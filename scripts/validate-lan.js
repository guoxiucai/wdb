#!/usr/bin/env node
'use strict';
// Uses only the delivered CLI and an already paired client profile. No secrets
// are written into the report; remote temporary files are scoped to this run.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const argv=process.argv.slice(2),options={};
for(let i=0;i<argv.length;i+=2){if(!argv[i].startsWith('--')||!argv[i+1])throw Error('Use --device <address|id> [--config <dir>] [--output <dir>]');options[argv[i].slice(2)]=argv[i+1];}
if(!options.device)throw Error('--device is required');
const output=path.resolve(options.output||path.join(process.cwd(),'lan-validation-'+Date.now()));
fs.mkdirSync(output,{recursive:true});
const cli=path.resolve(options.cli||path.join(__dirname,'../src/cli.js'));
const common=['--device',options.device,'--json','--reconnect-timeout','15000',...(options.config?['--config',path.resolve(options.config)]:[])];
const report={startedAt:new Date().toISOString(),client:{platform:process.platform,arch:process.arch,hostname:os.hostname(),node:process.version},target:options.device,steps:[],passed:false};
let remoteDir;
function run(label,args){
 const start=Date.now(),p=spawnSync(process.execPath,[cli,...args,...common],{encoding:'utf8',windowsHide:true,timeout:args[0]==='connect'?180000:90000,maxBuffer:32*1024*1024});
 let result;try{result=JSON.parse(p.stdout);}catch{throw Error(`${label}: invalid CLI output (${p.error?.message||p.stderr})`);}
 fs.writeFileSync(path.join(output,label+'.json'),JSON.stringify(result,null,2));
 const task=result.data?.taskId?result.data:null;
 report.steps.push({label,status:task?.status||result.status,taskId:task?.taskId||null,durationMs:Date.now()-start,error:task?.error||result.error});
 assert.equal(p.status,0,`${label}: ${JSON.stringify(task?.error||result.error)}`);
 console.log(`${label}: ${task?.status||result.status}`);return task?.data||result.data;
}
try{
 const info=run('info',['info']);assert.equal(info.protocolVersion,1);assert.match(info.deviceId,/^[a-f0-9]{16}$/);
 report.server={hostname:info.hostname,deviceId:info.deviceId,version:info.version,desktop:info.desktop.available};
 const shell=run('shell',['shell','--script','[Console]::Write($env:TEMP)']);assert.equal(shell.isElevated,false);assert.equal(shell.exitCode,0);
 remoteDir=path.win32.join(shell.stdout.trim(),'wdb-lan-smoke-'+crypto.randomUUID());assert.ok(path.win32.isAbsolute(remoteDir));
 const localSource=path.join(output,'上传 中文');fs.mkdirSync(path.join(localSource,'子目录'),{recursive:true});
 fs.writeFileSync(path.join(localSource,'子目录','sample.bin'),crypto.randomBytes(1024*1024));
 fs.writeFileSync(path.join(localSource,'hello 世界.txt'),'WDB LAN 中文验证\n'+info.deviceId+'\n');
 run('push-directory',['push',localSource,remoteDir]);
 const localDest=path.join(output,'下载 中文');run('pull-directory',['pull',remoteDir,localDest,'--recursive']);
 for(const name of ['hello 世界.txt',path.join('子目录','sample.bin')])assert.deepEqual(fs.readFileSync(path.join(localSource,name)),fs.readFileSync(path.join(localDest,name)));
 report.fileRoundtripVerified=true;
 run('screens',['screens']);run('windows',['windows','list']);
 const shot=run('screenshot',['screenshot']);assert.ok(shot.artifacts?.length,'Screenshot returned no artifact');
 const artifact=shot.artifacts.find(x=>x.path?.endsWith('.png'));assert.ok(artifact,'Screenshot PNG missing');
 const png=path.join(output,'desktop.png');run('pull-screenshot',['pull',artifact.path,png]);
 assert.equal(fs.readFileSync(png).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 const reconnectAddress=info.connection.url;
 run('disconnect',['disconnect',options.device]);
 const devices=run('devices-disconnected',['devices']);assert.ok(!devices.some(x=>x.deviceId===info.deviceId),'Explicitly disconnected device must be hidden');
 const reconnected=run('reconnect',['connect',reconnectAddress]);
 assert.equal(reconnected.state,'connected');
 assert.equal(run('info-reconnected',['info']).deviceId,info.deviceId);
 report.passed=true;
}catch(e){report.error=e.message;process.exitCode=1;}
finally{
 if(remoteDir){
  const quoted=remoteDir.replace(/'/g,"''");
  try{run('cleanup',['shell','--script',`$p=[IO.Path]::GetFullPath('${quoted}'); if ((Split-Path $p -Leaf) -notmatch '^wdb-lan-smoke-[a-f0-9-]{36}$' -or (Split-Path $p -Parent) -ne [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar)) { throw 'Invalid cleanup scope' }; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }`]);}
  catch(e){report.cleanupError=e.message;report.passed=false;process.exitCode=1;}
 }
 report.endedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,report:path.join(output,'report.json'),error:report.error||report.cleanupError}));
}
