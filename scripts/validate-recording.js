#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i].slice(2)]=process.argv[i+1];
const {main}=require(path.resolve(options.cli));
const output=path.resolve(options.output);fs.mkdirSync(output,{recursive:true});
async function cli(args){let stdout='',stderr='';const code=await main([...args,'--config',path.resolve(options.config),'--device',options.device,'--json'],{stdout:{write:s=>stdout+=s},stderr:{write:s=>stderr+=s}});const result=JSON.parse(stdout);assert.equal(code,0,JSON.stringify(result.error||result.data?.error||stderr));return result.data?.taskId?result.data.data:result.data;}
(async()=>{
 const recorded=await cli(['record','start','--args',JSON.stringify({durationSeconds:3,fps:15,monitor:0})]);
 const local=path.join(output,'recording.mp4');await cli(['pull',recorded.path,local]);
 const runtime=options.runtime||'C:\\Program Files\\wdb\\runtime';
 const probe=JSON.parse(execFileSync(path.join(runtime,'ffprobe.exe'),['-v','error','-show_streams','-of','json',local],{encoding:'utf8',windowsHide:true}));
 const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.codec_name,'h264');assert.ok(Number(video.duration)>=2.8);assert.ok(Number(video.nb_frames)>=40);
 execFileSync(path.join(runtime,'ffmpeg.exe'),['-v','error','-i',local,'-f','null','-'],{windowsHide:true});
 const frame=path.join(output,'frame.png');execFileSync(path.join(runtime,'ffmpeg.exe'),['-v','error','-ss','1','-i',local,'-frames:v','1','-y',frame],{windowsHide:true});
 const report={status:'pass',file:local,bytes:fs.statSync(local).size,durationSeconds:Number(video.duration),frames:Number(video.nb_frames),width:video.width,height:video.height,decoded:true,visualFrame:frame};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
