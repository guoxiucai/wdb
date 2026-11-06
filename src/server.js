'use strict';
const https=require('node:https');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const os=require('node:os');const {Transform}=require('node:stream');const {pipeline}=require('node:stream/promises');
const {ROOT,argv,fail,atomic,read,sha,hashFile,equal,body,envelope,send}=require('./common');const {runOperation,executionIdentity}=require('./operations');
const {newDeviceId,normalizeDeviceId}=require('./device-id');
const VERSION='0.1.0';
class Bridge {
 constructor(options={}){
  this.dir=path.resolve(options.dataDir||path.join(__dirname,'../.runtime/server'));fs.mkdirSync(path.join(this.dir,'tasks'),{recursive:true});
  this.options=options;this.config=read(path.join(this.dir,'config.json'),{deviceId:newDeviceId(),retentionHours:24,maxArtifactBytes:10*1024**3,maxOutputBytes:1024**2,helperPort:18767});
  const deviceId=normalizeDeviceId(this.config.deviceId);if(deviceId!==this.config.deviceId){this.config.legacyDeviceId=this.config.deviceId;this.config.deviceId=deviceId;}
  if(!/^[a-f0-9]{16}$/.test(this.config.deviceId))throw fail('INVALID_DEVICE_ID','Stored device ID must be a 16-character hexadecimal ID or a legacy UUID');
  atomic(path.join(this.dir,'config.json'),this.config);
  const installation=read(path.join(this.dir,'installation.json'),{});this.config.helperPort=options.helperPort||installation.helperPort||this.config.helperPort;
  this.helperSecret=fs.readFileSync(path.join(this.dir,'helper-secret'),'utf8').trim();this.pairingCode=fs.readFileSync(path.join(this.dir,'pairing-code'),'utf8').trim();
  this.clients=read(path.join(this.dir,'clients.json'),[]);this.tasks=new Map();this.active=new Map();this.leases=new Map();this.pairAttempts=new Map();this.uploads=new Set();this.clientSockets=new Map();
  for(const f of fs.readdirSync(path.join(this.dir,'tasks'),{withFileTypes:true})){if(!f.isDirectory())continue;const t=read(path.join(this.dir,'tasks',f.name,'task.json'),null);if(!t)continue;if(['accepted','running'].includes(t.status)){if(t.op?.startsWith('input.'))fs.writeFileSync(path.join(this.dir,'tasks',f.name,'cancel'),'SERVICE_RESTARTED');t.status='unknown';t.error={code:'SERVICE_RESTARTED',message:'Service restarted; prior operation outcome cannot be confirmed'};t.endedAt=new Date().toISOString();}this.tasks.set(t.id,t);this.save(t);}
  this.timer=setInterval(()=>{for(const [id,a] of this.active){const t=this.tasks.get(id);if(t.op.startsWith('input.')&&Date.now()-(this.leases.get(t.clientId)||0)>10000)this.cancel(t,'CONTROL_CONNECTION_LOST');}this.cleanup();},1000);this.timer.unref();
 }
 save(t){t.deviceId=normalizeDeviceId(t.deviceId);atomic(path.join(this.dir,'tasks',t.id,'task.json'),t);}
 audit(event){fs.appendFileSync(path.join(this.dir,'audit.jsonl'),JSON.stringify({...event,deviceId:this.config.deviceId,time:new Date().toISOString()})+'\n');}
 persistClients(){atomic(path.join(this.dir,'clients.json'),this.clients);}
 auth(req,refreshLease=true){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const c=this.clients.find(c=>!c.revokedAt&&equal(c.tokenHash,sha(token)));if(!c)throw fail('UNAUTHORIZED','Valid paired client token required',401);if(refreshLease)this.leases.set(c.id,Date.now());let sockets=this.clientSockets.get(c.id);if(!sockets){sockets=new Set();this.clientSockets.set(c.id,sockets);}if(!sockets.has(req.socket)){sockets.add(req.socket);req.socket.once('close',()=>{sockets.delete(req.socket);if(sockets.size===0)this.clientSockets.delete(c.id);});}return c;}
 owned(id,client){const t=this.tasks.get(id);if(!t||t.clientId!==client.id)throw fail('TASK_NOT_FOUND','Task not found for this client',404);return t;}
 cancel(t,reason='CANCEL_REQUESTED'){const a=this.active.get(t.id);if(!a)return;fs.writeFileSync(path.join(a.dir,'cancel'),reason);a.controller.abort();t.cancelRequested=true;t.cancelReason=reason;this.save(t);}
 async submit(client,b){
  if(typeof b.op!=='string'||!b.op)throw fail('INVALID_ARGUMENT','Task operation required');
  let submissionHash;
  if(b.submissionId!==undefined){
   if(typeof b.submissionId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.submissionId))throw fail('INVALID_SUBMISSION_ID','submissionId must be a UUID');
   submissionHash=sha(JSON.stringify({op:b.op,args:b.args||{},timeoutMs:b.timeoutMs}));
   const existing=[...this.tasks.values()].find(t=>t.clientId===client.id&&t.submissionId===b.submissionId);
   if(existing){if(existing.submissionHash!==submissionHash)throw fail('SUBMISSION_CONFLICT','Submission ID was already used with different arguments',409);return existing;}
  }
  this.cleanup();if(this.artifactBytes()>=this.config.maxArtifactBytes)throw fail('ARTIFACT_SPACE_EXHAUSTED','Task storage quota exhausted',507);
  const defaultTimeout=b.op==='record.start'?(Number(b.args?.durationSeconds||600)*1000+30000):120000;
  const timeoutMs=Number(b.timeoutMs||b.args?.timeoutMs||defaultTimeout);if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>24*3600*1000)throw fail('INVALID_TIMEOUT','Timeout must be 1..86400000 ms');
  const id=crypto.randomUUID(),dir=path.join(this.dir,'tasks',id);fs.mkdirSync(dir);
  const t={id,taskId:id,requestId:id,deviceId:this.config.deviceId,clientId:client.id,op:b.op,status:'accepted',createdAt:new Date().toISOString(),durationMs:0,artifacts:[],error:null};
  if(b.submissionId!==undefined){t.submissionId=b.submissionId;t.submissionHash=submissionHash;}
  this.tasks.set(id,t);this.save(t);const controller=new AbortController();this.active.set(id,{controller,dir});this.leases.set(client.id,Date.now());
  setImmediate(async()=>{
   if(controller.signal.aborted){t.status='cancelled';t.endedAt=new Date().toISOString();t.error={code:'CANCELLED',message:'Cancelled before execution'};this.active.delete(id);this.save(t);return;}
   t.status='running';t.startedAt=new Date().toISOString();this.save(t);this.audit({requestId:id,clientId:client.id,op:t.op,status:'running'});
   let outputBytes=0;
   try{
    const data=await runOperation(t.op,b.args||{},{id,dir,signal:controller.signal,timeoutMs,maxOutput:this.config.maxOutputBytes,onOutput:(kind,s)=>{const available=this.config.maxOutputBytes-outputBytes;if(available>0){const buffer=Buffer.from(s).subarray(0,available);fs.appendFileSync(path.join(dir,kind+'.live'),buffer);outputBytes+=buffer.length;}}},{helperSecret:this.helperSecret,helperPort:this.config.helperPort});
    t.data=data;t.artifacts=data?.artifacts||[];t.status=data?.timedOut?'timed_out':data?.cancelled||controller.signal.aborted?'cancelled':data?.installerStatus||((data?.exitCode!=null&&data.exitCode!==0)?'failed':'succeeded');
    if(t.status==='failed')t.error={code:'PROCESS_FAILED',message:'Process exited with code '+data.exitCode};if(t.status==='timed_out')t.error={code:'TIMEOUT',message:'Operation timed out; inspect current state before retrying'};
   }catch(e){t.status=controller.signal.aborted||e.code==='CANCELLED'?'cancelled':e.code==='TIMEOUT'?'timed_out':'failed';t.error={code:e.code||'OPERATION_FAILED',message:e.message};}
   finally{t.endedAt=new Date().toISOString();t.durationMs=Date.now()-Date.parse(t.startedAt);this.active.delete(id);this.save(t);this.audit({requestId:id,clientId:client.id,op:t.op,status:t.status,error:t.error});}
  });return t;
 }
 artifactBytes(){let total=0;for(const t of this.tasks.values()){const dir=path.join(this.dir,'tasks',t.id);try{for(const f of fs.readdirSync(dir))total+=fs.statSync(path.join(dir,f)).size;}catch{}}return total;}
 cleanup(){let size=this.artifactBytes();const terminal=[...this.tasks.values()].filter(t=>!['accepted','running'].includes(t.status)).sort((a,b)=>Date.parse(a.endedAt)-Date.parse(b.endedAt));for(const t of terminal){if(Date.now()-Date.parse(t.endedAt)<this.config.retentionHours*3600*1000&&size<this.config.maxArtifactBytes)continue;const dir=path.join(this.dir,'tasks',t.id);let bytes=0;try{for(const f of fs.readdirSync(dir))bytes+=fs.statSync(path.join(dir,f)).size;fs.rmSync(dir,{recursive:true,force:true});this.tasks.delete(t.id);size-=bytes;}catch{}}}
 async route(req,res){
  const started=Date.now(),requestId=crypto.randomUUID();let client;
  const respond=(data,status='succeeded',http=200)=>send(res,http,envelope(this.config.deviceId,data,status,null,requestId,started));
  try{
   const u=new URL(req.url,'https://localhost');
   if(u.pathname==='/v1/pair'&&req.method==='POST'){
    const ip=req.socket.remoteAddress,attempt=this.pairAttempts.get(ip)||{count:0,until:Date.now()+60000};if(Date.now()>attempt.until){attempt.count=0;attempt.until=Date.now()+60000;}attempt.count++;this.pairAttempts.set(ip,attempt);if(attempt.count>10)throw fail('RATE_LIMITED','Pairing attempt limit reached; retry after one minute',429);
    const b=await body(req);if(!equal(b.pairingCode||'',this.pairingCode))throw fail('PAIRING_DENIED','Invalid device pairing code',401);
    const token=crypto.randomBytes(32).toString('base64url');const c={id:crypto.randomUUID(),name:String(b.name||'wdb client').slice(0,120),tokenHash:sha(token),createdAt:new Date().toISOString()};this.clients.push(c);this.persistClients();this.audit({requestId,clientId:c.id,op:'pair',status:'succeeded'});return respond({clientId:c.id,token,deviceId:this.config.deviceId,version:VERSION});
   }
   client=this.auth(req,u.pathname!=='/v1/health');
   if(u.pathname==='/v1/health'&&req.method==='GET')return respond({version:VERSION,protocolVersion:1,deviceId:this.config.deviceId,hostname:os.hostname(),serverProcessId:process.pid,taskSubmissionDeduplication:true});
   if(u.pathname==='/v1/info'&&req.method==='GET'){
    const dir=path.join(this.dir,'tasks','.status');fs.mkdirSync(dir,{recursive:true});let desktop;
    try{desktop=await runOperation('desktop.status',{}, {id:'status',dir,timeoutMs:5000},{helperSecret:this.helperSecret,helperPort:this.config.helperPort});}catch(e){desktop={available:false,error:{code:e.code,message:e.message}};}
    const recording=[path.join(ROOT,'runtime','ffmpeg.exe'),path.join(ROOT,'.runtime','ffmpeg','ffmpeg.exe'),path.join(ROOT,'dist','wdb-windows-x64','runtime','ffmpeg.exe')].some(f=>fs.existsSync(f));
    const execution=await executionIdentity();
    return respond({version:VERSION,protocolVersion:1,deviceId:this.config.deviceId,hostname:os.hostname(),platform:process.platform,architecture:process.arch,serverProcessId:process.pid,execution,capabilities:['shell','files','tasks','screens','screenshot','windows','ui','input','touch','logs',...(execution.isElevated?['apps']:[]),...(recording?['record']:[])],desktop,recordingAvailable:recording,helperPort:this.config.helperPort,retentionHours:this.config.retentionHours,maxArtifactBytes:this.config.maxArtifactBytes});
   }
   if(u.pathname==='/v1/heartbeat'&&req.method==='POST')return respond({connected:true});
   if(u.pathname==='/v1/connection'&&req.method==='DELETE'){this.leases.delete(client.id);for(const t of this.tasks.values())if(t.clientId===client.id&&t.op.startsWith('input.'))this.cancel(t,'DISCONNECTED');return respond({disconnected:true,credentialsRetained:true});}
   if(u.pathname==='/v1/clients'&&req.method==='GET')return respond({clients:this.clients.map(({tokenHash,...c})=>c)});
   if(u.pathname.startsWith('/v1/clients/')&&req.method==='DELETE'){const id=decodeURIComponent(u.pathname.split('/').pop()),c=this.clients.find(c=>c.id===id);if(!c)throw fail('CLIENT_NOT_FOUND','Client not found',404);c.revokedAt=new Date().toISOString();this.persistClients();this.leases.delete(id);for(const t of this.tasks.values())if(t.clientId===id)this.cancel(t,'AUTHORIZATION_REVOKED');for(const socket of this.clientSockets.get(id)||[])if(socket!==req.socket)socket.destroy();return respond({revoked:id});}
   if(u.pathname==='/v1/tasks'&&req.method==='POST')return respond(await this.submit(client,await body(req)),'accepted',202);
   if(u.pathname==='/v1/tasks'&&req.method==='GET')return respond({tasks:[...this.tasks.values()].filter(t=>t.clientId===client.id)});
   const match=/^\/v1\/tasks\/([^/]+)(?:\/(cancel|output))?$/.exec(u.pathname);
   if(match){const t=this.owned(match[1],client);if(match[2]==='cancel'&&req.method==='POST'){this.cancel(t);return respond(t);}if(match[2]==='output'){const dir=path.join(this.dir,'tasks',t.id);return respond({stdout:fs.existsSync(path.join(dir,'stdout.live'))?fs.readFileSync(path.join(dir,'stdout.live'),'utf8'):'',stderr:fs.existsSync(path.join(dir,'stderr.live'))?fs.readFileSync(path.join(dir,'stderr.live'),'utf8'):''});}if(req.method==='GET')return respond(t);if(req.method==='DELETE'){if(this.active.has(t.id))throw fail('TASK_ACTIVE','Cancel and wait for task completion before deleting',409);fs.rmSync(path.join(this.dir,'tasks',t.id),{recursive:true,force:true});this.tasks.delete(t.id);return respond({deleted:t.id});}}
   if(u.pathname==='/v1/directories'){
    if(req.method==='POST'){const b=await body(req);if(typeof b.path!=='string'||!path.isAbsolute(b.path))throw fail('INVALID_PATH','Absolute directory path required');await fs.promises.mkdir(b.path,{recursive:true});return respond({path:b.path});}
    if(req.method==='GET'){const p=this.filePath(u);const entries=await fs.promises.readdir(p,{withFileTypes:true});return respond({path:p,entries:await Promise.all(entries.filter(e=>!e.isSymbolicLink()).map(async e=>({name:e.name,type:e.isDirectory()?'directory':'file',size:(await fs.promises.stat(path.join(p,e.name))).size}))) });}
   }
   if(u.pathname==='/v1/files'){
    const p=this.filePath(u);if(req.method==='PUT')return await this.upload(req,res,p,u,respond,client,requestId);
    if(req.method==='GET'){const st=await fs.promises.stat(p);if(!st.isFile())throw fail('NOT_A_FILE','Use directories endpoint for directories');const checksum=await hashFile(p);res.writeHead(200,{'content-type':'application/octet-stream','content-length':st.size,'x-content-sha256':checksum});await pipeline(fs.createReadStream(p),res);this.audit({requestId,clientId:client.id,op:'pull',status:'succeeded',bytes:st.size,durationMs:Date.now()-started});return;}
   }
   throw fail('NOT_FOUND','Unknown API route',404);
  }catch(e){if(res.headersSent){res.destroy(e);return;}send(res,e.statusCode||500,envelope(this.config.deviceId,null,'failed',{code:e.code||'INTERNAL_ERROR',message:e.message},requestId,started));}
 }
 filePath(u){const p=u.searchParams.get('path');if(!p||!path.isAbsolute(p))throw fail('INVALID_PATH','Absolute file path required');return path.resolve(p);}
 async upload(req,res,p,u,respond,client,requestId){
  const checksum=req.headers['x-content-sha256'];if(!/^[a-f0-9]{64}$/i.test(checksum||''))throw fail('CHECKSUM_REQUIRED','x-content-sha256 header required');
  if(this.uploads.has(p.toLowerCase()))throw fail('TRANSFER_IN_PROGRESS','Another upload targets the same path',409);
  const overwrite=u.searchParams.get('overwrite')==='true';if(!overwrite&&fs.existsSync(p))throw fail('TARGET_EXISTS','Destination exists; explicit overwrite required',409);
  this.uploads.add(p.toLowerCase());const temp=path.join(path.dirname(p),'.wdb-'+crypto.randomUUID()+'.part');const start=Date.now();let bytes=0;
  try{await fs.promises.mkdir(path.dirname(p),{recursive:true});const h=crypto.createHash('sha256');await pipeline(req,new Transform({transform(c,e,cb){h.update(c);bytes+=c.length;cb(null,c);}}),fs.createWriteStream(temp,{flags:'wx'}));const actual=h.digest('hex');if(actual.toLowerCase()!==checksum.toLowerCase())throw fail('CHECKSUM_MISMATCH','Upload checksum mismatch');
   if(overwrite)await fs.promises.rename(temp,p);else{await fs.promises.link(temp,p);await fs.promises.unlink(temp);}this.audit({requestId,clientId:client.id,op:'push',status:'succeeded',bytes,durationMs:Date.now()-start});return respond({path:p,bytes,sha256:actual,durationMs:Date.now()-start});
  }finally{await fs.promises.rm(temp,{force:true}).catch(()=>{});this.uploads.delete(p.toLowerCase());}
 }
 listen(port=18766,host='127.0.0.1'){
  const server=https.createServer({pfx:fs.readFileSync(path.join(this.dir,'tls.pfx')),passphrase:fs.readFileSync(path.join(this.dir,'tls-password'),'utf8'),minVersion:'TLSv1.2'},(req,res)=>this.route(req,res));server.requestTimeout=0;server.headersTimeout=30000;this.server=server;return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>resolve(server));});
 }
 close(){clearInterval(this.timer);return new Promise(r=>{this.server?.close(r);this.server?.closeAllConnections();if(!this.server)r();});}
}
if(require.main===module){const a=argv();const bridge=new Bridge({dataDir:a['data-dir'],helperPort:a['helper-port']});bridge.listen(Number(a.port||18766),a.host||'127.0.0.1').then(()=>console.log(JSON.stringify({event:'server-ready',port:Number(a.port||18766),deviceId:bridge.config.deviceId,pid:process.pid}))).catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={Bridge};
