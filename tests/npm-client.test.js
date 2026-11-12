'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('npm failures classify engine errors and cancellation without exposing stderr secrets',async()=>{
 const {execute}=require('../src/npm-client');await assert.rejects(execute(process.execPath,['-e',"process.stderr.write('EBADENGINE secret-registry-token');process.exit(1)"]),e=>e.code==='UPDATE_NODE_INCOMPATIBLE'&&!JSON.stringify(e).includes('secret-registry-token'));
 const abort=new AbortController(),pending=execute(process.execPath,['-e','setTimeout(()=>{},30000)'],{signal:abort.signal});abort.abort();await assert.rejects(pending,{code:'UPDATE_CANCELLED'});
});
