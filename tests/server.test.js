'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const https=require('node:https');const crypto=require('node:crypto');const os=require('node:os');const {Bridge}=require('../src/server');
test('HTTPS authentication, task isolation, files, cancellation, persistence',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-server-test-'));for(const f of ['tls.pfx','tls-password','helper-secret','pairing-code'])fs.copyFileSync(path.join(__dirname,'../.runtime/server',f),path.join(dir,f));
 const bridge=new Bridge({dataDir:dir});const server=await bridge.listen(0);const port=server.address().port;
 const request=(method,url,b,token,headers={})=>new Promise((resolve,reject)=>{const r=https.request({hostname:'127.0.0.1',port,path:url,method,rejectUnauthorized:false,headers:{...(token?{authorization:'Bearer '+token}:{}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const raw=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.headers,data:res.headers['content-type']?.includes('json')?JSON.parse(raw):raw});});});r.on('error',reject);r.end(Buffer.isBuffer(b)?b:b?JSON.stringify(b):undefined);});
 t.after(async()=>{await bridge.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal((await request('GET','/v1/info')).status,401);
 assert.equal((await request('POST','/v1/pair',{pairingCode:'bad'})).status,401);
 const pair=await request('POST','/v1/pair',{name:'A',pairingCode:fs.readFileSync(path.join(dir,'pairing-code'),'utf8')});assert.equal(pair.status,200);const token=pair.data.data.token;
 const b=(await request('POST','/v1/pair',{name:'B',pairingCode:fs.readFileSync(path.join(dir,'pairing-code'),'utf8')})).data.data;
 assert.equal((await request('GET','/v1/info',null,token)).data.data.protocolVersion,1);
 const task=(await request('POST','/v1/tasks',{op:'shell',args:{command:'Write-Output "中文 output"',admin:true}},token)).data.data;
 assert.equal((await request('GET','/v1/tasks/'+task.id,null,b.token)).status,404);
 let final;for(let n=0;n<100;n++){final=(await request('GET','/v1/tasks/'+task.id,null,token)).data.data;if(!['accepted','running'].includes(final.status))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(final.status,'succeeded');assert.match(final.data.stdout,/中文 output/);assert.ok(final.data.identity);
 const file=path.join(dir,'中文 file.bin'),bytes=crypto.randomBytes(1024*1024),checksum=crypto.createHash('sha256').update(bytes).digest('hex'),url='/v1/files?path='+encodeURIComponent(file);
 const pushed=await request('PUT',url,bytes,token,{'x-content-sha256':checksum});assert.equal(pushed.status,200);assert.equal(pushed.data.data.bytes,bytes.length);
 assert.equal((await request('PUT',url,bytes,token,{'x-content-sha256':checksum})).status,409);
 const pulled=await request('GET',url,null,token);assert.deepEqual(pulled.data,bytes);assert.equal(pulled.headers['x-content-sha256'],checksum);
 const bad=await request('PUT',url+'&overwrite=true',Buffer.from('bad'),token,{'x-content-sha256':checksum});assert.equal(bad.data.error.code,'CHECKSUM_MISMATCH');assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(fs.readdirSync(dir).filter(x=>x.endsWith('.part')).length,0);
 const long=(await request('POST','/v1/tasks',{op:'shell',args:{command:'Start-Sleep 20',admin:true}},token)).data.data;await new Promise(r=>setTimeout(r,400));await request('POST',`/v1/tasks/${long.id}/cancel`,{},token);
 for(let n=0;n<100;n++){final=(await request('GET','/v1/tasks/'+long.id,null,token)).data.data;if(!['accepted','running'].includes(final.status))break;await new Promise(r=>setTimeout(r,100));}assert.equal(final.status,'cancelled');
 await request('DELETE','/v1/clients/'+b.clientId,null,token);assert.equal((await request('GET','/v1/info',null,b.token)).status,401);
 assert.ok(fs.readFileSync(path.join(dir,'audit.jsonl'),'utf8').includes(task.id));
});
