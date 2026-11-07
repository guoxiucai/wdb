'use strict';
// The service's MD5 field identifies the unsigned upload; local integrity uses SHA-256.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),https=require('node:https'),http=require('node:http');
const {Readable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {sameContent}=require('./signature-content');
const DEFAULT_ENDPOINT='https://mhci-sign.gz.cvte.cn/';
async function digest(file,algorithm='sha256'){const hash=crypto.createHash(algorithm);for await(const part of fs.createReadStream(file))hash.update(part);return hash.digest('hex');}
function serviceUrl(value,allowLocalHttp=false){const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Signing endpoint must be an origin without credentials');if(url.protocol!=='https:'&&!(allowLocalHttp&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Signing requires HTTPS');return url;}
async function request(url,options,body,timeoutMs){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 const req=(url.protocol==='https:'?https:http).request(url,{...options,signal:controller.signal});
 const response=new Promise((resolve,reject)=>{req.once('response',res=>{res.once('end',()=>clearTimeout(timer));res.once('close',()=>clearTimeout(timer));resolve(res);});req.once('error',reject);});
 try{const results=await Promise.all([response,body?pipeline(body,req):Promise.resolve(req.end())]);return results[0];}
 catch(e){clearTimeout(timer);req.destroy();body?.destroy();throw e;}
}
async function readJson(response){let size=0;const chunks=[];for await(const b of response){size+=b.length;if(size>1024*1024){response.destroy();throw Error('Signing response exceeds 1 MiB');}chunks.push(b);}if(response.statusCode<200||response.statusCode>=300)throw Error(`Signing service HTTP ${response.statusCode}`);try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Signing service returned invalid JSON');}}
function assertSigned(file){
 const bytes=fs.readFileSync(file);
 if(/\.ps[1m]1?$/i.test(file)){const text=bytes.toString('utf8');if(!text.includes('# SIG # Begin signature block')||!text.includes('# SIG # End signature block'))throw Error('Downloaded PowerShell signature block is missing');return;}
 if(bytes.length<128||bytes.toString('ascii',0,2)!=='MZ')throw Error('Downloaded PE header is invalid');
 const pe=bytes.readUInt32LE(60),opt=pe+24;if(opt+160>bytes.length||bytes.toString('ascii',pe,pe+4)!=='PE\0\0')throw Error('Downloaded PE header is invalid');
 const entry=opt+(bytes.readUInt16LE(opt)===0x20b?112:96)+32,offset=bytes.readUInt32LE(entry),length=bytes.readUInt32LE(entry+4);
 if(!offset||length<8||offset+length!==bytes.length)throw Error('Downloaded PE certificate table is missing or invalid');
}
async function save(file,value){await fsp.mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp';await fsp.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await fsp.rename(temp,file);}
async function signFiles({root,files,reportFile,endpoint=DEFAULT_ENDPOINT,customer='SEEWO',source,timeoutMs=300000,allowLocalHttp=false,onSigned=()=>{}}){
 const base=serviceUrl(endpoint,allowLocalHttp);if(customer!=='SEEWO')throw Error('This integration requires customer SEEWO');if(!source||source.length>1024)throw Error('A bounded signing source is required');
 root=await fsp.realpath(root);reportFile=path.resolve(reportFile);let report;
 try{report=JSON.parse(await fsp.readFile(reportFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;report={schema:1,endpoint:base.origin,customer,source,files:[]};}
 if(report.endpoint!==base.origin||report.customer!==customer||report.source!==source)throw Error('Signing report belongs to different signing parameters');
 for(const input of files){
  const file=path.resolve(root,input),real=await fsp.realpath(file),relative=path.relative(root,file);
  if(!real.startsWith(root+path.sep)||!file.startsWith(root+path.sep)||fs.lstatSync(file).isSymbolicLink())throw Error('Signing file escapes build directory');
  if(!/\.(exe|dll|ps1|psm1|e32|e64)$/i.test(file)||path.basename(file).toLowerCase()==='node.exe')throw Error('File is outside WDB signing scope');
  const stat=await fsp.stat(file);if(!stat.isFile()||stat.size>3*1024**3)throw Error('Signing input exceeds service size limit');
  const before=await digest(file);let job=report.files.find(j=>j.path===relative);
  if(job?.status==='complete'){if(before!==job.afterSha256)throw Error('Previously signed file changed');onSigned({...job,skipped:true});continue;}
  if(job&&job.beforeSha256!==before)throw Error('Unfinished signing input changed');
  if(job&&!job.downloadUrl)throw Error(`Signing outcome unknown for ${relative}; review service logs before resubmitting with a new BuildId`);
  if(!job){
   const md5=await digest(file,'md5');job={path:relative,beforeSha256:before,md5,status:'uploading'};report.files.push(job);await save(reportFile,report);
   const uploadName=path.basename(file).replace(/\.e(?:32|64)$/i,'.exe');if(/[\r\n"\\]/.test(uploadName))throw Error('Unsafe multipart filename');
   const boundary='wdb-'+crypto.randomBytes(20).toString('hex'),parts=[];
   for(const [name,value] of Object.entries({name:uploadName,md5,customer,from:source}))parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
   parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${uploadName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
   const tail=Buffer.from(`\r\n--${boundary}--\r\n`),length=parts.reduce((n,b)=>n+b.length,0)+stat.size+tail.length;
   const body=Readable.from((async function*(){yield* parts;yield* fs.createReadStream(file);yield tail;})());
   const result=await readJson(await request(new URL('/uploadAndSign',base),{method:'POST',headers:{'content-type':'multipart/form-data; boundary='+boundary,'content-length':length}},body,timeoutMs));
   if(result.md5!==md5||typeof result.downloadUrl!=='string'||typeof result.trackId!=='string')throw Error('Signing response does not match unsigned upload');
   const download=new URL(result.downloadUrl,base);if(download.origin!==base.origin||download.pathname!=='/download'||download.username||download.password)throw Error('Signing download is outside approved service origin');
   Object.assign(job,{status:'download-pending',trackId:result.trackId,downloadUrl:download.href});await save(reportFile,report);
  }
  const download=new URL(job.downloadUrl);if(download.origin!==base.origin||download.pathname!=='/download')throw Error('Stored download is outside approved service origin');
  const temp=path.join(path.dirname(file),'.wdb-sign-'+crypto.randomUUID()+path.extname(file));
  try{
   const response=await request(download,{method:'GET'},null,timeoutMs);if(response.statusCode!==200){response.resume();throw Error(`Signing download HTTP ${response.statusCode}`);}
   let bytes=0;async function* bounded(){for await(const chunk of response){bytes+=chunk.length;if(bytes>stat.size+4*1024*1024)throw Error('Signing download exceeds signature size limit');yield chunk;}}
   await pipeline(Readable.from(bounded()),fs.createWriteStream(temp,{flags:'wx',mode:0o600}));
   if(await digest(file)!==before)throw Error('Input changed during signing');sameContent(file,temp);assertSigned(temp);
   job.afterSha256=await digest(temp);await fsp.rename(temp,file);job.status='complete';delete job.downloadUrl;await save(reportFile,report);onSigned({...job,skipped:false});
  }finally{await fsp.rm(temp,{force:true});}
 }
 return report;
}
if(require.main===module){
 const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
 (async()=>{const list=JSON.parse((await fsp.readFile(args.manifest,'utf8')).replace(/^\uFEFF/,''));const files=(Array.isArray(list)?list:list.files).map(f=>typeof f==='string'?f:f.path);await signFiles({root:args.root,files,reportFile:args.report,endpoint:args.endpoint||DEFAULT_ENDPOINT,source:args.source,timeoutMs:args.timeout?Number(args.timeout):300000,onSigned:j=>console.log(JSON.stringify({event:j.skipped?'already-signed':'signed',path:j.path,trackId:j.trackId,sha256:j.afterSha256}))});})().catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={signFiles,serviceUrl,assertSigned};
