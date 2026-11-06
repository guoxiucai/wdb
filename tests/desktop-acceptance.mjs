// Explicit interactive acceptance probe. Evidence is recorded even when application delivery fails.
import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const out=path.join(root,'artifacts/desktop-acceptance'+(process.env.WDB_ACCEPTANCE_LABEL?'-'+process.env.WDB_ACCEPTANCE_LABEL.replace(/[^a-z0-9-]/gi,''):''));fs.mkdirSync(out,{recursive:true});let serial=0;
const fingers=Number(process.env.WDB_TOUCH_FINGERS||10),durationMs=Number(process.env.WDB_TOUCH_DURATION_MS||30000),frameCount=Math.round(durationMs*60/1000);
if(!Number.isInteger(fingers)||fingers<1||fingers>10||frameCount<2)throw new Error('Invalid touch probe parameters');
const profile=process.env.WDB_TOUCH_PROFILE||'parallel';if(!['parallel','cross-stagger'].includes(profile))throw new Error('Unknown trajectory profile');
const useCli=process.env.WDB_ACCEPTANCE_CLI==='1';
function cli(words){const r=spawnSync(process.execPath,[path.join(root,'src/cli.js'),...words,'--json'],{encoding:'utf8',timeout:75000,windowsHide:true});if(r.error)throw r.error;const result=JSON.parse(r.stdout.replace(/^\uFEFF/,''));if(r.status!==0)throw new Error(JSON.stringify(result));return result;}
function request(op,args={}){
  const file=path.join(out,`request-${serial++}.json`);fs.writeFileSync(file,JSON.stringify(useCli?args:{op,args}));
  if(useCli){try{const envelope=cli(['call',op,'--args-file',file,'--timeout','60000']);fs.writeFileSync(file+'.result.json',JSON.stringify(envelope,null,2));const data=envelope.data.data;if(op==='screenshot'&&args.path){cli(['pull',data.path,args.path,'--overwrite']);data.localArtifactPath=args.path;}return {ok:true,data,taskId:envelope.data.id};}catch(e){return {ok:false,error:{message:e.message}};}}
  const r=spawnSync(process.env.WDB_DESKTOP_BRIDGE||path.join(root,'native/bin/DesktopBridge.exe'),[file],{encoding:'utf8',timeout:60000,windowsHide:true});return r.error?{ok:false,error:{message:r.error.message}}:JSON.parse(r.stdout.replace(/^\uFEFF/,''));
}
const fixture=path.join(out,'Fixture.exe'),log=path.join(out,'touch.log');fs.writeFileSync(log,'');
spawnSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe','/platform:x64',`/out:${fixture}`,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll',path.join(root,'tests/desktop-fixture.cs')],{windowsHide:true});
const proc=spawn(fixture,[log],{stdio:'ignore',windowsHide:false});await new Promise(r=>setTimeout(r,700));
try {
  const windows=request('windows.list',{pid:proc.pid});const window=windows.data[0].window;let focus=request('windows.action',{window,action:'focus'});if(!focus.ok){request('input.mouse',{action:'click',x:windows.data[0].bounds.x+150,y:windows.data[0].bounds.y+15});focus=request('windows.action',{window,action:'focus'});}const visibleBefore=request('screenshot',{region:windows.data[0].bounds,path:path.join(out,'visible-before.png')});const foregroundBefore=request('windows.list',{pid:proc.pid});fs.writeFileSync(path.join(out,'setup.json'),JSON.stringify({focus,visibleBefore,foregroundBefore},null,2));if(!focus.ok||!foregroundBefore.data?.some(w=>w.window===window&&w.foreground))throw new Error('SETUP_INVALID: fixture is not the foreground window; injection skipped');
  const canvas=request('ui.find',{window,name:'wdb touch canvas'}).data.controls[0].bounds;
  const x=Math.round(canvas.x+30),y=Math.round(canvas.y+40);const frames=[];
  for(let frame=0;frame<frameCount;frame++)frames.push({t:frame*1000/60,contacts:Array.from({length:fingers},(_,i)=>({id:i+1,x:x+i*55+Math.round(10*Math.sin(frame/20+i)),y:y+Math.round(250*frame/(frameCount-1)),phase:frame===0?'down':'move'}))});
  frames.push({t:durationMs,contacts:frames.at(-1).contacts.map(p=>({...p,phase:'up'}))});
  if(profile==='cross-stagger'){
    frames.length=0;const previous=new Map(),step=Math.max(1,Math.floor(frameCount/40));
    for(let frame=0;frame<frameCount;frame++){
      const contacts=[];
      for(let i=0;i<fingers;i++){const start=i*step,end=frameCount-1-(fingers-1-i)*step;if(frame<start||frame>end)continue;
        let p;if(frame===end)p={...previous.get(i),phase:'up'};else{const fraction=(frame-start)/(end-start-1);p={id:i+1,x:x+Math.round(55*(i+(fingers-1-2*i)*fraction)),y:y+Math.round(250*fraction),phase:frame===start?'down':'move'};previous.set(i,p);}contacts.push(p);
      }
      frames.push({t:frame*1000/60,contacts});
    }
  }
  const hitTests=frames.flatMap(f=>f.contacts.filter(p=>p.phase==='down')).map(p=>request('windows.hitTest',{x:p.x,y:p.y}));
  if(hitTests.some(r=>!r.ok||r.data.root.window!==window))throw new Error('SETUP_INVALID: a touch coordinate targets another window');
  let recording=null;
  if(useCli&&process.env.WDB_ACCEPTANCE_RECORD==='1'){const argsFile=path.join(out,'record-args.json');fs.writeFileSync(argsFile,JSON.stringify({durationSeconds:Math.ceil(durationMs/1000)+5}));recording=cli(['call','record.start','--args-file',argsFile,'--detach']);fs.writeFileSync(path.join(out,'record-start.json'),JSON.stringify(recording,null,2));await new Promise(r=>setTimeout(r,1000));}
  const startedAt=new Date().toISOString();const result=request('input.touch',{frames});await new Promise(r=>setTimeout(r,500));
  const text=fs.readFileSync(log,'utf8');const downs=[...text.matchAll(/^TOUCH (\d+) down/gm)].map(m=>m[1]),ups=[...text.matchAll(/^TOUCH (\d+) up/gm)].map(m=>m[1]);
  const foregroundAfter=request('windows.list',{pid:proc.pid});const setupValid=focus.ok&&foregroundBefore.data?.some(w=>w.window===window&&w.foreground)&&foregroundAfter.data?.some(w=>w.window===window&&w.foreground);const report={transport:useCli?'HTTPS CLI via service/helper':'native diagnostic',setup:{valid:setupValid,focus,foregroundBefore,foregroundAfter,visibleBefore,hitTests},rawTouchFixture:process.env.WDB_FIXTURE_RAW_TOUCH==='1',startedAt,endedAt:new Date().toISOString(),sample:'WinForms diagnostic fixture, not user application acceptance',requested:{fingers,durationMs,profile,samplesPerFingerPerSecond:60,frames:frames.length,contactSamples:frames.reduce((n,f)=>n+f.contacts.length,0)},injection:result,received:{distinctDownContacts:new Set(downs).size,upContacts:new Set(ups).size,touchEvents:[...text.matchAll(/^TOUCH /gm)].length},applicationDeliveryPassed:setupValid&&result.ok&&new Set(downs).size===fingers&&new Set(ups).size===fingers};
  report.visibleAfter=request('screenshot',{region:windows.data[0].bounds,path:path.join(out,'visible-after.png')});report.screenshot=request('screenshot',{window,path:path.join(out,'after.png')});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  if(recording){report.recording=cli(['task','wait',recording.data.id]);fs.writeFileSync(path.join(out,'recording-result.json'),JSON.stringify(report.recording,null,2));cli(['pull',report.recording.data.data.path,path.join(out,'recording.mp4'),'--overwrite']);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report,null,2));if(!report.applicationDeliveryPassed)process.exitCode=1;
  request('windows.action',{window,action:'close'});
}finally{if(proc.exitCode===null)proc.kill();}




