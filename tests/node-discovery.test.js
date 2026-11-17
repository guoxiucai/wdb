'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync,spawnSync}=require('node:child_process');
test('installer discovers safe system Node without executing untrusted candidates and reports remediation',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-node-discovery-'));
 const q=s=>"'"+s.replace(/'/g,"''")+"'";
 try{
  const first=path.join(dir,'first'),second=path.join(dir,'second');fs.mkdirSync(first);fs.mkdirSync(second);
  for(const d of [first,second])fs.writeFileSync(path.join(d,'node.exe'),'not executable');
  const script=path.join(dir,'check.ps1');fs.writeFileSync(script,`$env:ProgramFiles=${q(path.join(dir,'no-system-node'))}\n. ${q(path.resolve('scripts/resolve-node.ps1'))}\nFind-WdbNode -SearchPath ${q('relative;"'+first+'";'+second)}\n`);
  const env={...process.env};delete env.PSModulePath;delete env.PSMODULEPATH;
  const options={encoding:'utf8',windowsHide:true,env};
  const found=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],options).trim();
  assert.equal(fs.statSync(found).ino,fs.statSync(path.join(first,'node.exe')).ino);
  for(const candidate of [path.join(first,'node.exe'),path.join(dir,'missing.exe')]){
   const report=path.join(dir,'result.ini');const run=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/installer-node-check.ps1'),'-NodePath',candidate,'-ResultFile',report],options);
   assert.equal(run.status,1,run.stderr);const text=fs.readFileSync(report,'utf16le');assert.match(text,/Valid=0/);assert.match(text,/Path=.+node|Path=.+missing/);assert.match(text,/system-wide/);assert.match(text,/with-node installer/);assert.doesNotMatch(text,/could not start/);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
