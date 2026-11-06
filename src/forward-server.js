'use strict';
const net=require('node:net'),crypto=require('node:crypto');
const {error,check}=require('./stream-protocol');const {connectTcp,listenTcp,attachTcp}=require('./stream-tcp');
class ForwardServer{
 constructor(){this.rules=new Map();this.connections=new Map();}
 reserve(rule,socket){const all=[...this.connections.values()];check(all.length<64&&all.filter(c=>c.rule.owner===rule.owner).length<16,'TCP connection quota exceeded','RESOURCE_LIMIT');const conn={id:crypto.randomUUID(),rule,socket,claimed:false};this.connections.set(conn.id,conn);rule.connections.add(conn);return conn;}
 release(conn,closeChannel=true){if(conn.released)return;conn.released=true;clearTimeout(conn.timer);if(closeChannel)conn.channel?.close();conn.adapter?.close();conn.socket?.destroy();conn.rule.connections.delete(conn);this.connections.delete(conn.id);}
 async rule(ctx,m){
  const rule={id:crypto.randomUUID(),kind:m.kind,owner:ctx.owner.id,ctx,listen:m.listen,target:m.target,connections:new Set(),active:false,closed:false};this.rules.set(rule.id,rule);
  const close=()=>{if(rule.closing)return rule.closing;rule.closed=true;rule.active=false;this.rules.delete(rule.id);rule.closing=(async()=>{for(const conn of [...rule.connections])this.release(conn);if(rule.server)await new Promise(r=>rule.server.close(()=>r()));})();return rule.closing;};ctx.signal.addEventListener('abort',()=>{close().catch(()=>{});},{once:true});
  const announce=conn=>{if(!rule.active||conn.claimed||conn.announced||conn.released)return;conn.announced=true;ctx.channel.control({type:'incoming',forwardId:rule.id,connectionId:conn.id,attachTimeoutMs:10000});};
  try{
   if(m.kind==='reverse'){
    rule.server=net.createServer({allowHalfOpen:true,pauseOnConnect:true},socket=>{socket.on('error',()=>{});try{check(!rule.closed&&rule.connections.size<16,'Pending rule connection limit','RESOURCE_LIMIT');const conn=this.reserve(rule,socket);conn.timer=setTimeout(()=>{if(!conn.claimed)this.release(conn);},10000);socket.once('close',()=>{if(!conn.claimed)this.release(conn);});announce(conn);}catch{socket.destroy();}});
    rule.server.on('error',e=>{if(rule.active)ctx.channel.fail(error('STREAM_INTERRUPTED',e.message));});rule.listen=await listenTcp(rule.server,m.listen,ctx.signal);
   }
   return {opened:{forwardId:rule.id,listen:rule.listen,target:rule.target},start:async ready=>{if(m.kind==='forward'){check(ready.listen?.host===m.listen.host&&ready.listen.port>0&&(m.listen.port===0||ready.listen.port===m.listen.port),'Actual forward listen differs from requested endpoint');rule.listen=ready.listen;}return {forwardId:rule.id,listen:rule.listen,target:rule.target};},activate:()=>{rule.active=true;for(const conn of rule.connections)announce(conn);},close,audit:()=>({forwardId:rule.id,direction:rule.kind,listen:rule.listen,target:rule.target})};
  }catch(e){await close();throw e;}
 }
 async tcp(ctx,m){
  const rule=this.rules.get(m.forwardId);check(rule&&!rule.closed&&rule.active&&rule.owner===ctx.owner.id,'Rule is unavailable for this client','UNAUTHORIZED');let conn;
  try{
   if(rule.kind==='forward'){check(m.connectionId===undefined,'Forward connectionId is server-assigned');conn=this.reserve(rule);conn.claimed=true;conn.channel=ctx.channel;ctx.signal.addEventListener('abort',()=>this.release(conn),{once:true});conn.socket=await connectTcp(rule.target,ctx.signal);}
   else{check(m.connectionId,'Reverse requires connectionId');conn=this.connections.get(m.connectionId);check(conn&&conn.rule===rule&&!conn.claimed&&!conn.released,'Pending connection already claimed or expired','ATTACH_TIMEOUT');conn.claimed=true;clearTimeout(conn.timer);conn.channel=ctx.channel;ctx.signal.addEventListener('abort',()=>this.release(conn),{once:true});}
   if(ctx.signal.aborted||rule.closed){this.release(conn);throw error('STREAM_INTERRUPTED','Rule closed during TCP setup');}
   conn.adapter=attachTcp(ctx.channel,conn.socket,ctx.manager.budget);const ids={forwardId:rule.id,connectionId:conn.id};return {opened:ids,start:async()=>ids,activate:()=>conn.adapter.activate(),close:async()=>this.release(conn),audit:()=>({...ids,sentBytes:conn.adapter.flow.sent,receivedBytes:conn.adapter.flow.received})};
  }catch(e){if(conn?.rule===rule&&conn.channel===ctx.channel)this.release(conn,false);throw e;}
 }
 factories(){return {forward:(c,m)=>this.rule(c,m),reverse:(c,m)=>this.rule(c,m),tcp:(c,m)=>this.tcp(c,m)};}
}
module.exports={ForwardServer};
