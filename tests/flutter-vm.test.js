'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./support/rpc-fixture');const {VmConnection,serviceUrl}=require('../src/flutter-rpc');const {runVm}=require('../src/flutter-vm');
const prefix='ext.flutter.inspector.',methods=['getRootWidget','getRootWidgetSummaryTree','getProperties','disposeGroup'];
function ctx(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-vm-'));return {dir,timeoutMs:2000,cleanup(){assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('wdb-vm-'));fs.rmSync(dir,{recursive:true,force:true});}};}
function vmHandler(overrides={}){return (req,reply,socket,send)=>{
  if(overrides[req.method])return overrides[req.method](req,reply,socket,send);
  if(req.method==='getVM')return reply({pid:123,version:'fixture',isolates:[{id:'isolates/1'}]});
  if(req.method==='getIsolate')return reply({id:req.params.isolateId,name:'main',extensionRPCs:methods.map(n=>prefix+n)});
  if(req.method===prefix+'getRootWidgetSummaryTree')return reply({result:{description:'App',valueId:'root',children:[{description:'Text',widgetRuntimeType:'Text',valueId:'text',creationLocation:{file:'file:///app.dart',line:7}},{description:'Button',valueId:'button'}]}});
  if(req.method===prefix+'getProperties')return reply({result:[{name:'data',description:'真实文本',valueId:'must-not-leak'}]});
  reply({result:null});
};}
test('VM endpoint preserves authentication path and rejects remote or ambiguous URL forms',()=>{
  assert.equal(serviceUrl('http://localhost:1234/token=/').href,'ws://127.0.0.1:1234/token=/ws');assert.equal(serviceUrl('ws://127.0.0.1:1234/token=/ws').pathname,'/token=/ws');
  for(const u of ['http://192.168.1.2:1234','https://127.0.0.1:1234','http://user:pass@127.0.0.1','http://127.0.0.1/?uri=x','file:///app'])assert.throws(()=>serviceUrl(u),{code:'INVALID_FLUTTER_ENDPOINT'});
});
test('VM JSON-RPC correlates replies and reports cancellation without replays',async()=>{
  const f=await fixture((req,reply)=>{assert.equal(req.jsonrpc,'2.0');if(req.method==='slow')setTimeout(()=>reply({order:1}),15);else if(req.method==='fast')reply({order:2});});const abort=new AbortController(),c=new VmConnection(f.endpoint+'/secret=/',{signal:abort.signal,timeoutMs:100});
  try{assert.deepEqual(await Promise.all([c.send('slow'),c.send('fast')]),[{order:1},{order:2}]);const p=c.send('pending');abort.abort();await assert.rejects(p,{code:'CANCELLED'});assert.ok(f.calls.filter(x=>x.method==='pending').length<=1);}finally{c.close();await f.close();}
});
test('VM discovery validates process and refuses multiple Flutter isolates',async()=>{
  const f=await fixture(vmHandler({getVM:(_,reply)=>reply({pid:123,isolates:[{id:'one'},{id:'two'}]})})),context=ctx();
  try{await assert.rejects(runVm('tree',{endpoint:f.endpoint,pid:456},context),{code:'FLUTTER_PROCESS_MISMATCH'});assert.equal(f.calls.filter(x=>x.method==='getIsolate').length,0);await assert.rejects(runVm('tree',{endpoint:f.endpoint,pid:123},context),{code:'AMBIGUOUS_FLUTTER_ISOLATE'});const result=await runVm('tree',{endpoint:f.endpoint,isolate:'two'},context);assert.equal(result.isolate.id,'two');}finally{context.cleanup();await f.close();}
});
test('Inspector queries and property reads use fresh group references and release only their own group',async()=>{
  const f=await fixture(vmHandler()),context=ctx();try{
    const result=await runVm('properties',{endpoint:f.endpoint+'/secret=/',widgetType:'Text'},context);assert.equal(result.properties[0].description,'真实文本');assert.equal(result.cleanup.released,true);assert.ok(!JSON.stringify(result).includes('must-not-leak'));assert.ok(!JSON.stringify(result).includes('secret='));
    const read=f.calls.find(x=>x.method===prefix+'getProperties'),dispose=f.calls.find(x=>x.method===prefix+'disposeGroup');assert.equal(read.params.arg,'text');assert.equal(read.params.objectGroup,dispose.params.objectGroup);assert.match(read.params.objectGroup,/^wdb-/);assert.ok(!f.calls.some(x=>x.method.includes('disposeAll')));
  }finally{context.cleanup();await f.close();}
});
test('Inspector unavailability degrades explicitly, and truncated trees cannot prove absence',async()=>{
  let available=false;const f=await fixture(vmHandler({getIsolate:(req,reply)=>reply({id:req.params.isolateId,extensionRPCs:available?methods.map(n=>prefix+n):['ext.flutter.showPerformanceOverlay']})})),context=ctx();
  try{const info=await runVm('info',{endpoint:f.endpoint},context);assert.equal(info.isolates[0].capabilities.inspector,false);await assert.rejects(runVm('tree',{endpoint:f.endpoint},context),{code:'FLUTTER_INSPECTOR_UNAVAILABLE'});available=true;await assert.rejects(runVm('wait',{endpoint:f.endpoint,contains:'missing',state:'absent',limit:1},context),{code:'FLUTTER_TREE_TRUNCATED'});assert.ok(f.calls.some(x=>x.method===prefix+'disposeGroup'));}finally{context.cleanup();await f.close();}
});
test('VM RPC failures do not expose remote error secrets or retry a dropped request',async()=>{
  const f=await fixture((req,reply,socket,send)=>req.method==='error'?send({id:req.id,error:{code:-32000,message:'secret-token-path'}}):socket.destroy()),c=new VmConnection(f.endpoint);
  try{await assert.rejects(c.send('error'),e=>e.code==='FLUTTER_PROTOCOL_ERROR'&&!e.message.includes('secret-token-path'));await assert.rejects(c.send('drop'),{code:'FLUTTER_DISCONNECTED'});assert.equal(f.calls.filter(x=>x.method==='drop').length,1);}finally{c.close();await f.close();}
});
