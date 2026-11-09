'use strict';
const https=require('node:https');
const tls=require('node:tls');
const net=require('node:net');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const {normalizeDeviceId}=require('./device-id');
const sessions=new WeakMap();
const transportScope=new AsyncLocalStorage(),deviceAgents=new WeakMap(),trustedSockets=new WeakMap();
async function withTransport(action){
 const agents=new Map();
 return transportScope.run(agents,async()=>{try{return await action();}finally{for(const agent of agents.values())agent.destroy();}});
}
function agentFor(device,expected){
 // Pools are isolated by destination, certificate and credentials. A command owns
 // its pools, including devices reloaded from disk by watch; no background daemon.
 const key=JSON.stringify([new URL(device.url).origin,expected,crypto.createHash('sha256').update(device.token||'').digest('hex')]);
 const agents=transportScope.getStore();let entry=agents?agents.get(key):deviceAgents.get(device);
 if(entry?.wdbKey!==key)entry=null;
 if(!entry){
  entry=new https.Agent({keepAlive:true,maxSockets:8,maxFreeSockets:2,timeout:5000,maxCachedSessions:0});entry.wdbKey=key;
  if(agents)agents.set(key,entry);else deviceAgents.set(device,entry);
 }
 return entry;
}
const transient=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','EPIPE','EAI_AGAIN','ENOTFOUND','ECONNABORTED','TRANSPORT_TIMEOUT','ERR_STREAM_PREMATURE_CLOSE']);
class CliError extends Error {constructor(code,message,extra){super(message);this.code=code;this.extra=extra;}}
function normalizeFingerprint(value){const fingerprint=String(value||'').replace(/:/g,'').toLowerCase();if(!/^[a-f0-9]{64}$/.test(fingerprint))throw new CliError('FINGERPRINT_REQUIRED','Provide the 64-digit SHA-256 certificate fingerprint displayed by the server.');return fingerprint;}
// First contact uses TOFU. This socket sends no HTTP data or credentials; all
// subsequent requests, including pairing, must match the discovered certificate.
function discoverFingerprint(url,timeoutMs=10000){
 return new Promise((resolve,reject)=>{
  const target=new URL(url),host=target.hostname.replace(/^\[|\]$/g,'');
  const socket=tls.connect({host,port:Number(target.port||443),servername:net.isIP(host)?undefined:host,rejectUnauthorized:false,minVersion:'TLSv1.2'});
  const timer=setTimeout(()=>socket.destroy(new CliError('TRANSPORT_TIMEOUT','Server certificate discovery timed out.')),timeoutMs);
  socket.once('error',reject);
  socket.once('close',()=>{clearTimeout(timer);reject(new CliError('ECONNRESET','Connection closed before certificate discovery completed.'));});
  socket.once('secureConnect',()=>{
   const raw=socket.getPeerCertificate().raw;
   if(!raw){socket.destroy(new CliError('INVALID_CERTIFICATE','Server did not present a certificate.'));return;}
   resolve(crypto.createHash('sha256').update(raw).digest('hex'));socket.destroy();
  });
 });
}
function setSession(device,options={},io,configDir){
 const number=(key,fallback,min)=>{const value=options[key]===undefined?fallback:Number(options[key]);if(!Number.isFinite(value)||value<min)throw new CliError('INVALID_ARGUMENT',`--${key} must be >= ${min}.`);return value;};
 sessions.set(device,{reconnectMs:number('reconnect-timeout',60000,0),requestMs:number('request-timeout',10000,1),io,configDir});
}
async function ensureEnabled(device){const dir=sessions.get(device)?.configDir;if(!dir)return;let config;try{config=JSON.parse(await fs.readFile(path.join(dir,'devices.json'),'utf8'));}catch(e){if(e.code==='ENOENT')throw new CliError('CLIENT_DISCONNECTED','Device configuration was removed; connect again.');throw e;}const saved=config.devices?.find(d=>d.url===device.url);if(!saved||saved.connected===false)throw new CliError('CLIENT_DISCONNECTED','This device was explicitly disconnected; use connect to enable it again.');}
function openRequest(device,method,pathname,headers={},timeoutMs=30000,signal){
 return new Promise((resolve,reject)=>{
  const expected=normalizeFingerprint(device.fingerprint);
  const req=https.request(new URL(pathname,device.url),{method,rejectUnauthorized:false,minVersion:'TLSv1.2',agent:agentFor(device,expected),signal,headers:{...(device.token?{authorization:'Bearer '+device.token}:{}),...headers}});
  const connectTimer=setTimeout(()=>req.destroy(new CliError('TRANSPORT_TIMEOUT','Connection handshake timed out.')),timeoutMs);
  req.setTimeout(timeoutMs,()=>req.destroy(new CliError('TRANSPORT_TIMEOUT','Connection timed out; inspect task state before repeating an operation.')));
  req.once('close',()=>{clearTimeout(connectTimer);reject(new CliError('ECONNRESET','Connection closed before the request completed.'));});req.on('error',reject);
  req.once('socket',socket=>{
   const verify=()=>{
    clearTimeout(connectTimer);
    const actual=trustedSockets.get(socket)||(()=>{const raw=socket.getPeerCertificate().raw;return raw&&crypto.createHash('sha256').update(raw).digest('hex');})();
    if(actual!==expected){req.destroy(new CliError('CERTIFICATE_MISMATCH','Server certificate does not match the trusted fingerprint. No request was sent.'));return;}
    trustedSockets.set(socket,actual);resolve(req);
   };
   if(trustedSockets.has(socket))verify();else socket.once('secureConnect',verify);
  });
 });
}
function receiveResponse(req){return new Promise((resolve,reject)=>{req.once('response',resolve);req.once('error',reject);});}
async function responseJson(response){
 const chunks=[];let size=0;for await(const chunk of response){size+=chunk.length;if(size>32*1024*1024){response.destroy();throw new CliError('RESPONSE_TOO_LARGE','JSON response exceeds 32 MB; use file artifacts.');}chunks.push(chunk);}
 let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new CliError('INVALID_RESPONSE',`Server returned invalid JSON (HTTP ${response.statusCode}).`);}
 if(response.statusCode>=400||result.error){const e=new CliError(result.error?.code||'HTTP_ERROR',result.error?.message||`HTTP ${response.statusCode}`);e.envelope=result;e.statusCode=response.statusCode;throw e;}return result;
}
async function apiOnce(device,method,endpoint,body,timeoutMs){
 let req,response,sent=false,timer;try{
  const data=body===undefined?null:Buffer.from(JSON.stringify(body));
  req=await openRequest(device,method,endpoint,data?{'content-type':'application/json','content-length':data.length}:{},timeoutMs);
  timer=setTimeout(()=>req.destroy(new CliError('TRANSPORT_TIMEOUT','Response deadline exceeded.')),timeoutMs);
  const pending=receiveResponse(req);sent=true;req.end(data);response=await pending;const result=await responseJson(response);
  if(device.deviceId&&normalizeDeviceId(result.deviceId)!==normalizeDeviceId(device.deviceId))throw new CliError('DEVICE_ID_MISMATCH','Server device ID differs from the paired device. Reconnect was stopped.');
  result.deviceId=normalizeDeviceId(result.deviceId);
  if(['/v1/pair','/v1/info','/v1/health'].includes(endpoint)&&result.data)result.data.deviceId=normalizeDeviceId(result.data.deviceId);
  if(endpoint.startsWith('/v1/tasks')&&result.data){
   if(result.data.deviceId)result.data.deviceId=normalizeDeviceId(result.data.deviceId);
   if(Array.isArray(result.data.tasks))for(const task of result.data.tasks)task.deviceId=normalizeDeviceId(task.deviceId);
  }
  if(['/v1/info','/v1/health'].includes(endpoint)&&result.data?.protocolVersion!==undefined&&result.data.protocolVersion!==1)throw new CliError('INCOMPATIBLE_PROTOCOL',`Server protocol ${result.data.protocolVersion} is incompatible with client protocol 1.`);
  return result;
 }catch(e){e.requestSent=sent;throw e;}finally{clearTimeout(timer);if(!response?.complete)req?.destroy();}
}
async function api(device,method,endpoint,body,timeoutMs,policy={}){
 const session=sessions.get(device)||{},budget=policy.reconnectMs??session.reconnectMs??60000,started=Date.now();let attempts=0,lastError;
 const requestMs=timeoutMs??session.requestMs??10000;
 while(true){
  if(attempts){await ensureEnabled(device);if(Date.now()-started>=budget)break;}
  const remaining=budget>0?Math.max(1,Math.min(requestMs,Math.floor((budget-(Date.now()-started))/2))):requestMs;
  try{
   // A deployment rollback must not silently remove deduplication during recovery.
   if(attempts&&method==='POST'&&endpoint==='/v1/tasks'&&body?.submissionId&&session.deduplication){const health=await apiOnce(device,'GET','/v1/health',undefined,remaining);if(!health.data?.taskSubmissionDeduplication)throw new CliError('REQUEST_OUTCOME_UNKNOWN','Server no longer supports submission recovery; inspect the original task.',{submissionId:body.submissionId});}
   const result=await apiOnce(device,method,endpoint,body,remaining);
   if(attempts)session.io?.stderr.write(`Connection restored: ${device.url} (${device.deviceId||'pairing'}), ${attempts} retries.\n`);
   return result;
  }catch(e){
   if(!transient.has(e.code))throw e;
   const safe=!e.requestSent||method==='GET'||endpoint==='/v1/heartbeat'||(method==='POST'&&endpoint==='/v1/tasks'&&body?.submissionId&&session.deduplication);
   if(!safe)throw new CliError('REQUEST_OUTCOME_UNKNOWN','Connection lost after sending the request; it was not replayed. Observe server state before retrying.',{cause:e.code,submissionId:body?.submissionId});
   if(budget===0)throw e;lastError=e;attempts++;
   if(attempts===1)session.io?.stderr.write(`Connection lost: ${device.url} (${e.code}); reconnecting for up to ${budget} ms.\n`);
   const delay=Math.min(250*2**Math.min(attempts-1,4),3000,budget-(Date.now()-started));if(delay>0)await new Promise(r=>setTimeout(r,delay));
  }
 }
 throw new CliError('RECONNECT_TIMEOUT',`Could not reconnect to ${device.url} within ${budget} ms.`,{cause:lastError?.code,attempts,submissionId:body?.submissionId,taskId:endpoint.match(/^\/v1\/tasks\/([^/]+)/)?.[1]});
}
async function discoverServer(device,policy={}){
 let result;try{result=await api(device,'GET','/v1/health',undefined,policy.timeoutMs,policy);}catch(e){if(e.statusCode!==404)throw e;result=await api(device,'GET','/v1/info',undefined,policy.timeoutMs,policy);}
 let session=sessions.get(device);if(!session){setSession(device);session=sessions.get(device);}session.deduplication=result.data?.taskSubmissionDeduplication===true;session.taskEvents=result.data?.taskEvents===true;return result;
}
async function supportsTaskEvents(device,policy={}){
 if(sessions.get(device)?.taskEvents===undefined)await discoverServer(device,policy);
 return sessions.get(device)?.taskEvents===true;
}
async function consumeTaskEvents(device,id,{stdoutOffset,timeoutMs=10000,signal,onEvent,onTick}){
 const params=new URLSearchParams();if(stdoutOffset!==undefined)params.set('stdoutOffset',String(stdoutOffset));
 let req;
 try{
  req=await openRequest(device,'GET',`/v1/tasks/${encodeURIComponent(id)}/events${params.size?'?'+params:''}`,{accept:'text/event-stream'},timeoutMs,signal);
  const pending=receiveResponse(req);req.end();const response=await pending;
  if(response.statusCode>=400){await responseJson(response);throw new CliError('INVALID_RESPONSE','Event subscription failed.');}
  if(response.statusCode!==200||!/^text\/event-stream(?:;|$)/i.test(response.headers['content-type']||''))throw new CliError('INVALID_RESPONSE','Expected a task event stream.');
  req.setTimeout(Math.max(timeoutMs,5000));response.setEncoding('utf8');
  let pendingLine='',event='',data=[],size=0;
  for await(const chunk of response){
   await onTick?.();pendingLine+=chunk;
   if(Buffer.byteLength(pendingLine)+size>32*1024*1024)throw new CliError('RESPONSE_TOO_LARGE','Task event exceeds 32 MB.');
   let end;
   while((end=pendingLine.indexOf('\n'))!==-1){
    const line=pendingLine.slice(0,end).replace(/\r$/,'');pendingLine=pendingLine.slice(end+1);
    if(line===''){
     if(data.length){
      let value;try{value=JSON.parse(data.join('\n'));}catch{throw new CliError('INVALID_RESPONSE','Server returned an invalid task event.');}
      if(normalizeDeviceId(value.deviceId)!==normalizeDeviceId(device.deviceId))throw new CliError('DEVICE_ID_MISMATCH','Task event device ID differs from the paired device.');
      if(event==='error')throw Object.assign(new CliError(value.error?.code||'EVENT_STREAM_FAILED',value.error?.message||'Task event stream failed.'),{envelope:value});
      if(event==='task'){
       const task=value.data?.task||value.data;
       if((task?.id||task?.taskId)!==id||typeof task.status!=='string')throw new CliError('INVALID_RESPONSE','Task event identity or status is invalid.');
       value.deviceId=normalizeDeviceId(value.deviceId);if(task.deviceId)task.deviceId=normalizeDeviceId(task.deviceId);
      }
      if(event==='output'&&value.taskId!==id)throw new CliError('INVALID_RESPONSE','Output belongs to a different task.');
      if(await onEvent(event,value))return value;
     }
     event='';data=[];size=0;
    }else if(line.startsWith('event:'))event=line.slice(6).replace(/^ /,'');
    else if(line.startsWith('data:')){const value=line.slice(5).replace(/^ /,'');data.push(value);size+=Buffer.byteLength(value)+1;}
   }
  }
  throw new CliError('ECONNRESET','Task event stream ended before task completion.');
 }catch(error){if(signal?.aborted)throw signal.reason;throw error;}
 finally{req?.destroy();}
}
module.exports={CliError,normalizeFingerprint,discoverFingerprint,openRequest,receiveResponse,responseJson,api,setSession,ensureEnabled,discoverServer,withTransport,supportsTaskEvents,consumeTaskEvents,isTransient:error=>transient.has(error.code)};
