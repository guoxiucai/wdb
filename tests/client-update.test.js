'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {compare,inspect,update}=require('../src/client-update');
function fixture(t,version='0.1.0'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-update-unit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const prefix=path.join(dir,'prefix 中文'),modules=path.join(prefix,process.platform==='win32'?'node_modules':'lib/node_modules'),root=path.join(modules,'@tsingwill/wdb');fs.mkdirSync(root,{recursive:true});
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@tsingwill/wdb',version,bin:{wdb:'bin/wdb.js'}}));fs.writeFileSync(path.join(root,'BUILD-INFO.json'),'{}');
 const calls=[],candidate={name:'@tsingwill/wdb',version:'0.2.0',engines:{node:'>=22'},dist:{integrity:'sha512-'+Buffer.alloc(64).toString('base64')}};
 const npm={async run(args){calls.push(args);if(args[0]==='root')return modules;if(args[0]==='--versions')return JSON.stringify({node:process.versions.node});if(args[0]==='config')return args[2]==='registry'?'https://registry.npmjs.org/':'undefined';if(args[0]==='view')return JSON.stringify(candidate);throw Error('Unexpected write '+args[0]);}};
 fs.mkdirSync(path.join(root,'skills/wdb'),{recursive:true});fs.writeFileSync(path.join(root,'skills/wdb/SKILL.md'),'---\nname: wdb\n---\n');fs.writeFileSync(path.join(root,'SKILL-MANIFEST.json'),JSON.stringify(require('../src/update-skills').makeManifest(root,{sourceCommit:'fixture'})));
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
test('macOS global layout is distinct from project-local node_modules',t=>{
 const f=fixture(t),mac=path.join(f.prefix,'lib/node_modules/@tsingwill/wdb');fs.mkdirSync(path.dirname(mac),{recursive:true});fs.renameSync(f.root,mac);const {installation}=require('../src/client-update');assert.equal(installation(mac,'darwin').prefix,fs.realpathSync(f.prefix));fs.writeFileSync(path.join(f.prefix,'package.json'),'{}');assert.equal(installation(mac,'darwin').supported,false);
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
test('confirmation defaults to no; JSON/check and no-TTY never install',async t=>{
 const f=fixture(t),options={config:path.join(f.dir,'profile')};let writes=0,output='';const io={stderr:{write:s=>output+=s},stdout:{write(){}}};const deps={...f,home:f.dir,cwd:f.dir,worker:async()=>{writes++;return {ok:true,data:{state:'updated'}};}};
 assert.equal((await update({...options,json:true},io,deps)).state,'update_available');assert.equal(writes,0);
 await assert.rejects(update(options,io,deps),{code:'CONFIRMATION_REQUIRED'});assert.equal(writes,0);
 for(const reply of ['','n','NO'])assert.equal((await update(options,io,{...deps,ask:async()=>reply})).state,'cancelled');assert.equal(writes,0);
 assert.match(output,/0.1.0 -> 0.2.0/);await update({...options,yes:true},io,deps);assert.equal(writes,1);
});
test('configuration or managed Skills inside the replaced program cannot be lost during update',async t=>{
 const f=fixture(t);await assert.rejects(update({check:true,config:path.join(f.root,'config')},{},f),{code:'UPDATE_TARGET_UNSAFE'});const skills=require('../src/update-skills'),dir=path.join(f.dir,'profile');skills.write(dir,{schema:1,installations:[{directory:path.join(f.root,'.agents/skills/wdb')}]});await assert.rejects(update({yes:true,'no-skill':true,config:dir},{},f),{code:'UPDATE_TARGET_UNSAFE'});
});
test('candidate stays pinned and concurrent installation changes fail before writing',async t=>{
 const f=fixture(t),{unchanged}=require('../src/update-worker');let plan;
 await update({config:path.join(f.dir,'profile')},{stderr:{write(){}}},{...f,home:f.dir,cwd:f.dir,ask:async()=>{fs.appendFileSync(path.join(f.root,'package.json'),' ');return 'yes';},worker:async p=>{plan=p;assert.throws(()=>unchanged(p),{code:'UPDATE_TARGET_CHANGED'});return {ok:true,data:p.data};}});
 assert.equal(plan.version,'0.2.0');assert.equal(plan.installCli,true);
});
test('partial Skill errors remain explicit and return recoverable details',async t=>{
 const f=fixture(t);await assert.rejects(update({yes:true,config:path.join(f.dir,'profile')},{stderr:{write(){}}},{...f,home:f.dir,cwd:f.dir,worker:async()=>({ok:false,error:{code:'UPDATE_SKILL_PARTIAL',message:'partial'},data:{updated:true,state:'updated_with_skill_errors',skills:[{state:'failed'}]}})}),e=>e.code==='UPDATE_SKILL_PARTIAL'&&e.extra.updated===true);
});
test('EOF and Ctrl+C cancel prompts and release their signal listeners',async()=>{
 const {PassThrough}=require('node:stream'),{question}=require('../src/client-update'),before=process.listenerCount('SIGINT');
 for(const signal of ['eof','sigint']){const input=new PassThrough(),pending=question('?',{stdin:input,stderr:{write(){}}});if(signal==='eof')input.end();else process.emit('SIGINT');assert.equal(await pending,'');assert.equal(process.listenerCount('SIGINT'),before);}
});
test('Ctrl+C while checking aborts the owned npm request and performs no update',async t=>{
 const f=fixture(t),before=process.listenerCount('SIGINT');let aborted=false;
 f.npm.run=(_args,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(Error('cancelled'),{code:'UPDATE_CANCELLED'}));},{once:true}));
 const pending=update({check:true,config:path.join(f.dir,'profile')},{},f);setImmediate(()=>process.emit('SIGINT'));const result=await pending;assert.equal(result.state,'cancelled');assert.equal(aborted,true);assert.equal(process.listenerCount('SIGINT'),before);assert.equal(fs.existsSync(path.join(f.dir,'profile')),false);
});
test('real external worker accepts the canonical temp plan and cleans its directory',async t=>{
 const f=fixture(t),{runWorker}=require('../src/client-update'),s=require('../src/update-skills');
 const root=fs.realpathSync(f.root),result=await runWorker({root,prefix:fs.realpathSync(f.prefix),packageHash:s.sha(fs.readFileSync(path.join(root,'package.json'))),data:{state:'up_to_date'},dataDir:path.join(f.dir,'profile'),installCli:false,noSkill:true,targets:[],npmCommand:{file:process.execPath,args:[]}});
 assert.equal(result.ok,true);assert.equal(result.data.state,'up_to_date');
});
