'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {execute}=require('../src/common');
for(const exe of [path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),'pwsh.exe']){
 test(`installer preserves service command line and detects errors under ${path.basename(exe)}`,async t=>{
   let result;try{result=await execute(exe,['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'service-config.test.ps1')],{timeoutMs:15000});}catch(e){if(e.code==='ENOENT'&&exe==='pwsh.exe'){t.skip('Optional PowerShell 7 not installed');return;}throw e;}
   assert.equal(result.exitCode,0,result.stdout+result.stderr);assert.match(result.stdout,/PASS:/);
 });
}
