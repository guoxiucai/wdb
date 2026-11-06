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
test('Windows external runtime rejects user-managed and missing Node before execution',{skip:process.platform!=='win32'},()=>{
 const script=path.join(__dirname,'../scripts/resolve-node.ps1').replace(/'/g,"''");
 const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',`$ErrorActionPreference='Stop'; . '${script}'; $results=@(); foreach($p in @('C:\\Users\\test\\node.exe','C:\\Program Files\\WdbMissing-${crypto.randomUUID()}\\node.exe')) { try { Resolve-WdbNode -RuntimeMode external-node -NodePath $p; throw 'Accepted invalid Node' } catch { $results += $_.Exception.Message } }; $results | ConvertTo-Json`],{encoding:'utf8',windowsHide:true});
 const errors=JSON.parse(result);assert.equal(errors.length,2);assert.ok(errors.every(e=>e.startsWith('Node runtime not found:')));
});
