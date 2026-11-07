'use strict';
const net=require('node:net');
const {Flow}=require('./stream-flow');const {error,check}=require('./stream-protocol');
function connectTcp(target,signal,timeoutMs=5000){return new Promise((resolve,reject)=>{const socket=net.connect({...target,allowHalfOpen:true});socket.pause();let settled=false;const timer=setTimeout(()=>fail(error('TARGET_CONNECT_FAILED','Target connect timed out')),timeoutMs);const abort=()=>fail(error('STREAM_INTERRUPTED','TCP connect cancelled'));const fail=e=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.destroy();reject(e.code==='STREAM_INTERRUPTED'?e:error('TARGET_CONNECT_FAILED',`Target ${target.host}:${target.port}: ${e.message}`));};socket.once('error',fail);socket.once('connect',()=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.removeListener('error',fail);socket.on('error',()=>{});resolve(socket);});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});}
function listenTcp(server,endpoint,signal){return new Promise((resolve,reject)=>{let finished=false;const abort=()=>{server.close();done(error('STREAM_INTERRUPTED','Listener creation cancelled'));},failed=e=>done(error(e.code==='EADDRINUSE'?'PORT_IN_USE':'INVALID_ARGUMENT',`Cannot listen on ${endpoint.host}:${endpoint.port}: ${e.message}`));function done(e){if(finished)return;finished=true;signal?.removeEventListener('abort',abort);server.removeListener('error',failed);e?reject(e):resolve({host:endpoint.host,port:server.address().port});}server.once('error',failed);server.listen({host:endpoint.host,port:endpoint.port,ipv6Only:endpoint.host==='::1'},()=>{if(signal?.aborted){server.close();return;}done();});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});}
function attachTcp(channel,socket,budget){
 const flow=new Flow(channel,socket,socket,{tcp:true,budget});let cleaned=false,socketClosed=false,closing=false,drainTimer,closePromise;
 // FIN orders bytes, but only credit proves the remote destination write completed.
 // A local TCP close can precede the peer's last asynchronous write callback.
 const finish=()=>{if(cleaned||closing||channel.closed||!socketClosed)return;if(flow.localFin&&flow.remoteFin&&flow.finSent&&!flow.writing&&flow.outBytes===0&&flow.inBytes===0&&flow.sent===flow.peerConsumed&&flow.received===flow.consumed){closing=true;clearTimeout(drainTimer);channel.close();}};
 const socketClose=hadError=>{if(cleaned||channel.closed)return;socketClosed=true;if(hadError||!flow.localFin||!flow.remoteFin||!flow.finSent){channel.fail(error('STREAM_INTERRUPTED','TCP closed without both FIN directions'));return;}drainTimer=setTimeout(()=>channel.fail(error('OUTPUT_DRAIN_TIMEOUT','TCP final consumption credit did not arrive')),10000);drainTimer.unref?.();finish();};
 socket.on('close',socketClose);flow.on('progress',finish);
 const close=()=>{if(cleaned)return closePromise;cleaned=true;clearTimeout(drainTimer);socket.removeListener('close',socketClose);flow.removeListener('progress',finish);channel.removeListener('closed',close);channel.removeListener('failure',close);
  const graceful=channel.closed&&channel.closeCode===1000&&!channel.failure&&flow.localFin&&flow.remoteFin&&flow.finSent&&!flow.writing&&flow.sent===flow.peerConsumed&&flow.received===flow.consumed;
  flow.stop();
  if(graceful&&!socket.destroyed){
   // A write callback/credit is not TCP FIN completion. Preserve end()'s kernel
   // send queue rather than resetting a slow reader during WS cleanup.
   closePromise=new Promise(resolve=>{const timer=setTimeout(()=>socket.destroy(),10000);timer.unref?.();socket.once('close',()=>{clearTimeout(timer);resolve();});if(!socket.writableEnded)socket.end();});
  }else {socket.destroy();closePromise=Promise.resolve();}return closePromise;
 };channel.once('closed',close);channel.once('failure',close);
 return {flow,activate:()=>flow.activate(),close};
}
module.exports={connectTcp,listenTcp,attachTcp};
