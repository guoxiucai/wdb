'use strict';
// Client-only protocol fixtures; no Windows binaries or service credentials.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { main, saveConfig, desktopCommand, pullFile } = require('../src/cli');
const { api, setSession } = require('../src/client-transport');

let directory, tlsOptions, fingerprint;
const deviceId = '0123456789abcdef', token = 'fixture-private-token';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const envelope = data => ({ requestId: crypto.randomUUID(), deviceId, status: 'succeeded', error: null, data, artifacts: [], durationMs: 0 });
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wdb-portable-'));
  const cert = path.join(directory, 'cert.pem'), key = path.join(directory, 'key.pem');
  const openssl = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl';
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  tlsOptions = { cert: await fs.readFile(cert), key: await fs.readFile(key) };
  fingerprint = crypto.createHash('sha256').update(new crypto.X509Certificate(tlsOptions.cert).raw).digest('hex');
});
after(() => fs.rm(directory, { recursive: true, force: true }));

async function fixture(t, handler) {
  const requests = [], tasks = new Map(), bodies = [];
  const state = { requests, tasks, bodies, deduplication: true, taskStatus: 'succeeded', executions: 0, cancellations: 0 };
  const server = https.createServer(tlsOptions, async (req, res) => {
    try {
      requests.push({ method: req.method, url: req.url });
      const respond = data => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(envelope(data))); };
      if (await handler?.(req, res, state, respond)) return;
      if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401); res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Revoked' } })); return; }
      if (req.url === '/v1/health' || req.url === '/v1/info') return respond({ deviceId, hostname: 'fixture', protocolVersion: 1, taskSubmissionDeduplication: state.deduplication });
      if (req.url === '/v1/heartbeat') return respond({ connected: true });
      if (req.url === '/v1/tasks' && req.method === 'POST') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        bodies.push(raw);
        const body = JSON.parse(raw);
        let task = tasks.get(body.submissionId);
        if (!task) {
          state.executions++;
          task = { id: crypto.randomUUID(), status: state.taskStatus, data: { stdout: '中文\n第二行 🌍\n', fileId: 'log-1', text: '日志 🌍\n', size: 12, offset: 0, encoding: 'utf8' }, durationMs: 321 };
          tasks.set(body.submissionId, task);
        }
        if (state.dropAcceptance && bodies.length === 1) { req.socket.destroy(); return; }
        return respond(task);
      }
      if (req.url.endsWith('/cancel')) {
        state.cancellations++;
        for (const task of tasks.values()) task.status = 'cancelled';
        return respond({ cancelled: true });
      }
      if (req.url.startsWith('/v1/tasks/')) {
        const task = [...tasks.values()].find(item => req.url.includes(item.id)) || state.existingTask;
        return respond(task);
      }
      res.writeHead(404); res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: req.url } }));
    } catch (error) { res.destroy(error); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const device = { url: 'https://127.0.0.1:' + server.address().port, deviceId, fingerprint, token, connected: true };
  const config = path.join(directory, crypto.randomUUID()); await saveConfig(config, { devices: [device] });
  const common = ['--config', config, '--json', '--request-timeout', '200', '--reconnect-timeout', '1500', '--poll-ms', '100'];
  async function cli(args) {
    let stdout = '', stderr = '';
    const code = await main([...args, ...common], { stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } });
    return { code, result: JSON.parse(stdout), stdout, stderr };
  }
  function processCli(args) {
    const child = spawn(process.execPath, [path.join(__dirname, '../src/cli.js'), ...args, ...common]);
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', text => { stdout += text; });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr += text; });
    const done = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    return { child, done, output: () => stdout };
  }
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  setSession(device, { 'request-timeout': 200, 'reconnect-timeout': 1500 });
  return { state, device, cli, processCli };
}
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Timed out waiting for fixture observation'); await delay(20); }
}

test('lost acceptance retries the identical submission and executes once', async t => {
  const f = await fixture(t); f.state.dropAcceptance = true;
  const result = await f.cli(['shell', '--script', 'fixture command']);
  assert.equal(result.code, 0); assert.equal(f.state.executions, 1); assert.equal(f.state.bodies.length, 2);
  assert.equal(f.state.bodies[0], f.state.bodies[1]);
  assert.equal(result.result.data.data.stdout, '中文\n第二行 🌍\n');
  assert.equal(result.result.data.durationMs, 321); assert.match(result.stderr, /Connection restored/);
});

test('without advertised deduplication an uncertain task submission is not replayed', async t => {
  const f = await fixture(t); f.state.dropAcceptance = true; f.state.deduplication = false;
  const result = await f.cli(['shell', '--script', 'fixture command']);
  assert.equal(result.code, 1); assert.equal(result.result.error.code, 'REQUEST_OUTCOME_UNKNOWN');
  assert.equal(f.state.executions, 1); assert.equal(f.state.bodies.length, 1);
});

test('identity and authorization failures stop immediately; split UTF-8 JSON stays intact', async t => {
  let mode = 'identity';
  const f = await fixture(t, (req, res) => {
    if (mode === 'identity') { res.end(JSON.stringify({ ...envelope({}), deviceId: 'fedcba9876543210' })); return true; }
    if (mode === 'revoked') { res.writeHead(401); res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Revoked' } })); return true; }
    const bytes = Buffer.from(JSON.stringify(envelope({ text: '中文\n🌍' })));
    res.write(bytes.subarray(0, bytes.length - 5)); res.end(bytes.subarray(bytes.length - 5)); return true;
  });
  await assert.rejects(api(f.device, 'GET', '/v1/info'), { code: 'DEVICE_ID_MISMATCH' });
  assert.equal(f.state.requests.length, 1); mode = 'revoked';
  await assert.rejects(api(f.device, 'GET', '/v1/info'), { code: 'UNAUTHORIZED' });
  assert.equal(f.state.requests.length, 2); mode = 'utf8';
  assert.equal((await api(f.device, 'GET', '/v1/info')).data.text, '中文\n🌍');
});

test('wait reconnects after a dropped response and reports service restart uncertainty without submitting', async t => {
  let polls = 0;
  const f = await fixture(t, (req, res, state, respond) => {
    if (req.url !== '/v1/tasks/existing') return false;
    if (++polls === 1) { req.socket.destroy(); return true; }
    respond({ id: 'existing', status: 'unknown', error: { code: 'SERVICE_RESTARTED', message: 'Service restarted' } }); return true;
  });
  const result = await f.cli(['task', 'wait', 'existing']);
  assert.equal(result.code, 1); assert.equal(result.result.data.status, 'unknown');
  assert.equal(polls, 2); assert.equal(f.state.executions, 0);
});

test('Ctrl+C only interrupts an ordinary waiter; task cancel is explicit', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); f.state.taskStatus = 'running';
  const child = f.processCli(['shell', '--script', 'long fixture command']);
  await until(() => f.state.requests.some(item => item.url === '/v1/heartbeat'));
  child.child.kill('SIGINT'); const exit = await child.done;
  assert.equal(exit.signal, 'SIGINT'); assert.equal(f.state.cancellations, 0);
  const task = [...f.state.tasks.values()][0]; assert.equal(task.status, 'running');
  assert.equal((await f.cli(['task', 'cancel', task.id])).code, 0);
  const cancelled = await f.cli(['task', 'get', task.id]);
  assert.equal(cancelled.code, 1); assert.equal(cancelled.result.data.status, 'cancelled');
});

test('Ctrl+C stops devices watch and log follow with a final JSON result', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  for (const args of [['devices', '--watch'], ['logs', 'file', '--path', 'C:\\日志.txt', '--follow']]) {
    const child = f.processCli(args);
    await until(() => child.output().includes('\n'));
    child.child.kill('SIGINT'); const exit = await child.done;
    assert.equal(exit.code, 0); assert.equal(exit.signal, null);
    const events = exit.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.at(-1).data.reason, 'interrupted');
    assert.ok(!exit.stdout.includes(token));
  }
  assert.equal(f.state.cancellations, 0);
});

test('local argument files preserve Windows paths and PowerShell content', async t => {
  const f = await fixture(t), file = path.join(directory, '参数 中文.json'), script = path.join(directory, '脚本.ps1');
  const args = { path: 'C:\\目录\\文件.txt', cwd: 'D:\\工作 区', text: '中文 🌍\n第二行' };
  await fs.writeFile(file, JSON.stringify(args));
  assert.equal((await f.cli(['call', 'fixture', '--args-file', file])).code, 0);
  assert.deepEqual(JSON.parse(f.state.bodies.at(-1)).args, args);
  await fs.writeFile(script, '[Console]::Write($env:TEMP); Write-Output "中文 🌍"');
  await f.cli(['shell', '--script-file', script, '--cwd', args.cwd]);
  assert.equal(JSON.parse(f.state.bodies.at(-1)).args.command, await fs.readFile(script, 'utf8'));
  assert.equal(JSON.parse(f.state.bodies.at(-1)).args.cwd, args.cwd);
  const expression = path.join(directory, 'expression.js'); await fs.writeFile(expression, '\ufeffdocument.title + "中文"');
  assert.equal(desktopCommand('electron', ['eval'], { 'expression-file': expression }).args.expression, 'document.title + "中文"');
});

test('interrupted >4 GiB declared download preserves the destination and cleans partial files', async t => {
  const f = await fixture(t, (req, res) => {
    if (!req.url.startsWith('/v1/files')) return false;
    res.writeHead(200, { 'content-length': 2 ** 32 + 17, 'x-content-sha256': '0'.repeat(64) });
    res.write(Buffer.alloc(8192)); setTimeout(() => res.destroy(), 20); return true;
  });
  const local = path.join(directory, 'preserved.txt'); await fs.writeFile(local, 'keep');
  let progress = '';
  await assert.rejects(pullFile(f.device, 'C:\\huge.bin', local, { overwrite: true }, { stderr: { write: text => { progress += text; } } }));
  assert.match(progress, /4294967313/);
  assert.equal(await fs.readFile(local, 'utf8'), 'keep');
  assert.ok(!(await fs.readdir(directory)).some(file => file.endsWith('.wdb-part')));
});
