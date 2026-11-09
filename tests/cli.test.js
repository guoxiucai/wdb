'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { main, api, parseArgv, normalizeTarget, selectDevice } = require('../src/cli');
const {discoverFingerprint}=require('../src/client-transport');

describe('CLI HTTPS integration', () => {
let temporary, server, target, fingerprint, requestCount = 0, protocolVersion = 1;
let approvalRequired=false,approvalDelay=0,revoked=false,lastPairBody;
const requests=[];
const sockets=new Set();
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
    requests.push(req.method+' '+url.pathname);
    const respond = data => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(envelope(data))); };
    if (url.pathname === '/v1/pair') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      lastPairBody=body;
      if(approvalDelay)await new Promise(r=>setTimeout(r,approvalDelay));
      if(body.name==='reject-me'){res.writeHead(403);res.end(JSON.stringify({error:{code:'PAIRING_REJECTED',message:'Rejected on server'}}));return;}
      if(body.name==='timeout-me'){res.writeHead(408);res.end(JSON.stringify({error:{code:'PAIRING_TIMEOUT',message:'Approval timed out'}}));return;}
      if(body.name==='slow-me')await new Promise(r=>setTimeout(r,1200));
      revoked=false;
      respond({ clientId: 'client-test', deviceId: 'device-test', token: 'private-token' }); return;
    }
    if (revoked || req.headers.authorization !== 'Bearer private-token') { res.writeHead(401); res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'No token' } })); return; }
    if (url.pathname === '/v1/info'||url.pathname==='/v1/health') { if(approvalRequired){res.writeHead(401);res.end(JSON.stringify({error:{code:'PAIRING_REQUIRED',message:'Approval required'}}));return;}respond({ version: '0.1.0', protocolVersion, hostname:'test-server',...(url.pathname==='/v1/info'?{capabilities:['shell','files'],desktop:{available:true}}:{}) }); return; }
    if(url.pathname==='/v1/connection'&&req.method==='POST'){req.resume();approvalRequired=false;respond({clientId:'client-test',remembered:false});return;}
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
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  target = `https://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const socket of sockets) socket.destroy();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
});
async function cli(args, configName = 'client', json = true) {
  let stdout = '', stderr = '';
  const code = await main([...args, ...(json?['--json']:[]), '--config', path.join(temporary, configName)], { stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } } });
  return { code, result: json?JSON.parse(stdout):undefined, stderr, stdout };
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
test('legacy pairing code is ignored and never sent to the server', async () => {
  const paired = await cli(['connect', target, '--pairing-code', 'legacy-ignored-code'], 'legacy-argument');
  assert.equal(paired.code, 0);
  assert.equal(lastPairBody.pairingCode, undefined);
  assert.ok(!paired.stdout.includes('legacy-ignored-code'));
});
test('pair, shell, file/recursive transfers, disconnect, and reconnect', async () => {
  const paired = await cli(['connect', target]);
  assert.deepEqual(paired.result.data,{address:new URL(target).host,state:'connected'});assert.equal(lastPairBody.pairingCode,undefined);
  const saved=JSON.parse(await fs.readFile(path.join(temporary,'client/devices.json'),'utf8')).devices[0];
  assert.equal(saved.fingerprint,fingerprint);assert.equal(saved.clientId,'client-test');
  assert.equal(paired.code, 0); assert.ok(!paired.stdout.includes('private-token'));
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
  const disconnected=await cli(['disconnect', target]);assert.equal(disconnected.code,0);assert.equal(disconnected.result.data.credentialsRetained,false);
  assert.deepEqual((await cli(['devices'])).result.data,[]);
  assert.equal((await cli(['info'])).result.error.code, 'NO_DEVICE');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(temporary,'client','devices.json'))).devices,[]);
  const pairCount=requests.filter(r=>r==='POST /v1/pair').length;
  const resumed = await cli(['connect', target]);
  assert.equal(resumed.code, 0); assert.equal(resumed.result.data.state, 'connected');
  const reusedCredentials = JSON.parse(await fs.readFile(path.join(temporary, 'client', 'devices.json'))).devices[0];
  assert.ok(reusedCredentials.token);
  assert.equal(requests.filter(r=>r==='POST /v1/pair').length,pairCount+1);
  assert.equal((await cli(['info'])).result.data.version, '0.1.0');
});

test('offline disconnect removes only the selected device and its credentials',async()=>{
 const net=require('node:net'),listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
 const offline=`https://127.0.0.1:${listener.address().port}`;await new Promise(r=>listener.close(r));
 const dir=path.join(temporary,'offline-disconnect');await fs.mkdir(dir);
 const other={url:target,deviceId:'other-device',connected:false,token:'other-token',fingerprint};
 await fs.writeFile(path.join(dir,'devices.json'),JSON.stringify({devices:[{url:offline,deviceId:'offline-device',connected:true,token:'forgotten-token',fingerprint},other]}));
 const result=await cli(['disconnect',offline],'offline-disconnect');assert.equal(result.code,0);assert.equal(result.result.data.credentialsRetained,false);assert.equal(result.result.data.remoteNotified,false);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'devices.json'),'utf8')).devices,[other]);
 assert.ok((await cli(['devices'],'offline-disconnect')).result.data.every(d=>d.url!==offline));
});

test('symlinks, overwrite, and filename aliases respect the local filesystem', { skip: process.platform === 'win32' }, async () => {
  const source = path.join(temporary, 'original.txt'), link = path.join(temporary, 'link.txt');
  await fs.writeFile(source, 'original'); await fs.symlink(source, link);
  assert.equal((await cli(['push', link, 'C:/linked.txt'])).result.error.code, 'SYMLINK_UNSUPPORTED');
  stored.set('C:/replacement.txt', Buffer.from('replacement 🌍'));
  assert.equal((await cli(['pull', 'C:/replacement.txt', source])).result.error.code, 'ALREADY_EXISTS');
  assert.equal((await cli(['pull', 'C:/replacement.txt', link, '--overwrite'])).code, 0);
  assert.equal(await fs.readFile(source, 'utf8'), 'original');
  assert.equal(await fs.readFile(link, 'utf8'), 'replacement 🌍');
  assert.equal((await fs.lstat(link)).isSymbolicLink(), false);
  for (const [first, alias] of [['Case.txt', 'case.txt'], ['café.txt', 'cafe\u0301.txt']]) {
    const a = path.join(temporary, first), b = path.join(temporary, alias);
    assert.equal((await cli(['pull', 'C:/replacement.txt', a])).code, 0);
    const aliases = await fs.stat(b).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    const second = await cli(['pull', 'C:/replacement.txt', b]);
    assert.equal(second.code, aliases ? 1 : 0);
    if (aliases) assert.equal(second.result.error.code, 'ALREADY_EXISTS');
    assert.equal(await fs.readFile(a, 'utf8'), 'replacement 🌍');
  }
});

test('connect waits for server approval independently of ordinary request timeout and renews temporary identity',async()=>{
 approvalDelay=100;
 try{
  const paired=await cli(['connect',target,'--fingerprint',fingerprint,'--pairing-code','test-secret','--request-timeout','30','--approval-timeout','1000'],'approval-client');
  assert.equal(paired.code,0,JSON.stringify(paired.result));assert.match(paired.stderr,/Waiting for approval/);assert.equal(paired.stdout.trim().split('\n').length,1);
  approvalRequired=true;
  const renewed=await cli(['connect',target],'approval-client');assert.equal(renewed.code,0);assert.equal(renewed.result.data.state,'connected');assert.match(renewed.stderr,/Waiting for approval/);
  const saved=JSON.parse(await fs.readFile(path.join(temporary,'approval-client/devices.json'),'utf8'));assert.equal(saved.devices[0].remembered,false);
 }finally{approvalDelay=0;approvalRequired=false;}
});
test('server denial is returned and no new client credentials are saved',async()=>{
 const rejected=await cli(['connect',target,'--name','reject-me'],'rejected-client');assert.equal(rejected.code,1);assert.equal(rejected.result.error.code,'PAIRING_REJECTED');
 await assert.rejects(fs.stat(path.join(temporary,'rejected-client/devices.json')),{code:'ENOENT'});
});

test('automatic certificate discovery sends no HTTP request',async()=>{
 const count=requestCount;assert.equal(await discoverFingerprint(target),fingerprint);assert.equal(requestCount,count);
});

test('explicit first pin mismatch does not prompt or persist a client',async()=>{
 const count=requestCount,r=await cli(['connect',target,'--fingerprint','0'.repeat(64)],'bad-first-pin');
 assert.equal(r.result.error.code,'CERTIFICATE_MISMATCH');assert.equal(requestCount,count);
 await assert.rejects(fs.stat(path.join(temporary,'bad-first-pin/devices.json')),{code:'ENOENT'});
});

test('saved certificate mismatch never falls back to discovery, including legacy code arguments',async()=>{
 const dir=path.join(temporary,'changed-pin');await fs.mkdir(dir);
 const saved={devices:[{url:target,fingerprint:'0'.repeat(64),token:'private-token',deviceId:'device-test',connected:true}]};
 const file=path.join(dir,'devices.json');await fs.writeFile(file,JSON.stringify(saved));
 const count=requestCount,r=await cli(['connect',target,'--pairing-code','old-ignored-code'],'changed-pin');
 assert.equal(r.result.error.code,'CERTIFICATE_MISMATCH');assert.equal(r.result.data.state,'failed');assert.equal(requestCount,count);
 assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),saved);
});

test('revoked client can explicitly request fresh server consent without secrets',async()=>{
 revoked=true;const r=await cli(['connect',target]);assert.equal(r.code,0,JSON.stringify(r.result));
 assert.match(r.stderr,/Waiting for approval/);assert.equal(lastPairBody.pairingCode,undefined);
});

test('certificate discovery has a deadline and failure saves no trust',async()=>{
 const net=require('node:net'),sockets=new Set(),stalled=net.createServer(s=>{sockets.add(s);s.on('error',()=>{});});
 await new Promise(r=>stalled.listen(0,'127.0.0.1',r));
 try{
  const r=await cli(['connect',`127.0.0.1:${stalled.address().port}`,'--request-timeout','50'],'no-certificate');
  assert.equal(r.result.error.code,'TRANSPORT_TIMEOUT');assert.equal(r.result.data.state,'timeout');assert.equal(r.result.status,'timed_out');
  await assert.rejects(fs.stat(path.join(temporary,'no-certificate/devices.json')),{code:'ENOENT'});
  const dir=path.join(temporary,'was-online');await fs.mkdir(dir);
  const url=`https://127.0.0.1:${stalled.address().port}`;
  await fs.writeFile(path.join(dir,'devices.json'),JSON.stringify({devices:[{url,fingerprint,token:'private-token',deviceId:'device-test',connected:true}]}));
  const offline=await cli(['connect',url,'--request-timeout','50','--reconnect-timeout','0'],'was-online',false);
  assert.equal(offline.code,1);assert.equal(offline.stdout,`connection to 127.0.0.1:${stalled.address().port} timed out (TRANSPORT_TIMEOUT)\n`);
 }finally{for(const s of sockets)s.destroy();await new Promise(r=>stalled.close(r));}
});

test('connect prints one brief line and probes live health before reporting already connected',async()=>{
 const start=requests.length,address=new URL(target).host;
 const first=await cli(['connect',target],'brief-client',false);
 assert.equal(first.code,0);assert.equal(first.stdout,`connected to ${address}\n`);
 assert.deepEqual(requests.slice(start),['POST /v1/pair','GET /v1/health']);
 const repeatStart=requests.length;
 const repeat=await cli(['connect',target],'brief-client',false);
 assert.equal(repeat.code,0);assert.equal(repeat.stdout,`already connected to ${address}\n`);assert.equal(repeat.stderr,'');
 assert.deepEqual(requests.slice(repeatStart),['GET /v1/health']);
 const json=await cli(['connect',target],'brief-client');
 assert.deepEqual(json.result.data,{address,state:'already_connected'});assert.equal(json.result.status,'succeeded');
 const info=await cli(['info'],'brief-client');
 assert.deepEqual(info.result.data.capabilities,['shell','files']);assert.equal(info.result.data.desktop.available,true);
 assert.equal(info.result.data.connection.fingerprint,fingerprint);assert.equal(info.result.data.connection.clientId,'client-test');assert.equal(info.result.data.connection.remembered,true);
 assert.ok(!info.stdout.includes('private-token'));
 await cli(['disconnect',target],'brief-client');
 const resumed=await cli(['connect',target],'brief-client',false);assert.equal(resumed.stdout,`connected to ${address}\n`);
});

test('denied and timed-out approvals have concise text and distinct JSON states',async()=>{
 const address=new URL(target).host;
 for(const [name,state,code,status,text] of [
  ['reject-me','failed','PAIRING_REJECTED','failed',`failed to connect to ${address} (PAIRING_REJECTED)\n`],
  ['timeout-me','timeout','PAIRING_TIMEOUT','timed_out',`connection to ${address} timed out (PAIRING_TIMEOUT)\n`]
 ]){
  const plain=await cli(['connect',target,'--name',name],name,false);assert.equal(plain.code,1);assert.equal(plain.stdout,text);
  const json=await cli(['connect',target,'--name',name],name);assert.equal(json.code,1);assert.equal(json.result.status,status);assert.equal(json.result.error.code,code);assert.deepEqual(json.result.data,{address,state});
  await assert.rejects(fs.stat(path.join(temporary,name,'devices.json')),{code:'ENOENT'});
 }
});

test('a sent approval request timing out keeps its uncertain-outcome error',async()=>{
 const r=await cli(['connect',target,'--name','slow-me','--approval-timeout','1000'],'approval-timeout');
 assert.equal(r.code,1);assert.equal(r.result.status,'timed_out');assert.equal(r.result.data.state,'timeout');assert.equal(r.result.error.code,'REQUEST_OUTCOME_UNKNOWN');
 await assert.rejects(fs.stat(path.join(temporary,'approval-timeout/devices.json')),{code:'ENOENT'});
});
});
