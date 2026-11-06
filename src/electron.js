'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {setTimeout:delay}=require('node:timers/promises');
const {fail}=require('./common');
const {runCdp}=require('./electron-cdp');
const {targets,endpointUrl}=require('./cdp');
const SAFE_CDP=new Set(['CDP_UNAVAILABLE','CDP_TARGET_NOT_FOUND','CONTROL_NOT_FOUND']);
const SAFE_UIA=new Set(['CONTROL_NOT_FOUND','STALE_CONTROL','PATTERN_UNAVAILABLE']);
const errorInfo=e=>({code:e.code||'ELECTRON_ERROR',message:e.message,details:e.details,artifacts:e.artifacts||[]});
function winArg(value){return '"'+String(value).replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';}
async function checkPort(port){const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',()=>reject(fail('CDP_PORT_IN_USE','Choose an unused CDP port')));probe.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));}
async function executeElectron(operation,args,ctx,{native,cdp=runCdp}={}){
  const status=await native('desktop.status',{},ctx);if(!status.available)throw fail('DESKTOP_UNAVAILABLE','Electron debugging requires the logged-in unlocked desktop');
  if(operation==='launch'){
    if(typeof args.path!=='string'||!path.isAbsolute(args.path)||!fs.existsSync(args.path))throw fail('INVALID_ARGUMENT','launch requires an existing absolute application path');
    const port=Number(args.port||9222);if(!Number.isInteger(port)||port<1024||port>65535)throw fail('INVALID_ARGUMENT','CDP port must be 1024..65535');
    if(args.arguments!==undefined&&(!Array.isArray(args.arguments)||args.arguments.some(a=>typeof a!=='string'||/^--(?:remote-debugging|disable-renderer-accessibility)/i.test(a))))throw fail('INVALID_ARGUMENT','arguments must be strings without conflicting debugging/accessibility switches');
    await checkPort(port);const endpoint='http://127.0.0.1:'+port;
    const launched=await native('app.launch',{path:args.path,cwd:args.cwd,arguments:[...(args.arguments||[]),'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--force-renderer-accessibility'].map(winArg).join(' ')},ctx);
    const start=Date.now();let error;while(Date.now()-start<Math.min(15000,ctx.timeoutMs||15000)){
      try{const pages=await targets(endpoint,ctx.signal,1000);if(pages.length)return {...launched,endpoint,cdpAvailable:true,targets:pages.map(({webSocketDebuggerUrl,...t})=>t)};}catch(e){error=errorInfo(e);if(e.code==='CANCELLED')throw e;}
      await delay(200,null,{signal:ctx.signal});
    }
    return {...launched,endpoint,cdpAvailable:false,error:error||{code:'CDP_TARGET_NOT_FOUND',message:'No page was published; inspect existing single-instance processes and application debugging settings'},needsObservation:true};
  }
  const screenshot=async()=>{const file=path.join(ctx.dir,'electron-desktop.png');const data=await native('screenshot',{...(args.window?{window:args.window}:{}),...(args.region?{region:args.region}:{}),path:file},ctx);return {...data,backend:'visual',artifacts:[{path:file,type:'image/png',size:fs.statSync(file).size}]};};
  if(operation==='observe'){
    const observed={};
    for(const backend of ['cdp','uia','visual']){
      try{const data=backend==='cdp'?await cdp('tree',args,{...ctx,timeoutMs:Math.min(ctx.timeoutMs||120000,8000)}):backend==='uia'?(args.window?await native('ui.tree',{window:args.window,limit:args.limit||150,depth:args.depth||12},{...ctx,timeoutMs:Math.min(ctx.timeoutMs||120000,8000)}):{unavailable:true,reason:'Supply window for UIA observation'}):await screenshot();observed[backend]={ok:!data.unavailable,data};}
      catch(e){if(ctx.signal?.aborted)throw e;observed[backend]={ok:false,error:errorInfo(e)};}
    }
    return {backend:'combined',observed,artifacts:Object.values(observed).flatMap(r=>r.data?.artifacts||r.error?.artifacts||[])};
  }
  if(operation==='screenshot'&&args.backend==='visual')return screenshot();
  if(operation!=='action')return cdp(operation,args,ctx);
  const backend=args.backend||'auto';if(!['auto','cdp','uia','visual'].includes(backend))throw fail('INVALID_ARGUMENT','backend must be auto, cdp, uia or visual');
  const attempts=[];const candidates=backend==='auto'?['cdp',...(args.reference||args.window?['uia']:[]),...(args.visual?['visual']:[])]:[backend];
  for(const current of candidates){
    try{
      let data;
      if(current==='cdp')data=await cdp('action',args,ctx);
      else if(current==='uia'){
        let reference=args.reference;
        if(!reference){if(!args.window)throw fail('INVALID_ARGUMENT','UIA requires window or reference');const found=await native('ui.find',{window:args.window,...(args.name!==undefined?{name:args.name}:{}),...(args.automationId?{automationId:args.automationId}:{}),...(args.controlType?{controlType:args.controlType}:{})},ctx);if(!found.count)throw fail('CONTROL_NOT_FOUND','No matching UIA control');if(found.count!==1)throw fail('AMBIGUOUS_CONTROL','Multiple UIA controls; refine query');reference=found.controls[0].reference;}
        const action=({click:'invoke',fill:'value'})[args.action]||args.action||'invoke';
        try{data=await native('ui.action',{reference,method:'uia',action,value:args.text??args.value},ctx);}catch(e){if(SAFE_UIA.has(e.code))throw e;throw Object.assign(fail('ACTION_OUTCOME_UNKNOWN','UIA action may have executed; observe before retrying. '+e.message),{details:{cause:e.code},artifacts:e.artifacts});}
        data={...data,backend:'uia',needsObservation:true};
      }else{
        const point=args.visual||args;if(!args.window||!point.layoutId||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw fail('INVALID_ARGUMENT','Visual action needs window, observed x/y and layoutId');
        if(args.action&&args.action!=='click')throw fail('INVALID_ARGUMENT','Visual action supports click; use wdb key/text/touch for other physical input');
        await native('windows.action',{window:args.window,action:'focus',layoutId:point.layoutId},ctx);
        const hit=await native('windows.hitTest',{x:point.x,y:point.y,layoutId:point.layoutId},ctx);if(hit.root.window!==args.window)throw fail('VISUAL_TARGET_MISMATCH','Point belongs to another window; observe again');
        try{data=await native('input.mouse',{action:'click',x:point.x,y:point.y,layoutId:point.layoutId},ctx);}catch(e){throw Object.assign(fail('ACTION_OUTCOME_UNKNOWN','Visual input may have executed; observe before retrying. '+e.message),{artifacts:e.artifacts,details:{cause:e.code}});}
        data={...data,backend:'visual',coordinateSpace:'virtual-desktop-physical',needsObservation:true};
      }
      return {...data,attempts:[...attempts,{backend:current,status:'executed'}],artifacts:[...attempts.flatMap(a=>a.error?.artifacts||[]),...(data.artifacts||[])]};
    }catch(e){
      attempts.push({backend:current,status:'failed',error:errorInfo(e)});
      const safe=current==='cdp'?SAFE_CDP.has(e.code):current==='uia'?SAFE_UIA.has(e.code):false;
      if(backend!=='auto'||!safe||ctx.signal?.aborted){e.details={...e.details,attempts};throw e;}
    }
  }
  throw Object.assign(fail('NO_USABLE_UI_BACKEND','No requested backend located a usable control; inspect electron observe'),{details:{attempts},artifacts:attempts.flatMap(a=>a.error?.artifacts||[])});
}
async function runElectron(operation,args,ctx,deps={}){
  const timeout=Number(ctx.timeoutMs||120000),deadline=Date.now()+timeout;
  const signal=AbortSignal.any([AbortSignal.timeout(timeout),...(ctx.signal?[ctx.signal]:[])]);
  const limited={...ctx,signal};Object.defineProperty(limited,'timeoutMs',{enumerable:true,get:()=>Math.max(1,deadline-Date.now())});
  const bounded=fn=>async(op,values,child)=>{if(signal.aborted)throw fail(ctx.signal?.aborted?'CANCELLED':'TIMEOUT','Electron task ended before dispatch');return fn(op,values,{...child,signal,timeoutMs:Math.min(child.timeoutMs||timeout,Math.max(1,deadline-Date.now()))});};
  try{return await executeElectron(operation,args,limited,{native:bounded(deps.native),cdp:bounded(deps.cdp||runCdp)});}
  catch(e){if(signal.aborted&&e.code!=='ACTION_OUTCOME_UNKNOWN')e.code=ctx.signal?.aborted?'CANCELLED':'TIMEOUT';throw e;}
}
module.exports={runElectron,winArg};
