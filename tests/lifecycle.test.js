'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');
const { Bridge } = require('../src/server');
const { atomic } = require('../src/common');

function stateDirectory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdb-lifecycle-'));
  for (const name of ['tls.pfx', 'tls-password', 'helper-secret', 'pairing-code']) {
    fs.copyFileSync(path.join(__dirname, '../.runtime/server', name), path.join(dir, name));
  }
  return dir;
}
function request(port, method, url, body, token, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, method, path: url, rejectUnauthorized: false,
      headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : undefined);
  });
}
async function pair(port, dir, name) {
  const response = await request(port, 'POST', '/v1/pair', { name, pairingCode: fs.readFileSync(path.join(dir, 'pairing-code'), 'utf8') });
  assert.equal(response.status, 200);
  return response.body.data;
}
async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('Condition did not become true before timeout');
}

test('two independent localhost devices accept two clients each and isolate task ownership', async t => {
  const devices = [];
  for (let index = 0; index < 2; index++) {
    const dir = stateDirectory();
    const bridge = new Bridge({ dataDir: dir });
    const server = await bridge.listen(0);
    const port = server.address().port;
    devices.push({ dir, bridge, port, clients: await Promise.all([pair(port, dir, 'A'), pair(port, dir, 'B')]) });
  }
  t.after(async () => {
    for (const device of devices) { await device.bridge.close(); fs.rmSync(device.dir, { recursive: true, force: true }); }
  });
  assert.notEqual(devices[0].bridge.config.deviceId, devices[1].bridge.config.deviceId);
  const submissions = await Promise.all(devices.flatMap(device => device.clients.map(async (client, index) => {
    const logPath = path.join(device.dir, `client-${index}.txt`);
    fs.writeFileSync(logPath, `${client.clientId}: 中文证据`);
    const response = await request(device.port, 'POST', '/v1/tasks', { op: 'logs.file', args: { path: logPath } }, client.token);
    assert.equal(response.status, 202);
    return { device, client, index, id: response.body.data.id };
  })));
  assert.equal(new Set(submissions.map(item => item.id)).size, 4);
  for (const item of submissions) {
    const final = await until(async () => {
      const response = await request(item.device.port, 'GET', `/v1/tasks/${item.id}`, undefined, item.client.token);
      return !['accepted', 'running'].includes(response.body.data.status) && response.body.data;
    });
    assert.equal(final.status, 'succeeded');
    assert.equal(final.deviceId, item.device.bridge.config.deviceId);
    assert.equal(final.clientId, item.client.clientId);
    assert.match(final.data.text, /中文证据/);
    const foreign = item.device.clients[1 - item.index];
    assert.equal((await request(item.device.port, 'GET', `/v1/tasks/${item.id}`, undefined, foreign.token)).status, 404);
  }
  assert.equal((await request(devices[1].port, 'GET', '/v1/tasks', undefined, devices[0].clients[0].token)).status, 401);
  const revoked = devices[0].clients[1];
  await request(devices[0].port, 'DELETE', `/v1/clients/${revoked.clientId}`, undefined, devices[0].clients[0].token);
  assert.equal((await request(devices[0].port, 'GET', '/v1/tasks', undefined, revoked.token)).status, 401);
});

test('restart marks incomplete persisted work unknown; retention never removes active task data', async t => {
  const dir = stateDirectory();
  const id = crypto.randomUUID();
  const taskDir = path.join(dir, 'tasks', id);
  const original = { id, clientId: 'client-a', deviceId: 'device-a', op: 'shell', status: 'running', createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), artifacts: [] };
  atomic(path.join(taskDir, 'task.json'), original);
  fs.writeFileSync(path.join(taskDir, 'stdout.live'), 'output persisted before interruption');
  const bridge = new Bridge({ dataDir: dir });
  t.after(async () => { await bridge.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const recovered = bridge.tasks.get(id);
  assert.equal(recovered.status, 'unknown');
  assert.equal(recovered.error.code, 'SERVICE_RESTARTED');
  assert.equal(fs.readFileSync(path.join(taskDir, 'stdout.live'), 'utf8'), 'output persisted before interruption');
  assert.equal(JSON.parse(fs.readFileSync(path.join(taskDir, 'task.json'))).status, 'unknown');
  const activeId = crypto.randomUUID();
  const active = { ...original, id: activeId };
  bridge.tasks.set(activeId, active);
  bridge.save(active);
  fs.writeFileSync(path.join(dir, 'tasks', activeId, 'evidence.bin'), Buffer.alloc(4096));
  recovered.endedAt = new Date(Date.now() - 48 * 3600000).toISOString();
  bridge.config.maxArtifactBytes = 64;
  bridge.cleanup();
  assert.equal(bridge.tasks.has(id), false);
  assert.equal(fs.existsSync(taskDir), false);
  assert.equal(bridge.tasks.has(activeId), true);
  assert.equal(fs.statSync(path.join(dir, 'tasks', activeId, 'evidence.bin')).size, 4096);
  await assert.rejects(bridge.submit({ id: 'client-a' }, { op: 'logs.file', args: { path: 'unused' } }), { code: 'ARTIFACT_SPACE_EXHAUSTED' });
});

test('interrupted file upload removes partial output and releases destination reservation', async t => {
  const dir = stateDirectory();
  const bridge = new Bridge({ dataDir: dir });
  const server = await bridge.listen(0);
  const port = server.address().port;
  t.after(async () => { await bridge.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const client = await pair(port, dir, 'upload-interrupt');
  const destination = path.join(dir, '中断 transfer.bin');
  const url = `/v1/files?path=${encodeURIComponent(destination)}`;
  const req = https.request({ host: '127.0.0.1', port, path: url, method: 'PUT', rejectUnauthorized: false,
    headers: { authorization: `Bearer ${client.token}`, 'x-content-sha256': 'a'.repeat(64), 'content-length': 1048576 } });
  req.on('error', () => {});
  req.write(Buffer.alloc(65536));
  await until(() => fs.readdirSync(dir).some(name => name.endsWith('.part')));
  assert.equal(fs.existsSync(destination), false);
  const blocked = await request(port, 'PUT', url, Buffer.from('x'), client.token, { 'x-content-sha256': 'a'.repeat(64) });
  assert.equal(blocked.body.error.code, 'TRANSFER_IN_PROGRESS');
  req.destroy();
  await until(() => !fs.readdirSync(dir).some(name => name.endsWith('.part')) && bridge.uploads.size === 0);
  assert.equal(fs.existsSync(destination), false);
  const bytes = Buffer.from('fresh complete content');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const retry = await request(port, 'PUT', url, bytes, client.token, { 'x-content-sha256': digest });
  assert.equal(retry.status, 200);
  assert.deepEqual(fs.readFileSync(destination), bytes);
});
