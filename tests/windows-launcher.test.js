'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('Windows launcher preserves arguments, stdin, cwd, binding and exit status',{skip:process.platform!=='win32'},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb launcher '));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'bin'));fs.mkdirSync(path.join(dir,'src'));
 const exe=path.join(dir,'bin/wdb.exe');
 const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const build=spawnSync(compiler,['/nologo','/target:exe','/platform:x64','/r:System.Web.Extensions.dll',`/out:${exe}`,path.join(root,'native/CliLauncher.cs')],{encoding:'utf8',windowsHide:true});assert.equal(build.status,0,build.stdout+build.stderr);
 fs.writeFileSync(path.join(dir,'src/cli.js'),"console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),stdin:require('fs').readFileSync(0,'utf8')}));process.exitCode=7;");
 const args=['','space name','中文🙂','quote"middle','C:\\path with space\\','&|<>%test%!'];
 for(const runtimeMode of ['with-node','external-node']){
  fs.writeFileSync(path.join(dir,'runtime-binding.json'),JSON.stringify({runtimeMode,path:process.execPath}));
  const r=spawnSync(exe,args,{cwd:dir,input:'input 中文',encoding:'utf8',windowsHide:true,env:{...process.env,PATH:''}});
  assert.equal(r.status,7,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{args,cwd:fs.realpathSync.native(dir),stdin:'input 中文'});
 }
 fs.writeFileSync(path.join(dir,'runtime-binding.json'),JSON.stringify({path:path.join(dir,'missing.exe')}));
 const missing=spawnSync(exe,[],{encoding:'utf8',windowsHide:true});assert.equal(missing.status,1);assert.match(missing.stderr,/runtime is missing/);
});
test('PATH registration preserves registry data and only removes installer-owned entries',{skip:process.platform!=='win32'},()=>{
 const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tests/machine-path-fixture.ps1'),'-Module',path.join(root,'scripts/machine-path.ps1')],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stdout+r.stderr);
});
