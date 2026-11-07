'use strict';
const net=require('node:net');const {EventEmitter,setMaxListeners}=require('node:events');
const {error,check,parseEndpoint}=require('./stream-protocol');
const {openStream,capability,maintainLease,streamOptions}=require('./client-stream');
const {connectTcp,listenTcp,attachTcp}=require('./stream-tcp');
async function createForward(device,kind,listen,target,options={}){
 check(['forward','reverse'].includes(kind),'Invalid forwarding direction');await capability(device,kind==='forward'?'tcpForward':'tcpReverse',options.timeoutMs);
 const abort=new AbortController(),resources=new Set(),pending=new Set(),events=new EventEmitter();events.on('connection_error',()=>{});let listener,control,stopped=false,active=false,stopLease,closePromise;
 // At most 16 channels plus 16 pending target dials share this rule's signal.
 // Keep a finite warning threshold for Node 18, which warns at 11 by default.
 setMaxListeners(32,abort.signal);
 async function cleanup(){if(stopped)return;stopped=true;abort.abort();stopLease?.();for(const socket of pending)socket.destroy();pending.clear();for(const r of resources){r.channel?.close();r.adapter?.close();r.socket?.destroy();}resources.clear();if(listener)await new Promise(r=>listener.close(()=>r()));}
 const close=async(reason='client_close')=>{if(closePromise)return closePromise;closePromise=(async()=>{await cleanup();if(control&&!control.closed){try{await control.request('close',{reason},'closed');}catch{}control.close();}})();return closePromise;};
 async function connection(socket,connectionId){
  const resource={socket};resources.add(resource);let reported=false;
  const report=e=>{if(!reported&&!stopped){reported=true;events.emit('connection_error',{code:e.code||'STREAM_INTERRUPTED',message:e.message,connectionId:resource.channel?.opened?.connectionId||connectionId});}};
  try{check(resources.size<=16,'Local TCP quota exceeded','RESOURCE_LIMIT');const channel=await openStream(device,{kind:'tcp',forwardId:control.opened.forwardId,...(connectionId?{connectionId}:{})},{...options,signal:abort.signal,instanceId:control.hello.serverInstanceId});resource.channel=channel;channel.on('failure',report);check(channel.opened.forwardId===control.opened.forwardId,'Wrong rule in TCP response','INVALID_STATE');
   if(kind==='reverse')resource.socket=await connectTcp(target,abort.signal);
   if(stopped||channel.closed)throw error('STREAM_INTERRUPTED','Rule stopped during connection setup');resource.adapter=attachTcp(channel,resource.socket);await channel.ready();resource.adapter.activate();channel.once('closed',()=>{resource.adapter.close();resources.delete(resource);});
  }catch(e){report(e);if(resource.channel&&!resource.channel.closed){try{resource.channel.control({type:'reset',code:e.code||'STREAM_INTERRUPTED',message:String(e.message).slice(0,2048)});}catch{}resource.channel.close();}resource.adapter?.close();resource.socket?.destroy();resources.delete(resource);}
 }
 try{
  control=await openStream(device,{kind,listen,target},{...options,signal:options.signal});check(control.opened.listen.host===listen.host&&(listen.port===0||control.opened.listen.port===listen.port)&&control.opened.target.host===target.host&&control.opened.target.port===target.port,'Rule endpoints differ from requested values','INVALID_STATE');
  control.on('control',m=>{if(m.type==='incoming'){if(kind!=='reverse'||!active||m.forwardId!==control.opened.forwardId){control.fail(error('INVALID_STATE','Unexpected reverse incoming'));return;}connection(null,m.connectionId);}});
  control.on('closed',()=>{cleanup().finally(()=>events.emit('closed',control.failure));});
  if(kind==='forward'){
   listener=net.createServer({allowHalfOpen:true,pauseOnConnect:true},socket=>{socket.on('error',()=>{});if(stopped){socket.destroy();return;}if(active)connection(socket);else{if(pending.size>=16){socket.destroy();return;}pending.add(socket);socket.once('close',()=>pending.delete(socket));}});listener.on('error',e=>{if(active)control.fail(error('STREAM_INTERRUPTED',e.message));});listen=await listenTcp(listener,listen,abort.signal);
  }else listen=control.opened.listen;
  // incoming follows ready.ack on the same WS; install its handler first.
  active=true;await control.ready(kind==='forward'?{listen}:{});stopLease=maintainLease(control,device);for(const socket of pending)connection(socket);pending.clear();
  return Object.assign(events,{control,listen,target,kind,forwardId:control.opened.forwardId,close,resources});
 }catch(e){await cleanup();control?.close();throw e;}
}
async function runForward(device,kind,words,options,io){
 const settings=streamOptions(options);check(words.length===2,`${kind} requires a listen and target TCP endpoint`);for(const k of ['detach','follow','interactive','admin'])check(!options[k],`--${k} is not a forwarding option`);
 const rule=await createForward(device,kind,parseEndpoint(words[0],true),parseEndpoint(words[1]),settings);
 const emit=(event,extra={})=>{const data={event,direction:kind,forwardId:rule.forwardId,listen:rule.listen,target:rule.target,...extra};if(options.json)io.stdout.write(JSON.stringify(data)+'\n');else if(event==='ready')io.stdout.write(`${kind} ${rule.listen.host}:${rule.listen.port} -> ${rule.target.host}:${rule.target.port} (${rule.forwardId})\n`);else if(event==='connection_error')io.stderr.write(`${extra.code}: ${extra.message}\n`);};
 rule.on('connection_error',e=>emit('connection_error',e));emit('ready');let interrupted=false;
 const signals=io.signals||process,interrupt=()=>{interrupted=true;rule.close('client_interrupt').catch(()=>{});};signals.on('SIGINT',interrupt);signals.on('SIGTERM',interrupt);
 try{const failure=await new Promise(resolve=>{if(rule.control.closed)resolve(rule.control.failure);else rule.once('closed',resolve);});emit('closed',{reason:interrupted?'client_interrupt':failure?.code||'client_close',...(failure?{error:{code:failure.code,message:failure.message}}:{})});return interrupted||!failure?0:1;}
 finally{signals.removeListener('SIGINT',interrupt);signals.removeListener('SIGTERM',interrupt);await rule.close();}
}
module.exports={createForward,runForward};
