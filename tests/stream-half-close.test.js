'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {attachTcp}=require('../src/stream-tcp');
const {Channel}=require('../src/stream-channel');
function harness(){
 const channel=new EventEmitter(),socket=new EventEmitter();
 Object.assign(channel,{transport:{readyState:1,bufferedAmount:0},controls:[],closeCount:0,control(m){this.controls.push(m);},binary(b,cb){setImmediate(cb);},close(){this.closeCount++;},fail(e){this.failure=e;this.emit('failure',e);}});
 Object.assign(socket,{pause(){},resume(){},write(b,cb){this.complete=cb;},end(){this.writableEnded=true;},destroy(){this.destroyed=true;}});
 return {channel,socket,adapter:attachTcp(channel,socket)};
}
test('TCP close waits for peer consumption of the final 17 bytes',()=>{
 const {channel,socket,adapter}=harness();adapter.activate();
 socket.emit('data',Buffer.alloc(17));socket.emit('end');channel.emit('control',{type:'fin'});
 socket.emit('close',false);
 assert.equal(channel.closeCount,0,'queue empty and both FINs do not acknowledge destination writes');
 channel.emit('control',{type:'credit',consumed:17});assert.equal(channel.closeCount,1);
 adapter.close();
});
test('FIN flushes a small tail credit only after the delayed destination write',()=>{
 const {channel,socket,adapter}=harness();adapter.activate();
 channel.emit('data',Buffer.alloc(17));channel.emit('control',{type:'fin'});
 assert.equal(socket.writableEnded,undefined);assert.equal(channel.controls.length,0);
 socket.complete();assert.equal(socket.writableEnded,true);
 assert.deepEqual(channel.controls,[{type:'credit',consumed:17}]);adapter.close();
});
test('repeated channel close preserves the WebSocket closing handshake',()=>{
 const transport=new EventEmitter();Object.assign(transport,{readyState:1,closes:0,terminates:0,close(){this.closes++;this.readyState=2;},terminate(){this.terminates++;}});
 const channel=new Channel(transport,'client');channel.close();channel.close();
 assert.equal(transport.closes,1);assert.equal(transport.terminates,0);transport.emit('close',1000,'');
});
test('normal WS cleanup does not destroy a TCP socket still finishing its FIN',()=>{
 const {channel,socket,adapter}=harness();adapter.activate();socket.emit('end');channel.emit('control',{type:'fin'});
 channel.closed=true;channel.closeCode=1000;channel.emit('closed');adapter.close();
 assert.equal(socket.writableEnded,true);assert.equal(socket.destroyed,undefined);socket.emit('close',false);
});
test('server resource release awaits adapter drain without overriding it with destroy',async()=>{
 const {ForwardServer}=require('../src/forward-server');const server=new ForwardServer();
 const rule={owner:'fixture',connections:new Set()},socket={destroy(){throw Error('must not bypass adapter');}};
 const conn=server.reserve(rule,socket);let complete;
 conn.adapter={close(){return new Promise(resolve=>complete=resolve);}};
 const released=server.release(conn);assert.equal(server.connections.size,1);
 complete();await released;assert.equal(server.connections.size,0);assert.equal(rule.connections.size,0);
});
