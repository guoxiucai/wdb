#!/usr/bin/env node
'use strict';
// Runs against an already approved Windows SCM service. It never pairs clients,
// reads server keys, alters authorization, or records client credentials.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const options = {};
for (let i=2;i<process.argv.length;i+=2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i+1]) throw Error('Use --config <approved-profile> [--device <address>] [--cli <installed-src/cli.js>] [--output <dir>] [--restart true]');
  options[process.argv[i].slice(2)] = process.argv[i+1];
}
if (process.platform !== 'win32' || !options.config) throw Error('Windows and --config are required');
const cli = path.resolve(options.cli || path.join(__dirname,'../src/cli.js'));
const {main} = require(cli);
const transport = require(path.join(path.dirname(cli),'client-transport.js'));
const profile = JSON.parse(fs.readFileSync(path.join(path.resolve(options.config),'devices.json'),'utf8'));
const device = profile.devices.find(d => !options.device || d.url.includes(options.device) || d.deviceId === options.device);
if (!device || device.connected === false) throw Error('Use an enabled, already approved client');
const output = path.resolve(options.output || path.join('artifacts','windows-sse-'+Date.now()));
fs.mkdirSync(output,{recursive:true});
const report = {startedAt:new Date().toISOString(),machine:{platform:process.platform,release:os.release(),arch:process.arch,node:process.version},cli,server:device.url,checks:[],passed:false};
let trace;
const originalRequest = https.request;
https.request = function(...args) {
  const req=originalRequest.apply(this,args), url=new URL(args[0]), current=trace;
  if (current && url.origin===new URL(device.url).origin) {
    const entry={method:args[1]?.method||'GET',path:url.pathname+url.search}; current.requests.push(entry);
    req.on('socket',s=>current.sockets.add(s));
    req.on('response',res=>{entry.type=res.headers['content-type']; if(url.pathname.endsWith('/events')){current.eventRequest=req;current.onStream?.(req);}});
  }
  return req;
};
const common=['--config',path.resolve(options.config),'--device',device.deviceId,'--request-timeout','3000','--reconnect-timeout','15000'];
async function run(args,{json=true,onOutput,onStream}={}) {
  let stdout='',stderr=''; const current={requests:[],sockets:new Set(),onStream}; trace=current;
  const code=await main([...args,...common,...(json?['--json']:[])],{stdout:{write:s=>{stdout+=s;}},stderr:{write:s=>{stderr+=s;onOutput?.(s,current);}}});
  trace=null;
  return {code,stdout,stderr,result:json?JSON.parse(stdout):null,requests:current.requests,socketCount:current.sockets.size};
}
async function check(name,action) {const start=Date.now();try{const evidence=await action();report.checks.push({name,status:'pass',durationMs:Date.now()-start,...evidence});console.log(name+': pass');}catch(e){report.checks.push({name,status:'fail',error:e.message});throw e;}}
async function submit(script,admin=false) {
  const r=await run(['shell','--script',script,'--detach',...(admin?['--admin']:[])]); assert.equal(r.code,0,r.stderr);return r.result.data.taskId;
}
const taskOf=r=>r.result.data;
(async()=>{
 try {
  await check('SCM health advertises SSE',async()=>{
    const health=await transport.withTransport(()=>transport.api(device,'GET','/v1/health'));
    assert.equal(health.data.taskEvents,true);report.deviceId=health.deviceId;report.beforePid=health.data.serverProcessId;
    return {serverProcessId:health.data.serverProcessId};
  });
  await check('one pinned TLS connection reused across health requests',async()=>{
    trace={requests:[],sockets:new Set()};const current=trace;
    await transport.withTransport(async()=>{for(let i=0;i<5;i++)await transport.api({...device},'GET','/v1/health');});trace=null;
    assert.equal(current.sockets.size,1);return {requests:5,tlsConnections:1};
  });
  for(const admin of [false,true]) await check(admin?'SYSTEM shell pushes output':'interactive helper pushes output',async()=>{
    const expected='开始 中文 🌍\r\n中间 中文\r\n结束\r\n';
    const id=await submit("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::WriteLine('开始 中文 🌍'); Start-Sleep -Milliseconds 900; [Console]::WriteLine('中间 中文'); Start-Sleep -Milliseconds 900; [Console]::WriteLine('结束')",admin);
    const start=Date.now();let first;
    const r=await run(['task','wait',id,'--follow','--poll-ms','10000'],{json:false,onOutput:()=>{first??=Date.now();}});
    assert.equal(r.code,0,r.stderr);assert.equal(r.stderr,expected);assert.ok(first-start<1500,'First output was delayed until completion');
    assert.equal(r.requests.filter(x=>x.path.includes('/events')).length,1);assert.ok(!r.requests.some(x=>x.path.endsWith('/output')));
    assert.equal(r.requests.filter(x=>x.path===`/v1/tasks/${id}`).length,1);
    const final=taskOf(await run(['task','get',id]));assert.equal(final.status,'succeeded');assert.equal(final.data.isElevated,admin);
    return {taskId:id,firstOutputMs:first-start,events:1,pollingRequests:1,isElevated:final.data.isElevated};
  });
  await check('TCP stream interruption resumes byte offsets without duplicate output',async()=>{
    const id=await submit("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); 1..6 | ForEach-Object { [Console]::WriteLine(('第{0}行 中文 🌍' -f $_)); Start-Sleep -Milliseconds 400 }");
    let interrupted=false;
    const r=await run(['task','wait',id,'--follow'],{json:false,onOutput:(s,current)=>{if(!interrupted&&s.includes('第1行')){interrupted=true;current.eventRequest.destroy();}}});
    assert.equal(r.code,0,r.stderr);assert.ok(interrupted);assert.equal(r.stderr,Array.from({length:6},(_,i)=>`第${i+1}行 中文 🌍\r\n`).join(''));
    const events=r.requests.filter(x=>x.path.includes('/events'));assert.equal(events.length,2);assert.match(events[1].path,/stdoutOffset=[1-9]\d*/);assert.ok(!r.requests.some(x=>x.method==='POST'&&x.path==='/v1/tasks'));
    return {taskId:id,subscriptions:events.map(x=>x.path),submissionsDuringRecovery:0};
  });
  await check('wait timeout preserves running task and cancellation closes SSE',async()=>{
    const id=await submit('Start-Sleep -Seconds 30');
    try {
      const timeout=await run(['task','wait',id,'--wait-timeout','250']);assert.equal(timeout.result.error.code,'CLIENT_WAIT_TIMEOUT');
      assert.equal(taskOf(await run(['task','get',id])).status,'running');
      const cancelled=await run(['task','cancel',id]);assert.equal(cancelled.code,0);
      const ended=await run(['task','wait',id]);assert.equal(taskOf(ended).status,'cancelled');
      return {taskId:id,timeout:'CLIENT_WAIT_TIMEOUT',finalStatus:'cancelled'};
    } finally {await run(['task','cancel',id]);}
  });
  await check('JSON stdout contains exactly one terminal result',async()=>{
    const r=await run(['shell','--script',"Start-Sleep -Milliseconds 500; Write-Output 'JSON 完成'",'--follow']);
    assert.equal(r.code,0);assert.equal(r.stdout.trim().split('\n').length,1);assert.equal(r.stderr,'');assert.equal(r.result.data.status,'succeeded');
    return {stdoutLines:1,streamSubscriptions:r.requests.filter(x=>x.path.includes('/events')).length};
  });
  if(options.restart==='true') await check('SCM restart reconnects and never resubmits the interrupted task',async()=>{
    const marker='wdb-sse-'+crypto.randomUUID()+'.txt';
    const id=await submit(`$p=Join-Path $env:TEMP '${marker}'; [IO.File]::AppendAllText($p,"once\n"); [Console]::WriteLine('started'); Start-Sleep -Seconds 30`,true);
    let restart;
    const r=await run(['task','wait',id,'--follow'],{json:false,onOutput:(s)=>{if(!restart&&s.includes('started'))restart=promisify(execFile)('powershell.exe',['-NoProfile','-Command',"Restart-Service WdbService; (Get-Service WdbService).WaitForStatus('Running',[TimeSpan]::FromSeconds(20))"],{windowsHide:true,timeout:30000});}});
    assert.ok(restart);await restart;
    const final=taskOf(await run(['task','get',id]));assert.equal(final.status,'unknown');assert.equal(final.error.code,'SERVICE_RESTARTED');
    assert.ok(!r.requests.some(x=>x.method==='POST'&&x.path==='/v1/tasks'));
    const count=await run(['shell','--admin','--script',`$p=Join-Path $env:TEMP '${marker}'; [Console]::Write(@(Get-Content -LiteralPath $p).Count); Remove-Item -LiteralPath $p`]);assert.equal(count.result.data.data.stdout,'1');
    const health=await transport.withTransport(()=>transport.api(device,'GET','/v1/health'));assert.notEqual(health.data.serverProcessId,report.beforePid);
    return {taskId:id,finalStatus:final.status,error:final.error.code,executionCount:1,afterPid:health.data.serverProcessId};
  });
  report.passed=true;
 }catch(e){report.error=e.stack;process.exitCode=1;console.error(e.message);}
 finally{https.request=originalRequest;report.endedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,report:path.join(output,'report.json')}));}
})();
