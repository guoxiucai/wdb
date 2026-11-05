'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {ROOT,fail,powershell,execute,read}=require('./common');
function psQuote(s){return "'"+String(s).replaceAll("'","''")+"'";}
async function native(op,args,ctx){
  const request=path.join(ctx.dir,'native-request.json');fs.writeFileSync(request,JSON.stringify({op,args:{...args,cancelFile:path.join(ctx.dir,'cancel')}}));
  const abort=()=>fs.writeFileSync(path.join(ctx.dir,'cancel'),'cancel');ctx.signal?.addEventListener('abort',abort,{once:true});
  try {
    const r=await execute(process.env.SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'native','desktop.ps1'),'-RequestFile',request],{timeoutMs:ctx.timeoutMs+5000});
    let result;try{result=JSON.parse(r.stdout.replace(/^\uFEFF/,''));}catch{throw fail('NATIVE_ERROR',r.stderr||r.stdout||'Native bridge produced no JSON');}
    if(!result.ok)throw fail(result.error?.code||'NATIVE_ERROR',result.error?.message||'Native operation failed');return result.data;
  } finally {ctx.signal?.removeEventListener('abort',abort);}
}
async function helperRequest(op,args,ctx,config){
 return new Promise((resolve,reject)=>{
   const req=http.request({host:'127.0.0.1',port:config.helperPort||18767,path:'/execute',method:'POST',headers:{authorization:'Bearer '+config.helperSecret,'content-type':'application/json'}},res=>{
     let raw='';res.on('data',c=>{raw+=c;if(raw.length>16*1024*1024)res.destroy();});res.on('end',()=>{try{const r=JSON.parse(raw);if(!r.ok)throw fail(r.error.code,r.error.message);resolve(r.data);}catch(e){reject(e);}});
   });
   req.on('error',e=>reject(fail('DESKTOP_HELPER_UNAVAILABLE',e.message)));req.setTimeout(ctx.timeoutMs+15000,()=>req.destroy(new Error('Desktop helper timeout')));
   req.end(JSON.stringify({op,args,taskId:ctx.id,dir:ctx.dir,timeoutMs:ctx.timeoutMs}));
 });
}
async function shell(args,ctx){
 if(typeof args.command!=='string')throw fail('INVALID_ARGUMENT','shell requires command');
 const identity=await powershell('[Security.Principal.WindowsIdentity]::GetCurrent().Name',{timeoutMs:10000});
 const result=await powershell(args.command,{cwd:args.cwd,env:args.env,timeoutMs:ctx.timeoutMs,signal:ctx.signal,onOutput:ctx.onOutput,maxOutput:ctx.maxOutput});
 return {...result,identity:identity.stdout.trim(),requestedIdentity:args.admin?'administrator':'logged-in-user'};
}
async function installedApps(){
 const r=await powershell("$keys=@('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object DisplayName | ForEach-Object { [ordered]@{id=$_.PSPath;name=$_.DisplayName;version=$_.DisplayVersion;publisher=$_.Publisher;installLocation=$_.InstallLocation;uninstallString=$_.UninstallString;quietUninstallString=$_.QuietUninstallString} }) | ConvertTo-Json -Depth 5 -Compress");
 if(r.exitCode!==0)throw fail('APPS_QUERY_FAILED',r.stderr);return {apps:JSON.parse(r.stdout||'[]')};
}
async function install(op,args,ctx){
 let file=args.path,params=args.arguments;
 if(op==='apps.uninstall'){
   if(!args.id)throw fail('APPLICATION_ID_REQUIRED','Exact installed application registry id is required');
   const apps=(await installedApps()).apps;const app=apps.find(a=>a.id===args.id);if(!app)throw fail('APPLICATION_NOT_FOUND','Exact application id not found');
   if(!file || !Array.isArray(params))throw fail('EXPLICIT_UNINSTALL_REQUIRED','Supply exact executable path and argument array; stored uninstall strings are never guessed or executed');
 }
 if(!file || !fs.existsSync(file))throw fail('FILE_NOT_FOUND','Installer executable not found');
 if(!Array.isArray(params))throw fail('SILENT_ARGUMENTS_REQUIRED','Explicit silent argument array required (may be empty only if known supported)');
 let exe=file,argv=params;
 if(path.extname(file).toLowerCase()==='.msi'){exe='msiexec.exe';argv=[op==='apps.uninstall'?'/x':'/i',file,'/qn','/norestart',...params];}
 const result=await execute(exe,argv,{cwd:args.cwd,timeoutMs:ctx.timeoutMs,signal:ctx.signal});
 return {...result,installerStatus:result.timedOut?'needs_manual_intervention':result.exitCode===0?'succeeded':[1641,3010].includes(result.exitCode)?'reboot_required':'failed',rebootRequested:false};
}
async function logFile(args){
 if(!args.path)throw fail('INVALID_ARGUMENT','log path required');
 const st=await fs.promises.stat(args.path);const limit=Math.min(Math.max(Number(args.limitBytes)||65536,2),4*1024*1024);
 const start=Math.max(0,st.size-limit);const handle=await fs.promises.open(args.path,'r');let bytes;
 try{bytes=Buffer.alloc(st.size-start);await handle.read(bytes,0,bytes.length,start);}finally{await handle.close();}
 let encoding=args.encoding||'utf8';if(start===0&&bytes[0]===255&&bytes[1]===254)encoding='utf16le';if(!['utf8','utf16le'].includes(encoding))throw fail('INVALID_ENCODING','Supported encodings: utf8, utf16le');
 const text=bytes.toString(encoding).replace(/^\uFEFF/,'');const lines=args.lines?text.split(/\r?\n/).slice(-Number(args.lines)).join('\n'):text;
 return {path:args.path,text:lines,size:st.size,offset:start,encoding,modifiedAt:st.mtime.toISOString(),fileId:st.ino};
}
async function eventLogs(args){
 const log=args.log||'Application';if(!['Application','System','Security'].includes(log))throw fail('INVALID_LOG','Supported logs: Application, System, Security');
 const limit=Math.min(Math.max(Number(args.limit)||100,1),1000),offset=Math.max(0,Number(args.offset)||0);if(offset>10000)throw fail('INVALID_OFFSET','Maximum event offset is 10000');
 let filter='@{LogName='+psQuote(log);if(args.startTime)filter+=';StartTime=[datetime]'+psQuote(args.startTime);if(args.endTime)filter+=';EndTime=[datetime]'+psQuote(args.endTime);if(args.source)filter+=';ProviderName='+psQuote(args.source);if(args.level)filter+=';Level='+Number(args.level);if(args.eventId)filter+=';Id='+Number(args.eventId);filter+='}';
 const script='$ErrorActionPreference="Stop"; try { @(Get-WinEvent -FilterHashtable '+filter+' -MaxEvents '+(limit+offset)+' | Select-Object -Skip '+offset+' -First '+limit+' | Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,RecordId,Message) | ConvertTo-Json -Depth 5 -Compress } catch { if ($_.FullyQualifiedErrorId -like "NoMatchingEventsFound*") { "[]" } else { throw } }';
 const r=await powershell(script,{timeoutMs:30000});if(r.exitCode!==0)throw fail('EVENT_LOG_FAILED',r.stderr);let entries=JSON.parse(r.stdout||'[]');if(args.keyword)entries=entries.filter(e=>e.Message?.includes(args.keyword));return {entries,nextOffset:entries.length===limit?offset+limit:null};
}
const recordings=new Map();
async function record(op,args,ctx){
 if(op==='record.stop'){
   const entry=recordings.get(args.id);if(!entry)throw fail('RECORDING_NOT_FOUND','Recording id is absent or process restarted');
   entry.child.stdin.write('q\n');await entry.done;return entry.result;
 }
 const ffmpeg=[path.join(ROOT,'runtime','ffmpeg.exe'),path.join(ROOT,'dist','wdb-windows-x64','runtime','ffmpeg.exe')].find(f=>fs.existsSync(f));if(!ffmpeg)throw fail('CAPABILITY_UNAVAILABLE','Bundled ffmpeg is not installed');
 const duration=Number(args.durationSeconds||600);if(!(duration>0&&duration<=3600))throw fail('INVALID_DURATION','Recording duration must be 1..3600 seconds');
 const screens=await native('screens',{},ctx);const list=Array.isArray(screens)?screens:screens.screens||screens.monitors;const monitor=list?.[Number(args.monitor||0)];if(!monitor)throw fail('MONITOR_NOT_FOUND','Monitor unavailable');
 const bounds=monitor.bounds||monitor;const target=path.join(ctx.dir,'recording.mp4');const id=ctx.id;
 const cmd=['-y','-f','gdigrab','-framerate',String(args.fps||30),'-offset_x',String(bounds.x??bounds.left??0),'-offset_y',String(bounds.y??bounds.top??0),'-video_size',`${bounds.width}x${bounds.height}`,'-i','desktop','-t',String(duration),'-vf','scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-an','-movflags','+faststart',target];
 const entry={};let resolveDone;entry.done=new Promise(r=>resolveDone=r);recordings.set(id,entry);
 const child=spawn(ffmpeg,cmd,{windowsHide:true,stdio:['pipe','ignore','pipe']});entry.child=child;let stderr='';child.stderr.on('data',c=>{stderr=(stderr+c).slice(-65536);});
 const started=Date.now();const timer=setTimeout(()=>child.stdin.write('q\n'),(duration+10)*1000);const abort=()=>child.stdin.write('q\n');ctx.signal?.addEventListener('abort',abort);
 return await new Promise((resolve,reject)=>{child.on('error',e=>{clearTimeout(timer);reject(e);resolveDone();});child.on('close',code=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);entry.result={id,path:target,exitCode:code,durationMs:Date.now()-started,stderr,artifacts:fs.existsSync(target)?[{path:target,type:'video/mp4',size:fs.statSync(target).size}]:[]};resolveDone();recordings.delete(id);if(code===0)resolve(entry.result);else reject(fail('RECORDING_FAILED',stderr));});});
}
async function runOperation(op,args,ctx,config={}){
 const desktop=['desktop.','screens','screenshot','windows.','ui.','input.','app.launch','record.'].some(p=>op.startsWith(p));
 const userShell=op==='shell'&&!args.admin;
 if(!config.isHelper&&(desktop||userShell))return helperRequest(op,args,ctx,config);
 if(op==='shell')return shell(args,ctx);
 if(op==='apps.list')return installedApps();
 if(['apps.install','apps.update','apps.uninstall'].includes(op)){if(!args.admin)throw fail('ADMIN_REQUIRED','App deployment requires explicit admin:true');return install(op,args,ctx);}
 if(op==='logs.file')return logFile(args);
 if(op==='logs.events')return eventLogs(args);
 if(op.startsWith('record.'))return record(op,args,ctx);
 if(desktop){if(op==='screenshot')args={...args,path:path.join(ctx.dir,'screenshot.png')};const data=await native(op,args,ctx);if(op==='screenshot')return {...data,artifacts:[{path:args.path,type:'image/png',size:fs.statSync(args.path).size}]};return data;}
 throw fail('UNKNOWN_OPERATION','Unsupported operation: '+op);
}
module.exports={runOperation,native,psQuote,logFile,eventLogs};
