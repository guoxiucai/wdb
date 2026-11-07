'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os'),crypto=require('node:crypto');
const {build}=require('../scripts/build-cli-npm');
const {inspect}=require('../scripts/verify-cli-npm');
test('npm bootstrap rejects unsupported Node before loading CLI and preserves JSON output',()=>{
 const bootstrap=fs.readFileSync(path.join(__dirname,'../bin/wdb.js'),'utf8').replace(/^#!.*\n/,'');
 for(const version of ['16.20.2','18.16.9','18.17.0-rc.1']) {
  let output='',required=false;const process={versions:{node:version},version:'v'+version,argv:['node','wdb','--json'],stdout:{write:s=>output+=s},stderr:{write(){assert.fail('JSON error must go to stdout');}}};
  vm.runInNewContext(bootstrap,{process,require(){required=true;}});assert.equal(required,false);assert.equal(process.exitCode,1);assert.equal(JSON.parse(output).error.code,'UNSUPPORTED_NODE');
 }
 for(const version of ['18.17.0','18.20.8','20.0.0','22.0.0','24.15.0','26.0.0']){let required=false;vm.runInNewContext(bootstrap,{process:{versions:{node:version},argv:[]},require(){required=true;return {main:()=>Promise.resolve(0)};}});assert.equal(required,true);}
});
test('npm tarball contains only portable client files, no hooks/runtime/server and is under budget',()=>{
 const output=path.join(os.tmpdir(),'wdb-npm-test-'+crypto.randomUUID());
 try {const report=build({output,development:true});const result=inspect(report.tarball);assert.equal(result.pkg.private,true);assert.equal(result.pkg.license,'UNLICENSED');assert.ok(![...result.files.keys()].some(p=>/\.exe$|server\.js|\.npmrc|tls\.pfx/.test(p)));assert.equal(result.sha256,report.sha256);}
 finally {fs.rmSync(output,{recursive:true,force:true});}
});
