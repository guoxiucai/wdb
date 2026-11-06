'use strict';
const crypto=require('node:crypto');
const {WebSocketServer}=require('ws');
const {Channel}=require('./stream-channel');
const {PROTOCOL,LIMITS,error,check}=require('./stream-protocol');
class ServerStreams{
 constructor({deviceId,authorize,renew,audit=()=>{},protocol=PROTOCOL,endpoint='/v1/stream',factories={},limits={}}){
  this.deviceId=deviceId;this.authorize=authorize;this.renew=renew;this.audit=audit;this.protocol=protocol;this.endpoint=endpoint;this.factories=factories;this.instanceId=crypto.randomUUID();this.channels=new Set();this.budget={bytes:0};this.stopping=false;
  this.limits={shell:{client:4,total:16},rule:{client:4,total:16},tcp:{client:16,total:64},...limits};
  this.wss=new WebSocketServer({noServer:true,perMessageDeflate:false,maxPayload:LIMITS.binaryMessageBytes,handleProtocols:protocols=>protocols.has(protocol)?protocol:false});
  this.timer=setInterval(()=>this.sweep(),1000);this.timer.unref();
 }
 capabilities(){return {version:1,endpoint:this.endpoint,interactiveShell:!!this.factories.shell,tcpForward:!!this.factories.forward,tcpReverse:!!this.factories.reverse};}
 attach(server){server.on('upgrade',(req,socket,head)=>this.upgrade(req,socket,head));}
 upgrade(req,socket,head){
  socket.on('error',()=>{});
  try{check(!this.stopping,'Server is stopping','STREAM_INTERRUPTED');check(req.url===this.endpoint&&req.method==='GET'&&req.headers['sec-websocket-version']==='13','Unsupported stream endpoint','INCOMPATIBLE_STREAM_PROTOCOL');check(req.headers['sec-websocket-protocol']===this.protocol,'Unsupported subprotocol','INCOMPATIBLE_STREAM_PROTOCOL');check(!Object.hasOwn(req.headers,'origin'),'Browser Origin is not allowed','UNAUTHORIZED');check(this.channels.size<128,'Stream handshake capacity reached','RESOURCE_LIMIT');const owner=this.authorize(req,false);check([...this.channels].filter(x=>x.owner.id===owner.id).length<32,'Client stream capacity reached','RESOURCE_LIMIT');this.wss.handleUpgrade(req,socket,head,ws=>this.accept(ws,owner));}
  catch(e){const body=JSON.stringify({error:{code:e.code||'UNAUTHORIZED',message:String(e.message).slice(0,1024)}});socket.end(`HTTP/1.1 ${e.code==='RESOURCE_LIMIT'?429:403} Stream rejected\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);const timer=setTimeout(()=>socket.destroy(),1000);timer.unref();socket.once('close',()=>clearTimeout(timer));}
 }
 claim(ctx,kind){const category=kind==='shell'?'shell':kind==='tcp'?'tcp':'rule',limit=this.limits[category],existing=[...this.channels].filter(c=>c.category===category&&!c.channel.closed);check(existing.length<limit.total&&existing.filter(c=>c.owner.id===ctx.owner.id).length<limit.client,'Stream resource quota exceeded','RESOURCE_LIMIT');ctx.category=category;}
 accept(ws,owner){
  const channel=new Channel(ws,'server',{budget:this.budget});const controller=new AbortController();const ctx={channel,owner,manager:this,signal:controller.signal,state:'HELLO',leaseAt:Date.now(),deadline:Date.now()+10000,channelId:crypto.randomUUID(),createdAt:Date.now(),close:()=>channel.close()};this.channels.add(ctx);
  let completed;ctx.done=new Promise(r=>completed=r);
  const cleanup=()=>{if(ctx.cleaned)return;ctx.cleaned=true;controller.abort();this.channels.delete(ctx);Promise.resolve(ctx.resource?.close()).catch(()=>{}).finally(()=>{try{this.audit({op:'stream',clientId:owner.id,channelId:ctx.channelId,kind:ctx.kind,status:'closed',reason:channel.failure?.code||'closed',durationMs:Date.now()-ctx.createdAt,...ctx.resource?.audit?.()});}finally{completed();}});};
  channel.on('closed',cleanup);channel.on('failure',()=>{controller.abort();Promise.resolve(ctx.resource?.close()).catch(()=>{});});
  channel.on('data',()=>{if(!['shell','tcp'].includes(ctx.kind))channel.fail(error('INVALID_STATE','Binary on rule control channel'));});
  channel.on('control',m=>{this.control(ctx,m).catch(e=>channel.fail(e));});
  channel.control({type:'hello',version:1,deviceId:this.deviceId,serverInstanceId:this.instanceId,channelId:ctx.channelId,limits:LIMITS});
  ws.on('pong',()=>{ctx.pingAt=0;});
 }
 async control(ctx,m){
  const c=ctx.channel;check(!ctx.cleaned,'Stream already closed','INVALID_STATE');
  if(m.type==='close'){ctx.state='CLOSING';ctx.deadline=0;await ctx.resource?.close();if(!c.closed){c.control({type:'closed',replyTo:m.requestId,reason:m.reason});c.close();}return;}
  if(m.type==='open'){
   check(ctx.state==='HELLO','Only one open is allowed','INVALID_STATE');ctx.state='OPENING';ctx.kind=m.kind;this.claim(ctx,m.kind);const factory=this.factories[m.kind];check(factory,'Capability unavailable','FEATURE_UNAVAILABLE');const resource=await factory(ctx,m);if(ctx.signal.aborted||c.closed){await resource.close();return;}ctx.resource=resource;ctx.state='OPENED';ctx.deadline=Date.now()+10000;c.control({type:'opened',replyTo:m.requestId,kind:m.kind,...resource.opened});this.audit({op:'stream',status:'opened',clientId:ctx.owner.id,kind:m.kind,channelId:ctx.channelId,...resource.audit?.()});return;
  }
  if(m.type==='ready'){
   check(ctx.state==='OPENED','Unexpected or duplicate ready','INVALID_STATE');check(ctx.kind==='forward'||m.listen===undefined,'listen is only allowed for forward ready');ctx.state='STARTING';const info=await ctx.resource.start(m);if(ctx.signal.aborted||c.closed){await ctx.resource.close();return;}ctx.state='ACTIVE';ctx.deadline=0;ctx.leaseAt=Date.now();c.active=true;c.control({type:'ready.ack',replyTo:m.requestId,...info});ctx.resource.activate?.();return;
  }
  if(m.type==='reset'){check(ctx.kind==='tcp'&&['OPENED','ACTIVE','STARTING'].includes(ctx.state),'Unexpected reset','INVALID_STATE');c.fail(error(m.code,m.message));return;}
  check(ctx.state==='ACTIVE','Control message before ACTIVE','INVALID_STATE');
  if(m.type==='lease'){check(ctx.kind!=='tcp','TCP inherits control lease','INVALID_STATE');this.authorizeOwner(ctx.owner);this.renew(ctx.owner);ctx.leaseAt=Date.now();c.control({type:'lease.ack',replyTo:m.requestId,leaseTimeoutMs:LIMITS.leaseTimeoutMs});return;}
  if(m.type==='credit'){check(ctx.kind==='tcp'||ctx.kind==='shell','Rule control channels cannot receive credit','INVALID_STATE');return;}
  if(m.type==='fin'){check(ctx.kind==='tcp','FIN only valid for TCP','INVALID_STATE');return;}
  if(m.type==='resize'){check(ctx.kind==='shell','Resize only valid for shell','INVALID_STATE');const size=await ctx.resource.resize(m);if(!c.closed)c.control({type:'resize.ack',replyTo:m.requestId,...size});return;}
  throw error('INVALID_STATE','Unexpected control message');
 }
 authorizeOwner(owner){this.authorize({owner},true);}
 sweep(){const now=Date.now();for(const ctx of this.channels){try{this.authorizeOwner(ctx.owner);if(ctx.deadline&&now>ctx.deadline)throw error('STREAM_INTERRUPTED','Stream preparation deadline exceeded');if(ctx.state==='ACTIVE'&&ctx.kind!=='tcp'&&now-ctx.leaseAt>LIMITS.leaseTimeoutMs)throw error('LEASE_EXPIRED','Stream application lease expired');if(ctx.pingAt&&now-ctx.pingAt>10000)throw error('STREAM_INTERRUPTED','Peer stopped responding');if(!ctx.pingAt&&now-(ctx.lastPing||ctx.createdAt)>15000){ctx.lastPing=now;ctx.pingAt=now;ctx.channel.transport.ping();}}catch(e){ctx.channel.fail(e);}}}
 disconnect(id,code='STREAM_INTERRUPTED'){for(const ctx of this.channels)if(ctx.owner.id===id)ctx.channel.fail(error(code,'Client connection ended'));}
 async close(){if(this.closing)return this.closing;this.stopping=true;clearInterval(this.timer);this.closing=(async()=>{const all=[...this.channels];for(const ctx of all)ctx.channel.fail(error('STREAM_INTERRUPTED','Server stopped'),1001);let timer;await Promise.race([Promise.all(all.map(c=>c.done)),new Promise(r=>timer=setTimeout(r,2000))]);clearTimeout(timer);for(const ctx of all)if(!ctx.channel.closed)ctx.channel.transport.terminate();await Promise.race([Promise.all(all.map(c=>c.done)),new Promise(r=>timer=setTimeout(r,10000))]);clearTimeout(timer);this.wss.close();})();return this.closing;}
}
module.exports={ServerStreams};
