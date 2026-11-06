'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');const {runOperation}=require('../src/operations');
test('helper response preserves UTF-8 characters split across network chunks',async t=>{
 const expected={text:'中文🙂'.repeat(20)},bytes=Buffer.from(JSON.stringify({ok:true,data:expected}));
 const server=http.createServer(async(req,res)=>{req.resume();res.setHeader('content-type','application/json');for(const byte of bytes){res.write(Buffer.from([byte]));await new Promise(r=>setImmediate(r));}res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const result=await runOperation('screens',{}, {id:'unicode-test',dir:__dirname,timeoutMs:3000},{helperPort:server.address().port,helperSecret:'test-only'});assert.deepEqual(result,expected);assert.equal(Buffer.byteLength(result.text),Buffer.byteLength(expected.text));
});
