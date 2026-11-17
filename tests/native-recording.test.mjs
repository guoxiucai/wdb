import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{RecordingManager}=require('../src/recording-manager'),{prepare}=require('../src/recording-backends');
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.runtime','native-regression');
fs.mkdirSync(out,{recursive:true});
const exe=process.env.WDB_CAPTURE_HOST||path.join(root,'native/bin/CaptureHost.exe');
test('native video-only recording, software selection, stop, EOF, decoding and corrupt file rejection',{timeout:90000},async t=>{
 execFileSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:winexe','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/out:'+path.join(out,'fixture.exe'),path.join(root,'tests/recording-fixture.cs')]);
 const fixture=spawn(path.join(out,'fixture.exe'),[],{windowsHide:true});t.after(()=>fixture.kill());await new Promise(r=>setTimeout(r,1000));
 async function record(name,extra={},stopAfter){const request=path.join(out,name+'.json'),file=path.join(out,name+'.mp4');fs.writeFileSync(request,JSON.stringify({op:'record',durationSeconds:3,fps:30,path:file,...extra}));const child=spawn(exe,[request],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='';child.stdout.on('data',b=>stdout+=b);const timer=stopAfter?setTimeout(()=>child.stdin.end(),stopAfter):null;const code=await new Promise(r=>child.once('close',r));clearTimeout(timer);assert.equal(code,0,stdout);const data=JSON.parse(stdout).data;assert.equal(data.video.audioStreams,0);assert.equal(data.video.decoded,true);assert.equal(data.video.width,1920);assert.equal(data.video.height,1080);return {data,file};}
 const auto=await record('auto');assert.ok(auto.data.video.decodedFrames>=75,JSON.stringify(auto.data));
 const soft=await record('software',{encoder:'software'});assert.equal(soft.data.hardwareAccelerated,false);assert.ok(soft.data.video.decodedFrames>0);
 const stopped=await record('eof',{durationSeconds:60},1800);assert.ok(stopped.data.video.durationSeconds<5);assert.equal(stopped.data.stopReason,'control_closed');
 fixture.kill();await new Promise(r=>fixture.once('close',r));const still=spawn(path.join(out,'fixture.exe'),[],{windowsHide:true,env:{...process.env,WDB_STATIC_FIXTURE:'1'}});t.after(()=>still.kill());await new Promise(r=>setTimeout(r,1000));const staticVideo=await record('static');assert.ok(staticVideo.data.video.decodedFrames>=85,JSON.stringify(staticVideo.data));
 const bad=path.join(out,'bad.mp4');fs.writeFileSync(bad,fs.readFileSync(auto.file).subarray(0,80));const req=path.join(out,'bad.json');fs.writeFileSync(req,JSON.stringify({op:'verify',path:bad}));assert.throws(()=>execFileSync(exe,[req],{timeout:15000}));
 const id='22222222-2222-4222-8222-222222222222',dir=path.join(out,id);fs.mkdirSync(dir,{recursive:true});const manager=new RecordingManager({prepare});const start=manager.run('record.start',{durationSeconds:60},{id,dir,timeoutMs:65000});await new Promise(r=>setTimeout(r,2000));const stoppedByTask=await manager.run('record.stop',{id},{id:'stop',dir:path.join(out,'stop')});assert.equal(stoppedByTask.finalized,true);assert.deepEqual(await start,stoppedByTask);assert.ok(fs.existsSync(stoppedByTask.path));await manager.close();
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({auto:auto.data,static:staticVideo.data,software:soft.data,eof:stopped.data,taskStop:stoppedByTask},null,2));
});
