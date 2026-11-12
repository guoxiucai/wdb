'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {compare,inspect,update}=require('../src/client-update');
function fixture(t,version='0.1.0'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-update-unit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const prefix=path.join(dir,'prefix 中文'),modules=path.join(prefix,process.platform==='win32'?'node_modules':'lib/node_modules'),root=path.join(modules,'@tsingwill/wdb');fs.mkdirSync(root,{recursive:true});
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@tsingwill/wdb',version,bin:{wdb:'bin/wdb.js'}}));fs.writeFileSync(path.join(root,'BUILD-INFO.json'),'{}');
 const calls=[],candidate={name:'@tsingwill/wdb',version:'0.2.0',engines:{node:'>=22'},dist:{integrity:'sha512-'+Buffer.alloc(64).toString('base64')}};
 const npm={async run(args){calls.push(args);if(args[0]==='root')return modules;if(args[0]==='--versions')return JSON.stringify({node:process.versions.node});if(args[0]==='config')return args[2]==='registry'?'https://registry.npmjs.org/':'undefined';if(args[0]==='view')return JSON.stringify(candidate);throw Error('Unexpected write '+args[0]);}};
 return {dir,prefix,modules,root,calls,candidate,npm};
}
test('stable versions compare numerically and malformed/prerelease metadata fails closed',()=>{
 assert.equal(compare('0.10.0','0.9.9'),1);assert.equal(compare('1.0.0','1.0.0'),0);assert.equal(compare('0.1.0','1.0.0'),-1);
 for(const value of ['0.2.0-beta','01.2.0','0.2','0.2.0+build'])assert.throws(()=>compare(value,'0.1.0'),{code:'UPDATE_METADATA_INVALID'});
});
test('read-only update freezes registry/version and never installs',async t=>{
 const f=fixture(t);const r=await update({check:true},{},f);assert.equal(r.state,'update_available');assert.equal(r.latestVersion,'0.2.0');assert.ok(f.calls.every(a=>!['install','pack'].includes(a[0])));
 assert.ok(f.calls.at(-1).includes('--@tsingwill:registry=https://registry.npmjs.org/'));
 f.candidate.version='0.1.0';assert.equal((await inspect(f)).data.state,'up_to_date');f.candidate.version='0.0.9';assert.equal((await inspect(f)).data.state,'newer_than_release');
});
test('source/server/private/local installs are not npm update targets',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify({name:'windows-debug-bridge',version:'0.1.0',private:true}));assert.equal((await update({check:true},{},f)).state,'unsupported_installation');assert.equal(f.calls.length,0);
});
test('metadata, mismatched npm runtime and network errors never become up-to-date',async t=>{
 const f=fixture(t);f.candidate.name='another-package';await assert.rejects(inspect(f),{code:'UPDATE_METADATA_INVALID'});f.candidate.name='@tsingwill/wdb';f.candidate.dist.integrity='bad';await assert.rejects(inspect(f),{code:'UPDATE_METADATA_INVALID'});
 const g=fixture(t);const run=g.npm.run.bind(g.npm);g.npm.run=async args=>args[0]==='--versions'?JSON.stringify({node:'18.0.0'}):run(args);await assert.rejects(inspect(g),{code:'UPDATE_NPM_RUNTIME_MISMATCH'});
 const h=fixture(t);h.npm.run=async()=>{throw Object.assign(Error('offline'),{code:'UPDATE_NPM_FAILED'});};await assert.rejects(update({check:true},{},h),{code:'UPDATE_NPM_FAILED'});
});
test('CLI update dispatch does not select a device or create its profile',async t=>{
 const f=fixture(t),profile=path.join(f.dir,'absent-profile');let stdout='';const code=await require('../src/cli').main(['update','--check','--json','--config',profile],{stdout:{write:s=>stdout+=s},stderr:{write(){}}});assert.equal(code,0);assert.equal(JSON.parse(stdout).data.state,'unsupported_installation');assert.equal(fs.existsSync(profile),false);
 await assert.rejects(update({check:true,yes:true},{},f),{code:'INVALID_ARGUMENT'});
});
module.exports={fixture};
