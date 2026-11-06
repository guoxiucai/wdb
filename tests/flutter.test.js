'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {runFlutter}=require('../src/flutter'),{fail}=require('../src/common'),{desktopCommand,parseArgv}=require('../src/cli');
function fixture(calls,overrides={}){return async(op,args,ctx)=>{calls.push({op,args});if(overrides[op])return overrides[op](args,ctx);if(op==='desktop.status')return {available:true};if(op==='windows.list')return [{window:'app',pid:123}];if(op==='ui.find')return {count:1,controls:[{reference:{window:'app',runtimeId:[1]}}]};if(op==='windows.hitTest')return {root:{window:'app'}};if(op==='screenshot')fs.writeFileSync(args.path,'fixture');return {};};}
const context={dir:__dirname,timeoutMs:1000};
test('Flutter CLI preserves isolate, source location and backend selectors',()=>{
  const p=parseArgv(['flutter','properties','--isolate','isolates/1','--widget-type','Text','--source-file','file:///app.dart','--line','7']);assert.deepEqual(desktopCommand(p.positional[0],p.positional.slice(1),p.options),{op:'flutter.properties',args:{isolate:'isolates/1',widgetType:'Text',sourceFile:'file:///app.dart',line:7}});
});
test('Flutter observation continues through unavailable VM and returns UIA plus screenshot',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-flutter-observe-')),calls=[];
  try{const r=await runFlutter('observe',{window:'app'},{...context,dir},{native:fixture(calls),vm:()=>assert.fail('Missing endpoint must not connect')});assert.equal(r.observed.flutter.error.code,'FLUTTER_ENDPOINT_REQUIRED');assert.equal(r.observed.uia.ok,true);assert.equal(r.observed.visual.ok,true);assert.equal(r.artifacts.length,1);}finally{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('wdb-flutter-observe-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('Window selection binds VM PID and rejects mismatched references before dispatch',async()=>{
  const calls=[];const result=await runFlutter('info',{window:'app',endpoint:'http://127.0.0.1:1234'},context,{native:fixture(calls),vm:async(op,args)=>{assert.equal(args.pid,123);return {bound:true};}});assert.equal(result.bound,true);
  await assert.rejects(runFlutter('action',{window:'app',reference:{window:'other'}},context,{native:fixture([])}),{code:'FLUTTER_PROCESS_MISMATCH'});
  await assert.rejects(runFlutter('info',{window:'app',pid:999},context,{native:fixture([])}),{code:'FLUTTER_PROCESS_MISMATCH'});
});
test('UIA acts once; safe pre-action misses alone can fall back to observed physical coordinates',async()=>{
  const calls=[];const r=await runFlutter('action',{window:'app',name:'Open',action:'click',visual:{x:10,y:10,layoutId:'layout'}},context,{native:fixture(calls,{'ui.find':()=>({count:0,controls:[]})})});assert.equal(r.backend,'visual');assert.equal(r.attempts.length,2);assert.equal(calls.filter(c=>c.op==='input.mouse').length,1);
  const normal=[];const done=await runFlutter('action',{window:'app',name:'Open'},context,{native:fixture(normal)});assert.equal(done.backend,'uia');assert.equal(normal.filter(c=>c.op==='ui.action').length,1);
});
test('Uncertain UIA action and deadline expiry never fall back to physical input',async()=>{
  const calls=[];await assert.rejects(runFlutter('action',{window:'app',name:'Open',visual:{x:1,y:1,layoutId:'layout'}},context,{native:fixture(calls,{'ui.action':()=>{throw fail('TIMEOUT','no response');}})}),{code:'ACTION_OUTCOME_UNKNOWN'});assert.ok(!calls.some(c=>c.op==='input.mouse'));
  const late=[];await assert.rejects(runFlutter('action',{window:'app',name:'Open'},{...context,timeoutMs:20},{native:fixture(late,{'ui.find':async()=>{await new Promise(r=>setTimeout(r,40));return {count:1,controls:[{reference:{window:'app'}}]};}})}),{code:'ACTION_OUTCOME_UNKNOWN'});assert.ok(!late.some(c=>c.op==='ui.action'));
});
test('Inspector cannot be selected as a synthetic action backend',async()=>{
  await assert.rejects(runFlutter('action',{window:'app',backend:'flutter'},context,{native:fixture([])}),{code:'INVALID_ARGUMENT'});
});
