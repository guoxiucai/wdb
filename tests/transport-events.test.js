'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Bridge } = require('../src/server');
const { main, saveConfig, pushOne, pullFile } = require('../src/cli');
const { api, setSession, withTransport, consumeTaskEvents } = require('../src/client-transport');

let root, tlsOptions, fingerprint;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const silent = { stdout: { write() {} }, stderr: { write() {} } };
before(() => {
 root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdb-transport-events-'));
 const cert = path.join(root, 'cert.pem'), key = path.join(root, 'key.pem');
 const openssl = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl';
 execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
 execFileSync(openssl, ['pkcs12', '-export', '-out', path.join(root, 'tls.pfx'), '-inkey', key, '-in', cert, '-passout', 'pass:fixture', '-keypbe', 'AES-256-CBC', '-certpbe', 'AES-256-CBC', '-macalg', 'sha256'], { stdio: 'ignore' });
 tlsOptions = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
 fingerprint = crypto.createHash('sha256').update(new crypto.X509Certificate(tlsOptions.cert).raw).digest('hex');
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

async function setup(t) {
 const dir = fs.mkdtempSync(path.join(root, 'server-'));
 fs.copyFileSync(path.join(root, 'tls.pfx'), path.join(dir, 'tls.pfx'));
 fs.writeFileSync(path.join(dir, 'tls-password'), 'fixture');
 fs.writeFileSync(path.join(dir, 'helper-secret'), 'fixture-helper');
 const bridge = new Bridge({ dataDir: dir, approvePairing: async () => ({ decision: 'approved', remember: true }) });
 await bridge.listen(0);
 const seed = { url: 'https://127.0.0.1:' + bridge.server.address().port, fingerprint };
 const paired = await withTransport(() => api(seed, 'POST', '/v1/pair', { name: 'test' }));
 const device = { ...seed, ...paired.data, connected: true };
 const config = path.join(dir, 'client'); await saveConfig(config, { devices: [device] });
 setSession(device, { 'request-timeout': 1000, 'reconnect-timeout': 2000 }, silent, config);
 const requests = [], sockets = new Set(), route = bridge.route.bind(bridge);
 bridge.route = (req, res) => { requests.push(req.url); sockets.add(req.socket); return route(req, res); };
 const makeTask = () => {
  const task = { id: crypto.randomUUID(), clientId: device.clientId, deviceId: device.deviceId, status: 'running', op: 'shell', createdAt: new Date().toISOString(), artifacts: [] };
  bridge.tasks.set(task.id, task); bridge.save(task); return task;
 };
 const output = (task, bytes) => {
  fs.appendFileSync(path.join(dir, 'tasks', task.id, 'stdout.live'), bytes);
  bridge.taskEvents.output(task, 'stdout', bytes);
 };
 const complete = (task, stdout = '') => {
  task.status = 'succeeded'; task.data = { stdout, exitCode: 0 }; task.endedAt = new Date().toISOString(); bridge.save(task);
 };
 const cli = async (args, onStderr, json = true) => {
  let stdout = '', stderr = '';
  const code = await main(['--wait-timeout', '5000', ...args, '--config', config, '--request-timeout', '500', '--reconnect-timeout', '1500', ...(json ? ['--json'] : [])], {
   stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; onStderr?.(text); } }
  });
  return { code, stdout, stderr, ...(json ? { result: JSON.parse(stdout.trim().split('\n').at(-1)) } : {}) };
 };
 t.after(async () => { await bridge.close(); fs.rmSync(dir, { recursive: true, force: true }); });
 return { dir, bridge, device, config, requests, sockets, makeTask, output, complete, cli };
}
async function until(predicate) {
 const deadline = Date.now() + 4000;
 while (!predicate()) { assert.ok(Date.now() < deadline, 'Timed out waiting for observation'); await delay(10); }
}

test('JSON requests and file transfers reuse one pinned TLS connection', async t => {
 const f = await setup(t);
 const source = path.join(f.dir, 'source'), remote = path.join(f.dir, 'remote'), dest = path.join(f.dir, 'download');
 fs.writeFileSync(source, crypto.randomBytes(128 * 1024));
 await withTransport(async () => {
  for (let i = 0; i < 5; i++) await api({ ...f.device }, 'GET', '/v1/health');
  await pushOne(f.device, source, remote, {}, silent);
  await pullFile(f.device, remote, dest, {}, silent);
  await api(f.device, 'GET', '/v1/health');
  assert.equal(f.sockets.size, 1);
 });
 assert.deepEqual(fs.readFileSync(dest), fs.readFileSync(source));
 await until(() => [...f.sockets].every(socket => socket.destroyed));
});

test('warm pools do not bypass a changed pin or mix client credentials', async t => {
 const f = await setup(t);
 await withTransport(async () => {
  await api(f.device, 'GET', '/v1/health');
  const before = f.requests.length;
  await assert.rejects(api({ ...f.device, fingerprint: '0'.repeat(64) }, 'GET', '/v1/health'), { code: 'CERTIFICATE_MISMATCH' });
  assert.equal(f.requests.length, before, 'Wrong certificate must receive no HTTP request');
  await assert.rejects(api({ ...f.device, token: 'different-token' }, 'GET', '/v1/health'), { code: 'UNAUTHORIZED' });
  assert.equal(f.sockets.size, 2, 'Different credentials use separate pools');
  assert.equal((await api(f.device, 'GET', '/v1/health')).deviceId, f.device.deviceId);
 });
});

test('devices watch reuses a connection across config reloads', async t => {
 const f = await setup(t);
 const result = await f.cli(['devices', '--watch', '--duration', '350', '--poll-ms', '50']);
 assert.equal(result.code, 0); assert.equal(f.sockets.size, 1);
});

test('replacement connections recheck the server certificate before sending credentials', async t => {
 const f = await setup(t);
 const openssl = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl';
 const cert = path.join(f.dir, 'replacement-cert.pem'), key = path.join(f.dir, 'replacement-key.pem');
 execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
 await withTransport(async () => {
  await api(f.device, 'GET', '/v1/health');
  const before = f.requests.length;
  f.bridge.server.setSecureContext({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) });
  f.bridge.server.closeAllConnections();
  await delay(20);
  await assert.rejects(api(f.device, 'GET', '/v1/health'), { code: 'CERTIFICATE_MISMATCH' });
  assert.equal(f.requests.length, before);
 });
});

test('task completion is pushed without task polling; normal JSON stays a single result', async t => {
 const f = await setup(t), task = f.makeTask();
 const pending = f.cli(['task', 'wait', task.id, '--poll-ms', '10000']);
 await until(() => f.bridge.taskEvents.subscribers.has(task.id));
 f.complete(task, 'done'); const result = await pending;
 assert.equal(result.code, 0); assert.equal(result.result.data.data.stdout, 'done');
 assert.equal(result.stdout.trim().split('\n').length, 1);
 assert.equal(f.requests.filter(url => url === '/v1/tasks/' + task.id).length, 1);
 assert.equal(f.requests.filter(url => url.includes('/events')).length, 1);
 assert.equal(f.bridge.taskEvents.subscribers.size, 0);
});

test('follow resumes persisted byte offsets after disconnect, including split UTF-8', async t => {
 const f = await setup(t), task = f.makeTask(), bytes = Buffer.from('A中文 🌍\nsecond\n');
 f.output(task, bytes.subarray(0, 2));
 let observed = '';
 const pending = f.cli(['task', 'wait', task.id, '--follow'], text => { observed += text; }, false);
 await until(() => observed === 'A');
 f.bridge.taskEvents.disconnect(f.device.clientId);
 f.output(task, bytes.subarray(2, 7));
 await until(() => f.requests.filter(url => url.includes('/events')).length === 2 && f.bridge.taskEvents.subscribers.has(task.id));
 f.output(task, bytes.subarray(7));
 await until(() => observed === bytes.toString());
 f.complete(task, bytes.toString());
 const result = await pending;
 assert.equal(result.code, 0); assert.equal(result.stderr, bytes.toString());
 assert.ok(f.requests.some(url => url.endsWith('stdoutOffset=2')));
 assert.equal(f.requests.filter(url => url.endsWith('/output')).length, 0);
});

test('legacy servers and missing event endpoints fall back to polling', async t => {
 for (const mode of ['legacy', 'rollback']) {
  const f = await setup(t), task = f.makeTask(), route = f.bridge.route.bind(f.bridge);
  f.bridge.route = (req, res) => {
   if (mode === 'legacy' && req.url === '/v1/health') {
    f.requests.push(req.url); res.end(JSON.stringify({ deviceId: f.device.deviceId, data: { protocolVersion: 1 } })); return;
   }
   if (req.url.includes('/events')) {
    f.requests.push(req.url); res.writeHead(404); res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Old endpoint' } })); return;
   }
   return route(req, res);
  };
  const pending = f.cli(['task', 'wait', task.id, '--poll-ms', '50']);
  await until(() => f.requests.filter(url => url === '/v1/tasks/' + task.id).length >= 2);
  f.complete(task); assert.equal((await pending).code, 0);
  assert.equal(f.requests.filter(url => url.includes('/events')).length, mode === 'legacy' ? 0 : 1);
 }
});

test('output written by a separate helper is pushed before the task completes', async t => {
 const f = await setup(t), task = f.makeTask(); let observed = '';
 const pending = f.cli(['task', 'wait', task.id, '--follow'], text => { observed += text; }, false);
 await until(() => f.bridge.taskEvents.subscribers.has(task.id));
 fs.appendFileSync(path.join(f.dir, 'tasks', task.id, 'stdout.live'), 'helper 中文\n');
 await until(() => observed === 'helper 中文\n');
 assert.equal(task.status, 'running');
 f.complete(task, observed);
 assert.equal((await pending).stderr, 'helper 中文\n');
});

test('event wait deadline and explicit local disconnect stop waiting without cancelling tasks', async t => {
 const f = await setup(t), task = f.makeTask();
 const timed = await f.cli(['task', 'wait', task.id, '--wait-timeout', '150']);
 assert.equal(timed.result.error.code, 'CLIENT_WAIT_TIMEOUT');
 await until(() => f.bridge.taskEvents.subscribers.size === 0);
 const pending = f.cli(['task', 'wait', task.id]);
 await until(() => f.bridge.taskEvents.subscribers.has(task.id));
 await saveConfig(f.config, { devices: [{ ...f.device, connected: false }] });
 assert.equal((await pending).result.error.code, 'CLIENT_DISCONNECTED');
 assert.equal(task.status, 'running'); assert.ok(!f.requests.some(url => url.endsWith('/cancel')));
});

test('subscriptions enforce task ownership, offsets and revoked authorization', async t => {
 const f = await setup(t), task = f.makeTask();
 const paired = await api({ url: f.device.url, fingerprint }, 'POST', '/v1/pair', { name: 'other' });
 const other = { url: f.device.url, fingerprint, ...paired.data };
 await assert.rejects(consumeTaskEvents(other, task.id, { onEvent() {} }), { code: 'TASK_NOT_FOUND' });
 await assert.rejects(consumeTaskEvents(f.device, task.id, { stdoutOffset: 1, onEvent() {} }), { code: 'INVALID_OFFSET' });
 const pending = f.cli(['task', 'wait', task.id]);
 await until(() => f.bridge.taskEvents.subscribers.has(task.id));
 await api(other, 'DELETE', '/v1/clients/' + f.device.clientId);
 const result = await pending;
 assert.equal(result.result.error.code, 'UNAUTHORIZED');
 await until(() => f.bridge.taskEvents.subscribers.size === 0);
});

test('event identity mismatch stops immediately without resubmitting', async t => {
 const f = await setup(t), task = f.makeTask(), route = f.bridge.route.bind(f.bridge);
 f.bridge.route = (req, res) => {
  if (!req.url.includes('/events')) return route(req, res);
  f.requests.push(req.url); res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end('event: task\ndata: ' + JSON.stringify({ deviceId: 'fedcba9876543210', data: task }) + '\n\n');
 };
 const result = await f.cli(['task', 'wait', task.id]);
 assert.equal(result.result.error.code, 'DEVICE_ID_MISMATCH');
 assert.equal(f.requests.filter(url => url.includes('/events')).length, 1);
 assert.ok(!f.requests.includes('/v1/tasks'));
});

test('server restart returns the persisted unknown task without executing it again', async t => {
 const f = await setup(t), task = f.makeTask(), port = f.bridge.server.address().port;
 const pending = f.cli(['task', 'wait', task.id]);
 await until(() => f.bridge.taskEvents.subscribers.has(task.id));
 await f.bridge.close();
 const restarted = new Bridge({ dataDir: f.dir });
 try {
  await restarted.listen(port);
  const result = await pending;
  assert.equal(result.result.data.status, 'unknown');
  assert.equal(result.result.data.error.code, 'SERVICE_RESTARTED');
  assert.equal(restarted.active.size, 0); assert.equal(restarted.tasks.size, 1);
  assert.ok(!f.requests.includes('/v1/tasks'));
 } finally { await restarted.close(); }
});

test('server event heartbeats do not renew temporary consent or input control leases', async t => {
 const f = await setup(t), task = f.makeTask();
 f.bridge.options.temporaryIdleMs = 100;
 f.bridge.approve(f.bridge.clients[0], false);
 let lease;
 await assert.rejects(consumeTaskEvents(f.device, task.id, {
  onEvent(event) { if (event === 'task') lease = f.bridge.leases.get(f.device.clientId); }
 }), { code: 'PAIRING_REQUIRED' });
 assert.equal(f.bridge.leases.get(f.device.clientId), lease);
 assert.equal(f.bridge.taskEvents.subscribers.size, 0);
});

test('large retained output drains in bounded chunks before the terminal event', async t => {
 const f = await setup(t), task = f.makeTask(), bytes = crypto.randomBytes(2 * 1024 * 1024);
 f.output(task, bytes); f.complete(task);
 const received = []; let offset = 0;
 const result = await consumeTaskEvents(f.device, task.id, {
  stdoutOffset: 0,
  async onEvent(event, value) {
   if (event === 'task') return true;
   assert.equal(value.offset, offset);
   const chunk = Buffer.from(value.base64, 'base64');
   assert.ok(chunk.length <= 48 * 1024); offset += chunk.length; received.push(chunk);
   await delay(2); return false;
  }
 });
 assert.deepEqual(Buffer.concat(received), bytes);
 assert.equal(result.data.status, 'succeeded'); assert.equal(f.bridge.taskEvents.subscribers.size, 0);
});

test('an actual submitted portable operation publishes its terminal task snapshot', async t => {
 const f = await setup(t);
 const result = await f.cli(['call', 'logs.file', '--args', JSON.stringify({ path: path.join(f.dir, 'helper-secret') })]);
 assert.equal(result.code, 0); assert.equal(result.result.data.status, 'succeeded');
 assert.equal(result.result.data.data.text, 'fixture-helper');
});
