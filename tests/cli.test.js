'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { main, api, parseArgv, normalizeTarget, selectDevice } = require('../src/cli');

let temporary, server, target, fingerprint, requestCount = 0, protocolVersion = 1;
const stored = new Map();
function envelope(data, status = 'succeeded') { return { requestId: crypto.randomUUID(), deviceId: 'device-test', status, error: null, durationMs: 0, artifacts: [], data }; }
before(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wdb-cli-test-'));
  const openssl = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl';
  const cert = path.join(temporary, 'cert.pem'), key = path.join(temporary, 'key.pem');
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const certificate = await fs.readFile(cert);
  fingerprint = new crypto.X509Certificate(certificate).fingerprint256.replace(/:/g, '').toLowerCase();
  server = https.createServer({ key: await fs.readFile(key), cert: certificate }, async (req, res) => {
    requestCount++;
    const url = new URL(req.url, 'https://localhost');
    const respond = data => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(envelope(data))); };
    if (url.pathname === '/v1/pair') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      if (body.pairingCode !== 'test-secret') { res.writeHead(401); res.end(JSON.stringify({ error: { code: 'PAIRING_DENIED', message: 'Incorrect pairing code' } })); return; }
      respond({ clientId: 'client-test', deviceId: 'device-test', token: 'private-token' }); return;
    }
    if (req.headers.authorization !== 'Bearer private-token') { res.writeHead(401); res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'No token' } })); return; }
    if (url.pathname === '/v1/info') { respond({ version: '0.1.0', protocolVersion }); return; }
    if (url.pathname === '/v1/heartbeat' || url.pathname === '/v1/connection') { respond({ ok: true }); return; }
    if (url.pathname === '/v1/tasks' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      assert.equal(body.op, 'shell');
      respond({ id: 'task-test', status: 'running' }); return;
    }
    if (url.pathname === '/v1/tasks/task-test') { respond({ id: 'task-test', status: 'succeeded', result: { stdout: '中文测试\n', exitCode: 0 } }); return; }
    if (url.pathname === '/v1/files') {
      const remote = url.searchParams.get('path');
      if (req.method === 'PUT') {
        if (stored.has(remote) && url.searchParams.get('overwrite') !== 'true') {
          req.resume(); res.writeHead(409); res.end(JSON.stringify({ error: { code: 'ALREADY_EXISTS', message: 'Exists' } })); return;
        }
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const data = Buffer.concat(chunks), sha256 = crypto.createHash('sha256').update(data).digest('hex');
        assert.equal(sha256, req.headers['x-content-sha256']);
        stored.set(remote, data); respond({ bytes: data.length, sha256 }); return;
      }
      const data = stored.get(remote) || Buffer.from('corrupt');
      const hash = remote === 'corrupt' ? '0'.repeat(64) : crypto.createHash('sha256').update(data).digest('hex');
      res.writeHead(200, { 'x-content-sha256': hash, 'content-length': data.length }); res.end(data); return;
    }
    if (url.pathname === '/v1/directories') {
      if (req.method === 'POST') { req.resume(); respond({ ok: true }); return; }
      const prefix = `${url.searchParams.get('path')}/`;
      const names = new Map();
      for (const key of stored.keys()) if (key.startsWith(prefix)) {
        const suffix = key.slice(prefix.length), name = suffix.split('/')[0];
        names.set(name, { name, type: suffix.includes('/') ? 'directory' : 'file' });
      }
      respond({ entries: [...names.values()] }); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No route' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  target = `https://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
});
async function cli(args, configName = 'client') {
  let stdout = '', stderr = '';
  const code = await main([...args, '--json', '--config', path.join(temporary, configName)], { stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } } });
  return { code, result: JSON.parse(stdout), stderr, stdout };
}
test('parser preserves PowerShell content after -- and validates address', () => {
  assert.deepEqual(parseArgv(['shell', '--json', '--', 'Write-Output', '--foo']).positional, ['shell', 'Write-Output', '--foo']);
  assert.equal(normalizeTarget('localhost'), 'https://localhost:18766');
  assert.equal(normalizeTarget('localhost:443'), 'https://localhost');
  assert.throws(() => normalizeTarget('http://localhost'), { code: 'INVALID_TARGET' });
  assert.throws(() => normalizeTarget('https://localhost/unsafe'), { code: 'INVALID_TARGET' });
});
test('ambiguous target errors instead of selecting silently', () => {
  assert.throws(() => selectDevice({ devices: [{ url: 'https://localhost:18766', deviceId: 'one' }, { url: 'https://localhost:18768', deviceId: 'two' }] }), { code: 'AMBIGUOUS_DEVICE' });
});
test('certificate mismatch sends no credentials or request body', async () => {
  const beforeCount = requestCount;
  await assert.rejects(api({ url: target, fingerprint: '0'.repeat(64), token: 'secret' }, 'POST', '/v1/pair', { pairingCode: 'secret' }), { code: 'CERTIFICATE_MISMATCH' });
  assert.equal(requestCount, beforeCount);
});
test('incompatible protocol is reported explicitly', async () => {
  protocolVersion = 2;
  try { await assert.rejects(api({ url: target, fingerprint, token: 'private-token' }, 'GET', '/v1/info'), { code: 'INCOMPATIBLE_PROTOCOL' }); }
  finally { protocolVersion = 1; }
});
test('pair, shell, file/recursive transfers, disconnect, and reconnect', async () => {
  const paired = await cli(['connect', target, '--fingerprint', fingerprint, '--pairing-code', 'test-secret']);
  assert.equal(paired.code, 0); assert.equal(paired.result.data.clientId, 'client-test'); assert.ok(!paired.stdout.includes('private-token'));
  const shell = await cli(['shell', '--script', 'Write-Output 中文测试']);
  assert.equal(shell.result.data.result.stdout, '中文测试\n');
  const source = path.join(temporary, '中文 space.bin'), output = path.join(temporary, '下载 space.bin');
  const bytes = crypto.randomBytes(4 * 1024 * 1024 + 7); await fs.writeFile(source, bytes);
  const push = await cli(['push', source, 'C:/中文 space.bin']); assert.equal(push.code, 0); assert.equal(push.result.data.bytes, bytes.length);
  const duplicatePush = await cli(['push', source, 'C:/中文 space.bin']); assert.equal(duplicatePush.code, 1);
  const pull = await cli(['pull', 'C:/中文 space.bin', output]); assert.equal(pull.code, 0); assert.deepEqual(await fs.readFile(output), bytes);
  const duplicatePull = await cli(['pull', 'C:/中文 space.bin', output]); assert.equal(duplicatePull.result.error.code, 'ALREADY_EXISTS');
  const corrupt = await cli(['pull', 'corrupt', path.join(temporary, 'bad.bin')]); assert.equal(corrupt.result.error.code, 'CHECKSUM_MISMATCH');
  await assert.rejects(fs.stat(path.join(temporary, 'bad.bin')), { code: 'ENOENT' });
  assert.ok(!(await fs.readdir(temporary)).some(name => name.includes('wdb-part')));
  const folder = path.join(temporary, 'directory'), nested = path.join(folder, '子目录');
  await fs.mkdir(nested, { recursive: true }); await fs.writeFile(path.join(nested, '文件.txt'), '你好世界');
  assert.equal((await cli(['push', folder, 'C:/tree'])).code, 0);
  assert.equal((await cli(['pull', 'C:/tree', path.join(temporary, 'download-dir'), '--recursive'])).code, 0);
  assert.equal(await fs.readFile(path.join(temporary, 'download-dir/子目录/文件.txt'), 'utf8'), '你好世界');
  assert.equal((await cli(['disconnect', target])).code, 0);
  assert.equal((await cli(['info'])).result.error.code, 'NO_DEVICE');
  assert.equal((await cli(['connect', target])).code, 0);
  assert.equal((await cli(['info'])).result.data.version, '0.1.0');
});
