'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {fail}=require('./common');
const {runOperation}=require('./operations');
const APPROVAL_TIMEOUT_MS=120000;
const TEMPORARY_IDLE_MS=30*60*1000;
function clientName(value){return String(value||'wdb client').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,120);}
async function requestApproval(bridge,req,res,name,requestId){
 if(bridge.pendingPairing)throw fail('PAIRING_BUSY','Another client is waiting for approval on the server. Try again after it finishes.',409);
 const controller=new AbortController(),dir=path.join(bridge.dir,'tasks','.pair-'+crypto.randomUUID());
 const timeoutMs=bridge.options.approvalTimeoutMs||APPROVAL_TIMEOUT_MS;
 const input={name,remoteAddress:req.socket.remoteAddress,requestId,timeoutMs};
 fs.mkdirSync(dir);bridge.pendingPairing={controller,dir};
 const cancel=()=>{if(!res.writableEnded){controller.abort();try{fs.writeFileSync(path.join(dir,'cancel'),'CLIENT_DISCONNECTED');}catch{}}};
 res.once('close',cancel);
 let expired=false;
 const deadline=setTimeout(()=>{expired=true;controller.abort();try{fs.writeFileSync(path.join(dir,'cancel'),'APPROVAL_TIMEOUT');}catch{}},timeoutMs);
 try{
  // Function injection is for in-process unit fixtures only. No HTTP/config flag
  // can replace the interactive approval provider of the installed service.
  const provider=bridge.options.approvePairing
   ? bridge.options.approvePairing(input,controller.signal)
   : runOperation('connection.approve',input,{id:requestId,dir,timeoutMs:timeoutMs+1500,signal:controller.signal},{helperSecret:bridge.helperSecret,helperPort:bridge.config.helperPort});
  const aborted=new Promise((_,reject)=>{const stop=()=>reject(fail('PAIRING_CANCELLED','Approval was cancelled.',409));if(controller.signal.aborted)stop();else controller.signal.addEventListener('abort',stop,{once:true});});
  const decision=await Promise.race([provider,aborted]);
  if(expired||decision?.decision==='timed_out')throw fail('PAIRING_TIMEOUT','No approval was received before the server dialog expired.',408);
  if(controller.signal.aborted||res.destroyed)throw fail('PAIRING_CANCELLED','The client disconnected while waiting for approval.',409);
  if(decision?.decision!=='approved')throw fail(decision?.decision==='desktop_unavailable'?'PAIRING_DESKTOP_UNAVAILABLE':'PAIRING_REJECTED','The server did not approve this connection.',403);
  return {remember:decision.remember===true};
 }catch(e){
  if(expired)throw fail('PAIRING_TIMEOUT','No approval was received before the server dialog expired.',408);
  if(['DESKTOP_UNAVAILABLE','DESKTOP_HELPER_UNAVAILABLE'].includes(e.code))throw fail('PAIRING_DESKTOP_UNAVAILABLE','Log in and unlock the server desktop to approve a new client.',503);
  throw e;
 }finally{
  clearTimeout(deadline);res.removeListener('close',cancel);bridge.pendingPairing=null;
  // A cancelled helper may still be reading its cancel marker. Preserve that
  // marker briefly; unique directories never contain client credentials.
  const cleanup=()=>fs.rmSync(dir,{recursive:true,force:true});
  if(controller.signal.aborted){const timer=setTimeout(cleanup,6000);timer.unref();}else cleanup();
 }
}
module.exports={APPROVAL_TIMEOUT_MS,TEMPORARY_IDLE_MS,clientName,requestApproval};
