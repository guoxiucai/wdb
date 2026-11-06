'use strict';
const http=require('node:http'),crypto=require('node:crypto');
async function fixture(handler){
  const sockets=new Set(),calls=[];let endpoint;
  const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify([{id:'page-one',type:'page',title:'Fixture',url:'file:///fixture.html',webSocketDebuggerUrl:endpoint.replace('http:','ws:')+'/devtools/page/page-one'}]));});
  server.on('upgrade',(req,socket)=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
    const send=message=>{const body=Buffer.from(JSON.stringify({jsonrpc:"2.0",...message})),head=Buffer.alloc(body.length<126?2:4);head[0]=129;if(body.length<126)head[1]=body.length;else{head[1]=126;head.writeUInt16BE(body.length,2);}socket.write(Buffer.concat([head,body]));};
    let pending=Buffer.alloc(0);socket.on('data',chunk=>{
      pending=Buffer.concat([pending,chunk]);while(pending.length>=2){const opcode=pending[0]&15;let length=pending[1]&127,offset=2;if(length===126){if(pending.length<4)return;length=pending.readUInt16BE(2);offset=4;}else if(length===127){if(pending.length<10)return;length=Number(pending.readBigUInt64BE(2));offset=10;}const masked=!!(pending[1]&128),maskBytes=masked?4:0;if(pending.length<offset+maskBytes+length)return;const mask=pending.subarray(offset,offset+maskBytes),body=Buffer.from(pending.subarray(offset+maskBytes,offset+maskBytes+length));pending=pending.subarray(offset+maskBytes+length);if(masked)for(let i=0;i<body.length;i++)body[i]^=mask[i%4];if(opcode===8){socket.end(Buffer.from([136,0]));return;}if(opcode!==1)continue;const request=JSON.parse(body);calls.push(request);handler(request,(result={})=>send({id:request.id,result}),socket,send);}
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));endpoint='http://127.0.0.1:'+server.address().port;
  return {endpoint,calls,async close(){for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

module.exports={fixture};
