#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {checkRecording}=require('./check-recording');
const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i].slice(2)]=process.argv[i+1];
const {main}=require(path.resolve(options.cli));
const output=path.resolve(options.output);fs.mkdirSync(output,{recursive:true});
async function cli(args){let stdout='',stderr='';const code=await main([...args,'--config',path.resolve(options.config),'--device',options.device,'--json'],{stdout:{write:s=>stdout+=s},stderr:{write:s=>stderr+=s}});const result=JSON.parse(stdout);assert.equal(code,0,JSON.stringify(result.error||result.data?.error||stderr));return result.data?.taskId?result.data.data:result.data;}
(async()=>{
 const recorded=await cli(['record','start','--args',JSON.stringify({durationSeconds:3,fps:15,monitor:0})]);
 const local=path.join(output,'recording.mp4');await cli(['pull',recorded.path,local]);
 const runtime=options.runtime||'C:\\Program Files\\wdb\\runtime';
 const video=checkRecording(path.join(runtime,'ffmpeg.exe'),local,output);
 assert.ok(video.durationSeconds>=2.8);assert.ok(video.frames>=40);assert.equal(video.width,1920);assert.equal(video.height,1080);
 assert.equal(recorded.probe,null);assert.equal(recorded.recordingStats.source,'ffmpeg-progress');assert.ok(recorded.recordingStats.frames>=40);
 const report={status:'pass',...video,recordingStats:recorded.recordingStats};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
