'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {ROOT,fail,powershell,execute,read}=require('./common');
function psQuote(s){return "'"+String(s).replaceAll("'","''")+"'";}
async function native(op,args,ctx){
  if(ctx.signal?.aborted)throw fail('CANCELLED','Operation cancelled before execution');
  const request=path.join(ctx.dir,'native-request.json');fs.writeFileSync(request,JSON.stringify({op,args:{...args,cancelFile:path.join(ctx.dir,'cancel')}}));
  const abort=()=>fs.writeFileSync(path.join(ctx.dir,'cancel'),'cancel');ctx.signal?.addEventListener('abort',abort,{once:true});
  let timedOut=false;const deadline=setTimeout(()=>{timedOut=true;abort();},ctx.timeoutMs);
  try {
    const r=await execute(process.env.SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'native','desktop.ps1'),'-RequestFile',request],{timeoutMs:ctx.timeoutMs+5000});
    if(r.timedOut||timedOut)throw fail('TIMEOUT','Native operation timed out; observe before retrying');
    let result;try{result=JSON.parse(r.stdout.replace(/^\uFEFF/,''));}catch{throw fail('NATIVE_ERROR',r.stderr||r.stdout||'Native bridge produced no JSON');}
    if(!result.ok)throw fail(result.error?.code||'NATIVE_ERROR',result.error?.message||'Native operation failed');return result.data;
  } finally {clearTimeout(deadline);ctx.signal?.removeEventListener('abort',abort);}
}
async function helperRequest(op,args,ctx,config){
 if(ctx.signal?.aborted)throw fail('CANCELLED','Operation cancelled before execution');
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
 const identity=await executionIdentity();if(args.admin&&!identity.isElevated)throw fail('ADMIN_NOT_AVAILABLE','Server is not elevated. Repair/install the Windows service before requesting administrator execution');
 const result=await powershell(args.command,{cwd:args.cwd,env:args.env,timeoutMs:ctx.timeoutMs,signal:ctx.signal,onOutput:ctx.onOutput,maxOutput:ctx.maxOutput});
 return {...result,...identity,requestedIdentity:args.admin?'administrator':'logged-in-user'};
}
async function executionIdentity(){const r=await powershell('$i=[Security.Principal.WindowsIdentity]::GetCurrent(); $p=New-Object Security.Principal.WindowsPrincipal($i); @{identity=$i.Name;isElevated=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json -Compress',{timeoutMs:10000});if(r.exitCode!==0)throw fail('IDENTITY_QUERY_FAILED',r.stderr);return JSON.parse(r.stdout);}
async function installedApps(){
 const r=await powershell("$keys=@('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object DisplayName | ForEach-Object { [ordered]@{id=$_.PSPath;name=$_.DisplayName;version=$_.DisplayVersion;publisher=$_.Publisher;installLocation=$_.InstallLocation;uninstallString=$_.UninstallString;quietUninstallString=$_.QuietUninstallString} }) | ConvertTo-Json -Depth 5 -Compress");
 if(r.exitCode!==0)throw fail('APPS_QUERY_FAILED',r.stderr);const value=JSON.parse(r.stdout||'[]');return {apps:Array.isArray(value)?value:value?[value]:[]};
}
async function install(op,args,ctx){
 const identity=await executionIdentity();if(!identity.isElevated)throw fail('ADMIN_NOT_AVAILABLE','App deployment requires the installed elevated Windows service');
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
 return {...result,...identity,installerStatus:result.timedOut?'needs_manual_intervention':result.exitCode===0?'succeeded':[1641,3010].includes(result.exitCode)?'reboot_required':'failed',rebootRequested:false};
}
async function logFile(args){
 if(!args.path)throw fail('INVALID_ARGUMENT','log path required');
 const st=await fs.promises.stat(args.path);const limit=Math.min(Math.max(Number(args.limitBytes)||65536,2),4*1024*1024);
 let start=Math.max(0,st.size-limit);const handle=await fs.promises.open(args.path,'r');let bytes,encoding=args.encoding||'utf8';
 try{const prefix=Buffer.alloc(2);await handle.read(prefix,0,2,0);if(!args.encoding&&prefix[0]===255&&prefix[1]===254)encoding='utf16le';if(encoding==='utf16le')start-=start%2;bytes=Buffer.alloc(st.size-start);const result=await handle.read(bytes,0,bytes.length,start);bytes=bytes.subarray(0,result.bytesRead);if(encoding==='utf8'&&start>0){let skip=0;while(skip<bytes.length&&(bytes[skip]&0xc0)===0x80)skip++;bytes=bytes.subarray(skip);start+=skip;}}finally{await handle.close();}
 if(!['utf8','utf16le'].includes(encoding))throw fail('INVALID_ENCODING','Supported encodings: utf8, utf16le');
 const text=bytes.toString(encoding).replace(/^\uFEFF/,'');const lines=args.lines?text.split(/\r?\n/).slice(-Number(args.lines)).join('\n'):text;
 return {path:args.path,text:lines,size:st.size,offset:start,encoding,modifiedAt:st.mtime.toISOString(),fileId:st.ino};
}
async function eventLogs(args){
 const log=args.log||'Application';if(!['Application','System','Security'].includes(log))throw fail('INVALID_LOG','Supported logs: Application, System, Security');
 const limit=Math.min(Math.max(Number(args.limit)||100,1),1000),offset=Math.max(0,Number(args.offset)||0);if(offset>10000)throw fail('INVALID_OFFSET','Maximum event offset is 10000');
 let filter='@{LogName='+psQuote(log);if(args.startTime)filter+=';StartTime=[datetime]'+psQuote(args.startTime);if(args.endTime)filter+=';EndTime=[datetime]'+psQuote(args.endTime);if(args.source)filter+=';ProviderName='+psQuote(args.source);if(args.level)filter+=';Level='+Number(args.level);if(args.eventId)filter+=';Id='+Number(args.eventId);filter+='}';
 const script='$ErrorActionPreference="Stop"; try { @(Get-WinEvent -FilterHashtable '+filter+' -MaxEvents '+(limit+offset)+' | Select-Object -Skip '+offset+' -First '+limit+' | Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,RecordId,Message) | ConvertTo-Json -Depth 5 -Compress } catch { if ($_.FullyQualifiedErrorId -like "NoMatchingEventsFound*") { "[]" } else { throw } }';
 const r=await powershell(script,{timeoutMs:30000});if(r.exitCode!==0)throw fail('EVENT_LOG_FAILED',r.stderr);let entries=JSON.parse(r.stdout||'[]');entries=Array.isArray(entries)?entries:entries?[entries]:[];const fetched=entries.length;if(args.keyword)entries=entries.filter(e=>e.Message?.includes(args.keyword));return {entries,nextOffset:fetched===limit?offset+limit:null};
}
const recordings=new Map();
async function record(op,args,ctx){
 if(op==='record.stop'){
   const entry=recordings.get(args.id);if(!entry)throw fail('RECORDING_NOT_FOUND','Recording id is absent or process restarted');
   if(entry.child.exitCode===null)entry.child.stdin.write('q\n');await entry.done;return entry.result;
 }
 const ffmpeg=[path.join(ROOT,'runtime','ffmpeg.exe'),path.join(ROOT,'.runtime','ffmpeg','ffmpeg.exe'),path.join(ROOT,'dist','wdb-windows-x64','runtime','ffmpeg.exe')].find(f=>fs.existsSync(f));if(!ffmpeg)throw fail('CAPABILITY_UNAVAILABLE','Bundled ffmpeg is not installed');
 const duration=Number(args.durationSeconds||600);if(!(duration>0&&duration<=3600))throw fail('INVALID_DURATION','Recording duration must be 1..3600 seconds');
 const screens=await native('screens',{},ctx);const list=Array.isArray(screens)?screens:screens.screens||screens.monitors;const monitor=list?.[Number(args.monitor||0)];if(!monitor)throw fail('MONITOR_NOT_FOUND','Monitor unavailable');
 const target=path.join(ctx.dir,'recording.mp4');const id=ctx.id;const fps=Number(args.fps||30);if(!Number.isInteger(fps)||fps<1||fps>60)throw fail('INVALID_FPS','fps must be 1..60');
 const captureIndex=Number(args.captureIndex??args.monitor??0);if(!Number.isInteger(captureIndex)||captureIndex<0)throw fail('INVALID_MONITOR','captureIndex must be a nonnegative DXGI output index');
 const progressPath=path.join(ctx.dir,'encoder-progress.log');
 const cmd=['-y','-hide_banner','-nostats','-loglevel','warning','-progress',progressPath,'-f','lavfi','-i',`ddagrab=output_idx=${captureIndex}:framerate=${fps}`,'-t',String(duration),'-vf','hwdownload,format=bgra,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-r',String(fps),'-fps_mode','cfr','-an','-movflags','+faststart',target];
 const entry={};let resolveDone;entry.done=new Promise(r=>resolveDone=r);recordings.set(id,entry);
 const child=spawn(ffmpeg,cmd,{windowsHide:true,stdio:['pipe','ignore','pipe']});entry.child=child;child.stdin.on('error',()=>{});let stderr='';child.stderr.on('data',c=>{stderr=(stderr+c).slice(-65536);});
 const started=Date.now();const timer=setTimeout(()=>child.stdin.write('q\n'),(duration+10)*1000);const abort=()=>child.stdin.write('q\n');ctx.signal?.addEventListener('abort',abort);
 const hardStop=setTimeout(()=>{if(child.exitCode===null)spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});},(duration+30)*1000);
 return await new Promise((resolve,reject)=>{child.on('error',e=>{clearTimeout(timer);clearTimeout(hardStop);reject(e);resolveDone();});child.on('close',async code=>{clearTimeout(timer);clearTimeout(hardStop);ctx.signal?.removeEventListener('abort',abort);const log=path.join(ctx.dir,'encoder.log');fs.writeFileSync(log,stderr);let probe=null;try{const r=await execute(path.join(path.dirname(ffmpeg),'ffprobe.exe'),['-v','error','-show_entries','stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration','-of','json',target],{timeoutMs:30000});if(r.exitCode===0)probe=JSON.parse(r.stdout);}catch{}
 const progress={};try{for(const line of fs.readFileSync(progressPath,'utf8').split(/\r?\n/)){const at=line.indexOf('=');if(at>0)progress[line.slice(0,at)]=line.slice(at+1);}}catch{}
 entry.result={id,path:target,exitCode:code,durationMs:Date.now()-started,captureMethod:'DXGI Desktop Duplication (ddagrab)',monitor:Number(args.monitor||0),captureIndex,monitorMappingVerified:list.length===1,requestedFps:fps,probe,progress,encoderLog:log,artifacts:fs.existsSync(target)?[{path:target,type:'video/mp4',size:fs.statSync(target).size},{path:log,type:'text/plain',size:fs.statSync(log).size},...(fs.existsSync(progressPath)?[{path:progressPath,type:'text/plain',size:fs.statSync(progressPath).size}]:[])]:[]};resolveDone();recordings.delete(id);if(code===0)resolve(entry.result);else reject(fail('RECORDING_FAILED',stderr.slice(-2000)));});});
}
async function runOperation(op,args,ctx,config={}){
 if(ctx.signal?.aborted)throw fail('CANCELLED','Operation cancelled before execution');
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
module.exports={runOperation,native,psQuote,logFile,eventLogs,executionIdentity};
