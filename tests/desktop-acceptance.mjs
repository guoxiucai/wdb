// Explicit interactive acceptance probe. Evidence is recorded even when application delivery fails.
import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const out=path.join(root,'artifacts/desktop-acceptance');fs.mkdirSync(out,{recursive:true});let serial=0;
function request(op,args={}){const file=path.join(out,`request-${serial++}.json`);fs.writeFileSync(file,JSON.stringify({op,args}));const r=spawnSync(path.join(root,'native/bin/DesktopBridge.exe'),[file],{encoding:'utf8',timeout:60000,windowsHide:true});return r.error?{ok:false,error:{message:r.error.message}}:JSON.parse(r.stdout.replace(/^\uFEFF/,''));}
const fixture=path.join(out,'Fixture.exe'),log=path.join(out,'touch.log');fs.writeFileSync(log,'');
spawnSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe','/platform:x64',`/out:${fixture}`,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll',path.join(root,'tests/desktop-fixture.cs')],{windowsHide:true});
const proc=spawn(fixture,[log],{stdio:'ignore',windowsHide:false});await new Promise(r=>setTimeout(r,700));
try {
  const windows=request('windows.list',{pid:proc.pid});const window=windows.data[0].window;request('windows.action',{window,action:'focus'});
  const canvas=request('ui.find',{window,name:'wdb touch canvas'}).data.controls[0].bounds;
  const x=Math.round(canvas.x+30),y=Math.round(canvas.y+40);const frames=[];
  for(let frame=0;frame<1800;frame++)frames.push({t:frame*1000/60,contacts:Array.from({length:10},(_,i)=>({id:i+1,x:x+i*55+Math.round(10*Math.sin(frame/20+i)),y:y+Math.round(250*frame/1799),phase:frame===0?'down':'move'}))});
  frames.push({t:30000,contacts:frames.at(-1).contacts.map(p=>({...p,phase:'up'}))});
  const startedAt=new Date().toISOString();const result=request('input.touch',{frames});await new Promise(r=>setTimeout(r,500));
  const text=fs.readFileSync(log,'utf8');const downs=[...text.matchAll(/^TOUCH (\d+) down/gm)].map(m=>m[1]),ups=[...text.matchAll(/^TOUCH (\d+) up/gm)].map(m=>m[1]);
  const report={startedAt,endedAt:new Date().toISOString(),sample:'WinForms diagnostic fixture, not user application acceptance',requested:{fingers:10,durationMs:30000,samplesPerFingerPerSecond:60,frames:frames.length,contactSamples:18010},injection:result,received:{distinctDownContacts:new Set(downs).size,upContacts:new Set(ups).size,touchEvents:[...text.matchAll(/^TOUCH /gm)].length},applicationDeliveryPassed:new Set(downs).size===10&&new Set(ups).size===10};
  report.screenshot=request('screenshot',{window,path:path.join(out,'after.png')});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  request('windows.action',{window,action:'close'});
}finally{if(proc.exitCode===null)proc.kill();}
