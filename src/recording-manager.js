'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {fail}=require('./common');

// The helper owns all recording processes. Completed results live in the task
// directory, not an unbounded in-memory cache; the service checks ownership.
class RecordingManager {
 constructor({launch=spawn,prepare,stopGraceMs=15000}={}){this.launch=launch;this.prepare=prepare;this.stopGraceMs=stopGraceMs;this.active=new Map();this.closing=false;}
 async run(op,args,ctx){
  if(op==='record.stop'){
   const entry=this.active.get(args.id);
   if(entry){entry.stop('requested');return entry.done;}
   if(!/^[a-f0-9-]{36}$/i.test(args.id||''))throw fail('INVALID_ARGUMENT','Recording task id required');
   const file=path.join(path.dirname(ctx.dir),args.id,'recording-result.json');
   if(fs.existsSync(file)){const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.error)throw Object.assign(new Error(saved.error.message),saved.error);return saved.data;}
   throw fail('RECORDING_NOT_FOUND','Recording is absent or its outcome is unknown');
  }
  if(op!=='record.start')throw fail('UNKNOWN_OPERATION','Unsupported recording operation');
  if(this.closing)throw fail('HELPER_CLOSING','Desktop helper is closing');
  if(this.active.size)throw fail('RESOURCE_LIMIT','Only one recording may run per desktop helper');
  if(ctx.signal?.aborted)throw fail('CANCELLED','Recording cancelled before initialization');
  const duration=Number(args.durationSeconds??600),fps=Number(args.fps??30);
  if(!Number.isFinite(duration)||duration<1||duration>3600)throw fail('INVALID_DURATION','Recording duration must be 1..3600 seconds');
  if(!Number.isInteger(fps)||fps<1||fps>60)throw fail('INVALID_FPS','fps must be 1..60');
  const backend=args.backend??'native';if(!['native','ffmpeg'].includes(backend))throw fail('INVALID_BACKEND','backend must be native or ffmpeg');
  const entry={reason:null,child:null};let grace,deadline;
  entry.stop=reason=>{if(entry.reason)return;entry.reason=reason;if(entry.child){entry.child.stdin.write(entry.spec.stop);grace=setTimeout(()=>entry.child.kill(),this.stopGraceMs);}};
  // Reserve before any asynchronous initialization to prevent concurrent starts.
  this.active.set(ctx.id,entry);
  entry.done=Promise.resolve().then(async()=>{
   let output='',stderr='',childError;
   const abort=()=>entry.stop('cancelled');ctx.signal?.addEventListener('abort',abort,{once:true});
   deadline=setTimeout(()=>entry.stop('timeout'),Math.min(ctx.timeoutMs||duration*1000+30000,duration*1000+30000));
   try{
    entry.spec=await this.prepare({...args,backend,fps,durationSeconds:duration},ctx);
    if(entry.reason||ctx.signal?.aborted)throw fail('CANCELLED','Recording cancelled during initialization');
    const child=entry.child=this.launch(entry.spec.executable,entry.spec.argv,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    child.stdin.on('error',()=>{});
    child.stdout.on('data',b=>{if(output.length<1024*1024)output+=b.toString();if(Buffer.byteLength(output)>1024*1024){childError=fail('MEDIA_PROTOCOL_ERROR','Recording response exceeds limit');entry.stop('protocol_error');}});
    child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-65536);});
    const code=await new Promise(resolve=>{child.once('error',e=>{childError=e;});child.once('close',resolve);});
    if(childError)throw childError;
    const data=await entry.spec.result({code,output,stderr,stopReason:entry.reason});
    fs.writeFileSync(path.join(ctx.dir,'recording-result.json'),JSON.stringify({data}));return data;
   }catch(e){fs.writeFileSync(path.join(ctx.dir,'recording-result.json'),JSON.stringify({error:{code:e.code||'RECORDING_FAILED',message:e.message}}));throw e;}
   finally{clearTimeout(grace);clearTimeout(deadline);ctx.signal?.removeEventListener('abort',abort);this.active.delete(ctx.id);}
  });
  return entry.done;
 }
 async close(){this.closing=true;for(const e of this.active.values())e.stop('helper_shutdown');await Promise.allSettled([...this.active.values()].map(e=>e.done));}
}
module.exports={RecordingManager};
