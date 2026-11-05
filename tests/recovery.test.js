'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {Bridge}=require('../src/server');
test('server restart writes cancellation for outstanding held input without replaying it',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-recovery-'));for(const f of ['tls.pfx','tls-password','helper-secret','pairing-code'])fs.copyFileSync(path.join(__dirname,'../.runtime/server',f),path.join(dir,f));
 const id='held-input',taskDir=path.join(dir,'tasks',id);fs.mkdirSync(taskDir,{recursive:true});fs.writeFileSync(path.join(taskDir,'task.json'),JSON.stringify({id,clientId:'test-client',op:'input.key',status:'running',createdAt:new Date().toISOString()}));
 const bridge=new Bridge({dataDir:dir});t.after(async()=>{await bridge.close();fs.rmSync(dir,{recursive:true,force:true});});assert.equal(bridge.tasks.get(id).status,'unknown');assert.equal(fs.readFileSync(path.join(taskDir,'cancel'),'utf8'),'SERVICE_RESTARTED');assert.equal(bridge.active.size,0);
});
