'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./stream-fixture');const {manageLocalClients}=require('../src/local-clients');const {api,withTransport}=require('../src/client-transport');const {createForward}=require('../src/forward-client');
test('local credentials list and revoke a remote client without pairing a manager; revoke closes live rules',async t=>{
 const {bridge,dir,device}=await fixture(t);
 fs.writeFileSync(path.join(dir,'installation.json'),JSON.stringify({port:bridge.server.address().port,listenAddress:'0.0.0.0'}));fs.writeFileSync(path.join(dir,'fingerprint'),device.fingerprint);
 await withTransport(async()=>{
  const result=await manageLocalClients(['list'],{dataDir:dir});assert.equal(result.data.clients.length,1);assert.equal(result.data.clients[0].tokenHash,undefined);assert.equal(bridge.clients.length,1);
  const rule=await createForward(device,'reverse',{host:'127.0.0.1',port:0},{host:'127.0.0.1',port:9});t.after(()=>rule.close());
  const revoked=await manageLocalClients(['revoke',device.clientId],{dataDir:dir});assert.equal(revoked.data.revoked,device.clientId);
  await withTransport(()=>assert.rejects(api(device,'GET','/v1/health',undefined,1000,{reconnectMs:0}),{code:'UNAUTHORIZED'}));
  const after=await manageLocalClients(['list'],{dataDir:dir});assert.equal(after.data.clients[0].authorized,false);assert.ok(after.data.clients[0].revokedAt);
  await rule.close();assert.equal(bridge.forwarding.rules.size,0);
 });
});
test('paired tokens and missing local secrets cannot access local management',async t=>{
 const {device,bridge}=await fixture(t);await withTransport(()=>assert.rejects(api(device,'GET','/v1/local/clients',undefined,1000,{reconnectMs:0}),{code:'UNAUTHORIZED'}));
 let status,output;
 await bridge.route({url:'/v1/local/clients',method:'GET',socket:{remoteAddress:'192.0.2.10',localAddress:'192.0.2.20'},headers:{authorization:'Bearer '+bridge.helperSecret,'x-forwarded-for':'127.0.0.1'}},{writeHead(code){status=code;},end(b){output=JSON.parse(b);}});
 assert.equal(status,401);assert.equal(output.error.code,'UNAUTHORIZED');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-local-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 await assert.rejects(manageLocalClients(['list'],{dataDir:dir}),{code:'LOCAL_ADMIN_UNAVAILABLE'});
 await assert.rejects(manageLocalClients(['revoke'],{dataDir:dir}),{code:'INVALID_ARGUMENT'});
});
test('revoked CLI connect requests fresh approval and only then replaces credentials',async t=>{
 let approve=false,requests=0;
 const {bridge,dir,device}=await fixture(t);
 bridge.options.approvePairing=async()=>{requests++;return {decision:approve?'approved':'denied',remember:true};};
 const profile=path.join(dir,'client');await require('../src/cli').saveConfig(profile,{devices:[device]});
 bridge.revokeClient(device.clientId);
 async function connect(){let output='';const code=await require('../src/cli').main(['connect',device.url,'--config',profile,'--json'],{stdout:{write:s=>output+=s},stderr:{write(){}}});return {code,result:JSON.parse(output)};}
 const denied=await connect();assert.equal(denied.code,1);assert.equal(requests,1);assert.equal(bridge.clients.length,1);
 approve=true;const allowed=await connect();assert.equal(allowed.code,0);assert.equal(requests,2);
 const saved=JSON.parse(fs.readFileSync(path.join(profile,'devices.json'))).devices[0];assert.notEqual(saved.clientId,device.clientId);assert.notEqual(saved.token,device.token);
 assert.ok(bridge.clients.find(c=>c.id===device.clientId).revokedAt);
 await withTransport(async()=>{await assert.rejects(api(device,'GET','/v1/health',undefined,1000,{reconnectMs:0}),{code:'UNAUTHORIZED'});assert.equal((await api(saved,'GET','/v1/health')).status,'succeeded');});
});
