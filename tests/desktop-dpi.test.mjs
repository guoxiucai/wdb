import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Run once at each real Windows display scaling setting. Never changes OS settings.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bridge=process.env.WDB_DPI_BRIDGE||path.join(root,'native/bin/DesktopBridge.exe');
const dir=path.join(root,'dev_doc/dpi',`${Date.now()}`);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('approval layout and screenshot physical pixels at current Windows DPI', {skip:process.platform!=='win32',timeout:60000},async()=>{
  fs.mkdirSync(dir,{recursive:true});let serial=0;
  function request(op,args={}) {
    const file=path.join(dir,`request-${serial++}.json`);fs.writeFileSync(file,JSON.stringify({op,args}));
    const result=spawnSync(bridge,[file],{encoding:'utf8',windowsHide:true,timeout:10000});
    assert.ifError(result.error);return JSON.parse(result.stdout.replace(/^\uFEFF/,''));
  }
  function call(op,args={}) {const r=request(op,args);assert.equal(r.ok,true,JSON.stringify(r));return r.data;}
  const screens=call('screens');
  const fixture=path.join(dir,'ApprovalLayoutFixture.exe');
  const framework=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319');
  const build=spawnSync(path.join(framework,'csc.exe'),['/nologo','/target:winexe','/platform:x64',`/out:${fixture}`,`/win32manifest:${path.join(root,'native/DesktopBridge.manifest')}`,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',path.join(root,'tests/approval-layout-fixture.cs')],{encoding:'utf8',windowsHide:true});
  assert.equal(build.status,0,build.stdout+build.stderr);
  fs.copyFileSync(`${bridge}.config`,`${fixture}.config`);
  const results=[];
  const scales=process.env.WDB_DPI_LAYOUT_STRESS==='1'?[1,1.25,1.5,1.75,2,2.5,3]:[1];
  const cases=scales.flatMap(scale=>['QMacBookPro.local','研发笔记本 & QA — '+ 'LongDeviceName-'.repeat(10)].map(name=>({scale,name})));
  for(const [index,{scale,name}] of cases.entries()) {
    const metrics=path.join(dir,`layout-${index}.json`);
    const proc=spawn(fixture,[bridge,metrics,name,String(scale)],{stdio:'ignore'});
    try {
      for(let i=0;i<40&&!fs.existsSync(metrics);i++)await pause(100);
      assert.ok(fs.existsSync(metrics),'preview must write layout evidence');
      const layout=JSON.parse(fs.readFileSync(metrics));assert.equal(layout.error,undefined);
      assert.deepEqual(layout.failures,[]);assert.equal(layout.dpi,screens.monitors[0].dpiX);
      const windows=call('windows.list',{pid:proc.pid});assert.equal(windows.length,1);
      const window=windows[0].window;
      const shot=call('screenshot',{window,path:path.join(dir,`dialog-${index}.png`)});
      assert.equal(shot.width,layout.window.width);assert.equal(shot.height,layout.window.height);
      const region={x:layout.window.x+30,y:layout.window.y+50,width:120,height:60};
      const crop=call('screenshot',{region,path:path.join(dir,`region-${index}.png`)});
      assert.deepEqual(crop.mapping,{scaleX:1,scaleY:1,offsetX:region.x,offsetY:region.y});
      for(const capture of [shot,crop]) {
        const png=fs.readFileSync(capture.path);assert.equal(png.readUInt32BE(16),capture.width);assert.equal(png.readUInt32BE(20),capture.height);
      }
      results.push({layout,shot,crop});
    } finally {if(proc.exitCode===null){proc.kill();await new Promise(resolve=>proc.once('exit',resolve));}}
  }
  const desktop=call('screenshot',{path:path.join(dir,'desktop.png')});
  assert.equal(desktop.width,screens.virtualBounds.width);assert.equal(desktop.height,screens.virtualBounds.height);
  assert.equal(request('screenshot',{layoutId:'stale',path:path.join(dir,'stale.png')}).error.code,'DISPLAY_CHANGED');
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({screens,results,desktop},null,2));
  console.log(`Real Windows DPI ${screens.monitors[0].dpiX}; additional simulated layout scales: ${scales.join(', ')}; evidence: ${dir}`);
});
