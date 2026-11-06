#!/usr/bin/env node
'use strict';
// Live protocol acceptance. UI actions require fresh, application-specific observations
// and are recorded separately. The log stimulus reapplies one observed Inspector flag.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync,spawn}=require('node:child_process'),{argv}=require('../src/common'),{VmConnection}=require('../src/flutter-rpc');
const options=argv(),root=path.resolve(__dirname,'..'),output=path.resolve(options.output||'artifacts/flutter-live-'+Date.now());
fs.mkdirSync(output,{recursive:true});const report={startedAt:new Date().toISOString(),steps:[],scope:'Real Flutter VM diagnostics and WDB CLI; business UI actions are validated separately'};
const cli=path.join(root,'src/cli.js');let session;
function command(args){const r=spawnSync(process.execPath,[cli,...args,'--json'],{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:16*1024*1024});if(r.error)throw r.error;return JSON.parse(r.stdout);}
function save(label,r){fs.writeFileSync(path.join(output,label+'.json'),JSON.stringify(r,null,2));const t=r.data;report.steps.push({label,taskId:t.id,status:t.status,error:t.error?.code,durationMs:t.durationMs});for(const [i,a]of(t.artifacts||[]).entries()){const p=command(['pull',a.path,path.join(output,label+'-'+i+path.extname(a.path)),'--overwrite']);assert.equal(p.status,'succeeded');}return t;}
function call(op,args,label){const file=path.join(output,label+'.args.private.json');fs.writeFileSync(file,JSON.stringify(args));return save(label,command(['call',op,'--args-file',file,'--timeout','20000','--reconnect-timeout','5000']));}
function ok(t){assert.equal(t.status,'succeeded',JSON.stringify(t.error));return t.data;}
async function main(){
  assert.ok(options.session,'--session <local JSON file containing endpoint, window/pid and optional isolate> is required');session=JSON.parse(fs.readFileSync(options.session,'utf8').replace(/^\uFEFF/,''));
  const info=ok(call('flutter.info',session,'info')),isolate=info.isolates.filter(i=>session.isolate?i.id===session.isolate:i.capabilities.inspector);assert.equal(isolate.length,1,'Select one Inspector isolate');session.isolate=isolate[0].id;report.pid=info.pid;report.vmVersion=info.vmVersion;
  const tree=ok(call('flutter.tree',session,'tree'));assert.ok(tree.count>0);assert.equal(tree.cleanup.released,true);report.widgetCount=tree.count;
  const first=tree.nodes.find(n=>n.creationLocation&&tree.nodes.filter(v=>v.widgetType===n.widgetType&&v.creationLocation?.file===n.creationLocation.file&&v.creationLocation?.line===n.creationLocation.line).length===1);assert.ok(first,'Need a unique observed widget source location');
  const query={...session,widgetType:first.widgetType,sourceFile:first.creationLocation.file,line:first.creationLocation.line};
  const props=ok(call('flutter.properties',query,'properties'));assert.ok(props.properties.length>0);assert.equal(props.cleanup.released,true);
  ok(call('flutter.wait',{...query,state:'present',timeoutMs:2000},'wait'));
  const wrong=call('flutter.info',{...session,window:undefined,pid:info.pid+1},'wrong-process');assert.equal(wrong.error.code,'FLUTTER_PROCESS_MISMATCH');
  const memory=ok(call('flutter.memory',session,'memory'));assert.ok(memory.memory.heapUsage>=0);
  const noEndpoint={...session};delete noEndpoint.endpoint;const fallback=ok(call('flutter.observe',noEndpoint,'without-vm'));assert.equal(fallback.observed.flutter.ok,false);assert.equal(fallback.observed.uia.ok,true);assert.equal(fallback.observed.visual.ok,true);
  const extension='ext.flutter.inspector.show',file=path.join(output,'logs.args.private.json');fs.writeFileSync(file,JSON.stringify({...session,durationMs:5000,limit:1000}));
  const logResult=new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'call','flutter.logs','--args-file',file,'--timeout','15000','--json'],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);child.on('error',reject);const timer=setTimeout(()=>{child.kill();reject(Error('Log CLI exceeded deadline'));},25000);child.on('close',()=>{clearTimeout(timer);try{resolve(JSON.parse(out));}catch(e){reject(e);}});});
  // Independent test stimulus through an existing Inspector extension. Read its
  // current flag, then reapply exactly that value to emit a diagnostic event.
  // No evaluator/compiler service or changes to application source are required.
  await new Promise(r=>setTimeout(r,2000));const vm=new VmConnection(session.endpoint,{timeoutMs:3000});
  let enabled;
  try{const identity=await vm.send('getVM');assert.equal(identity.pid,info.pid);const before=await vm.send(extension,{isolateId:session.isolate});enabled=before.enabled;assert.ok(['true','false'].includes(enabled));await vm.send(extension,{isolateId:session.isolate,enabled});const after=await vm.send(extension,{isolateId:session.isolate});assert.equal(after.enabled,enabled);}finally{vm.close();}
  const logs=ok(save('logs',await logResult));assert.ok(logs.events.some(e=>e.event?.extensionKind==='Flutter.ServiceExtensionStateChanged'&&e.event.extensionData?.extension===extension&&String(e.event.extensionData.value)===enabled),'Must receive the Inspector event through WDB');report.inspectorFlagPreserved=true;report.logExtensionObserved=true;report.eventCount=logs.events.length;
  report.passed=true;
}
main().catch(e=>{report.passed=false;report.error={code:e.code,message:e.message};process.exitCode=1;}).finally(()=>{report.endedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(output,'report.json'),error:report.error},null,2));});
