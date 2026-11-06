'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {Bridge}=require('../src/server');const {main}=require('../src/cli');const {api,setSession}=require('../src/client-transport');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-reconnect-'));for(const name of ['tls.pfx','tls-password','helper-secret','pairing-code'])fs.copyFileSync(path.join(__dirname,'../.runtime/server',name),path.join(dir,name));
 const bridge=new Bridge({dataDir:dir,approvePairing:async()=>({decision:'approved',remember:true})});await bridge.listen(0);const target='https://127.0.0.1:'+bridge.server.address().port;
 // Read the server certificate with an unauthenticated TLS handshake; never print credentials.
 const tls=require('node:tls');const fingerprint=await new Promise((resolve,reject)=>{const s=tls.connect({host:'127.0.0.1',port:bridge.server.address().port,rejectUnauthorized:false},()=>{resolve(crypto.createHash('sha256').update(s.getPeerCertificate().raw).digest('hex'));s.destroy();});s.on('error',reject);});
 const seed={url:target,fingerprint};setSession(seed,{'reconnect-timeout':2000,'request-timeout':300});const paired=await api(seed,'POST','/v1/pair',{pairingCode:fs.readFileSync(path.join(dir,'pairing-code'),'utf8')});const device={...seed,...paired.data,connected:true};
 const configDir=path.join(dir,'client');fs.mkdirSync(configDir);fs.writeFileSync(path.join(configDir,'devices.json'),JSON.stringify({version:1,devices:[device]}));
 const cli=async(args)=>{let stdout='',stderr='';const code=await main([...args,'--config',configDir,'--json','--reconnect-timeout','2500','--request-timeout','300','--poll-ms','50'],{stdout:{write:s=>stdout+=s},stderr:{write:s=>stderr+=s}});return {code,result:JSON.parse(stdout),stderr};};
 t.after(async()=>{await bridge.close();fs.rmSync(dir,{recursive:true,force:true});});return {dir,configDir,bridge,device,cli};
}
test('lost task acceptance response recovers the same persisted task without replay',async t=>{
 const f=await setup(t),original=f.bridge.route.bind(f.bridge);let posts=0;
 f.bridge.route=async(req,res)=>{if(req.url==='/v1/tasks'&&req.method==='POST'){posts++;if(posts===1){res.end=()=>{res.destroy();return res;};}}return original(req,res);};
 const r=await f.cli(['call','logs.file','--args',JSON.stringify({path:path.join(f.dir,'pairing-code')})]);assert.equal(r.code,0,JSON.stringify(r.result));assert.equal(posts,2);assert.equal(f.bridge.tasks.size,1);assert.equal(r.result.data.id,[...f.bridge.tasks.keys()][0]);assert.match(r.stderr,/Connection restored/);
});
test('transient loss reconnects, while revoked credentials and device identity changes do not retry',async t=>{
 const f=await setup(t),original=f.bridge.route.bind(f.bridge);let mode='drop',requests=0;
 f.bridge.route=async(req,res)=>{requests++;if(mode==='drop'&&requests<=2){req.socket.destroy();return;}if(mode==='identity'){res.end(JSON.stringify({deviceId:'wrong-device',data:{protocolVersion:1}}));return;}return original(req,res);};
 setSession(f.device,{'reconnect-timeout':2500,'request-timeout':300});assert.equal((await api(f.device,'GET','/v1/health')).deviceId,f.device.deviceId);assert.equal(requests,3);
 mode='identity';requests=0;await assert.rejects(api(f.device,'GET','/v1/health'),{code:'DEVICE_ID_MISMATCH'});assert.equal(requests,1);
 mode='normal';requests=0;f.bridge.clients[0].revokedAt=new Date().toISOString();await assert.rejects(api(f.device,'GET','/v1/health'),{code:'UNAUTHORIZED'});assert.equal(requests,1);
 const wrong={...f.device,fingerprint:'0'.repeat(64)};setSession(wrong,{'reconnect-timeout':2500});requests=0;await assert.rejects(api(wrong,'GET','/v1/health'),{code:'CERTIFICATE_MISMATCH'});assert.equal(requests,0);
});
test('blackholed TLS connection has a bounded recovery deadline; explicit disconnect works offline',async t=>{
 const f=await setup(t),sockets=new Set(),blackhole=net.createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>blackhole.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>blackhole.close(r));});
 const device={...f.device,url:'https://127.0.0.1:'+blackhole.address().port};setSession(device,{'reconnect-timeout':500,'request-timeout':100});const start=Date.now();await assert.rejects(api(device,'GET','/v1/health'),{code:'RECONNECT_TIMEOUT'});assert.ok(Date.now()-start<1400);
 fs.writeFileSync(path.join(f.configDir,'devices.json'),JSON.stringify({devices:[device]}));const disconnected=await f.cli(['disconnect',device.url]);assert.equal(disconnected.code,0);assert.equal(disconnected.result.data.remoteNotified,false);assert.equal(JSON.parse(fs.readFileSync(path.join(f.configDir,'devices.json'))).devices[0].connected,false);assert.equal((await f.cli(['info'])).result.error.code,'NO_DEVICE');
});
test('non-idempotent requests with uncertain outcomes are not replayed',async t=>{
 const f=await setup(t);let requests=0;f.bridge.route=async(req)=>{requests++;for await(const chunk of req){}req.socket.destroy();};setSession(f.device,{'reconnect-timeout':1000,'request-timeout':100});await assert.rejects(api(f.device,'POST','/v1/pair',{pairingCode:'unused'}),{code:'REQUEST_OUTCOME_UNKNOWN'});assert.equal(requests,1);
});
test('task waiter survives a server outage and reports restart uncertainty without resubmission',async t=>{
 const f=await setup(t),original=f.bridge.route.bind(f.bridge);let polls=0,posts=0,restored=false;
 // This fixture fabricates the legacy polling endpoint without a stored task.
 // Advertise that capability honestly; real SSE restart is covered separately.
 const legacyRoute=original;f.bridge.route=(req,res)=>{if(req.url==='/v1/health'){res.end(JSON.stringify({deviceId:f.device.deviceId,data:{protocolVersion:1,taskEvents:false}}));return;}return legacyRoute(req,res);};
 const legacy=f.bridge.route.bind(f.bridge);
 f.bridge.route=async(req,res)=>{if(req.method==='POST'&&req.url==='/v1/tasks')posts++;if(req.url==='/v1/tasks/existing'){polls++;if(polls===1){res.end(JSON.stringify({deviceId:f.device.deviceId,data:{id:'existing',status:'running'}}));setTimeout(()=>{f.bridge.server.close();f.bridge.server.closeAllConnections();setTimeout(()=>{restored=true;f.bridge.server.listen(new URL(f.device.url).port,'127.0.0.1');},500);},30);return;}res.end(JSON.stringify({deviceId:f.device.deviceId,data:{id:'existing',status:'unknown',error:{code:'SERVICE_RESTARTED',message:'unknown'}}}));return;}return legacy(req,res);};
 const result=await f.cli(['task','wait','existing']);assert.equal(restored,true);assert.equal(result.code,1);assert.equal(result.result.data.status,'unknown');assert.equal(posts,0);assert.match(result.stderr,/Connection restored/);
});

test('devices watches real online/offline recovery and displays hostname, URL and stable ID without credentials',async t=>{
 const f=await setup(t),original=f.bridge.route.bind(f.bridge);let dropped=false,restored=false,mode='online',stdout='';const events=[];
 f.bridge.route=(req,res)=>{if(mode==='offline'){req.socket.destroy();return;}return original(req,res);};
 const code=await main(['devices','--watch','--duration','1200','--poll-ms','50','--probe-timeout','100','--config',f.configDir,'--json'],{stdout:{write:s=>{stdout+=s;const e=JSON.parse(s);if(!Array.isArray(e.data))return;events.push(e.data[0]);if(e.data[0].connectionState==='online'&&!dropped){dropped=true;mode='offline';}else if(e.data[0].connectionState==='offline'&&!restored){restored=true;setTimeout(()=>{mode='online';},200);}}},stderr:{write(){}}});
 assert.equal(code,0);assert.deepEqual(events.map(d=>d.connectionState),['online','offline','online']);assert.ok(events.every(d=>d.deviceId===f.device.deviceId&&d.url===f.device.url&&d.hostname===os.hostname()));assert.ok(!stdout.includes(f.device.token));assert.equal(events[1].enabled,true);assert.equal(events[1].connected,false);
 assert.equal((await f.cli(['info','--device',os.hostname()])).code,0);
 const saved=JSON.parse(fs.readFileSync(path.join(f.configDir,'devices.json')));assert.equal(saved.devices[0].hostname,os.hostname());
});
test('devices does not reconnect explicitly disconnected entries or repeatedly probe revoked authorization',async t=>{
 const f=await setup(t),original=f.bridge.route.bind(f.bridge);let requests=0;f.bridge.route=(req,res)=>{requests++;return original(req,res);};
 const file=path.join(f.configDir,'devices.json');fs.writeFileSync(file,JSON.stringify({devices:[{...f.device,connected:false}]}));const off=await f.cli(['devices']);assert.equal(off.result.data[0].connectionState,'disconnected');assert.equal(requests,0);
 fs.writeFileSync(file,JSON.stringify({devices:[f.device]}));f.bridge.clients[0].revokedAt=new Date().toISOString();let output='';
 await main(['devices','--watch','--duration','350','--poll-ms','50','--config',f.configDir,'--json'],{stdout:{write:s=>output+=s},stderr:{write(){}}});assert.equal(requests,1);assert.equal(JSON.parse(output.trim().split('\n')[0]).data[0].connectionState,'unauthorized');
});
test('hostname collisions require an explicit address or device ID',()=>{
 const {selectDevice}=require('../src/cli');assert.throws(()=>selectDevice({devices:[{hostname:'same',deviceId:'a'},{hostname:'SAME',deviceId:'b'}]},'same'),{code:'AMBIGUOUS_DEVICE'});
});
