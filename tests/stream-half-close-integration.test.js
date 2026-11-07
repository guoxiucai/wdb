'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),crypto=require('node:crypto');
const {createForward}=require('../src/forward-client');
const {fixture,until,delay}=require('./stream-fixture');
test('forward, reverse and chained EOF response preserve tails with zero connection errors',{timeout:Math.max(60000,Number(process.env.WDB_HALF_CLOSE_SOAK_MS||0)+60000)},async t=>{
 const {bridge,device}=await fixture(t),sockets=new Set(),errors=[];
 const server=net.createServer({allowHalfOpen:true},s=>{sockets.add(s);s.on('error',()=>{});s.once('close',()=>sockets.delete(s));const parts=[];s.on('data',b=>parts.push(b));s.on('end',()=>setTimeout(()=>s.end(Buffer.concat(parts)),15));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 const endpoint={host:'127.0.0.1',port:server.address().port},listen={host:'127.0.0.1',port:0};
 const reverse=await createForward(device,'reverse',listen,endpoint);t.after(()=>reverse.close());
 const forward=await createForward(device,'forward',listen,endpoint);t.after(()=>forward.close());
 const chain=await createForward(device,'forward',listen,reverse.listen);t.after(()=>chain.close());
 const rules=[forward,reverse,chain];for(const r of rules)r.control.on('failure',e=>console.log(JSON.stringify({event:'control_failure',code:e.code,message:e.message})));for(const r of rules)r.on('connection_error',e=>{errors.push(e);console.log(JSON.stringify({event:'connection_error',kind:r.kind,...e}));});
 let exchanges=0;
 async function exchange(rule,size){const payload=crypto.randomBytes(size);await new Promise((resolve,reject)=>{const s=net.connect({...rule.listen,allowHalfOpen:true}),parts=[];const timer=setTimeout(()=>s.destroy(Error('exchange timeout')),15000);s.on('error',e=>{e.message+=' ('+rule.kind+', size='+size+', completed='+exchanges+')';reject(e);});s.on('close',()=>clearTimeout(timer));s.on('connect',()=>s.end(payload));s.on('data',b=>{parts.push(b);s.pause();setTimeout(()=>s.resume(),2);});s.on('end',()=>{try{assert.deepEqual(Buffer.concat(parts),payload);resolve();}catch(e){reject(e);}});});exchanges++;}
 for(const r of rules)for(const size of [0,1,17,65535,65536,65537,1048576,1048593,3*1048576+17])await exchange(r,size);
 const start=Date.now(),duration=Number(process.env.WDB_HALF_CLOSE_SOAK_MS||0);
 do{for(const r of rules)await Promise.all(Array.from({length:4},()=>exchange(r,1048593)));await until(()=>bridge.forwarding.connections.size===0&&rules.every(r=>r.resources.size===0));assert.deepEqual(errors,[]);await delay(1000);}while(Date.now()-start<duration);
 for(const r of rules){await r.close();const probe=net.createServer();await new Promise((resolve,reject)=>probe.once('error',reject).listen(r.listen.port,r.listen.host,resolve));await new Promise(resolve=>probe.close(resolve));}
 await until(()=>bridge.forwarding.connections.size===0&&bridge.forwarding.rules.size===0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({exchanges,soakMs:Date.now()-start,connectionErrors:errors.length,connections:bridge.forwarding.connections.size,rules:bridge.forwarding.rules.size}));
});
