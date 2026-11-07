'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const OFFLINE_MS=10*60*1000;

// Resolve the persistent shell, including npm's temporary Windows cmd /c shim.
function sessionKey(env=process.env,parent=process.ppid){
 return crypto.createHash('sha256').update(JSON.stringify([env.TERM_SESSION_ID||env.WT_SESSION||'',parent])).digest('hex');
}
function currentSession(){
 let parent;
 try{
  if(process.platform==='win32'){
   const script=`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${process.ppid}"; while($p.Name -ieq 'cmd.exe' -and $p.CommandLine -match '(?i)\\s/c(?:\\s|")'){ $p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$p.ParentProcessId) }; if($null -eq $p){exit 1}; [Console]::Write(($p.ProcessId.ToString()+':'+$p.CreationDate.ToUniversalTime().Ticks.ToString()))`;
   parent=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:5000}).trim();
  }else parent=execFileSync('/bin/ps',['-p',String(process.ppid),'-o','pid=','-o','lstart='],{encoding:'utf8',timeout:2000}).trim();
  if(!parent)throw Error('No parent shell');
 }catch{parent='invocation:'+process.pid+':'+Date.now();}
 return sessionKey(process.env,parent);
}
class DeviceVisibility{
 constructor(dir,{session=currentSession(),now=Date.now}={}){this.file=path.join(dir,'device-visibility',session+'.json');this.now=now;this.records={};}
 async load(){try{const data=JSON.parse(await fs.readFile(this.file,'utf8'));if(data&&typeof data==='object'&&!Array.isArray(data))this.records=data;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}return this;}
 async filter(entries){
  const now=this.now(),next={},visible=[];
  for(const entry of entries){
   const key=crypto.createHash('sha256').update(JSON.stringify([entry.url,entry.deviceId])).digest('hex');
   const previous=this.records[key];
   if(entry.connectionState==='online'){next[key]={online:true};visible.push(entry);}
   else if(entry.connectionState==='offline'){
    if(!previous)continue;
    const since=previous.online?now:previous.offlineSince;
    if(Number.isFinite(since)&&since<=now&&now-since<OFFLINE_MS){next[key]={offlineSince:since};visible.push(entry);}
   }else visible.push(entry);
  }
  this.records=next;
  await this.save();
  return visible;
 }
 async online(device){
  const key=crypto.createHash('sha256').update(JSON.stringify([device.url,device.deviceId])).digest('hex');
  this.records[key]={online:true};await this.save();
 }
 async save(){
  await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
  const temp=this.file+'.'+crypto.randomUUID()+'.tmp';
  try{await fs.writeFile(temp,JSON.stringify(this.records),{flag:'wx',mode:0o600});await fs.rename(temp,this.file);}finally{await fs.rm(temp,{force:true});}
 }
}
module.exports={DeviceVisibility,sessionKey,currentSession,OFFLINE_MS};
