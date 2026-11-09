'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Bridge}=require('../src/server'),{main,selectDevice}=require('../src/cli'),{api}=require('../src/client-transport'),{newDeviceId,normalizeDeviceId}=require('../src/device-id'),{atomic,sha}=require('../src/common');
function directory(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-device-id-'));for(const f of ['tls.pfx','tls-password','helper-secret','pairing-code'])fs.copyFileSync(path.join(__dirname,'../.runtime/server',f),path.join(dir,f));return dir;}
async function cli(config,args){let stdout='',stderr='';const code=await main([...args,'--config',config,'--json','--reconnect-timeout','0'],{stdout:{write:s=>stdout+=s},stderr:{write:s=>stderr+=s}});return {code,result:JSON.parse(stdout),stdout,stderr};}
test('new device IDs have exactly 16 separator-free characters and persist across restarts',async()=>{
 const dir=directory();let bridge;try{bridge=new Bridge({dataDir:dir});const id=bridge.config.deviceId;assert.match(id,/^[0-9a-f]{16}$/);assert.match(newDeviceId(),/^[0-9a-f]{16}$/);assert.notEqual(newDeviceId(),id);await bridge.close();bridge=new Bridge({dataDir:dir});assert.equal(bridge.config.deviceId,id);assert.equal(normalizeDeviceId(id),id);}finally{await bridge?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('legacy device IDs migrate without changing credentials, task IDs or task results',async()=>{
 const dir=directory(),legacy='e032c011-1a94-4882-887c-b8e9c62d1ce1',id=normalizeDeviceId(legacy),token=crypto.randomBytes(24).toString('hex'),clientId=crypto.randomUUID(),taskId=crypto.randomUUID();let bridge;
 try{
  assert.equal(id,'2f493aacf427f3e9','The legacy migration mapping must remain stable across releases');
  atomic(path.join(dir,'config.json'),{deviceId:legacy,retentionHours:24,maxArtifactBytes:1024**3,maxOutputBytes:1024**2,helperPort:18767});atomic(path.join(dir,'clients.json'),[{id:clientId,name:'migration-test',tokenHash:sha(token)}]);
  atomic(path.join(dir,'tasks',taskId,'task.json'),{id:taskId,deviceId:legacy,clientId,op:'shell',status:'succeeded',createdAt:new Date().toISOString(),endedAt:new Date().toISOString(),data:{stdout:'preserved',deviceId:legacy}});
  bridge=new Bridge({dataDir:dir});await bridge.listen(0);assert.equal(bridge.config.deviceId,id);assert.equal(bridge.config.legacyDeviceId,legacy);assert.equal(normalizeDeviceId(legacy.toUpperCase()),id);assert.equal(bridge.tasks.get(taskId).id,taskId);assert.equal(bridge.tasks.get(taskId).data.deviceId,legacy,'Application result payload must remain untouched');
  const fingerprint=fs.readFileSync(path.join(__dirname,'../.runtime/server/fingerprint'),'utf8').trim().toLowerCase(),url='https://127.0.0.1:'+bridge.server.address().port,config=path.join(dir,'client');atomic(path.join(config,'devices.json'),{version:1,devices:[{url,deviceId:legacy,clientId,token,fingerprint,connected:true}]});
  const listed=await cli(config,['devices']);assert.equal(listed.code,0);assert.equal(listed.result.data[0].deviceId,id);assert.equal(listed.result.data[0].connected,true);assert.ok(!listed.stdout.includes(legacy));assert.ok(!listed.stdout.includes(token));
  const saved=JSON.parse(fs.readFileSync(path.join(config,'devices.json'))).devices[0];assert.equal(saved.deviceId,id);assert.equal(saved.clientId,clientId);assert.equal(saved.token,token);assert.equal(saved.fingerprint,fingerprint);assert.equal(selectDevice({devices:[saved]},legacy).deviceId,id);
  const task=await cli(config,['task','get',taskId,'--device',id]);assert.equal(task.code,0);assert.equal(task.result.data.deviceId,id);assert.equal(task.result.data.data.stdout,'preserved');assert.equal(task.result.data.data.deviceId,legacy);
  const different={...saved,deviceId:normalizeDeviceId(crypto.randomUUID())};await assert.rejects(api(different,'GET','/v1/health'),{code:'DEVICE_ID_MISMATCH'});
  assert.equal((await cli(config,['disconnect',id])).code,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(config,'devices.json'))).devices,[]);
  // The updated client also tolerates the exact corresponding old wire ID during rolling upgrades.
  bridge.route=async(req,res)=>{req.resume();res.end(JSON.stringify({deviceId:legacy,data:{deviceId:legacy,protocolVersion:1}}));};const old=await api(saved,'GET','/v1/health');assert.equal(old.deviceId,id);assert.equal(old.data.deviceId,id);
 }finally{await bridge?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
