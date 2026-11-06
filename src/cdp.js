'use strict';
const {fail}=require('./common');
const MAX_JSON=16*1024*1024;

function endpointUrl(value='http://127.0.0.1:9222') {
  let url;try {url=new URL(value);}catch {throw fail('INVALID_CDP_ENDPOINT','Use http://127.0.0.1:<port>');}
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw fail('INVALID_CDP_ENDPOINT','CDP must use an explicit server-local loopback HTTP endpoint without credentials or a path');
  if(url.hostname==='localhost')url.hostname='127.0.0.1';
  return url;
}
function webSocketUrl(value,endpoint) {
  let url;try {url=new URL(value);}catch {throw fail('INVALID_CDP_TARGET','Target has no valid debugger URL');}
  if(url.hostname==='localhost')url.hostname='127.0.0.1';
  if(url.protocol!=='ws:'||url.hostname!==endpoint.hostname||(url.port||'80')!==(endpoint.port||'80')||url.username||url.password||!url.pathname.startsWith('/devtools/'))
    throw fail('INVALID_CDP_TARGET','Debugger URL must belong to the selected loopback endpoint');
  return url.href;
}
async function targets(value,signal,timeoutMs=5000) {
  const endpoint=endpointUrl(value);
  if(signal?.aborted)throw fail('CANCELLED','CDP discovery cancelled');
  try {
    const response=await fetch(new URL('/json/list',endpoint),{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])])});
    if(!response.ok)throw Error('HTTP '+response.status);
    let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>MAX_JSON)throw fail('CDP_RESPONSE_TOO_LARGE','Discovery exceeds 16 MiB');chunks.push(chunk);}
    const list=JSON.parse(Buffer.concat(chunks).toString());if(!Array.isArray(list))throw Error('Expected target array');
    return list.filter(t=>t.type==='page'||t.type==='webview').map(t=>({id:t.id,title:t.title,url:t.url,type:t.type,webSocketDebuggerUrl:webSocketUrl(t.webSocketDebuggerUrl,endpoint)}));
  }catch(e){if(signal?.aborted)throw fail('CANCELLED','CDP discovery cancelled');if(e.code)throw e;throw fail('CDP_UNAVAILABLE','Cannot discover Electron pages at '+endpoint.origin+': '+e.message);}
}
function chooseTarget(list,id) {
  const matches=id?list.filter(t=>t.id===id):list;
  if(!matches.length)throw fail('CDP_TARGET_NOT_FOUND','No matching page; run electron targets again');
  if(matches.length!==1)throw fail('AMBIGUOUS_CDP_TARGET','Multiple Electron pages; provide --target from electron targets');
  return matches[0];
}
class CdpConnection {
  constructor(url,{signal,timeoutMs=10000,trace=()=>{}}={}) {
    this.timeoutMs=timeoutMs;this.trace=trace;this.pending=new Map();this.serial=0;this.listeners=new Set();this.signal=signal;
    this.ws=new WebSocket(url);this.ws.binaryType='arraybuffer';
    this.abort=()=>this.shutdown(fail('CANCELLED','CDP operation cancelled'));
    this.ready=new Promise((resolve,reject)=>{
      this.rejectReady=reject;this.openTimer=setTimeout(()=>this.shutdown(fail('CDP_UNAVAILABLE','CDP WebSocket handshake timed out')),timeoutMs);
      this.ws.addEventListener('open',()=>{clearTimeout(this.openTimer);resolve(this);});
    });
    this.ws.addEventListener('message',event=>{
      try{
        const raw=typeof event.data==='string'?event.data:Buffer.from(event.data).toString();if(Buffer.byteLength(raw)>MAX_JSON)throw fail('CDP_RESPONSE_TOO_LARGE','CDP response exceeds 16 MiB');
        const message=JSON.parse(raw);
        if(message.id){const p=this.pending.get(message.id);if(!p)return;this.pending.delete(message.id);clearTimeout(p.timer);this.trace({method:p.method,status:message.error?'error':'received',durationMs:Date.now()-p.at});if(message.error)p.reject(fail('CDP_PROTOCOL_ERROR',p.method+': '+message.error.message));else p.resolve(message.result||{});}
        else for(const listener of this.listeners)listener(message);
      }catch(e){this.shutdown(e);}
    });
    this.ws.addEventListener('error',()=>this.shutdown(fail('CDP_DISCONNECTED','CDP WebSocket failed')));
    this.ws.addEventListener('close',()=>this.shutdown(fail('CDP_DISCONNECTED','CDP WebSocket closed')));
    signal?.addEventListener('abort',this.abort,{once:true});if(signal?.aborted)this.abort();
  }
  async send(method,params={}) {
    await this.ready;if(this.closed)throw this.closed;
    if(this.signal?.aborted)throw fail('CANCELLED','CDP operation cancelled');
    const id=++this.serial;return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.trace({method,status:'timeout'});reject(fail('CDP_TIMEOUT',method+' timed out; observe before retrying'));},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer,method,at:Date.now()});this.trace({method,status:'sent'});
      try{this.ws.send(JSON.stringify({id,method,params}));}catch(e){clearTimeout(timer);this.pending.delete(id);reject(fail('CDP_DISCONNECTED',e.message));}
    });
  }
  onEvent(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  shutdown(error=fail('CDP_DISCONNECTED','CDP session ended')) {
    if(this.closed)return;this.closed=error;clearTimeout(this.openTimer);this.rejectReady(error);this.signal?.removeEventListener('abort',this.abort);
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.listeners.clear();
    try{this.ws.close();}catch{}
  }
  close(){this.shutdown();}
}
module.exports={endpointUrl,webSocketUrl,targets,chooseTarget,CdpConnection};
