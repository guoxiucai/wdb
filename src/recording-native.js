'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ROOT,fail,execute}=require('./common');
const executable=path.join(ROOT,'native','bin','CaptureHost.exe');
function parse(output){let result;try{result=JSON.parse(output.replace(/^\uFEFF/,''));}catch{throw fail('MEDIA_PROTOCOL_ERROR','Native recorder did not return valid JSON');}if(!result.ok)throw Object.assign(fail(result.error?.code||'RECORDING_FAILED',result.error?.message||'Native recorder failed'),{details:{hresult:result.error?.hresult}});return result.data;}
async function probe(ctx){
 if(!fs.existsSync(executable))return {available:false,reason:'CAPTURE_HOST_MISSING'};
 const file=path.join(ctx.dir,'media-probe-'+crypto.randomUUID()+'.json');
 try{fs.writeFileSync(file,JSON.stringify({op:'probe',path:file+'.mp4'}));const result=await execute(executable,[file],{timeoutMs:5000});if(result.timedOut)return {available:false,reason:'MEDIA_PROBE_TIMEOUT'};return parse(result.stdout);}
 catch(e){return {available:false,reason:e.code||'MEDIA_UNAVAILABLE',message:e.message};}
 finally{fs.rmSync(file,{force:true});fs.rmSync(file+'.mp4',{force:true});}
}
async function prepare(args,ctx){
 if(!fs.existsSync(executable))throw fail('BACKEND_UNAVAILABLE','Precompiled CaptureHost is not installed');
 for(const key of ['monitor','captureIndex'])if(args[key]!==undefined&&(!Number.isInteger(args[key])||args[key]<0))throw fail('INVALID_MONITOR',key+' must be a nonnegative integer');
 if(args.encoder!==undefined&&!['auto','software'].includes(args.encoder))throw fail('INVALID_ENCODER','encoder must be auto or software');
 const partial=path.join(ctx.dir,'recording.partial.mp4'),target=path.join(ctx.dir,'recording.mp4'),request=path.join(ctx.dir,'capture-request.json'),started=Date.now();
 const maxBytes=Math.min(ctx.maxArtifactBytes||1024**3,1024**3*10);
 fs.writeFileSync(request,JSON.stringify({op:'record',path:partial,monitor:args.monitor??0,...(args.captureIndex!==undefined?{captureIndex:args.captureIndex}:{}),fps:args.fps,durationSeconds:args.durationSeconds,encoder:args.encoder||'auto',parentPid:process.pid,maxBytes}));
 return {executable,argv:[request],stop:'stop\n',result:({code,output,stderr,stopReason})=>{
  fs.writeFileSync(path.join(ctx.dir,'encoder.log'),stderr);const result=parse(output);if(code!==0||!result.finalized)throw fail('RECORDING_FAILED','Recorder exited before finalization');
  fs.renameSync(partial,target);
  return {...result,id:ctx.id,path:target,exitCode:0,durationMs:Date.now()-started,monitor:args.monitor??0,requestedFps:args.fps,probe:null,recordingStats:{source:'native-media-foundation',frames:result.video.decodedFrames,outputDurationSeconds:result.video.durationSeconds,complete:true},stopReason:stopReason||result.stopReason||'duration_limit',...(stopReason==='timeout'?{timedOut:true}:{}),...(stopReason==='cancelled'||stopReason==='helper_shutdown'?{cancelled:true}:{}),artifacts:[{path:target,type:'video/mp4',size:fs.statSync(target).size}]};
 }};
}
module.exports={prepare,probe,parse};
