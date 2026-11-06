'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runElectron,winArg}=require('../src/electron');
const {desktopCommand,parseArgv}=require('../src/cli');
const {fail}=require('../src/common');
const ctx={dir:__dirname,timeoutMs:1000};
function nativeFixture(calls,actionError){return async(op,args)=>{calls.push({op,args});if(op==='desktop.status')return {available:true};if(op==='ui.find')return {count:1,controls:[{reference:{window:'fixture',runtimeId:[1]}}]};if(op==='ui.action'){if(actionError)throw actionError;return {method:'uia'};}if(op==='windows.hitTest')return {root:{window:'fixture'}};return {};};}
test('electron CLI maps endpoint, target, structured selectors, arguments and backend',()=>{
  const p=parseArgv(['electron','action','--endpoint','http://127.0.0.1:9333','--target','page1','--selector','button[data-testid="open"]','--backend','cdp','--action','click']);
  assert.deepEqual(desktopCommand(p.positional[0],p.positional.slice(1),p.options),{op:'electron.action',args:{action:'click',endpoint:'http://127.0.0.1:9333',target:'page1',selector:'button[data-testid="open"]',backend:'cdp'}});
  assert.deepEqual(desktopCommand('electron',['launch','C:\\Apps\\app.exe'],{port:'9333',arguments:'["--test-mode"]'}).args,{path:'C:\\Apps\\app.exe',port:9333,arguments:['--test-mode']});
  assert.equal(winArg('C:\\A B\\'),'"C:\\A B\\\\"');
});
test('auto falls back to UIA only when CDP did not locate a control',async()=>{
  const calls=[];const result=await runElectron('action',{window:'fixture',name:'Open',action:'click'},ctx,{native:nativeFixture(calls),cdp:async()=>{throw fail('CONTROL_NOT_FOUND','missing');}});
  assert.equal(result.backend,'uia');assert.equal(result.attempts.length,2);assert.equal(calls.filter(c=>c.op==='ui.action').length,1);
});
test('uncertain CDP or UIA effects never trigger fallback or repeated actions',async()=>{
  for(const code of ['ACTION_OUTCOME_UNKNOWN','AMBIGUOUS_CONTROL','CDP_TIMEOUT']){const calls=[];await assert.rejects(runElectron('action',{window:'fixture',name:'Open',visual:{x:5,y:5,layoutId:'layout'}},ctx,{native:nativeFixture(calls),cdp:async()=>{throw fail(code,'uncertain');}}),{code});assert.deepEqual(calls.map(c=>c.op),['desktop.status']);}
  const calls=[];await assert.rejects(runElectron('action',{window:'fixture',name:'Open',visual:{x:5,y:5,layoutId:'layout'}},ctx,{native:nativeFixture(calls,fail('TIMEOUT','uia timeout')),cdp:async()=>{throw fail('CDP_UNAVAILABLE','offline');}}),{code:'ACTION_OUTCOME_UNKNOWN'});assert.ok(!calls.some(c=>c.op==='input.mouse'));
});
test('visual fallback verifies layout and target window before one physical click',async()=>{
  const calls=[];const result=await runElectron('action',{backend:'visual',window:'fixture',x:12,y:34,layoutId:'layout'},ctx,{native:nativeFixture(calls)});assert.equal(result.backend,'visual');assert.deepEqual(calls.map(c=>c.op),['desktop.status','windows.action','windows.hitTest','input.mouse']);
  assert.equal(calls.at(-1).args.layoutId,'layout');
  await assert.rejects(runElectron('action',{backend:'visual',window:'fixture',x:12,y:34},ctx,{native:nativeFixture([])}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(runElectron('action',{backend:'visual',window:'fixture',x:12,y:34,layoutId:'layout'},ctx,{native:async(op,args)=>op==='windows.hitTest'?{root:{window:'other'}}:nativeFixture([])(op,args)}),{code:'VISUAL_TARGET_MISMATCH'});
});
test('Electron refuses a locked desktop before discovering or controlling pages',async()=>{
  await assert.rejects(runElectron('targets',{},ctx,{native:async()=>({available:false}),cdp:async()=>assert.fail('must not dispatch')}),{code:'DESKTOP_UNAVAILABLE'});
});
test('one task deadline covers lookup and prevents late action dispatch',async()=>{
  const calls=[];
  await assert.rejects(runElectron('action',{backend:'uia',window:'fixture',name:'Open'},{...ctx,timeoutMs:30},{native:async(op,args,context)=>{
    calls.push(op);if(op==='desktop.status')return {available:true};
    if(op==='ui.find'){await new Promise(resolve=>setTimeout(resolve,50));assert.equal(context.signal.aborted,true);return {count:1,controls:[{reference:{window:'fixture',runtimeId:[1]}}]};}
    assert.fail('Must not dispatch after lookup exceeded deadline');
  }}),{code:'ACTION_OUTCOME_UNKNOWN'});
  assert.deepEqual(calls,['desktop.status','ui.find']);
});
