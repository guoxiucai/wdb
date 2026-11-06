'use strict';
const https=require('node:https');
const tls=require('node:tls');
const net=require('node:net');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {normalizeDeviceId}=require('./device-id');
const sessions=new WeakMap();
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
async function ensureEnabled(device){const dir=sessions.get(device)?.configDir;if(!dir)return;let config;try{config=JSON.parse(await fs.readFile(path.join(dir,'devices.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}if(config.devices?.find(d=>d.url===device.url)?.connected===false)throw new CliError('CLIENT_DISCONNECTED','This device was explicitly disconnected; use connect to enable it again.');}
function openRequest(device,method,pathname,headers={},timeoutMs=30000){
 return new Promise((resolve,reject)=>{
  const expected=normalizeFingerprint(device.fingerprint);
  const req=https.request(new URL(pathname,device.url),{method,rejectUnauthorized:false,minVersion:'TLSv1.2',agent:false,headers:{...(device.token?{authorization:'Bearer '+device.token}:{}),...headers}});
  const connectTimer=setTimeout(()=>req.destroy(new CliError('TRANSPORT_TIMEOUT','Connection handshake timed out.')),timeoutMs);
  req.setTimeout(timeoutMs,()=>req.destroy(new CliError('TRANSPORT_TIMEOUT','Connection timed out; inspect task state before repeating an operation.')));
  req.once('close',()=>clearTimeout(connectTimer));req.on('error',reject);
  req.once('socket',socket=>socket.once('secureConnect',()=>{
   clearTimeout(connectTimer);const certificate=socket.getPeerCertificate(),actual=certificate.raw&&crypto.createHash('sha256').update(certificate.raw).digest('hex');
   if(actual!==expected){req.destroy(new CliError('CERTIFICATE_MISMATCH','Server certificate does not match the trusted fingerprint. No request was sent.'));return;}resolve(req);
  }));
 });
}
function receiveResponse(req){return new Promise((resolve,reject)=>{req.once('response',resolve);req.once('error',reject);});}
async function responseJson(response){
 const chunks=[];let size=0;for await(const chunk of response){size+=chunk.length;if(size>32*1024*1024){response.destroy();throw new CliError('RESPONSE_TOO_LARGE','JSON response exceeds 32 MB; use file artifacts.');}chunks.push(chunk);}
 let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new CliError('INVALID_RESPONSE',`Server returned invalid JSON (HTTP ${response.statusCode}).`);}
 if(response.statusCode>=400||result.error){const e=new CliError(result.error?.code||'HTTP_ERROR',result.error?.message||`HTTP ${response.statusCode}`);e.envelope=result;e.statusCode=response.statusCode;throw e;}return result;
}
async function apiOnce(device,method,endpoint,body,timeoutMs){
 let req,sent=false,timer;try{
  const data=body===undefined?null:Buffer.from(JSON.stringify(body));
  req=await openRequest(device,method,endpoint,data?{'content-type':'application/json','content-length':data.length}:{},timeoutMs);
  timer=setTimeout(()=>req.destroy(new CliError('TRANSPORT_TIMEOUT','Response deadline exceeded.')),timeoutMs);
  const response=receiveResponse(req);sent=true;req.end(data);const result=await responseJson(await response);
  if(device.deviceId&&normalizeDeviceId(result.deviceId)!==normalizeDeviceId(device.deviceId))throw new CliError('DEVICE_ID_MISMATCH','Server device ID differs from the paired device. Reconnect was stopped.');
  result.deviceId=normalizeDeviceId(result.deviceId);
  if(['/v1/pair','/v1/info','/v1/health'].includes(endpoint)&&result.data)result.data.deviceId=normalizeDeviceId(result.data.deviceId);
  if(endpoint.startsWith('/v1/tasks')&&result.data){
   if(result.data.deviceId)result.data.deviceId=normalizeDeviceId(result.data.deviceId);
   if(Array.isArray(result.data.tasks))for(const task of result.data.tasks)task.deviceId=normalizeDeviceId(task.deviceId);
  }
  if(['/v1/info','/v1/health'].includes(endpoint)&&result.data?.protocolVersion!==undefined&&result.data.protocolVersion!==1)throw new CliError('INCOMPATIBLE_PROTOCOL',`Server protocol ${result.data.protocolVersion} is incompatible with client protocol 1.`);
  return result;
 }catch(e){e.requestSent=sent;throw e;}finally{clearTimeout(timer);req?.destroy();}
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
 let session=sessions.get(device);if(!session){setSession(device);session=sessions.get(device);}session.deduplication=result.data?.taskSubmissionDeduplication===true;return result;
}
module.exports={CliError,normalizeFingerprint,discoverFingerprint,openRequest,receiveResponse,responseJson,api,setSession,ensureEnabled,discoverServer};
