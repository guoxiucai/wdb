'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {execute}=require('../src/common');
test('completed shell process does not wait for inherited pipes held by detached descendant',async()=>{
 const code="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},3000)'],{stdio:['ignore',1,2],detached:true,windowsHide:true});child.unref();console.log('parent complete');";
 const result=await execute(process.execPath,['-e',code],{timeoutMs:5000});assert.equal(result.exitCode,0);assert.match(result.stdout,/parent complete/);assert.ok(result.durationMs<2000,JSON.stringify(result));assert.equal(result.truncated,true);
});
