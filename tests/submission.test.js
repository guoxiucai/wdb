'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Bridge}=require('../src/server');
test('submission deduplication survives restart, rejects conflicting content, and preserves client isolation',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-submission-'));
 for(const name of ['tls.pfx','tls-password','helper-secret','pairing-code'])fs.copyFileSync(path.join(__dirname,'../.runtime/server',name),path.join(dir,name));
 let bridge=new Bridge({dataDir:dir});t.after(async()=>{await bridge.close();fs.rmSync(dir,{recursive:true,force:true});});
 const a={id:'client-a'},b={id:'client-b'},submissionId=crypto.randomUUID(),body={submissionId,op:'logs.file',args:{path:path.join(dir,'pairing-code')}};
 const first=await bridge.submit(a,body),second=await bridge.submit(a,body);assert.equal(first.id,second.id);assert.equal(bridge.tasks.size,1);
 await assert.rejects(bridge.submit(a,{...body,args:{path:'different'}}),{code:'SUBMISSION_CONFLICT'});
 const isolated=await bridge.submit(b,body);assert.notEqual(isolated.id,first.id);
 while(bridge.active.size)await new Promise(r=>setTimeout(r,10));await bridge.close();
 // Simulate a crash after acceptance: persisted status must become unknown, never execute again.
 const taskFile=path.join(dir,'tasks',first.id,'task.json'),persisted=JSON.parse(fs.readFileSync(taskFile));persisted.status='running';delete persisted.data;fs.writeFileSync(taskFile,JSON.stringify(persisted));
 bridge=new Bridge({dataDir:dir});const recovered=await bridge.submit(a,body);assert.equal(recovered.id,first.id);assert.equal(recovered.status,'unknown');assert.equal(recovered.error.code,'SERVICE_RESTARTED');assert.equal(bridge.active.size,0);
 await assert.rejects(bridge.submit(a,{...body,submissionId:'invalid'}),{code:'INVALID_SUBMISSION_ID'});
});
