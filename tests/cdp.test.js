'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {CdpConnection,endpointUrl,webSocketUrl,targets,chooseTarget}=require('../src/cdp');
const {runCdp}=require('../src/electron-cdp');
async function fixture(handler){
  const sockets=new Set(),calls=[];let endpoint;
  const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify([{id:'page-one',type:'page',title:'Fixture',url:'file:///fixture.html',webSocketDebuggerUrl:endpoint.replace('http:','ws:')+'/devtools/page/page-one'}]));});
  server.on('upgrade',(req,socket)=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
    const send=message=>{const body=Buffer.from(JSON.stringify(message)),head=Buffer.alloc(body.length<126?2:4);head[0]=129;if(body.length<126)head[1]=body.length;else{head[1]=126;head.writeUInt16BE(body.length,2);}socket.write(Buffer.concat([head,body]));};
    let pending=Buffer.alloc(0);socket.on('data',chunk=>{
      pending=Buffer.concat([pending,chunk]);while(pending.length>=2){const opcode=pending[0]&15;let length=pending[1]&127,offset=2;if(length===126){if(pending.length<4)return;length=pending.readUInt16BE(2);offset=4;}else if(length===127){if(pending.length<10)return;length=Number(pending.readBigUInt64BE(2));offset=10;}const masked=!!(pending[1]&128),maskBytes=masked?4:0;if(pending.length<offset+maskBytes+length)return;const mask=pending.subarray(offset,offset+maskBytes),body=Buffer.from(pending.subarray(offset+maskBytes,offset+maskBytes+length));pending=pending.subarray(offset+maskBytes+length);if(masked)for(let i=0;i<body.length;i++)body[i]^=mask[i%4];if(opcode===8){socket.end(Buffer.from([136,0]));return;}if(opcode!==1)continue;const request=JSON.parse(body);calls.push(request);handler(request,(result={})=>send({id:request.id,result}),socket,send);}
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));endpoint='http://127.0.0.1:'+server.address().port;
  return {endpoint,calls,async close(){for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
function context(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-cdp-test-'));return {dir,timeoutMs:2000,cleanup(){assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('wdb-cdp-test-'));fs.rmSync(dir,{recursive:true,force:true});}};}
test('CDP discovery restricts endpoints and debugger URLs and refuses ambiguous targets',async()=>{
  for(const input of ['http://192.168.1.1:9222','https://127.0.0.1:9222','http://user@127.0.0.1:9222','http://127.0.0.1:9222/path'])assert.throws(()=>endpointUrl(input),{code:'INVALID_CDP_ENDPOINT'});
  assert.throws(()=>webSocketUrl('ws://127.0.0.1:1234/devtools/page/x',endpointUrl()),{code:'INVALID_CDP_TARGET'});
  assert.throws(()=>chooseTarget([{id:'a'},{id:'b'}]),{code:'AMBIGUOUS_CDP_TARGET'});
  assert.equal(chooseTarget([{id:'a'},{id:'b'}],'b').id,'b');
  const server=await fixture((req,reply)=>reply());try{const list=await targets(server.endpoint);assert.equal(list[0].id,'page-one');}finally{await server.close();}
});
test('CDP multiplexes responses, exposes protocol errors, and cancels pending requests',async()=>{
  const server=await fixture((req,reply,socket,send)=>{if(req.method==='slow')setTimeout(()=>reply({order:1}),30);else if(req.method==='error')send({id:req.id,error:{code:-1,message:'unsupported'}});else if(req.method!=='hang')reply({order:2});});
  const abort=new AbortController(),client=new CdpConnection(server.endpoint.replace('http:','ws:')+'/devtools/page/page-one',{signal:abort.signal,timeoutMs:300});
  try{assert.deepEqual(await Promise.all([client.send('slow'),client.send('fast')]),[{order:1},{order:2}]);await assert.rejects(client.send('error'),{code:'CDP_PROTOCOL_ERROR'});const pending=client.send('hang');setTimeout(()=>abort.abort(),20);await assert.rejects(pending,{code:'CANCELLED'});}finally{client.close();await server.close();}
});
test('CDP click sends one press/release and a timeout never replays the action',async()=>{
  let failPress=false;const server=await fixture((req,reply)=>{if(req.method==='Runtime.evaluate')reply({result:{value:{control:{name:'Open'},x:40,y:50}}});else if(!(failPress&&req.params.type==='mousePressed'))reply();});const ctx=context();
  try{const done=await runCdp('action',{endpoint:server.endpoint,selector:'#open'},ctx);assert.equal(done.method,'CDP.Input');assert.deepEqual(server.calls.filter(r=>r.method==='Input.dispatchMouseEvent').map(r=>r.params.type),['mousePressed','mouseReleased']);failPress=true;await assert.rejects(runCdp('action',{endpoint:server.endpoint,selector:'#open',commandTimeoutMs:50},ctx),{code:'ACTION_OUTCOME_UNKNOWN'});assert.equal(server.calls.filter(r=>r.params.type==='mousePressed').length,2);assert.match(fs.readFileSync(path.join(ctx.dir,'cdp-trace.jsonl'),'utf8'),/mutationSent/);}finally{ctx.cleanup();await server.close();}
});
test('CDP DOM lookup failure sends no input; renderer exceptions remain explicit',async()=>{
  let exception=false;const server=await fixture((req,reply)=>reply(exception?{exceptionDetails:{text:'script threw'}}:{result:{value:{error:{code:'CONTROL_NOT_FOUND',message:'missing'}}}})),ctx=context();
  try{await assert.rejects(runCdp('action',{endpoint:server.endpoint,selector:'#missing'},ctx),{code:'CONTROL_NOT_FOUND'});assert.ok(server.calls.every(r=>r.method==='Runtime.evaluate'));exception=true;await assert.rejects(runCdp('tree',{endpoint:server.endpoint},ctx),{code:'CDP_EVALUATION_FAILED'});}finally{ctx.cleanup();await server.close();}
});
test('CDP closed socket after dispatch reports unknown outcome without reconnecting',async()=>{
  const server=await fixture((req,reply,socket)=>{if(req.method==='Runtime.evaluate')reply({result:{value:{control:{name:'Open'},x:40,y:50}}});else socket.destroy();}),ctx=context();
  try{await assert.rejects(runCdp('action',{endpoint:server.endpoint,selector:'#open'},ctx),{code:'ACTION_OUTCOME_UNKNOWN'});assert.equal(server.calls.filter(r=>r.method==='Input.dispatchMouseEvent').length,1);}finally{ctx.cleanup();await server.close();}
});
