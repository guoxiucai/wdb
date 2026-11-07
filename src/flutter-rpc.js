'use strict';
const WebSocket=require('ws');
const {fail}=require('./common');
const MAX_BYTES=16*1024*1024;

// VM Service authentication lives in the URI path. Keep it for transport only.
function serviceUrl(value){
  let u;try{u=new URL(value);}catch{throw fail('INVALID_FLUTTER_ENDPOINT','Supply the server-local Dart VM Service URI');}
  if(!['http:','ws:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)
    throw fail('INVALID_FLUTTER_ENDPOINT','VM Service must use a loopback HTTP/WS URI without query, fragment or user info');
  if(u.hostname==='localhost')u.hostname='127.0.0.1';
  u.protocol='ws:';if(!u.pathname.endsWith('/ws'))u.pathname=u.pathname.replace(/\/$/,'')+'/ws';
  return u;
}
class VmConnection{
  constructor(uri,{signal,timeoutMs=5000,trace=()=>{}}={}){
    this.signal=signal;this.timeoutMs=timeoutMs;this.trace=trace;this.pending=new Map();this.listeners=new Set();this.serial=0;
    this.ws=new WebSocket(serviceUrl(uri));this.ws.binaryType='arraybuffer';
    this.ready=new Promise((resolve,reject)=>{this.rejectReady=reject;this.openTimer=setTimeout(()=>this.close(fail('FLUTTER_UNAVAILABLE','VM Service handshake timed out')),timeoutMs);this.ws.addEventListener('open',()=>{clearTimeout(this.openTimer);resolve(this);});});
    this.abort=()=>this.close(fail('CANCELLED','Flutter request cancelled'));
    this.ws.addEventListener('error',()=>this.close(fail('FLUTTER_DISCONNECTED','VM Service socket failed; verify its URI and authentication path')));
    this.ws.addEventListener('close',()=>this.close(fail('FLUTTER_DISCONNECTED','VM Service socket closed')));
    this.ws.addEventListener('message',event=>{
      try{
        const raw=typeof event.data==='string'?event.data:Buffer.from(event.data).toString();
        if(Buffer.byteLength(raw)>MAX_BYTES)throw fail('FLUTTER_RESPONSE_TOO_LARGE','VM response exceeds 16 MiB');
        const m=JSON.parse(raw);if(m.jsonrpc!=='2.0')throw fail('INVALID_FLUTTER_RESPONSE','Expected JSON-RPC 2.0');
        if(m.id!==undefined){const p=this.pending.get(String(m.id));if(!p)return;this.pending.delete(String(m.id));clearTimeout(p.timer);this.trace({method:p.method,status:m.error?'error':'received',durationMs:Date.now()-p.at});
          // Remote error text may echo URI credentials or evaluated expressions.
          if(m.error)p.reject(Object.assign(fail('FLUTTER_PROTOCOL_ERROR',p.method+' failed (RPC '+m.error.code+')'),{details:{rpcCode:m.error.code}}));
          else if(m.result?.type==='Sentinel')p.reject(fail('STALE_FLUTTER_OBJECT','VM object or isolate is no longer available'));
          else p.resolve(m.result);
        }else for(const fn of this.listeners)fn(m);
      }catch(e){this.close(e.code?e:fail('INVALID_FLUTTER_RESPONSE','Invalid VM Service message'));}
    });
    signal?.addEventListener('abort',this.abort,{once:true});if(signal?.aborted)this.abort();
  }
  async send(method,params={},timeoutMs=this.timeoutMs){
    await this.ready;if(this.closed)throw this.closed;if(this.signal?.aborted)throw fail('CANCELLED','Flutter request cancelled');
    const id=String(++this.serial);return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.trace({method,status:'timeout'});reject(fail('FLUTTER_TIMEOUT',method+' timed out'));},timeoutMs);
      this.pending.set(id,{resolve,reject,timer,method,at:Date.now()});this.trace({method,status:'sent'});
      try{this.ws.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));}catch{clearTimeout(timer);this.pending.delete(id);reject(fail('FLUTTER_DISCONNECTED','VM Service send failed'));}
    });
  }
  onEvent(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
  close(error=fail('FLUTTER_DISCONNECTED','VM Service connection ended')){
    if(this.closed)return;this.closed=error;clearTimeout(this.openTimer);this.rejectReady(error);this.signal?.removeEventListener('abort',this.abort);
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.listeners.clear();try{this.ws.close();}catch{}
  }
}
module.exports={serviceUrl,VmConnection};
