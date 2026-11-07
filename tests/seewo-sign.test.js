'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const {signFiles,serviceUrl}=require('../scripts/seewo-sign');
function pe(){const b=Buffer.alloc(1024);b.write('MZ');b.writeUInt32LE(64,60);b.write('PE\0\0',64);b.writeUInt16LE(0x20b,88);b[500]=42;return b;}
function signed(b){if(b.toString('ascii',0,2)!=='MZ')return Buffer.concat([b,Buffer.from('\n# SIG # Begin signature block\n# fixture only\n# SIG # End signature block\n')]);const r=Buffer.concat([b,Buffer.alloc(16)]);r.writeUInt32LE(b.length,232);r.writeUInt32LE(16,236);return r;}
async function setup(t,mode='normal'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-sign-'));let uploads=0,download,filename,downloads=0;const names=[];
 const server=http.createServer(async(req,res)=>{if(req.method==='POST'){
  uploads++;const chunks=[];for await(const b of req)chunks.push(b);const body=Buffer.concat(chunks),text=body.toString('latin1');assert.match(text,/name="customer"\r\n\r\nSEEWO/);
  const match=/name="file"; filename="([^"]+)"[^]*?\r\n\r\n/.exec(text);filename=match[1];names.push(filename);const start=match.index+match[0].length;const b=body.subarray(start,body.lastIndexOf(Buffer.from('\r\n--')));download=signed(b);if(mode==='changed')download[500]=43;if(mode==='unsigned')download=b;
  const md5=crypto.createHash('md5').update(b).digest('hex');assert.ok(text.includes(md5));
  if(mode==='failure'){res.writeHead(503);res.end('Unavailable');return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({md5,trackId:'fixture-track',downloadUrl:mode==='foreign'?'https://example.invalid/download':'/download?file=fixture'}));
 }else if(req.url.startsWith('/download')){downloads++;if(mode==='download-failure'&&downloads===1){res.destroy();return;}res.end(download);}else{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,names,endpoint:`http://127.0.0.1:${server.address().port}/`,get uploads(){return uploads;},get filename(){return filename;}};
}
function options(f,files){return {root:f.dir,files,reportFile:path.join(f.dir,'sign.json'),endpoint:f.endpoint,source:'WDB signing fixture',allowLocalHttp:true};}
test('SEEWO multipart signing preserves content, restores e32 filename and skips completed uploads',async t=>{
 const f=await setup(t);fs.writeFileSync(path.join(f.dir,'cache.e32'),pe());fs.writeFileSync(path.join(f.dir,'run.ps1'),'Write-Output "fixture"\r\n');
 const opts=options(f,['cache.e32','run.ps1']);const result=await signFiles(opts);assert.equal(result.files.length,2);assert.equal(f.uploads,2);assert.equal(fs.existsSync(path.join(f.dir,'cache.e32')),true);assert.equal(fs.existsSync(path.join(f.dir,'cache.exe')),false);
 assert.deepEqual(f.names,['cache.exe','run.ps1']);
 assert.ok(result.files.every(j=>j.status==='complete'&&j.beforeSha256!==j.afterSha256&&!j.downloadUrl));
 await signFiles(opts);assert.equal(f.uploads,2);fs.appendFileSync(path.join(f.dir,'run.ps1'),'changed');await assert.rejects(signFiles(opts),/changed/);
});
test('download failures resume by GET without replaying the signing POST',async t=>{
 const f=await setup(t,'download-failure');fs.writeFileSync(path.join(f.dir,'program.exe'),pe());const opts=options(f,['program.exe']);await assert.rejects(signFiles(opts));assert.equal(f.uploads,1);await signFiles(opts);assert.equal(f.uploads,1);
});
test('unsigned downloads and executable text after PowerShell signature markers are rejected',async t=>{
 const f=await setup(t,'unsigned');fs.writeFileSync(path.join(f.dir,'program.exe'),pe());await assert.rejects(signFiles(options(f,['program.exe'])),/certificate table/);
 const {sameContent}=require('../scripts/signature-content');const a=path.join(f.dir,'a.ps1'),b=path.join(f.dir,'b.ps1');fs.writeFileSync(a,'Write-Output "fixture"\n');fs.writeFileSync(b,fs.readFileSync(a)+'# SIG # Begin signature block\n# data\n# SIG # End signature block\nWrite-Output "injected"');assert.throws(()=>sameContent(a,b),/trailing executable/);
});
test('downloaded executable changes are rejected without replacing the original',async t=>{
 const f=await setup(t,'changed'),file=path.join(f.dir,'program.exe');fs.writeFileSync(file,pe());await assert.rejects(signFiles(options(f,['program.exe'])),/content differs/);assert.deepEqual(fs.readFileSync(file),pe());assert.equal(fs.readdirSync(f.dir).some(n=>n.startsWith('.wdb-sign')),false);
});
test('uncertain upload is not automatically replayed on resume',async t=>{
 const f=await setup(t,'failure');fs.writeFileSync(path.join(f.dir,'program.exe'),pe());const opts=options(f,['program.exe']);await assert.rejects(signFiles(opts),/503/);await assert.rejects(signFiles(opts),/outcome unknown/);assert.equal(f.uploads,1);
});
test('foreign download origins, upstream Node and unsafe endpoints are rejected',async t=>{
 const f=await setup(t,'foreign');fs.writeFileSync(path.join(f.dir,'program.exe'),pe());await assert.rejects(signFiles(options(f,['program.exe'])),/outside approved service/);
 fs.writeFileSync(path.join(f.dir,'node.exe'),pe());await assert.rejects(signFiles({...options(f,['node.exe']),reportFile:path.join(f.dir,'other.json')}),/outside WDB signing scope/);
 assert.throws(()=>serviceUrl('http://example.com/'),/HTTPS/);assert.throws(()=>serviceUrl('https://user:password@example.com/'),/credentials/);
});
