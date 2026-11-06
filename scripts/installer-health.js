'use strict';
// Private installation diagnostic: validate local TLS identity and authenticated
// helper availability without creating a client or granting remote authorization.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),https=require('node:https');
const {runOperation}=require('../src/operations');
const [dataDir,port,helperPort]=process.argv.slice(2);
(async()=>{
 const expected=fs.readFileSync(path.join(dataDir,'fingerprint'),'utf8').trim().toLowerCase();
 await new Promise((resolve,reject)=>{
  const req=https.request({host:'127.0.0.1',port:Number(port),path:'/v1/health',rejectUnauthorized:false,agent:false},res=>{res.resume();res.on('end',()=>res.statusCode===401?resolve():reject(Error('Expected protected health HTTP 401, got '+res.statusCode)));});
  req.on('error',reject);req.setTimeout(4000,()=>req.destroy(Error('HTTPS startup timeout')));
  req.on('socket',socket=>socket.once('secureConnect',()=>{const actual=crypto.createHash('sha256').update(socket.getPeerCertificate().raw).digest('hex');if(actual!==expected)req.destroy(Error('Installed TLS identity mismatch'));else req.end();}));
 });
 const dir=path.join(dataDir,'tasks','.installer-status');fs.mkdirSync(dir,{recursive:true});let desktop;
 try{desktop=await runOperation('desktop.status',{}, {id:'installer-status',dir,timeoutMs:5000},{helperSecret:fs.readFileSync(path.join(dataDir,'helper-secret'),'utf8').trim(),helperPort:Number(helperPort)});}catch(e){desktop={available:false,error:{code:e.code,message:e.message}};}
 console.log(JSON.stringify({status:'ready',https:'pinned-authentication-required',version:require('../package.json').version,node:process.execPath,nodeVersion:process.version,desktop}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
