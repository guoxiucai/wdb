'use strict';
const fs=require('node:fs'),path=require('node:path');
const {fail}=require('./common');const {runVm}=require('./flutter-vm');const {runElectron}=require('./electron');
const SAFE_UIA=new Set(['CONTROL_NOT_FOUND','STALE_CONTROL','PATTERN_UNAVAILABLE']);
const errorInfo=e=>({code:e.code||'FLUTTER_ERROR',message:e.message,details:e.details,artifacts:e.artifacts||[]});
async function runFlutter(operation,args,ctx,{native,vm=runVm}={}){
  const deadline=Date.now()+(ctx.timeoutMs||120000),signal=AbortSignal.any([AbortSignal.timeout(ctx.timeoutMs||120000),...(ctx.signal?[ctx.signal]:[])]);
  const remaining=()=>Math.max(1,deadline-Date.now());
  const invoke=async(fn,op,values,budget=remaining())=>{if(signal.aborted)throw fail(ctx.signal?.aborted?'CANCELLED':'TIMEOUT','Flutter task ended before dispatch');return fn(op,values,{...ctx,signal,timeoutMs:Math.min(remaining(),budget)});};
  const status=await invoke(native,'desktop.status',{});if(!status.available)throw fail('DESKTOP_UNAVAILABLE','Flutter debugging requires the logged-in unlocked desktop');
  if(args.reference&&args.window&&args.reference.window!==args.window)throw fail('FLUTTER_PROCESS_MISMATCH','UIA reference belongs to another window');
  const window=args.window||args.reference?.window;let pid=args.pid;
  if(window){const windows=await invoke(native,'windows.list',{}),selected=windows.filter(w=>w.window===window);if(selected.length!==1)throw fail('STALE_WINDOW','Selected window no longer exists');if(pid!==undefined&&Number(pid)!==selected[0].pid)throw fail('FLUTTER_PROCESS_MISMATCH','PID and window disagree');pid=selected[0].pid;}
  const values={...args,...(window?{window}:{}),...(pid!==undefined?{pid}:{})};
  const protocol=async(op,budget)=>{if(!args.endpoint)throw fail('FLUTTER_ENDPOINT_REQUIRED','Supply the Dart VM Service URI in endpoint; UIA and visual do not require it');return invoke(vm,op,values,budget);};
  const screenshot=async()=>{const file=path.join(ctx.dir,'flutter-desktop.png');const data=await invoke(native,'screenshot',{...(window?{window}:{}),...(args.region?{region:args.region}:{}),path:file});return {...data,backend:'visual',artifacts:[{path:file,type:'image/png',size:fs.statSync(file).size}]};};
  if(operation==='observe'){
    const observed={};
    for(const backend of ['flutter','uia','visual'])try{
      const data=backend==='flutter'?await protocol('tree',8000):backend==='uia'?(window?await invoke(native,'ui.tree',{window,limit:args.uiaLimit||150,depth:args.uiaDepth||12},8000):{unavailable:true,reason:'Supply window for UIA'}):await screenshot();
      observed[backend]={ok:!data.unavailable,data};
    }catch(e){if(signal.aborted)throw e;observed[backend]={ok:false,error:errorInfo(e)};}
    return {backend:'combined',observed,artifacts:Object.values(observed).flatMap(x=>x.data?.artifacts||x.error?.artifacts||[])};
  }
  if(operation==='screenshot')return screenshot();
  if(operation!=='action')return protocol(operation);
  const backend=args.backend||'auto';if(!['auto','uia','visual'].includes(backend))throw fail('INVALID_ARGUMENT','Flutter action supports auto, uia or visual; Inspector is an observation channel');
  const attempts=[],candidates=backend==='auto'?['uia',...(args.visual?['visual']:[])]:[backend];
  for(const selected of candidates){
    try{
      const data=await invoke((op,a,c)=>runElectron(op,a,c,{native}),'action',{...values,backend:selected});
      return {...data,attempts:[...attempts,{backend:selected,status:'executed'}],artifacts:[...attempts.flatMap(x=>x.error.artifacts||[]),...(data.artifacts||[])]};
    }catch(e){attempts.push({backend:selected,status:'failed',error:errorInfo(e)});if(backend!=='auto'||!SAFE_UIA.has(e.code)||selected!=='uia'||signal.aborted){e.details={...e.details,attempts};throw e;}}
  }
  throw Object.assign(fail('NO_USABLE_UI_BACKEND','No selected UIA/visual path is usable; inspect flutter observe'),{details:{attempts},artifacts:attempts.flatMap(x=>x.error.artifacts||[])});
}
module.exports={runFlutter};
