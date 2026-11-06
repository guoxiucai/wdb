'use strict';
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const {argv,equal,body,send,fail}=require('./common');const {runOperation}=require('./operations');
const args=argv(),dataDir=path.resolve(args['data-dir']||path.join(__dirname,'../.runtime/server'));
const secret=fs.readFileSync(path.join(dataDir,'helper-secret'),'utf8').trim();
const server=http.createServer(async(req,res)=>{
 try{
  if(!equal(req.headers.authorization||'','Bearer '+secret))throw fail('UNAUTHORIZED','Invalid helper secret',401);
  if(req.url!=='/execute'||req.method!=='POST')throw fail('NOT_FOUND','Endpoint not found',404);
  const b=await body(req);const dir=path.resolve(b.dir||'');const base=path.join(dataDir,'tasks')+path.sep;
  if(!dir.startsWith(base))throw fail('INVALID_TASK_DIRECTORY','Task directory outside service data');
  const controller=new AbortController();const timer=setInterval(()=>{if(fs.existsSync(path.join(dir,'cancel')))controller.abort();},100);
  res.once('close',()=>{if(b.op?.startsWith('input.')&&!res.writableEnded){fs.writeFileSync(path.join(dir,'cancel'),'CONTROL_CONNECTION_LOST');controller.abort();}});
  let outputBytes=0;const maxOutput=1024*1024;
  try {const data=await runOperation(b.op,b.args||{},{id:b.taskId,dir,timeoutMs:b.timeoutMs||120000,signal:controller.signal,onOutput:(stream,text)=>{const available=maxOutput-outputBytes;if(available>0){const bytes=Buffer.from(text).subarray(0,available);fs.appendFileSync(path.join(dir,stream+'.live'),bytes);outputBytes+=bytes.length;}}},{isHelper:true});send(res,200,{ok:true,data});}finally{clearInterval(timer);}
 }catch(e){send(res,e.statusCode||500,{ok:false,error:{code:e.code||'INTERNAL_ERROR',message:e.message,details:e.details,artifacts:e.artifacts}});}
});
server.listen(Number(args.port||18767),'127.0.0.1',()=>console.log(JSON.stringify({event:'helper-ready',port:Number(args.port||18767),pid:process.pid})));
