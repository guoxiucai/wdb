'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {runOperation,psQuote}=require('../src/operations');const {powershell}=require('../src/common');
test('per-user applications are discoverable and explicit user deployment preserves identity',async t=>{
 const name='wdb-fixture-'+crypto.randomUUID(),key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+name,dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-apps-'));
 t.after(async()=>{await powershell('Remove-Item -LiteralPath '+psQuote(key)+' -ErrorAction SilentlyContinue');fs.rmSync(dir,{recursive:true,force:true});});
 const setup=await powershell('New-Item -Path '+psQuote(key)+' -Force | Out-Null; New-ItemProperty -LiteralPath '+psQuote(key)+' -Name DisplayName -Value '+psQuote(name)+' | Out-Null');assert.equal(setup.exitCode,0,setup.stderr);
 const ctx={id:crypto.randomUUID(),dir,timeoutMs:10000},config={isHelper:true};
 const listing=await runOperation('apps.list',{},ctx,config),app=listing.apps.find(a=>a.name===name);assert.ok(app);assert.equal(app.scope,'user');assert.equal(listing.userScopeAvailable,true);
 const marker=path.join(dir,'uninstall-ran');const result=await runOperation('apps.uninstall',{scope:'user',id:app.id,path:process.execPath,arguments:['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ok')`]},ctx,config);
 assert.equal(result.installerStatus,'succeeded');assert.equal(result.scope,'user');assert.ok(result.identity);assert.equal(fs.readFileSync(marker,'utf8'),'ok');
 await assert.rejects(runOperation('apps.install',{scope:'user',admin:true,path:process.execPath,arguments:[]},ctx,config),{code:'APP_SCOPE_CONFLICT'});
 await assert.rejects(runOperation('apps.uninstall',{scope:'user',id:'missing',path:process.execPath,arguments:[]},ctx,config),{code:'APPLICATION_NOT_FOUND'});
});
