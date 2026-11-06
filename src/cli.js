#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DEFAULT_PORT = 18766;
const ACTIVE = new Set(['accepted', 'queued', 'running']);
const FAILED = new Set(['failed', 'timeout', 'timed_out', 'cancelled', 'canceled', 'needs_intervention', 'needs_manual_intervention', 'needs_attention', 'unknown', 'interrupted', 'result_unknown']);
const BOOL_OPTIONS = new Set(['json', 'detach', 'overwrite', 'admin', 'recursive', 'follow', 'watch', 'help', 'version']);
const {CliError,normalizeFingerprint,openRequest,receiveResponse,responseJson,api,setSession,ensureEnabled,discoverServer}=require('./client-transport');
const {normalizeDeviceId}=require('./device-id');
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
async function secureConfig(dir) {
  if (process.platform !== 'darwin') return;
  for (const [file, directory, mode] of [[dir, true, 0o700], [path.join(dir, 'devices.json'), false, 0o600]]) {
    try {
      const stat = await fsp.lstat(file);
      if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
        throw new CliError('CONFIG_INVALID', `Expected a regular ${directory ? 'directory' : 'file'}: ${file}`);
      }
      await fsp.chmod(file, mode);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
async function resolveConfigDir(options = {}, context = {}) {
  const { platform = process.platform, env = process.env, home = os.homedir() } = context;
  if (options.config || env.WDB_CONFIG) return path.resolve(options.config || env.WDB_CONFIG);
  if (platform !== 'darwin') return path.join(env.LOCALAPPDATA || home, 'wdb', 'client');
  const dir = path.join(home, 'Library', 'Application Support', 'wdb', 'client');
  try { await fsp.lstat(dir); return dir; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const legacy = path.join(home, 'wdb', 'client');
  let content;
  try {
    await secureConfig(legacy);
    content = await fsp.readFile(path.join(legacy, 'devices.json'));
  } catch (error) { if (error.code === 'ENOENT') return dir; throw error; }
  try {
    if (!Array.isArray(JSON.parse(content).devices)) throw new Error();
  } catch { throw new CliError('CONFIG_INVALID', `Invalid legacy configuration: ${legacy}`); }
  await fsp.mkdir(path.dirname(dir), { recursive: true, mode: 0o700 });
  // Exclusively claim the new directory. Never merge into an existing profile.
  try { await fsp.mkdir(dir, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') return dir; throw error; }
  const temporary = path.join(dir, `.devices-${crypto.randomUUID()}.tmp`);
  try {
    await fsp.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await fsp.link(temporary, path.join(dir, 'devices.json'));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    await fsp.rm(temporary, { force: true });
    // If publication failed, remove only our empty directory, never another profile.
    await fsp.rmdir(dir).catch(error => { if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) throw error; });
  }
  return dir;
}
async function readConfig(dir) {
  try {
    await secureConfig(dir);
    const data = JSON.parse(await fsp.readFile(path.join(dir, 'devices.json'), 'utf8'));
    if (!data.devices || !Array.isArray(data.devices)) throw new Error('missing devices');
    let migrated=false;for(const device of data.devices){const id=normalizeDeviceId(device.deviceId);if(id!==device.deviceId){device.deviceId=id;migrated=true;}}
    if(migrated)await saveConfig(dir,data);
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, devices: [] };
    throw new CliError('CONFIG_INVALID', `Cannot read ${path.join(dir, 'devices.json')}: ${error.code || 'invalid JSON or device list'}`);
  }
}
async function saveConfig(dir, data) {
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  await secureConfig(dir);
  const temp = path.join(dir, `.devices-${crypto.randomUUID()}.tmp`);
  try {
    await fsp.writeFile(temp, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
    await fsp.rename(temp, path.join(dir, 'devices.json'));
  }
  finally { await fsp.rm(temp, { force: true }); }
}
function selectDevice(config, selector, allowDisconnected = false) {
  let matches = config.devices.filter(device => allowDisconnected || device.connected !== false);
  if (selector) {
    let normalized;
    try { normalized = normalizeTarget(selector); } catch { /* selector can be device ID */ }
    matches = matches.filter(device => normalizeDeviceId(device.deviceId) === normalizeDeviceId(selector) || device.url === normalized || device.name === selector || device.hostname?.toLowerCase() === selector.toLowerCase());
  }
  if (!matches.length) throw new CliError('NO_DEVICE', 'No matching connected device. Use wdb connect first.');
  if (matches.length > 1) throw new CliError('AMBIGUOUS_DEVICE', 'More than one device matches. Supply --device <address|deviceId>.', { candidates: matches.map(({ url, deviceId, hostname }) => ({ url, deviceId, hostname })) });
  return matches[0];
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function deviceSnapshot(dir,options,io,blocked){
  const config=await readConfig(dir),checkedAt=new Date().toISOString();
  const entries=await Promise.all(config.devices.map(async device=>{
    const result={url:device.url,hostname:device.hostname||null,deviceId:device.deviceId,clientId:device.clientId,version:device.version,fingerprint:device.fingerprint,enabled:device.connected!==false,connected:false,connectionState:'disconnected',lastConnected:device.lastConnected,checkedAt};
    if(!result.enabled){blocked?.delete(device.url);return result;}
    const identityKey=crypto.createHash('sha256').update(JSON.stringify([device.deviceId,device.token,device.fingerprint,device.lastConnected])).digest('hex');
    const cached=blocked?.get(device.url);if(cached?.identityKey===identityKey)return {...cached.result,checkedAt};
    setSession(device,options,io);
    try{const health=await discoverServer(device,{reconnectMs:0,timeoutMs:numberOption(options['probe-timeout'],2000,'--probe-timeout',1)});Object.assign(result,{connected:true,connectionState:'online',hostname:health.data.hostname||result.hostname,version:health.data.version||result.version,serverProcessId:health.data.serverProcessId});}
    catch(e){Object.assign(result,{connectionState:e.code==='UNAUTHORIZED'?'unauthorized':e.code==='PAIRING_REQUIRED'?'approval_required':['CERTIFICATE_MISMATCH','DEVICE_ID_MISMATCH'].includes(e.code)?'identity_mismatch':e.code==='INCOMPATIBLE_PROTOCOL'?'incompatible':'offline',error:{code:e.code,message:e.message}});}
    if(['unauthorized','approval_required','identity_mismatch','incompatible'].includes(result.connectionState))blocked?.set(device.url,{identityKey,result});else blocked?.delete(device.url);
    return result;
  }));
  const latest=await readConfig(dir);let changed=false;
  for(const entry of entries){const saved=latest.devices.find(d=>d.url===entry.url&&d.deviceId===entry.deviceId);if(!saved)continue;if(saved.connected===false){entry.enabled=false;entry.connected=false;entry.connectionState='disconnected';}
    if(entry.hostname&&saved.hostname!==entry.hostname){saved.hostname=entry.hostname;changed=true;}
  }
  if(changed)await saveConfig(dir,latest);return entries;
}
async function watchDevices(dir,options,io){
  const duration=numberOption(options.duration,Infinity,'--duration',1),interval=numberOption(options['poll-ms'],1000,'--poll-ms',50);let stopped=false,previous='',changes=0;const start=Date.now(),blocked=new Map();
  const interrupt=()=>{stopped=true;};process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{while(!stopped&&Date.now()-start<duration){const snapshot=await deviceSnapshot(dir,options,io,blocked);const signature=JSON.stringify(snapshot.map(({checkedAt,error,...d})=>({...d,errorCode:error?.code})));
    if(signature!==previous){printResult(makeEnvelope(snapshot,{status:'running'}),options,io);previous=signature;changes++;}
    if(!stopped)await sleep(Math.min(interval,Math.max(0,duration-(Date.now()-start))));
  }return makeEnvelope({stopped:true,changes,reason:stopped?'interrupted':'duration_limit'});}
  finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
function taskFrom(envelope) { return envelope.data?.task || envelope.data; }
function taskId(task) { return task?.id || task?.taskId; }
async function waitTask(device, id, options = {}, initial, io = process) {
  const poll = numberOption(options['poll-ms'], 350, '--poll-ms', 50);
  const waitMs = numberOption(options['wait-timeout'], 24 * 60 * 60 * 1000, '--wait-timeout', 1);
  const start = Date.now(); let lastHeartbeat = 0, result = initial;
  let lastOutputLength = 0;
  const query=async(method,endpoint,body)=>{
    const remaining=waitMs-(Date.now()-start);
    const timeout=()=>new CliError('CLIENT_WAIT_TIMEOUT',`Stopped waiting for task ${id}; it may still be running.`,{taskId:id});
    if(remaining<=0)throw timeout();
    try{return await api(device,method,endpoint,body,Math.min(numberOption(options['request-timeout'],10000,'--request-timeout',1),remaining),{reconnectMs:Math.min(numberOption(options['reconnect-timeout'],60000,'--reconnect-timeout'),remaining)});}
    catch(e){if(e.code==='RECONNECT_TIMEOUT'&&Date.now()-start>=waitMs)throw timeout();throw e;}
  };
  while (true) {
    await ensureEnabled(device);
    if (!result) result = await query('GET', `/v1/tasks/${encodeURIComponent(id)}`);
    const task = taskFrom(result);
    if (options.follow && !options.json) {
      const live = ACTIVE.has(task?.status || result.status) ? await query('GET', `/v1/tasks/${encodeURIComponent(id)}/output`) : null;
      const output = live?.data?.stdout ?? task?.data?.stdout ?? task?.result?.stdout ?? task?.output?.stdout ?? task?.stdout ?? '';
      if (output.length > lastOutputLength) io.stderr.write(output.slice(lastOutputLength));
      lastOutputLength = output.length;
    }
    if (!ACTIVE.has(task?.status || result.status)) return result;
    if (Date.now() - start > waitMs) throw new CliError('CLIENT_WAIT_TIMEOUT', `Stopped waiting for task ${id}; it may still be running.`, { taskId: id });
    if (Date.now() - lastHeartbeat > 1500) {
      await query('POST', '/v1/heartbeat', {});
      lastHeartbeat = Date.now();
    }
    await sleep(poll); result = null;
  }
}
async function runTask(device, op, args, options, io) {
  await discoverServer(device);
  const result = await api(device, 'POST', '/v1/tasks', { op, args, submissionId: crypto.randomUUID(), timeoutMs: numberOption(options.timeout, undefined, '--timeout', 1) });
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
  const mapped = { window: 'window', path: 'path', name: 'name', title: 'title', process: 'process', method: 'method', action: 'action', text: 'text', cwd: 'cwd', scope: 'scope', state: 'state', value: 'value', 'layout-id': 'layoutId', automationId: 'automationId', controlType: 'controlType', id: 'id', encoding: 'encoding', log: 'log', source: 'source', startTime: 'startTime', endTime: 'endTime', keyword: 'keyword' };
  for (const [flag, property] of Object.entries(mapped)) if (options[flag] !== undefined) args[property] = options[flag];
  for (const key of ['endpoint','target','selector','backend','expression','isolate','description','contains','property']) if (options[key] !== undefined) args[key] = options[key];
  for (const [flag,key] of Object.entries({'widget-type':'widgetType','source-file':'sourceFile','tree-mode':'treeMode'})) if(options[flag]!==undefined)args[key]=options[flag];
  if(options.line!==undefined)args.line=numberOption(options.line,undefined,'--line',1);
  for (const key of ['port','connectTimeoutMs','commandTimeoutMs']) if (options[key] !== undefined) args[key] = numberOption(options[key],undefined,`--${key}`,1);
  if (options['expression-file']) args.expression = fs.readFileSync(options['expression-file'],'utf8').replace(/^\uFEFF/,'');
  for (const key of ['x', 'y', 'width', 'height', 'toX', 'toY', 'delta', 'durationMs', 'timeoutMs', 'holdMs', 'depth', 'limit', 'fps', 'durationSeconds', 'monitor', 'pid', 'lines', 'limitBytes', 'offset', 'level', 'eventId']) if (options[key] !== undefined) args[key] = numberOption(options[key], undefined, `--${key}`, -1000000);
  if (options.ref || options.reference) args.reference = jsonOption(options.reference || options.ref);
  if (options.arguments !== undefined) args.arguments = command === 'electron' || command === 'app' && words[0] !== 'launch' ? jsonOption(options.arguments) : options.arguments;
  switch (command) {
    case 'call': if (!words[0]) throw new CliError('INVALID_ARGUMENT', 'call requires an operation.'); return { op: words[0], args };
    case 'screens': return { op: 'screens', args };
    case 'screenshot': if (words[0]) args.path = words[0]; return { op: 'screenshot', args };
    case 'desktop': return { op: `desktop.${words[0] || 'status'}`, args };
    case 'windows': if (!words[0] || words[0] === 'list') return { op: 'windows.list', args }; args.action = words[0]; if (words[1]) args.window = words[1]; return { op: 'windows.action', args };
    case 'ui': return { op: `ui.${words[0] || 'tree'}`, args };
    case 'electron': if(words[0]==='launch'&&words[1])args.path=words[1];return {op:`electron.${words[0]||'targets'}`,args};
    case 'flutter': return {op:`flutter.${words[0]||'info'}`,args};
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
const HELP = `wdb — Windows Debug Bridge

  wdb connect <server-IP-or-hostname>[:18766] --fingerprint <SHA256> --pairing-code <code>
    Server operator must approve new clients; --approval-timeout <ms> defaults to 150000.
  wdb devices [--watch] [--duration <ms>] | disconnect [address] | info
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
  wdb electron launch <exe> --port <port> [--arguments <JSON-array>]
  wdb electron targets|observe|tree|find|action|wait|eval|screenshot|logs --args <JSON>
  wdb flutter info|isolates|observe|tree|find|properties|wait|logs|memory|screenshot|action --args-file <JSON>
    --endpoint http://127.0.0.1:9222 --target <id> --selector <CSS> --backend auto|cdp|uia|visual
  wdb mouse click|doubleclick|drag|scroll --args <JSON>
  wdb key Ctrl+A | text <text> | touch --args-file <trajectory.json>
  wdb app launch|list|install|update|uninstall --args <JSON>
  wdb record start|stop --args <JSON> | logs events|file --args <JSON> [--follow]
  wdb call <operation> --args <JSON> [--args-file <file>]

Global: --json --device <address|id> --config <dir> --timeout <server-ms>
Recovery: --reconnect-timeout <ms> (default 60000; 0 disables) --request-timeout <ms>
Devices: --watch --poll-ms <ms> --probe-timeout <ms> (default 2000)
Tasks: --detach --wait-timeout <client-ms> --follow --poll-ms <ms>
Credentials: macOS ~/Library/Application Support/wdb/client;
  Windows %LOCALAPPDATA%\\wdb\\client (override: --config > WDB_CONFIG).
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
  const dir = await resolveConfigDir(options);
  const config = await readConfig(dir);
  if (command === 'devices') return { options, result: boolOption(options.watch)?await watchDevices(dir,options,io):makeEnvelope(await deviceSnapshot(dir,options,io)) };
  if (command === 'connect') {
    const url = normalizeTarget(words[0]);
    const approvalTimeout=numberOption(options['approval-timeout'],150000,'--approval-timeout',1000);
    let device = config.devices.find(entry => entry.url === url);
    if (device && !options['pairing-code']) {
      setSession(device,options,io);
      if (options.fingerprint && normalizeFingerprint(options.fingerprint) !== device.fingerprint) throw new CliError('CERTIFICATE_MISMATCH', 'Supplied fingerprint differs from saved device identity; re-pair explicitly.');
      let info;
      try{info=await api(device,'GET','/v1/info');}
      catch(e){if(e.code!=='PAIRING_REQUIRED')throw e;io.stderr.write('Waiting for approval on the Windows server.\n');const renewed=await api(device,'POST','/v1/connection',{},approvalTimeout,{reconnectMs:0});device.remembered=renewed.data.remembered;info=await api(device,'GET','/v1/info');}
      device.connected = true; device.lastConnected = new Date().toISOString();device.hostname=info.data.hostname||device.hostname;
      await saveConfig(dir, config);
      return { options, result: makeEnvelope({ url, deviceId: device.deviceId, clientId: device.clientId, reconnected: true, info: info.data }, { deviceId: device.deviceId }) };
    }
    if (!options['pairing-code']) throw new CliError('PAIRING_CODE_REQUIRED', 'First connection requires --pairing-code and --fingerprint from the server.');
    const next = { url, fingerprint: normalizeFingerprint(options.fingerprint||device?.fingerprint) };
    setSession(next,options,io);
    io.stderr.write('Waiting for approval on the Windows server (new connection).\n');
    const paired = await api(next, 'POST', '/v1/pair', { name: options.name || os.hostname(), pairingCode: String(options['pairing-code']) },approvalTimeout,{reconnectMs:0});
    if (!paired.data?.token || !paired.data.clientId || !paired.data.deviceId) throw new CliError('INVALID_RESPONSE', 'Pairing response is missing credentials or identity.');
    device = { ...next, ...paired.data, connected: true, lastConnected: new Date().toISOString() };
    setSession(device,options,io);
    const info=await api(device, 'GET', '/v1/info');device.hostname=info.data.hostname;
    config.devices = [...config.devices.filter(entry => entry.url !== url), device];
    await saveConfig(dir, config);
    const { token, ...publicDevice } = device;
    return { options, result: makeEnvelope(publicDevice, { deviceId: device.deviceId }) };
  }
  const device = selectDevice(config, command === 'disconnect' ? words[0] || options.device : options.device, command === 'disconnect');
  setSession(device,options,io,dir);
  let result;
  if (command === 'disconnect') {
    device.connected = false; await saveConfig(dir, config);
    try{result=await api(device,'DELETE','/v1/connection',undefined,2000,{reconnectMs:0});}
    catch(e){result=makeEnvelope({disconnected:true,credentialsRetained:true,remoteNotified:false,notificationError:{code:e.code,message:e.message}},{deviceId:device.deviceId});}
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
    await discoverServer(device);
    const start = Date.now();
    const transfer = command === 'push' ? await pushOne(device, words[0], words[1], options, io)
      : boolOption(options.recursive) ? await pullDirectory(device, words[0], words[1], options, io)
      : await pullFile(device, words[0], words[1], options, io);
    result = makeEnvelope(transfer, { deviceId: device.deviceId, durationMs: Date.now() - start });
  } else {
    const { op, args } = desktopCommand(command, words, options);
    if (boolOption(options.admin)) args.admin = true;
    result = command === 'logs' && boolOption(options.follow)
      ? (setSession(device,{...options,'reconnect-timeout':0},io,dir),await followLogs(device, op, args, options, io, dir))
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
  else if(Array.isArray(result.data)&&result.data.every(d=>d.connectionState)){
    io.stdout.write('STATE              HOSTNAME             ADDRESS                          DEVICE ID\n');
    for(const d of result.data)io.stdout.write(`${d.connectionState.padEnd(18)} ${(d.hostname||'(unknown)').padEnd(20)} ${d.url.padEnd(32)} ${d.deviceId}\n`);
    if(!result.data.length)io.stdout.write('(no paired devices)\n');
  }
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
module.exports = { main, execute, parseArgv, normalizeTarget, normalizeFingerprint, selectDevice, openRequest, api, sha256, pushOne, pullFile, pullDirectory, desktopCommand, CliError, resolveConfigDir, readConfig, saveConfig };
