'use strict';
const fs=require('node:fs'),path=require('node:path');
const {ROOT,fail}=require('./common');
const {parseProgress,recordingStats}=require('./recording-stats');
function ffmpegPath(root=ROOT){
 const info=path.join(root,'BUILD-INFO.json');
 if(fs.existsSync(info)){
  if(JSON.parse(fs.readFileSync(info,'utf8').replace(/^\uFEFF/,'')).ffmpegMode==='no-ffmpeg')return null;
  const exe=path.join(root,'runtime','ffmpeg.exe');return fs.existsSync(exe)?exe:null;
 }
 return [path.join(root,'runtime','ffmpeg.exe'),path.join(root,'.runtime','ffmpeg','ffmpeg.exe')].find(f=>fs.existsSync(f))||null;
}
async function prepare(args,ctx){
 if(args.backend==='native')return require('./recording-native').prepare(args,ctx);
 const executable=ffmpegPath();if(!executable)throw fail('BACKEND_UNAVAILABLE','This installation does not include FFmpeg');
 const screenData=await require('./operations').native('screens',{},ctx);
 const monitor=Number(args.monitor??0),list=screenData.monitors||screenData.screens||screenData;
 if(!Number.isInteger(monitor)||monitor<0||!list[monitor])throw fail('MONITOR_NOT_FOUND','Monitor unavailable');
 const captureIndex=Number(args.captureIndex??monitor);
 if(!Number.isInteger(captureIndex)||captureIndex<0)throw fail('INVALID_MONITOR','captureIndex must be nonnegative');
 // Legacy FFmpeg does not expose the output identity; require an explicit index
 // on multi-monitor machines instead of claiming an unverified mapping.
 if(list.length>1&&args.captureIndex===undefined)throw fail('MONITOR_MAPPING_REQUIRED','FFmpeg on multiple monitors requires explicit captureIndex');
 const target=path.join(ctx.dir,'recording.mp4'),partial=path.join(ctx.dir,'recording.partial.mp4'),progressPath=path.join(ctx.dir,'encoder-progress.log');
 const started=Date.now();
 return {executable,stop:'q\n',argv:['-y','-hide_banner','-nostats','-loglevel','warning','-progress',progressPath,'-f','lavfi','-i',`ddagrab=output_idx=${captureIndex}:framerate=${args.fps}`,'-t',String(args.durationSeconds),'-vf','hwdownload,format=bgra,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-r',String(args.fps),'-fps_mode','cfr','-an','-movflags','+faststart',partial],result:({code,stderr,stopReason})=>{
  const log=path.join(ctx.dir,'encoder.log');fs.writeFileSync(log,stderr);
  if(code!==0)throw fail('RECORDING_FAILED',stderr.slice(-2000)||'FFmpeg terminated before finalization');
  fs.renameSync(partial,target);let progress={};try{progress=parseProgress(fs.readFileSync(progressPath,'utf8'));}catch{}
  return {id:ctx.id,path:target,exitCode:0,durationMs:Date.now()-started,backend:'ffmpeg',captureMethod:'DXGI Desktop Duplication (ddagrab)',monitor,captureIndex,monitorMappingVerified:list.length===1,requestedFps:args.fps,probe:null,progress,recordingStats:recordingStats(progress),encoderLog:log,audioStreams:0,finalized:true,stopReason:stopReason||'duration_limit',artifacts:[target,log,progressPath].filter(f=>fs.existsSync(f)).map(f=>({path:f,type:f===target?'video/mp4':'text/plain',size:fs.statSync(f).size}))};
 }};
}
module.exports={prepare,ffmpegPath};
