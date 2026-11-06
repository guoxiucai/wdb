'use strict';
const https=require('node:https'),crypto=require('node:crypto');
const WebSocket=require('ws');
const {Channel}=require('./stream-channel');
const {PROTOCOL,HELPER_PROTOCOL,LIMITS,error,check}=require('./stream-protocol');
const {normalizeFingerprint,ensureEnabled,api}=require('./client-transport');
async function dial(device,{timeoutMs=10000,signal,internal=false,protocol=PROTOCOL,endpoint='/v1/stream',instanceId}={}){
 await ensureEnabled(device);check(!signal?.aborted,'Stream cancelled','STREAM_INTERRUPTED');
 const url=new URL(endpoint,device.url);url.protocol=internal?'ws:':'wss:';
 const expected=internal?null:normalizeFingerprint(device.fingerprint);
 const agent=internal?undefined:new https.Agent({keepAlive:false,maxCachedSessions:0});let pinError;
 const ws=new WebSocket(url,protocol,{agent,headers:{authorization:'Bearer '+device.token},perMessageDeflate:false,maxPayload:LIMITS.binaryMessageBytes,followRedirects:false,rejectUnauthorized:false,minVersion:'TLSv1.2',handshakeTimeout:timeoutMs,
  finishRequest(req){if(internal){req.end();return;}req.once('socket',socket=>{socket.once('secureConnect',()=>{const raw=socket.getPeerCertificate().raw;const actual=raw&&crypto.createHash('sha256').update(raw).digest('hex');if(actual!==expected){pinError=error('CERTIFICATE_MISMATCH','Server certificate differs; no Upgrade request or credentials were sent.');req.destroy(pinError);return;}req.end();});});}
 });
 const channel=new Channel(ws,'client',{timeoutMs,signal});channel.once('closed',()=>agent?.destroy());
 ws.on('unexpected-response',(req,res)=>{const chunks=[];let bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes<=16384)chunks.push(b);else res.destroy();});res.once('end',()=>{let e;try{const body=JSON.parse(Buffer.concat(chunks));e=body.error;}catch{}channel.fail(error(e?.code||'INCOMPATIBLE_STREAM_PROTOCOL',e?.message||`Upgrade rejected (HTTP ${res.statusCode})`));});res.once('error',()=>channel.fail(error('STREAM_INTERRUPTED','Invalid Upgrade response')));});
 try{
  const hello=await channel.waitFor('hello');check(ws.protocol===protocol,'WebSocket subprotocol differs','INCOMPATIBLE_STREAM_PROTOCOL');check(hello.deviceId===device.deviceId,'Device identity differs; no stream was opened','DEVICE_ID_MISMATCH');if(instanceId)check(hello.serverInstanceId===instanceId,'Server restarted; existing streams are not resumed','STREAM_INTERRUPTED');channel.hello=hello;return channel;
 }catch(e){channel.fail(pinError||e);throw pinError||e;}
}
async function openStream(device,open,options={}){
 const channel=await dial(device,options);
 try{channel.opened=await channel.request('open',open,'opened');check(channel.opened.kind===open.kind,'Opened kind differs','INVALID_STATE');channel.kind=open.kind;channel.ready=async(extra={})=>{channel.active=true;const ack=await channel.request('ready',extra);channel.readyInfo=ack;return ack;};return channel;}catch(e){channel.fail(e);throw e;}
}
async function capability(device,name,timeoutMs=10000){await ensureEnabled(device);const result=await api(device,'GET','/v1/health',undefined,timeoutMs,{reconnectMs:0});check(result.data?.streaming?.version===1&&result.data.streaming[name]===true,'Server does not support this stream capability','FEATURE_UNAVAILABLE');}
function maintainLease(channel,device,{signal}={}){
 let busy=false;const tick=async()=>{if(busy||channel.closed)return;busy=true;try{await ensureEnabled(device);await channel.request('lease');}catch(e){channel.fail(e);}finally{busy=false;}};
 const interval=setInterval(tick,LIMITS.leaseIntervalMs);channel.once('closed',()=>clearInterval(interval));const local=setInterval(()=>ensureEnabled(device).catch(e=>channel.fail(e)),1000);channel.once('closed',()=>clearInterval(local));return ()=>{clearInterval(interval);clearInterval(local);};
}
function streamOptions(options){for(const k of ['poll-ms','wait-timeout','reconnect-timeout'])check(options[k]===undefined,`--${k} is a task/recovery option; streams never resume or replay`);const timeoutMs=options['request-timeout']===undefined?10000:Number(options['request-timeout']);check(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=300000,'Invalid --request-timeout');return {timeoutMs};}
module.exports={dial,openStream,capability,maintainLease,streamOptions};
