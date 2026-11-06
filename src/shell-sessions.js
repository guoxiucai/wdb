'use strict';
const {openPty}=require('./pty-host');const {openStream,maintainLease}=require('./client-stream');
const {LIMITS,HELPER_PROTOCOL,error,check}=require('./stream-protocol');
function shellOpen(m){return {kind:'shell',program:m.program,admin:m.admin,env:m.env,terminal:m.terminal,...(m.cwd===undefined?{}:{cwd:m.cwd})};}
async function shellResource(ctx,m,backend){
 let active=false,closed=false,closing,exitSeen=false,stopLease,pending=[],pendingBytes=0,outSent=0,outConsumed=0,inReceived=0,inConsumed=0;
 const external=ctx.channel;
 const close=()=>{if(closing)return closing;closed=true;closing=(async()=>{stopLease?.();pending=[];pendingBytes=0;if(backend.dispose)await backend.dispose();else{try{if(!backend.closed)await backend.request('close',{reason:'client_close'},'closed');}catch{}backend.close();}})();return closing;};
 const safely=fn=>x=>{try{fn(x);}catch(e){external.fail(e);}};
 backend.on('data',safely(b=>{check(outSent+b.length-outConsumed<=LIMITS.windowBytes,'Backend exceeded output window','FLOW_CONTROL_ERROR');outSent+=b.length;if(!active){pendingBytes+=b.length;check(pendingBytes<=LIMITS.windowBytes,'Pre-ready terminal output overflow','RESOURCE_LIMIT');pending.push(b);}else external.binary(b);}));
 backend.on('control',safely(msg=>{
  if(msg.type==='credit'){check(msg.consumed>=inConsumed&&msg.consumed<=inReceived,'Backend input credit invalid','FLOW_CONTROL_ERROR');inConsumed=msg.consumed;if(active)external.control(msg);}
  else if(msg.type==='exit'){check(active&&msg.sessionId===backend.opened.sessionId,'Unexpected shell exit','INVALID_STATE');check(outConsumed===outSent,'Backend exited before output drain','OUTPUT_DRAIN_TIMEOUT');exitSeen=true;external.control(msg);external.close();}
 }));
 backend.on('failure',e=>{if(!closed)external.fail(e);});backend.on('closed',()=>{if(!closed&&!exitSeen)external.fail(error('STREAM_INTERRUPTED','Shell backend closed; session was not resumed'));});
 external.on('data',safely(b=>{check(active&&!closed,'Shell data before ACTIVE','INVALID_STATE');check(inReceived+b.length-inConsumed<=LIMITS.windowBytes,'Shell input window exceeded','FLOW_CONTROL_ERROR');inReceived+=b.length;backend.binary(b);}));
 external.on('control',safely(msg=>{if(msg.type==='credit'){check(active&&msg.consumed>=outConsumed&&msg.consumed<=outSent,'Terminal output credit invalid','FLOW_CONTROL_ERROR');outConsumed=msg.consumed;backend.control(msg);}}));
 ctx.signal.addEventListener('abort',()=>{close().catch(()=>{});},{once:true});
 return {opened:{sessionId:backend.opened.sessionId,program:m.program,backend:'conpty',execution:backend.opened.execution},start:async()=>{const info=await backend.ready();return {sessionId:backend.opened.sessionId,pid:info.pid,execution:info.execution};},activate:()=>{active=true;for(const b of pending)external.binary(b);pending=[];pendingBytes=0;},resize:async msg=>{const r=await backend.request('resize',{cols:msg.cols,rows:msg.rows});return {cols:r.cols,rows:r.rows};},close,audit:()=>({sessionId:backend.opened.sessionId,execution:backend.opened.execution,program:m.program,sentBytes:outSent,receivedBytes:inReceived})};
}
function shellFactory({helper=false,helperPort,helperSecret,deviceId,desktopUser}={}){return async(ctx,m)=>{
 let backend;
 try{
  if(helper){check(!m.admin,'Helper cannot create admin sessions','UNAUTHORIZED');backend=await openPty(shellOpen(m),{signal:ctx.signal});check(!backend.opened.execution.isElevated&&backend.opened.execution.windowsSessionId>0,'Helper must be the non-elevated interactive user','HELPER_UNAVAILABLE');}
  else if(m.admin){backend=await openPty(shellOpen(m),{signal:ctx.signal});check(backend.opened.execution.isElevated,'SYSTEM shell backend is unavailable','PTY_UNAVAILABLE');}
  else{const device={url:`http://127.0.0.1:${helperPort}`,token:helperSecret,deviceId};try{backend=await openStream(device,shellOpen(m),{signal:ctx.signal,internal:true,protocol:HELPER_PROTOCOL,endpoint:'/stream/shell'});}catch(e){throw error(e.code==='SHELL_NOT_FOUND'?e.code:'HELPER_UNAVAILABLE',e.code==='SHELL_NOT_FOUND'?e.message:'Interactive user helper is unavailable; no SYSTEM fallback.');}check(!backend.opened.execution.isElevated&&backend.opened.execution.windowsSessionId>0&&(!desktopUser||backend.opened.execution.identity.toLowerCase()===desktopUser.toLowerCase()),'Helper user differs from configured desktop account','HELPER_UNAVAILABLE');const stop=maintainLease(backend,device);backend.once('closed',stop);}
  if(ctx.signal.aborted){await backend.dispose?.();backend.close();throw error('STREAM_INTERRUPTED','Shell creation cancelled');}
  return await shellResource(ctx,m,backend);
 }catch(e){if(backend){if(backend.dispose)await backend.dispose();else backend.close();}throw e;}
};}
async function helperShellStatus(port,secret){return new Promise(resolve=>{const req=require('node:http').get({host:'127.0.0.1',port,path:'/stream/status',headers:{authorization:'Bearer '+secret}},res=>{let text='';res.on('data',b=>{text+=b;if(text.length>16384)req.destroy();});res.on('end',()=>{try{if(res.statusCode!==200)throw Error();resolve(JSON.parse(text));}catch{resolve({available:false,reason:'HELPER_UNAVAILABLE',programs:[]});}});});req.setTimeout(3000,()=>req.destroy());req.on('error',()=>resolve({available:false,reason:'HELPER_UNAVAILABLE',programs:[]}));});}
module.exports={shellFactory,shellResource,shellOpen,helperShellStatus};
