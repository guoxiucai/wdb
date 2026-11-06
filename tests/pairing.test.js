'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),https=require('node:https');
const {Bridge}=require('../src/server');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-pairing-'));
 for(const name of ['tls.pfx','tls-password','helper-secret','pairing-code'])fs.copyFileSync(path.join(__dirname,'../.runtime/server',name),path.join(dir,name));
 let bridge;
 const f={dir,code:fs.readFileSync(path.join(dir,'pairing-code'),'utf8').trim(),get bridge(){return bridge;},async start(){bridge=new Bridge({dataDir:dir,...options});await bridge.listen(0);},async restart(){await bridge.close();await f.start();},request(method,url,body,token){return new Promise((resolve,reject)=>{
  const req=https.request({host:'127.0.0.1',port:bridge.server.address().port,path:url,method,rejectUnauthorized:false,headers:token?{authorization:'Bearer '+token}:{}},res=>{let raw='';res.setEncoding('utf8');res.on('data',x=>raw+=x);res.on('end',()=>resolve({http:res.statusCode,...JSON.parse(raw)}));res.on('error',reject);});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });},pair(name='test'){return f.request('POST','/v1/pair',{name,pairingCode:f.code});}};
 await f.start();t.after(async()=>{await bridge.close();fs.rmSync(dir,{recursive:true,force:true});});return f;
}
test('new client receives no authorization until a server decision; rejection and bad code issue no token',async t=>{
 let answer,calls=0;const f=await setup(t,{approvePairing:async input=>{calls++;assert.equal(input.remoteAddress,'127.0.0.1');assert.equal(input.name,'a b');return new Promise(r=>answer=r);}});
 assert.equal((await f.request('POST','/v1/pair',{pairingCode:'wrong'})).error.code,'PAIRING_DENIED');assert.equal(calls,0);
 const pending=f.pair('a\u202eb');while(!answer)await delay(5);assert.equal(f.bridge.clients.length,0);
 assert.equal((await f.pair()).error.code,'PAIRING_BUSY');answer({decision:'denied',remember:true});
 const denied=await pending;assert.equal(denied.error.code,'PAIRING_REJECTED');assert.equal(f.bridge.clients.length,0);
 assert.equal((await f.request('GET','/v1/health',null,'unapproved')).http,401);
});
test('remembered approval survives restart and disconnect; temporary approval requires renewed decision with same client ID',async t=>{
 let remember=true,calls=0;const f=await setup(t,{approvePairing:async()=>{calls++;return {decision:'approved',remember};}});
 const saved=(await f.pair()).data;assert.equal(saved.remembered,true);await f.restart();assert.equal((await f.request('GET','/v1/health',null,saved.token)).http,200);
 await f.request('DELETE','/v1/connection',null,saved.token);assert.equal((await f.request('GET','/v1/health',null,saved.token)).http,200);assert.equal(calls,1);
 remember=false;const temporary=(await f.pair()).data;assert.equal(temporary.remembered,false);
 assert.equal((await f.request('GET','/v1/health',null,temporary.token)).http,200);
 await f.request('DELETE','/v1/connection',null,temporary.token);assert.equal((await f.request('GET','/v1/health',null,temporary.token)).error.code,'PAIRING_REQUIRED');
 const resumed=await f.request('POST','/v1/connection',null,temporary.token);assert.equal(resumed.data.clientId,temporary.clientId);assert.equal(resumed.data.remembered,false);
 await f.restart();assert.equal((await f.request('GET','/v1/health',null,temporary.token)).error.code,'PAIRING_REQUIRED');
 remember=true;assert.equal((await f.request('POST','/v1/connection',null,temporary.token)).data.remembered,true);await f.restart();assert.equal((await f.request('GET','/v1/health',null,temporary.token)).http,200);
 const disk=fs.readFileSync(path.join(f.dir,'clients.json'),'utf8');assert.ok(!disk.includes(temporary.token));assert.equal(calls,4);
});
test('temporary idle expiry fails closed and revoked credentials cannot request another approval',async t=>{
 let calls=0;const f=await setup(t,{temporaryIdleMs:100,approvePairing:async()=>{calls++;return {decision:'approved',remember:false};}});
 const c=(await f.pair()).data;f.bridge.temporaryClients.set(c.clientId,Date.now()-101);
 assert.equal((await f.request('GET','/v1/health',null,c.token)).error.code,'PAIRING_REQUIRED');
 f.bridge.clients[0].revokedAt=new Date().toISOString();assert.equal((await f.request('POST','/v1/connection',null,c.token)).error.code,'UNAUTHORIZED');assert.equal(calls,1);
});
test('approval timeout and unavailable desktop cannot create an authorization',async t=>{
 const f=await setup(t,{approvalTimeoutMs:40,approvePairing:()=>new Promise(()=>{})});
 assert.equal((await f.pair()).error.code,'PAIRING_TIMEOUT');assert.equal(f.bridge.clients.length,0);assert.equal(f.bridge.pendingPairing,null);
 f.bridge.options.approvePairing=async()=>{throw Object.assign(Error('locked'),{code:'DESKTOP_UNAVAILABLE'});};
 assert.equal((await f.pair()).error.code,'PAIRING_DESKTOP_UNAVAILABLE');assert.equal(f.bridge.clients.length,0);
});
test('client disconnect cancels approval and a late allow cannot grant access',async t=>{
 let answer;const f=await setup(t,{approvePairing:()=>new Promise(r=>answer=r)});
 const req=https.request({host:'127.0.0.1',port:f.bridge.server.address().port,path:'/v1/pair',method:'POST',rejectUnauthorized:false});req.on('error',()=>{});req.end(JSON.stringify({pairingCode:f.code}));
 while(!answer)await delay(5);req.destroy();while(f.bridge.pendingPairing)await delay(5);answer({decision:'approved',remember:true});await delay(15);assert.equal(f.bridge.clients.length,0);
});
test('only pairing flow may initiate the internal dialog, and revocation during renewal wins',async t=>{
 let remember=true,answer;const f=await setup(t,{approvePairing:async()=>remember?{decision:'approved',remember:false}:new Promise(r=>answer=r)});
 const c=(await f.pair()).data;assert.equal((await f.request('POST','/v1/tasks',{op:'connection.approve'},c.token)).error.code,'INTERNAL_OPERATION');
 await f.request('DELETE','/v1/connection',null,c.token);remember=false;const pending=f.request('POST','/v1/connection',null,c.token);while(!answer)await delay(5);
 f.bridge.clients[0].revokedAt=new Date().toISOString();answer({decision:'approved',remember:true});assert.equal((await pending).error.code,'UNAUTHORIZED');
 assert.equal((await f.request('GET','/v1/health',null,c.token)).http,401);
});
