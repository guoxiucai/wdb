'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');const {runOperation}=require('../src/operations');
test('helper response preserves UTF-8 characters split across network chunks',async t=>{
 const expected={text:'中文🙂'.repeat(20)},bytes=Buffer.from(JSON.stringify({ok:true,data:expected}));
 const server=http.createServer(async(req,res)=>{req.resume();res.setHeader('content-type','application/json');for(const byte of bytes){res.write(Buffer.from([byte]));await new Promise(r=>setImmediate(r));}res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const result=await runOperation('screens',{}, {id:'unicode-test',dir:__dirname,timeoutMs:3000},{helperPort:server.address().port,helperSecret:'test-only'});assert.deepEqual(result,expected);assert.equal(Buffer.byteLength(result.text),Buffer.byteLength(expected.text));
 const flutter=await runOperation('flutter.info',{}, {id:'flutter-route',dir:__dirname,timeoutMs:3000},{helperPort:server.address().port,helperSecret:'test-only'});assert.deepEqual(flutter,expected);
 const approval=await runOperation('connection.approve',{}, {id:'approval-route',dir:__dirname,timeoutMs:3000},{helperPort:server.address().port,helperSecret:'test-only'});assert.deepEqual(approval,expected);
});

test('helper startup refusal is retried before dispatch, but a lost reply is not replayed',async t=>{
 const net=require('node:net');const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));let requests=0,drop=false;
 const server=http.createServer((req,res)=>{requests++;req.resume();req.on('end',()=>{if(drop)req.socket.destroy();else res.end(JSON.stringify({ok:true,data:{ready:true}}));});});t.after(()=>new Promise(r=>server.close(r)));
 const started=setTimeout(()=>server.listen(port,'127.0.0.1'),200);t.after(()=>clearTimeout(started));
 const ctx={id:'startup-test',dir:__dirname,timeoutMs:2000},config={helperPort:port,helperSecret:'test-only'};assert.equal((await runOperation('screens',{},ctx,config)).ready,true);assert.equal(requests,1);
 drop=true;await assert.rejects(runOperation('input.mouse',{x:1,y:1},ctx,config),{code:'DESKTOP_HELPER_UNAVAILABLE'});assert.equal(requests,2);
});

test('cancellation while helper is starting prevents later action dispatch',async t=>{
 const net=require('node:net'),controller=new AbortController(),reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));let requests=0;
 const server=http.createServer((req,res)=>{requests++;req.resume();res.end(JSON.stringify({ok:true,data:{}}));});const pending=runOperation('input.mouse',{}, {id:'cancel-startup',dir:__dirname,timeoutMs:1000,signal:controller.signal},{helperPort:port,helperSecret:'test-only'});
 await new Promise(r=>setTimeout(r,30));controller.abort();await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));await assert.rejects(pending,{code:'CANCELLED'});assert.equal(requests,0);
});
