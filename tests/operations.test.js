'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {logFile}=require('../src/operations');
test('Chinese log tails preserve UTF8 boundaries and detect UTF16 BOM outside tail',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-log-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const utf8=path.join(dir,'utf8.log');fs.writeFileSync(utf8,'前缀中文 abc 后缀中文');const a=await logFile({path:utf8,limitBytes:13});assert.equal(a.encoding,'utf8');assert.ok(!a.text.includes('\uFFFD'));assert.equal(a.text,fs.readFileSync(utf8).subarray(a.offset).toString('utf8'));
 const utf16=path.join(dir,'utf16.log');fs.writeFileSync(utf16,Buffer.concat([Buffer.from([255,254]),Buffer.from('中文 UTF16 日志\n第二行','utf16le')]));const b=await logFile({path:utf16,limitBytes:13});assert.equal(b.encoding,'utf16le');assert.equal(b.offset%2,0);assert.ok(b.text.endsWith('第二行'));assert.ok(!b.text.includes('\uFFFD'));
});
