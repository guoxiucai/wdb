'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {DeviceVisibility,sessionKey,OFFLINE_MS}=require('../src/device-visibility');
test('terminal observations survive CLI invocations, expire without refreshing, and recover',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wdb-visible-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let now=1000;const open=session=>new DeviceVisibility(dir,{session,now:()=>now}).load();
 const offline={url:'https://example.invalid:18766',deviceId:'1234567890abcdef',connectionState:'offline'},online={...offline,connectionState:'online'};
 assert.deepEqual(await (await open('one')).filter([offline]),[]);
 await (await open('one')).online(online);
 assert.deepEqual(await (await open('two')).filter([offline]),[]);
 assert.deepEqual(await (await open('one')).filter([offline]),[offline]);
 now+=OFFLINE_MS-1;assert.deepEqual(await (await open('one')).filter([offline]),[offline]);
 now++;assert.deepEqual(await (await open('one')).filter([offline]),[]);
 assert.deepEqual(await (await open('one')).filter([online]),[online]);
 assert.deepEqual(await (await open('one')).filter([offline]),[offline]);
 const unauthorized={...offline,connectionState:'unauthorized'};
 assert.deepEqual(await (await open('two')).filter([unauthorized]),[unauthorized]);
});
test('Windows and Mac terminal identifiers isolate parent shells',()=>{
 for(const env of [{WT_SESSION:'windows-tab'},{TERM_SESSION_ID:'mac-tab'},{}]){
  assert.equal(sessionKey(env,10),sessionKey(env,10));
  assert.notEqual(sessionKey(env,10),sessionKey(env,11));
 }
 assert.notEqual(sessionKey({WT_SESSION:'a'},10),sessionKey({WT_SESSION:'b'},10));
});
test('separate CLI processes share a parent session but a new parent is isolated',()=>{
 const {execFileSync}=require('node:child_process');
 const code=`process.stdout.write(require(${JSON.stringify(require.resolve('../src/device-visibility'))}).currentSession())`;
 const run=()=>execFileSync(process.execPath,['-e',code],{encoding:'utf8'});
 const first=run();assert.equal(run(),first);
 const nested=`process.stdout.write(require('node:child_process').execFileSync(process.execPath,['-e',${JSON.stringify(code)}]))`;
 assert.notEqual(execFileSync(process.execPath,['-e',nested],{encoding:'utf8'}),first);
});
