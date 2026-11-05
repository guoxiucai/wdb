import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-desktop-test-'));
const exe=path.join(root,'native/bin/DesktopBridge.exe');
let serial=0;
function request(op,args={}) {
  const file=path.join(tmp,`request-${serial++}.json`);fs.writeFileSync(file,JSON.stringify({op,args}));
  const result=spawnSync(exe,[file],{encoding:'utf8',timeout:45000,windowsHide:true});
  assert.ifError(result.error);return JSON.parse(result.stdout.replace(/^\uFEFF/,''));
}
function call(op,args={}){const r=request(op,args);assert.equal(r.ok,true,JSON.stringify(r));return r.data;}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('native desktop observation, UIA, input, true multitouch, stale references and artifacts',{skip:process.platform!=='win32',timeout:120000},async()=>{
  const bootstrap=path.join(tmp,'bootstrap.json');fs.writeFileSync(bootstrap,JSON.stringify({op:'desktop.status',args:{}}));
  const build=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'native/desktop.ps1'),'-RequestFile',bootstrap],{encoding:'utf8',windowsHide:true});assert.equal(build.status,0,build.stdout+build.stderr);
  const status=call('desktop.status');assert.equal(status.available,true,'Requires an unlocked interactive desktop');
  const csc=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const fixture=path.join(tmp,'Fixture.exe'),log=path.join(tmp,'fixture.log');
  const compile=spawnSync(csc,['/nologo','/target:winexe','/platform:x64',`/out:${fixture}`,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll',path.join(root,'tests/desktop-fixture.cs')],{encoding:'utf8',windowsHide:true});assert.equal(compile.status,0,compile.stdout+compile.stderr);
  const proc=spawn(fixture,[log],{windowsHide:false,stdio:'ignore'});
  try {
    let windows=[];for(let i=0;i<20&&!windows.length;i++){await pause(150);windows=call('windows.list',{pid:proc.pid});}assert.equal(windows.length,1);const window=windows[0].window;
    const screens=call('screens');assert.ok(screens.monitors.length);assert.equal(request('screenshot',{path:path.join(tmp,'bad.png'),layoutId:'stale'}).error.code,'DISPLAY_CHANGED');
    const tree=call('ui.tree',{window});assert.ok(tree.controls.length>=4);
    const input=call('ui.find',{window,name:'wdb input'}).controls[0];assert.ok(input);
    const button=call('ui.find',{window,name:'wdb apply'}).controls[0];assert.ok(button);
    call('ui.action',{reference:input.reference,action:'value',value:'中文 English !@#'});
    call('ui.action',{reference:button.reference,action:'invoke'});assert.match(fs.readFileSync(log,'utf8'),/CLICK 1 TEXT 中文 English/);
    call('ui.wait',{window,name:'wdb apply',state:'enabled',timeoutMs:1000});
    assert.equal(request('ui.wait',{window,name:'missing',state:'appeared',timeoutMs:100}).error.code,'TIMEOUT');
    call('windows.action',{window,action:'focus'});
    call('ui.action',{reference:input.reference,action:'focus'});call('input.key',{key:'ctrl+A'});call('input.text',{text:'键盘 Unicode 123'});call('ui.action',{reference:button.reference,action:'invoke'});assert.match(fs.readFileSync(log,'utf8'),/键盘 Unicode 123/);
    call('ui.action',{reference:button.reference,action:'click',method:'input'});await pause(150);assert.match(fs.readFileSync(log,'utf8'),/CLICK 3/);
    const shot=call('screenshot',{window,path:path.join(tmp,'window.png')});assert.ok(shot.bytes>1000);assert.equal(shot.coordinateSpace,'virtual-desktop-physical');
    const canvas=call('ui.find',{window,name:'wdb touch canvas'}).controls[0];assert.ok(canvas);const x=Math.round(canvas.bounds.x+30),y=Math.round(canvas.bounds.y+40);
    const frames=[{t:0,contacts:Array.from({length:2},(_,i)=>({id:i+1,x:x+i*50,y,phase:'down'}))},{t:40,contacts:Array.from({length:2},(_,i)=>({id:i+1,x:x+i*50,y:y+50,phase:'move'}))},{t:80,contacts:Array.from({length:2},(_,i)=>({id:i+1,x:x+i*50,y:y+100,phase:'move'}))},{t:120,contacts:Array.from({length:2},(_,i)=>({id:i+1,x:x+i*50,y:y+100,phase:'up'}))}];
    const touch=call('input.touch',{frames});assert.equal(touch.maxContacts,2);assert.equal(touch.samples,8);await pause(300);const observed=fs.readFileSync(log,'utf8');assert.equal(new Set([...observed.matchAll(/^TOUCH (\d+) down/gm)].map(m=>m[1])).size,2,'App must receive two real touch contacts');assert.equal([...observed.matchAll(/^TOUCH \d+ up/gm)].length,2);
    assert.equal(request('input.touch',{frames:[{t:0,contacts:[{id:1,x,y,phase:'move'}]}]}).error.code,'INVALID_TRAJECTORY');
    call('windows.action',{window,action:'close'});await pause(150);assert.equal(request('ui.action',{reference:button.reference,action:'invoke'}).error.code,'STALE_WINDOW');
    fs.mkdirSync(path.join(root,'artifacts/desktop'),{recursive:true});for(const name of ['window.png','fixture.log','fixture.log.png'])if(fs.existsSync(path.join(tmp,name)))fs.copyFileSync(path.join(tmp,name),path.join(root,'artifacts/desktop',name));
    console.log(`Desktop evidence: ${path.join(root,'artifacts/desktop')}`);
  } finally {if(proc.exitCode===null)proc.kill();}
});




