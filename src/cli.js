#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DEFAULT_PORT = 18766;
const ACTIVE = new Set(['accepted', 'queued', 'running']);
const FAILED = new Set(['failed', 'timeout', 'timed_out', 'cancelled', 'canceled', 'needs_intervention', 'needs_manual_intervention', 'needs_attention', 'unknown', 'interrupted', 'result_unknown']);
const BOOL_OPTIONS = new Set(['json', 'detach', 'overwrite', 'admin', 'recursive', 'follow', 'help', 'version']);
class CliError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; this.extra = extra; }
}
function parseArgv(argv) {
  const positional = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const equal = value.indexOf('=');
    const key = value.slice(2, equal < 0 ? undefined : equal);
    if (!key) throw new CliError('INVALID_ARGUMENT', 'Empty option.');
    if (equal >= 0) options[key] = value.slice(equal + 1);
    else if (BOOL_OPTIONS.has(key)) options[key] = true;
    else {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new CliError('INVALID_ARGUMENT', `--${key} requires a value.`);
      options[key] = argv[++i];
    }
  }
  return { positional, options };
}
function normalizeTarget(value) {
  if (!value) throw new CliError('TARGET_REQUIRED', 'Supply a device address.');
  const target = new URL(value.includes('://') ? value : `https://${value}`);
  if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new CliError('INVALID_TARGET', 'Use an HTTPS hostname or IP, optionally with a port.');
  }
  if (!target.port && !/:\d+\/?$/.test(value)) target.port = String(DEFAULT_PORT);
  return target.origin;
}
function normalizeFingerprint(value) {
  const fingerprint = String(value || '').replace(/:/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new CliError('FINGERPRINT_REQUIRED', 'Provide the 64-digit SHA-256 certificate fingerprint displayed by the server.');
  return fingerprint;
}
function numberOption(value, fallback, name, min = 0) {
  if (value === undefined) return fallback;
  const result = Number(value);
  if (!Number.isFinite(result) || result < min) throw new CliError('INVALID_ARGUMENT', `${name} must be a number >= ${min}.`);
  return result;
}
function jsonOption(value, fallback = {}) {
  if (value === undefined) return fallback;
  try { return JSON.parse(value); } catch { throw new CliError('INVALID_ARGUMENT', 'Invalid JSON argument.'); }
}
function boolOption(value) { return value === true || value === 'true'; }
function makeEnvelope(data, extra = {}) {
  return { requestId: crypto.randomUUID(), deviceId: null, status: 'succeeded', error: null, durationMs: 0, artifacts: [], data, ...extra };
}
async function readConfig(dir) {
  try {
    const data = JSON.parse(await fsp.readFile(path.join(dir, 'devices.json'), 'utf8'));
    if (!data.devices || !Array.isArray(data.devices)) throw new Error('missing devices');
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, devices: [] };
    throw new CliError('CONFIG_INVALID', `Cannot read ${path.join(dir, 'devices.json')}: ${error.message}`);
  }
}
async function saveConfig(dir, data) {
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, `.devices-${crypto.randomUUID()}.tmp`);
  await fsp.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { await fsp.rename(temp, path.join(dir, 'devices.json')); }
  finally { await fsp.rm(temp, { force: true }); }
}
function selectDevice(config, selector, allowDisconnected = false) {
  let matches = config.devices.filter(device => allowDisconnected || device.connected !== false);
  if (selector) {
    let normalized;
    try { normalized = normalizeTarget(selector); } catch { /* selector can be device ID */ }
    matches = matches.filter(device => device.deviceId === selector || device.url === normalized || device.name === selector);
  }
  if (!matches.length) throw new CliError('NO_DEVICE', 'No matching connected device. Use wdb connect first.');
  if (matches.length > 1) throw new CliError('AMBIGUOUS_DEVICE', 'More than one device matches. Supply --device <address|deviceId>.', { candidates: matches.map(({ url, deviceId }) => ({ url, deviceId })) });
  return matches[0];
}

// Send no credentials or request body until the TLS certificate is pinned. A
// checkServerIdentity callback alone is insufficient with self-signed TLS.
function openRequest(device, method, pathname, headers = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const expected = normalizeFingerprint(device.fingerprint);
    const req = https.request(new URL(pathname, device.url), {
      method, rejectUnauthorized: false, agent: false,
      headers: { ...(device.token ? { authorization: `Bearer ${device.token}` } : {}), ...headers },
    });
    req.setTimeout(timeoutMs, () => req.destroy(new CliError('TRANSPORT_TIMEOUT', 'Connection timed out; the remote operation may still have occurred. Query its task before retrying.')));
    req.on('error', reject);
    req.once('socket', socket => socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      const actual = certificate.raw && crypto.createHash('sha256').update(certificate.raw).digest('hex');
      if (actual !== expected) {
        req.destroy(new CliError('CERTIFICATE_MISMATCH', 'Server certificate does not match the trusted fingerprint. No request was sent.'));
        return;
      }
      resolve(req);
    }));
  });
}
function receiveResponse(req) {
  return new Promise((resolve, reject) => { req.once('response', resolve); req.once('error', reject); });
}
async function responseJson(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new CliError('RESPONSE_TOO_LARGE', 'JSON response exceeds 32 MB; use file artifacts.');
    chunks.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new CliError('INVALID_RESPONSE', `Server returned invalid JSON (HTTP ${response.statusCode}).`); }
  if (response.statusCode >= 400 || result.error) {
    const error = new CliError(result.error?.code || 'HTTP_ERROR', result.error?.message || `HTTP ${response.statusCode}`);
    error.envelope = result;
    throw error;
  }
  return result;
}
async function api(device, method, endpoint, body, timeoutMs) {
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const req = await openRequest(device, method, endpoint, data ? { 'content-type': 'application/json', 'content-length': data.length } : {}, timeoutMs);
  const response = receiveResponse(req);
  req.end(data);
  const result = await responseJson(await response);
  if (endpoint === '/v1/info' && result.data?.protocolVersion !== undefined && result.data.protocolVersion !== 1) {
    throw new CliError('INCOMPATIBLE_PROTOCOL', `Server protocol ${result.data.protocolVersion} is incompatible with client protocol 1.`);
  }
  return result;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function taskFrom(envelope) { return envelope.data?.task || envelope.data; }
function taskId(task) { return task?.id || task?.taskId; }
async function waitTask(device, id, options = {}, initial, io = process) {
  const poll = numberOption(options['poll-ms'], 350, '--poll-ms', 50);
  const waitMs = numberOption(options['wait-timeout'], 24 * 60 * 60 * 1000, '--wait-timeout', 1);
  const start = Date.now(); let lastHeartbeat = 0, result = initial;
  let lastOutputLength = 0;
  while (true) {
    if (!result) result = await api(device, 'GET', `/v1/tasks/${encodeURIComponent(id)}`);
    const task = taskFrom(result);
    if (options.follow && !options.json) {
      const live = ACTIVE.has(task?.status || result.status) ? await api(device, 'GET', `/v1/tasks/${encodeURIComponent(id)}/output`) : null;
      const output = live?.data?.stdout ?? task?.data?.stdout ?? task?.result?.stdout ?? task?.output?.stdout ?? task?.stdout ?? '';
      if (output.length > lastOutputLength) io.stderr.write(output.slice(lastOutputLength));
      lastOutputLength = output.length;
    }
    if (!ACTIVE.has(task?.status || result.status)) return result;
    if (Date.now() - start > waitMs) throw new CliError('CLIENT_WAIT_TIMEOUT', `Stopped waiting for task ${id}; it may still be running.`, { taskId: id });
    if (Date.now() - lastHeartbeat > 1500) {
      await api(device, 'POST', '/v1/heartbeat', {});
      lastHeartbeat = Date.now();
    }
    await sleep(poll); result = null;
  }
}
async function runTask(device, op, args, options, io) {
  const result = await api(device, 'POST', '/v1/tasks', { op, args, timeoutMs: numberOption(options.timeout, undefined, '--timeout', 1) });
  const task = taskFrom(result);
  if (boolOption(options.detach) || !taskId(task) || !ACTIVE.has(task.status || result.status)) return result;
  return waitTask(device, taskId(task), options, result, io);
}
async function followLogs(device, op, args, options, io, configDir) {
  if (!['logs.file', 'logs.events'].includes(op)) throw new CliError('INVALID_ARGUMENT', '--follow supports file and events logs.');
  const interval = numberOption(options['poll-ms'], 1000, '--poll-ms', 100);
  const duration = numberOption(options.duration, Infinity, '--duration', 1);
  const started = Date.now(); let previous = null, stopped = false, count = 0;
  const seen = new Set();
  const interrupt = () => { stopped = true; };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  function emit(kind, data) {
    count++;
    if (options.json) io.stdout.write(`${JSON.stringify(makeEnvelope({ kind, ...data }, { deviceId: device.deviceId, status: 'running' }))}\n`);
    else io.stdout.write(kind === 'content' ? data.text : `${JSON.stringify({ kind, ...data })}\n`);
  }
  try {
    while (!stopped && Date.now() - started < duration) {
      const currentConfig = await readConfig(configDir);
      if (currentConfig.devices.find(entry => entry.url === device.url)?.connected === false) break;
      const response = await runTask(device, op, { ...args, ...(op === 'logs.file' ? { lines: undefined } : {}) }, { ...options, follow: false, detach: false }, io);
      const task = taskFrom(response);
      if (FAILED.has(task?.status) || task?.error) return response;
      const data = task?.data || task?.result || task;
      if (op === 'logs.file') {
        const rotated = previous && data.fileId !== previous.fileId;
        const truncated = previous && data.size < previous.size;
        if (rotated) emit('rotated', { path: args.path, previousFileId: previous.fileId, fileId: data.fileId });
        else if (truncated) emit('truncated', { path: args.path, previousSize: previous.size, size: data.size });
        if (!previous || rotated || truncated) emit('content', { path: args.path, text: data.text, offset: data.offset });
        else if (data.size > previous.size) {
          if (data.offset > previous.size) emit('gap', { path: args.path, lostBytes: data.offset - previous.size, reason: 'Growth exceeded the configured log read window; query the source file.' });
          const skip = Math.max(0, previous.size - data.offset);
          const bytes = Buffer.from(data.text, data.encoding || 'utf8');
          emit('content', { path: args.path, text: bytes.subarray(skip).toString(data.encoding || 'utf8'), offset: Math.max(previous.size, data.offset) });
        }
        previous = data;
      } else {
        const entries = data.entries || [];
        for (const entry of [...entries].reverse()) {
          const key = `${entry.RecordId}:${entry.TimeCreated}`;
          if (!seen.has(key)) { seen.add(key); emit('event', { log: args.log || 'Application', event: entry }); }
        }
        if (data.nextOffset !== null && data.nextOffset !== undefined) emit('page_available', { nextOffset: data.nextOffset, message: 'Query the next page or narrow the time range to retrieve further history.' });
        if (seen.size > 10000) { const retained = [...seen].slice(-5000); seen.clear(); for (const key of retained) seen.add(key); }
      }
      if (!stopped) await sleep(Math.min(interval, Math.max(0, duration - (Date.now() - started))));
    }
    return makeEnvelope({ stopped: true, emitted: count, reason: stopped ? 'interrupted' : Date.now() - started >= duration ? 'duration_limit' : 'disconnected' }, { deviceId: device.deviceId, durationMs: Date.now() - started });
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}
function progressTransform(io, label, total) {
  let bytes = 0, last = 0;
  const stream = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (Date.now() - last > 1000) {
      io.stderr.write(`${label}: ${bytes}${total === undefined ? '' : `/${total}`} bytes\n`); last = Date.now();
    }
    callback(null, chunk);
  }});
  stream.byteCount = () => bytes;
  return stream;
}
function remoteJoin(base, name) { return `${base.replace(/[\\/]+$/, '')}/${name}`; }
async function pushOne(device, local, remote, options, io) {
  const stat = await fsp.lstat(local);
  if (stat.isSymbolicLink()) throw new CliError('SYMLINK_UNSUPPORTED', `Transfer of symbolic links is not supported: ${local}`);
  if (stat.isDirectory()) {
    await api(device, 'POST', '/v1/directories', { path: remote });
    const results = [];
    for (const entry of await fsp.readdir(local, { withFileTypes: true })) {
      results.push(await pushOne(device, path.join(local, entry.name), remoteJoin(remote, entry.name), options, io));
    }
    return { type: 'directory', path: remote, entries: results };
  }
  if (!stat.isFile()) throw new CliError('FILE_TYPE_UNSUPPORTED', `Not a regular file: ${local}`);
  const start = Date.now();
  const checksum = await sha256(local);
  const transferStart = Date.now();
  const req = await openRequest(device, 'PUT', `/v1/files?${new URLSearchParams({ path: remote, overwrite: String(boolOption(options.overwrite)) })}`, { 'content-type': 'application/octet-stream', 'content-length': stat.size, 'x-content-sha256': checksum }, numberOption(options['transfer-timeout'], 120000, '--transfer-timeout', 1));
  const responsePromise = receiveResponse(req).then(responseJson);
  // Attach rejection handler immediately while the stream is still uploading.
  responsePromise.catch(() => {});
  const progress = progressTransform(io, `push ${path.basename(local)}`, stat.size);
  try {
    await pipeline(fs.createReadStream(local, { highWaterMark: 1024 * 1024 }), progress, req);
    const result = await responsePromise;
    const serverHash = result.data?.sha256 || result.data?.checksum;
    if (serverHash && serverHash.toLowerCase() !== checksum) throw new CliError('CHECKSUM_MISMATCH', 'Server reported a different checksum.');
    return { type: 'file', requestId: result.requestId, deviceId: result.deviceId, localPath: path.resolve(local), path: remote, bytes: progress.byteCount(), sha256: checksum, checksumMs: transferStart - start, transferMs: Date.now() - transferStart, durationMs: Date.now() - start, result: result.data };
  } catch (error) { req.destroy(); throw error; }
}
async function pullFile(device, remote, local, options, io) {
  const start = Date.now();
  const absolute = path.resolve(local);
  if (!boolOption(options.overwrite)) {
    try { await fsp.lstat(absolute); throw new CliError('ALREADY_EXISTS', `Destination already exists: ${absolute}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${crypto.randomUUID()}.wdb-part`);
  const req = await openRequest(device, 'GET', `/v1/files?${new URLSearchParams({ path: remote })}`, {}, numberOption(options['transfer-timeout'], 120000, '--transfer-timeout', 1));
  const responsePromise = receiveResponse(req); req.end();
  const response = await responsePromise;
  const responseAt = Date.now();
  if (response.statusCode >= 400) return responseJson(response);
  const expected = String(response.headers['x-content-sha256'] || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) { response.destroy(); throw new CliError('CHECKSUM_MISSING', 'Server did not provide a valid SHA-256 checksum.'); }
  const hash = crypto.createHash('sha256');
  const progress = progressTransform(io, `pull ${path.basename(absolute)}`, response.headers['content-length']);
  const hasher = new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); } });
  try {
    await pipeline(response, hasher, progress, fs.createWriteStream(temporary, { flags: 'wx', highWaterMark: 1024 * 1024 }));
    const transferMs = Date.now() - responseAt;
    const actual = hash.digest('hex');
    if (expected !== actual) throw new CliError('CHECKSUM_MISMATCH', 'Downloaded content failed its SHA-256 integrity check.');
    if (boolOption(options.overwrite)) await fsp.rename(temporary, absolute);
    else { await fsp.link(temporary, absolute); await fsp.unlink(temporary); }
    return { type: 'file', localPath: absolute, path: remote, bytes: progress.byteCount(), sha256: actual, responseWaitMs: responseAt - start, transferMs, checksumMode: 'inline-sha256', durationMs: Date.now() - start };
  } finally { req.destroy(); await fsp.rm(temporary, { force: true }); }
}
async function pullDirectory(device, remote, local, options, io) {
  const listing = await api(device, 'GET', `/v1/directories?${new URLSearchParams({ path: remote })}`);
  const entries = listing.data?.entries || listing.data;
  if (!Array.isArray(entries)) throw new CliError('INVALID_RESPONSE', 'Directory response must contain entries.');
  await fsp.mkdir(local, { recursive: true });
  const results = [];
  for (const entry of entries) {
    if (!entry.name || /[\\/:]/.test(entry.name) || entry.name === '.' || entry.name === '..') throw new CliError('INVALID_RESPONSE', 'Server supplied an unsafe directory entry.');
    const childRemote = remoteJoin(remote, entry.name), childLocal = path.join(local, entry.name);
    if (entry.type === 'directory' || entry.isDirectory === true) results.push(await pullDirectory(device, childRemote, childLocal, options, io));
    else if (entry.type === 'file' || entry.isFile === true) results.push(await pullFile(device, childRemote, childLocal, options, io));
    else throw new CliError('FILE_TYPE_UNSUPPORTED', `Unsupported remote entry: ${entry.name}`);
  }
  return { type: 'directory', path: remote, localPath: path.resolve(local), entries: results };
}

function desktopCommand(command, words, options) {
  const args = jsonOption(options.args);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new CliError('INVALID_ARGUMENT', '--args must be a JSON object.');
  // JSON argument files avoid shell quoting and command-line length limitations.
  const mapped = { window: 'window', path: 'path', name: 'name', title: 'title', process: 'process', method: 'method', action: 'action', text: 'text', cwd: 'cwd', state: 'state', value: 'value', 'layout-id': 'layoutId', automationId: 'automationId', controlType: 'controlType', id: 'id', encoding: 'encoding', log: 'log', source: 'source', startTime: 'startTime', endTime: 'endTime', keyword: 'keyword' };
  for (const [flag, property] of Object.entries(mapped)) if (options[flag] !== undefined) args[property] = options[flag];
  for (const key of ['x', 'y', 'width', 'height', 'toX', 'toY', 'delta', 'durationMs', 'timeoutMs', 'holdMs', 'depth', 'limit', 'fps', 'durationSeconds', 'monitor', 'pid', 'lines', 'limitBytes', 'offset', 'level', 'eventId']) if (options[key] !== undefined) args[key] = numberOption(options[key], undefined, `--${key}`, -1000000);
  if (options.ref || options.reference) args.reference = jsonOption(options.reference || options.ref);
  if (options.arguments !== undefined) args.arguments = command === 'app' && words[0] !== 'launch' ? jsonOption(options.arguments) : options.arguments;
  switch (command) {
    case 'call': if (!words[0]) throw new CliError('INVALID_ARGUMENT', 'call requires an operation.'); return { op: words[0], args };
    case 'screens': return { op: 'screens', args };
    case 'screenshot': if (words[0]) args.path = words[0]; return { op: 'screenshot', args };
    case 'desktop': return { op: `desktop.${words[0] || 'status'}`, args };
    case 'windows': if (!words[0] || words[0] === 'list') return { op: 'windows.list', args }; args.action = words[0]; if (words[1]) args.window = words[1]; return { op: 'windows.action', args };
    case 'ui': return { op: `ui.${words[0] || 'tree'}`, args };
    case 'mouse': if (words[0]) args.action = words[0] === 'doubleclick' ? 'doubleClick' : words[0]; return { op: 'input.mouse', args };
    case 'key': if (words[0]) args.keys = words[0].split('+'); if (words[1]) args.action = words[1]; return { op: 'input.key', args };
    case 'text': if (words[0] !== undefined) args.text = words.join(' '); return { op: 'input.text', args };
    case 'touch': return { op: 'input.touch', args };
    case 'app': if (words[1]) args.path = words[1]; return { op: `${words[0] === 'launch' ? 'app' : 'apps'}.${words[0] || 'list'}`, args };
    case 'record': return { op: `record.${words[0] || 'start'}`, args };
    case 'logs': return { op: `logs.${words[0] || 'events'}`, args };
    case 'artifacts': if (words[1]) args.taskId = words[1]; return { op: `artifacts.${words[0] || 'list'}`, args };
    default: throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${command}. Run wdb --help.`);
  }
}
const HELP = `wdb — Windows Debug Bridge (localhost-first)

  wdb connect localhost[:18766] --fingerprint <SHA256> --pairing-code <code>
  wdb devices | disconnect [address] | info
  wdb clients list | clients revoke <clientId>
  wdb shell --script <PowerShell> [--cwd <dir>] [--env <JSON>] [--admin] [--detach]
  wdb task list|get <id>|wait <id>|cancel <id>|output <id>|delete <id>
  wdb push <local-file-or-dir> <remote-path> [--overwrite]
  wdb pull <remote-file> <local-path> [--overwrite]
  wdb pull <remote-dir> <local-dir> --recursive
  wdb screens | desktop status | windows list
  wdb screenshot [remote-output.png] [--window <id>] [--monitor <id>]
  wdb windows focus|maximize|minimize|restore|move|resize|close <id> --args <JSON>
  wdb ui tree|find|action|wait --args <JSON>
  wdb mouse click|doubleclick|drag|scroll --args <JSON>
  wdb key Ctrl+A | text <text> | touch --args-file <trajectory.json>
  wdb app launch|list|install|update|uninstall --args <JSON>
  wdb record start|stop --args <JSON> | logs events|file --args <JSON> [--follow]
  wdb call <operation> --args <JSON> [--args-file <file>]

Global: --json --device <address|id> --config <dir> --timeout <server-ms>
Tasks: --detach --wait-timeout <client-ms> --follow --poll-ms <ms>
Credentials: %LOCALAPPDATA%\\wdb\\client (override: WDB_CONFIG).
Observe task state before retrying side effects after timeouts.
`;

async function execute(argv, io) {
  const { positional, options } = parseArgv(argv);
  if (options.version) return { result: makeEnvelope({ version: '0.1.0' }), options };
  if (options.help || !positional.length) return { help: HELP, options };
  const [command, ...words] = positional;
  if (options['args-file']) {
    if (options.args !== undefined) throw new CliError('INVALID_ARGUMENT', 'Use either --args or --args-file.');
    options.args = await fsp.readFile(path.resolve(options['args-file']), 'utf8');
  }
  const dir = options.config || process.env.WDB_CONFIG || path.join(process.env.LOCALAPPDATA || os.homedir(), 'wdb', 'client');
  const config = await readConfig(dir);
  if (command === 'devices') return { options, result: makeEnvelope(config.devices.map(({ token, fingerprint, ...device }) => ({ ...device, fingerprint }))) };
  if (command === 'connect') {
    const url = normalizeTarget(words[0]);
    let device = config.devices.find(entry => entry.url === url);
    if (device && !options['pairing-code']) {
      if (options.fingerprint && normalizeFingerprint(options.fingerprint) !== device.fingerprint) throw new CliError('CERTIFICATE_MISMATCH', 'Supplied fingerprint differs from saved device identity; re-pair explicitly.');
      const info = await api(device, 'GET', '/v1/info');
      device.connected = true; device.lastConnected = new Date().toISOString();
      await saveConfig(dir, config);
      return { options, result: makeEnvelope({ url, deviceId: device.deviceId, clientId: device.clientId, reconnected: true, info: info.data }, { deviceId: device.deviceId }) };
    }
    if (!options['pairing-code']) throw new CliError('PAIRING_CODE_REQUIRED', 'First connection requires --pairing-code and --fingerprint from the server.');
    const next = { url, fingerprint: normalizeFingerprint(options.fingerprint) };
    const paired = await api(next, 'POST', '/v1/pair', { name: options.name || os.hostname(), pairingCode: String(options['pairing-code']) });
    if (!paired.data?.token || !paired.data.clientId || !paired.data.deviceId) throw new CliError('INVALID_RESPONSE', 'Pairing response is missing credentials or identity.');
    device = { ...next, ...paired.data, connected: true, lastConnected: new Date().toISOString() };
    await api(device, 'GET', '/v1/info');
    config.devices = [...config.devices.filter(entry => entry.url !== url), device];
    await saveConfig(dir, config);
    const { token, ...publicDevice } = device;
    return { options, result: makeEnvelope(publicDevice, { deviceId: device.deviceId }) };
  }
  const device = selectDevice(config, command === 'disconnect' ? words[0] || options.device : options.device, command === 'disconnect');
  let result;
  if (command === 'disconnect') {
    result = await api(device, 'DELETE', '/v1/connection');
    device.connected = false; await saveConfig(dir, config);
  } else if (command === 'info') result = await api(device, 'GET', '/v1/info');
  else if (command === 'clients') {
    if (!words[0] || words[0] === 'list') result = await api(device, 'GET', '/v1/clients');
    else if (words[0] === 'revoke' && words[1]) result = await api(device, 'DELETE', `/v1/clients/${encodeURIComponent(words[1])}`);
    else throw new CliError('INVALID_ARGUMENT', 'Use clients list or clients revoke <clientId>.');
  } else if (command === 'task') {
    const [action = 'list', id] = words;
    if (action === 'list') result = await api(device, 'GET', '/v1/tasks');
    else if (!id) throw new CliError('INVALID_ARGUMENT', 'Task ID is required.');
    else if (action === 'get') result = await api(device, 'GET', `/v1/tasks/${encodeURIComponent(id)}`);
    else if (action === 'cancel') result = await api(device, 'POST', `/v1/tasks/${encodeURIComponent(id)}/cancel`, {});
    else if (action === 'delete') result = await api(device, 'DELETE', `/v1/tasks/${encodeURIComponent(id)}`);
    else if (action === 'output') result = await api(device, 'GET', `/v1/tasks/${encodeURIComponent(id)}/output`);
    else if (action === 'wait') result = await waitTask(device, id, options, null, io);
    else throw new CliError('INVALID_ARGUMENT', `Unknown task action: ${action}`);
  } else if (command === 'shell') {
    const script = options['script-file'] ? await fsp.readFile(options['script-file'], 'utf8') : options.script || words.join(' ');
    if (!script) throw new CliError('INVALID_ARGUMENT', 'shell requires --script, --script-file, or a script after --.');
    result = await runTask(device, 'shell', { command: script, cwd: options.cwd, env: jsonOption(options.env), admin: boolOption(options.admin) }, options, io);
  } else if (command === 'push' || command === 'pull') {
    if (words.length !== 2) throw new CliError('INVALID_ARGUMENT', `${command} requires source and destination paths.`);
    const start = Date.now();
    const transfer = command === 'push' ? await pushOne(device, words[0], words[1], options, io)
      : boolOption(options.recursive) ? await pullDirectory(device, words[0], words[1], options, io)
      : await pullFile(device, words[0], words[1], options, io);
    result = makeEnvelope(transfer, { deviceId: device.deviceId, durationMs: Date.now() - start });
  } else {
    const { op, args } = desktopCommand(command, words, options);
    if (boolOption(options.admin)) args.admin = true;
    result = command === 'logs' && boolOption(options.follow)
      ? await followLogs(device, op, args, options, io, dir)
      : await runTask(device, op, args, options, io);
  }
  return { options, result };
}
function exitCode(result) {
  const task = taskFrom(result);
  return result.error || task?.error || FAILED.has(result.status) || FAILED.has(task?.status) ? 1 : 0;
}
function printResult(result, options, io) {
  if (options.json) io.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    io.stdout.write(`${result.status || 'unknown'}${result.deviceId ? ` — ${result.deviceId}` : ''}${taskId(taskFrom(result)) ? ` — task ${taskId(taskFrom(result))}` : ''}\n`);
    if (result.error) io.stderr.write(`${result.error.code}: ${result.error.message}\n`);
    if (result.data !== undefined && result.data !== null) io.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
  }
}
async function main(argv = process.argv.slice(2), io = process) {
  try {
    const { help, result, options } = await execute(argv, io);
    if (help) { io.stdout.write(help); return 0; }
    printResult(result, options, io); return exitCode(result);
  } catch (error) {
    const result = error.envelope || makeEnvelope(error.extra || null, { status: 'failed', error: { code: error.code || 'CLIENT_ERROR', message: error.message } });
    printResult(result, { json: argv.includes('--json') || argv.includes('--json=true') }, io);
    return 1;
  }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main, execute, parseArgv, normalizeTarget, normalizeFingerprint, selectDevice, openRequest, api, sha256, pushOne, pullFile, pullDirectory, desktopCommand, CliError };
