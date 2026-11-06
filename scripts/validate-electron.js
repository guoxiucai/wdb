#!/usr/bin/env node
'use strict';
// Explicit live test: creates a temporary DOM panel in the selected Electron page,
// drives it only through the WDB CLI, and removes that exact panel in finally.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {argv}=require('../src/common');
const options=argv(),root=path.resolve(__dirname,'..'),marker='wdb-validation-'+crypto.randomBytes(8).toString('hex');
const output=path.resolve(options.output||path.join(root,'artifacts',marker));fs.mkdirSync(output,{recursive:true});
const report={startedAt:new Date().toISOString(),scope:'Temporary DOM fixture in a real Electron renderer; not application business acceptance',marker,steps:[],cleanup:false};
let session;
function command(args){const r=spawnSync(process.execPath,[path.join(root,'src/cli.js'),...args,...(options.config?['--config',options.config]:[]),'--json'],{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:16*1024*1024});if(r.error)throw r.error;return JSON.parse(r.stdout);}
function call(op,args,label){const file=path.join(output,label+'.args.json');fs.writeFileSync(file,JSON.stringify(args));const r=command(['call',op,'--args-file',file,'--timeout','20000','--reconnect-timeout','5000']),t=r.data;fs.writeFileSync(path.join(output,label+'.json'),JSON.stringify(r,null,2));report.steps.push({label,taskId:t.id,status:t.status,error:t.error,durationMs:t.durationMs});for(const [i,a] of (t.artifacts||[]).entries()){const pulled=command(['pull',a.path,path.join(output,label+'-'+i+path.extname(a.path)),'--overwrite']);assert.equal(pulled.status,'succeeded');}return t;}
function ok(t){assert.equal(t.status,'succeeded',JSON.stringify(t.error));return t.data;}
function evaluate(expression,label){return ok(call('electron.eval',{...session,expression},label)).value;}
try{
  const list=ok(call('electron.targets',{endpoint:options.endpoint},'targets')).targets;
  const chosen=options.target?list.filter(t=>t.id===options.target):list;assert.equal(chosen.length,1,'Supply --target for the intended single Electron page');
  session={endpoint:options.endpoint||'http://127.0.0.1:9222',target:chosen[0].id};report.target=chosen[0];
  evaluate(`(()=>{if(document.getElementById(${JSON.stringify(marker)}))throw Error('Fixture already exists');const host=document.createElement('div');host.id=${JSON.stringify(marker)};host.style.cssText='position:fixed;left:100px;top:100px;width:480px;height:260px;background:white;color:black;z-index:2147483647;padding:24px;box-sizing:border-box;';const panel=host.attachShadow({mode:'open'});panel.innerHTML='<style>input,button{font:18px sans-serif;margin:8px;padding:8px}output{display:block;min-height:28px}</style><label>WDB 临时输入<input id="wdb-electron-input"></label><button id="wdb-electron-apply">WDB Apply</button><button class="wdb-electron-duplicate">Same</button><button class="wdb-electron-duplicate">Same</button><button id="wdb-electron-disabled" disabled>Disabled</button><output id="wdb-electron-result"></output>';host.dataset.clicks='0';panel.getElementById('wdb-electron-input').addEventListener('input',e=>{host.dataset.inputTrusted=String(e.isTrusted)});panel.getElementById('wdb-electron-apply').addEventListener('click',e=>{host.dataset.clicks=String(Number(host.dataset.clicks)+1);host.dataset.clickTrusted=String(e.isTrusted);const out=panel.getElementById('wdb-electron-result');out.textContent=panel.getElementById('wdb-electron-input').value;out.dataset.complete='true'});document.body.appendChild(host);return {created:true};})()`,'fixture-created');
  const found=ok(call('electron.find',{...session,selector:'#wdb-electron-input'},'find-shadow-input'));assert.equal(found.count,1);
  ok(call('electron.action',{...session,backend:'cdp',action:'fill',selector:'#wdb-electron-input',text:'中文 WDB 123'},'fill'));
  ok(call('electron.action',{...session,backend:'cdp',action:'type',selector:'#wdb-electron-input',text:' ✓'},'type'));
  ok(call('electron.action',{...session,backend:'cdp',action:'click',selector:'#wdb-electron-apply'},'click'));
  ok(call('electron.wait',{...session,selector:'#wdb-electron-result[data-complete="true"]',state:'visible',timeoutMs:3000},'wait'));
  const observed=evaluate(`(()=>{const h=document.getElementById(${JSON.stringify(marker)});return {value:h.shadowRoot.getElementById('wdb-electron-result').textContent,clicks:h.dataset.clicks,inputTrusted:h.dataset.inputTrusted,clickTrusted:h.dataset.clickTrusted}})()`,'observed');
  assert.deepEqual(observed,{value:'中文 WDB 123 ✓',clicks:'1',inputTrusted:'true',clickTrusted:'true'});report.input=observed;
  const ambiguous=call('electron.action',{...session,backend:'auto',action:'click',selector:'.wdb-electron-duplicate'},'ambiguous');assert.equal(ambiguous.error.code,'AMBIGUOUS_CONTROL');
  const disabled=call('electron.action',{...session,backend:'cdp',action:'click',selector:'#wdb-electron-disabled'},'disabled');assert.equal(disabled.error.code,'CONTROL_DISABLED');
  ok(call('electron.action',{...session,backend:'cdp',action:'fill',selector:'#wdb-electron-input',text:''},'clear'));assert.equal(evaluate(`document.getElementById(${JSON.stringify(marker)}).shadowRoot.getElementById('wdb-electron-input').value`,'cleared'),'');
  evaluate(`setTimeout(()=>console.info(${JSON.stringify(marker)}),750);true`,'console-scheduled');
  const logs=ok(call('electron.logs',{...session,durationMs:1800},'console'));assert.ok(JSON.stringify(logs.events).includes(marker),'Must observe actual console event');report.consoleEvents=logs.events.length;
  const screenshot=ok(call('electron.screenshot',session,'screenshot'));assert.ok(screenshot.width>0&&screenshot.height>0);report.screenshot={width:screenshot.width,height:screenshot.height};
  report.passed=true;
}catch(e){report.passed=false;report.error={code:e.code,message:e.message};process.exitCode=1;}
finally{
  if(session){try{assert.equal(evaluate(`document.getElementById(${JSON.stringify(marker)})?.remove();!document.getElementById(${JSON.stringify(marker)})`,'fixture-removed'),true);report.cleanup=true;}catch(e){report.cleanup=false;report.passed=false;report.cleanupError=e.message;process.exitCode=1;}}
  report.endedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,cleanup:report.cleanup,report:path.join(output,'report.json'),error:report.error},null,2));
}
