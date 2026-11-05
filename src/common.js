'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
function argv(args = process.argv.slice(2)) { const out = {}; for (let i=0;i<args.length;i++) if(args[i].startsWith('--')) out[args[i].slice(2)] = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : true; return out; }
function fail(code, message, statusCode = 400) { return Object.assign(new Error(message), {code,statusCode}); }
function atomic(file, value) { fs.mkdirSync(path.dirname(file), {recursive:true}); const temp=file+'.'+crypto.randomUUID()+'.tmp'; fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600}); fs.renameSync(temp,file); }
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')); } catch(e) { if(e.code==='ENOENT') return fallback; throw e; } }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
async function hashFile(file) { const h=crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) h.update(chunk); return h.digest('hex'); }
function equal(a,b) { const x=Buffer.from(String(a)),y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); }
function powershell(script, options={}) {
  return execute(process.env.SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; '+script,'utf16le').toString('base64')], options);
}
function execute(exe,args,options={}) { return new Promise((resolve,reject)=>{
  const started=Date.now(); let stdout='',stderr='',truncated=false,timedOut=false,cancelled=false;
  const child=spawn(exe,args,{windowsHide:true,cwd:options.cwd,env:{...process.env,...options.env},stdio:['pipe','pipe','pipe']});
  const max=options.maxOutput || 1024*1024;
  const add=(kind,chunk)=> { const s=chunk.toString('utf8'); options.onOutput?.(kind,s); if(kind==='stdout'){ if(Buffer.byteLength(stdout)+Buffer.byteLength(s)<=max)stdout+=s; else truncated=true;} else {if(Buffer.byteLength(stderr)+Buffer.byteLength(s)<=max)stderr+=s;else truncated=true;} };
  child.stdout.on('data',x=>add('stdout',x));child.stderr.on('data',x=>add('stderr',x));
  const kill=()=>{ if(process.platform==='win32') spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL'); };
  const timer=setTimeout(()=>{timedOut=true;kill();},options.timeoutMs || 120000);
  const abort=()=>{cancelled=true;kill();}; options.signal?.addEventListener('abort',abort,{once:true});
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('close',code=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);resolve({stdout,stderr,exitCode:code,durationMs:Date.now()-started,truncated,timedOut,cancelled,pid:child.pid});});
  if(options.stdin) child.stdin.end(options.stdin); else if(!options.keepStdin) child.stdin.end();
  options.onSpawn?.(child);
}); }
async function body(req,limit=8*1024*1024) { let n=0; const chunks=[];for await(const c of req){n+=c.length;if(n>limit)throw fail('REQUEST_TOO_LARGE','Request exceeds limit',413);chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw fail('INVALID_JSON','Request must be valid JSON');} }
function envelope(deviceId,data,status='succeeded',error=null,requestId=crypto.randomUUID(),started=Date.now()) { return {requestId,deviceId,status,error,durationMs:Date.now()-started,data,artifacts:data?.artifacts||[]}; }
function send(res,status,data) { if(res.destroyed)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data)); }
module.exports={ROOT,argv,fail,atomic,read,sha,hashFile,equal,powershell,execute,body,envelope,send};
