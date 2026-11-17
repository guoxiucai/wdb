'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
test('release verification requires four distinct combinations and signed-byte hashes',{skip:process.platform!=='win32'},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-four-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const artifacts=require('../packaging/windows/variants.json').map(v=>{const name=`wdb-server-0.1.1-windows-x64-${v.variantId}-Development-setup.exe`,bytes=Buffer.from(v.variantId);fs.writeFileSync(path.join(dir,name),bytes);return {name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
 const manifest={version:'0.1.1',signingMode:'Development',serverOnly:true,artifacts};const save=()=>fs.writeFileSync(path.join(dir,'release-manifest.json'),JSON.stringify(manifest));
 const verify=()=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/verify-release.ps1'),'-ReleaseDirectory',dir],{encoding:'utf8',windowsHide:true,stdio:'pipe'});
 save();assert.equal(JSON.parse(verify()).status,'verified');manifest.artifacts=artifacts.slice(0,3);save();assert.throws(verify);manifest.artifacts=[...artifacts.slice(0,3),artifacts[0]];save();assert.throws(verify);manifest.artifacts=artifacts;save();fs.appendFileSync(path.join(dir,artifacts[0].name),'altered');assert.throws(verify);
});
