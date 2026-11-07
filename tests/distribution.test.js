'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {sameContent}=require('../scripts/signature-content');
test('signing continuation accepts appended PowerShell signatures but rejects source changes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-signing-'));try{
  const original=path.join(dir,'before.ps1'),signed=path.join(dir,'after.ps1');fs.writeFileSync(original,'Write-Output "ready"\r\n');
  fs.writeFileSync(signed,'Write-Output "ready"\r\n# SIG # Begin signature block\r\n# test\r\n# SIG # End signature block\r\n');assert.equal(sameContent(original,signed),true);
  fs.writeFileSync(signed,'Write-Output "changed"\r\n# SIG # Begin signature block\r\n# test');assert.throws(()=>sameContent(original,signed));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('signing continuation rejects non-signable byte changes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-freeze-'));try{const a=path.join(dir,'a.js'),b=path.join(dir,'b.js');fs.writeFileSync(a,'original');fs.writeFileSync(b,'replacement');assert.throws(()=>sameContent(a,b));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('PE signing continuation allows certificate append but rejects code replacement',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-pe-signing-'));try{
  const original=path.join(dir,'original.exe'),signed=path.join(dir,'signed.exe'),a=Buffer.alloc(1024);a.write('MZ');a.writeUInt32LE(64,60);a.write('PE\0\0',64);a.writeUInt16LE(0x20b,88);a[500]=42;fs.writeFileSync(original,a);
  const b=Buffer.concat([a,Buffer.alloc(16)]);b.writeUInt32LE(1234,152);b.writeUInt32LE(1024,232);b.writeUInt32LE(16,236);fs.writeFileSync(signed,b);assert.equal(sameContent(original,signed),true);
  b[500]=43;fs.writeFileSync(signed,b);assert.throws(()=>sameContent(original,signed),/executable content/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('payload manifests reject changed, unlisted and escaping files',{skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-payload-integrity-'));
 try{
  const files=['package.json','BUILD-INFO.json','src/server.js','src/helper.js','src/task-events.js','src/runtime-guard.js','src/server-streams.js','src/pty-host.js','node_modules/ws/index.js','node_modules/ws/LICENSE','native/bin/PtyHost.exe','native/WdbServiceHost.exe','native/bin/DesktopBridge.exe','native/desktop.ps1','runtime/ffmpeg.exe','runtime/FFMPEG-LICENSE','runtime/FFMPEG-PROVENANCE.json','scripts/installer-action.ps1','scripts/resolve-node.ps1'];
  for(const file of files){fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),'fixture');}
  fs.writeFileSync(path.join(dir,'BUILD-INFO.json'),JSON.stringify({runtimeMode:'external-node',version:'0.1.0'}));fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({version:'0.1.0'}));
  const script=path.join(dir,'test.ps1'),payload=path.join(dir,'payload');fs.mkdirSync(payload);for(const file of files){fs.mkdirSync(path.dirname(path.join(payload,file)),{recursive:true});fs.renameSync(path.join(dir,file),path.join(payload,file));}
  const q=s=>"'"+s.replace(/'/g,"''")+"'";
  fs.writeFileSync(script,`$ErrorActionPreference='Stop'\n. ${q(path.join(__dirname,'../scripts/payload-common.ps1'))}\n$r=${q(payload)}\nWrite-WdbPayloadManifest $r\n$null=Test-WdbPayload $r\n[IO.File]::AppendAllText((Join-Path $r 'src/server.js'),'changed')\ntry{$null=Test-WdbPayload $r;throw 'accepted changed file'}catch{if($_.Exception.Message -notlike 'Payload missing or changed:*'){throw}}\nWrite-WdbPayloadManifest $r\n[IO.File]::WriteAllText((Join-Path $r 'unexpected.txt'),'extra')\ntry{$null=Test-WdbPayload $r;throw 'accepted unlisted file'}catch{if($_.Exception.Message -notlike 'Unlisted payload file:*'){throw}}\nRemove-Item -LiteralPath (Join-Path $r 'unexpected.txt')\n[IO.File]::AppendAllText((Join-Path $r 'PAYLOAD-SHA256SUMS.txt'),(('0'*64)+'  ../outside.txt'+[Environment]::NewLine))\ntry{$null=Test-WdbPayload $r;throw 'accepted traversal'}catch{if($_.Exception.Message -ne 'Unsafe or duplicate payload entry'){throw}}\n'passed'\n`);
  const env={...process.env};delete env.PSModulePath;delete env.PSMODULEPATH;
  assert.match(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,env}),/passed/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Windows external runtime rejects user-managed and missing Node before execution',{skip:process.platform!=='win32'},()=>{
 const script=path.join(__dirname,'../scripts/resolve-node.ps1').replace(/'/g,"''");
 const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',`$ErrorActionPreference='Stop'; . '${script}'; $results=@(); foreach($p in @('C:\\Users\\test\\node.exe','C:\\Program Files\\WdbMissing-${crypto.randomUUID()}\\node.exe')) { try { Resolve-WdbNode -RuntimeMode external-node -NodePath $p; throw 'Accepted invalid Node' } catch { $results += $_.Exception.Message } }; $results | ConvertTo-Json`],{encoding:'utf8',windowsHide:true});
 const errors=JSON.parse(result);assert.equal(errors.length,2);assert.ok(errors.every(e=>e.startsWith('Node runtime not found:')));
});
test('Windows service diagnostics return bounded JSON with plain log lines',{skip:process.platform!=='win32'},()=>{
 const env={...process.env};delete env.PSModulePath;delete env.PSMODULEPATH;
 const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'../scripts/service.ps1'),'diagnose'],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:256*1024,env});
 const result=JSON.parse(output);assert.ok(result.logs);assert.ok(Buffer.byteLength(output)<128*1024);for(const lines of Object.values(result.logs)){assert.ok(lines.length<=40);assert.ok(lines.every(line=>typeof line==='string'));}
});
test('Windows installer without SourceDirectory reaches its preflight guards',{skip:process.platform!=='win32'},()=>{
 const env={...process.env};delete env.PSModulePath;delete env.PSMODULEPATH;
 // A non-product path is rejected before any writes, including when tests run
 // elevated. This exercises the same omitted parameter as the real uninstaller.
 assert.throws(()=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'../scripts/installer-action.ps1'),'-Action','Preflight','-InstallDirectory',path.join(os.tmpdir(),'wdb-invalid-install-root')],{encoding:'utf8',windowsHide:true,timeout:10000,env,stdio:'pipe'}),error=>{
  const output=String(error.stderr);assert.match(output,/normal Windows administrator consent|fixed Program Files/);assert.doesNotMatch(output,/empty string|ParameterArgumentValidationErrorEmptyString/);return true;
 });
});
