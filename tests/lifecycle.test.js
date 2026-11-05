'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { Bridge } = require('../src/server');
const { atomic, execute, powershell } = require('../src/common');
const { runOperation } = require('../src/operations');

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

test('real user helper preserves shell work across disconnect and cancels on explicit request', async t => {
  const dir = stateDirectory();
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const helperPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const helper = spawn(process.execPath, [path.join(__dirname, '../src/helper.js'), '--data-dir', dir, '--port', String(helperPort)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let helperError = '';
  helper.stderr.on('data', data => { helperError += data; });
  const helperReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Helper startup timeout: ${helperError}`)), 10000);
    helper.stdout.on('data', data => { if (data.toString().includes('helper-ready')) { clearTimeout(timer); resolve(); } });
    helper.once('error', error => { clearTimeout(timer); reject(error); });
    helper.once('exit', code => { clearTimeout(timer); reject(new Error(`Helper exited ${code}: ${helperError}`)); });
  });
  const bridge = new Bridge({ dataDir: dir, helperPort });
  t.after(async () => {
    for (const task of bridge.tasks.values()) bridge.cancel(task);
    await until(() => bridge.active.size === 0, 10000);
    await bridge.close();
    const exited = new Promise(resolve => helper.once('exit', resolve));
    helper.kill();
    if (helper.exitCode === null) await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await helperReady;
  const server = await bridge.listen(0);
  const port = server.address().port;
  const client = await pair(port, dir, 'shell-lifecycle');
  const helperCall = (secret, payload) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: helperPort, path: '/execute', method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' } }, res => {
      let output = '';
      res.on('data', chunk => { output += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(output) }));
    });
    req.on('error', reject); req.end(JSON.stringify(payload));
  });
  const unauthorizedMarker = path.join(dir, 'unauthorized-marker');
  const unauthorized = await helperCall('wrong-secret', { op: 'shell', args: { command: `Set-Content -LiteralPath '${unauthorizedMarker.replaceAll("'", "''")}' -Value unsafe` }, dir: path.join(dir, 'tasks', 'invalid') });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error.code, 'UNAUTHORIZED');
  assert.equal(fs.existsSync(unauthorizedMarker), false);
  const outside = await helperCall(fs.readFileSync(path.join(dir, 'helper-secret'), 'utf8').trim(), { op: 'shell', args: { command: 'Write-Output ignored' }, dir: path.join(dir, 'outside-tasks') });
  assert.equal(outside.status, 400);
  assert.equal(outside.body.error.code, 'INVALID_TASK_DIRECTORY');
  const submit = async command => (await request(port, 'POST', '/v1/tasks', { op: 'shell', args: { command }, timeoutMs: 15000 }, client.token)).body.data;
  const completed = id => until(async () => {
    const response = await request(port, 'GET', `/v1/tasks/${id}`, undefined, client.token);
    return !['accepted', 'running'].includes(response.body.data.status) && response.body.data;
  }, 15000);
  const surviving = await submit('Write-Output "before disconnect"; Start-Sleep -Seconds 2; Write-Output "after disconnect"');
  const disconnected = await request(port, 'DELETE', '/v1/connection', undefined, client.token);
  assert.equal(disconnected.body.data.credentialsRetained, true);
  const done = await completed(surviving.id);
  assert.equal(done.status, 'succeeded', JSON.stringify(done.error));
  assert.match(done.data.stdout, /before disconnect/);
  assert.match(done.data.stdout, /after disconnect/);
  assert.equal(done.data.requestedIdentity, 'logged-in-user');
  assert.ok(done.data.identity);
  const cancelled = await submit('Write-Output "started"; Start-Sleep -Seconds 5; Write-Output "should not finish"');
  await until(() => fs.existsSync(path.join(dir, 'tasks', cancelled.id, 'stdout.live')), 10000);
  await request(port, 'POST', `/v1/tasks/${cancelled.id}/cancel`, {}, client.token);
  const cancelledFinal = await completed(cancelled.id);
  assert.equal(cancelledFinal.status, 'cancelled');
  assert.doesNotMatch(cancelledFinal.data?.stdout || '', /should not finish/);
  const noisy = await submit("Write-Output ('中' * 600000)");
  const noisyFinal = await completed(noisy.id);
  assert.equal(noisyFinal.status, 'succeeded');
  assert.equal(noisyFinal.data.truncated, true);
  assert.ok(Buffer.byteLength(noisyFinal.data.stdout) <= 1024 * 1024);
  const liveBytes = ['stdout.live', 'stderr.live'].reduce((sum, name) => {
    const file = path.join(dir, 'tasks', noisy.id, name);
    return sum + (fs.existsSync(file) ? fs.statSync(file).size : 0);
  }, 0);
  assert.ok(liveBytes <= 1024 * 1024, `Saved live output exceeded cap: ${liveBytes}`);
});

test('cancelling accepted or already-aborted work prevents process side effects', async t => {
  const dir = stateDirectory();
  const bridge = new Bridge({ dataDir: dir });
  t.after(async () => { await bridge.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const marker = path.join(dir, 'must-not-exist.txt');
  const task = await bridge.submit({ id: 'early-cancel-client' }, { op: 'shell', args: { admin: true, command: `Set-Content -LiteralPath '${marker.replaceAll("'", "''")}' -Value unsafe` } });
  assert.equal(task.status, 'accepted');
  bridge.cancel(task);
  await until(() => task.status === 'cancelled');
  assert.equal(task.startedAt, undefined);
  assert.equal(fs.existsSync(marker), false);
  const controller = new AbortController(); controller.abort();
  let spawned = false;
  const result = await execute(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`], { signal: controller.signal, onSpawn: () => { spawned = true; } });
  assert.equal(result.cancelled, true);
  assert.equal(result.pid, null);
  assert.equal(spawned, false);
  assert.equal(fs.existsSync(marker), false);
});

test('non-elevated execution rejects explicit administrator commands and installers', async t => {
  const elevated = await powershell('(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)');
  if (elevated.stdout.trim() === 'True') { t.skip('This rejection case requires an ordinary user process.'); return; }
  const dir = stateDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const marker = path.join(dir, 'admin-must-not-execute');
  const ctx = { id: crypto.randomUUID(), dir, timeoutMs: 5000 };
  await assert.rejects(runOperation('shell', { admin: true, command: `Set-Content -LiteralPath '${marker.replaceAll("'", "''")}' -Value unsafe` }, ctx), { code: 'ADMIN_NOT_AVAILABLE' });
  await assert.rejects(runOperation('apps.install', { admin: true, path: process.execPath, arguments: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`] }, ctx), { code: 'ADMIN_NOT_AVAILABLE' });
  assert.equal(fs.existsSync(marker), false);
});

test('fallback start is idempotent and stop targets only recorded matching processes', async t => {
  const dir = stateDirectory();
  const reserve = async () => {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
  };
  const port = await reserve(), helperPort = await reserve();
  const windowsPowerShell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // A detached Windows daemon can inherit the launcher's pipe handles. Await the
  // launcher process's exit and drain its already-written JSON without requiring
  // all intentionally surviving daemon descendants to close inherited handles.
  const script = (name, args = []) => new Promise((resolve, reject) => {
    const child = spawn(windowsPowerShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../scripts', name), '-DataDirectory', dir, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Script ${name} timed out: ${stderr}`)); }, 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', exitCode => {
      clearTimeout(timer);
      setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); resolve({ exitCode, stdout, stderr }); }, 100);
    });
  });
  t.after(async () => { await script('stop-local.ps1'); fs.rmSync(dir, { recursive: true, force: true }); });
  const first = await script('start-local.ps1', ['-Port', String(port), '-HelperPort', String(helperPort)]);
  assert.equal(first.exitCode, 0, first.stderr);
  const one = JSON.parse(first.stdout);
  assert.equal(one.mode, 'current-user-background');
  assert.equal(one.windowsServiceVerified, false);
  assert.equal(one.server.status, 'started');
  assert.equal(one.helper.status, 'started');
  const second = await script('start-local.ps1', ['-Port', String(port), '-HelperPort', String(helperPort)]);
  assert.equal(second.exitCode, 0, second.stderr);
  const two = JSON.parse(second.stdout);
  assert.equal(two.server.status, 'already-running');
  assert.equal(two.helper.status, 'already-running');
  assert.equal(two.server.pid, one.server.pid);
  assert.equal(two.helper.pid, one.helper.pid);
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'local-processes.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(metadata.length, 2);
  assert.ok(metadata.every(item => item.role && item.pid && item.startedAt));
  const stopped = await script('stop-local.ps1');
  assert.equal(stopped.exitCode, 0, stopped.stderr);
  assert.equal(JSON.parse(stopped.stdout).filter(item => item.status === 'stopped').length, 2);
  assert.equal(fs.existsSync(path.join(dir, 'local-processes.json')), false);
  fs.writeFileSync(path.join(dir, 'local-processes.json'), JSON.stringify([{ role: 'server', pid: process.pid, executable: process.execPath, script: 'unrelated-script.js', dataDirectory: dir, startedAt: '2000-01-01T00:00:00.0000000Z' }]));
  const refused = await script('stop-local.ps1');
  assert.notEqual(refused.exitCode, 0);
  assert.match(refused.stderr, /no longer matches/);
  fs.unlinkSync(path.join(dir, 'local-processes.json'));
});
