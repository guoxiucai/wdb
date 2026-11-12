'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const s=require('../src/update-skills');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-skill-update-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const root=path.join(dir,'package'),base=path.join(dir,'project 中文'),data=path.join(dir,'data');fs.mkdirSync(path.join(root,'skills/wdb/references'),{recursive:true});fs.mkdirSync(base);fs.mkdirSync(data);fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@tsingwill/wdb',version:'0.2.0'}));fs.writeFileSync(path.join(root,'skills/wdb/SKILL.md'),'---\nname: wdb\n---\nnew');fs.writeFileSync(path.join(root,'skills/wdb/references/cli.md'),'new guide');const m=s.makeManifest(root,{sourceCommit:'fixture'});fs.writeFileSync(path.join(root,'SKILL-MANIFEST.json'),JSON.stringify(m));return {dir,root,base,data,m};}
test('managed user/project targets update atomically with backups outside discovery',t=>{
 const f=setup(t);const records=[];for(const agent of ['codex','claude']){const directory=path.join(f.base,agent==='codex'?'.agents':'.claude','skills/wdb');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'SKILL.md'),'old');records.push({agent,scope:'project',base:f.base,directory,version:'0.1.0',files:s.snapshot(directory)});}s.write(f.data,{schema:1,installations:records});
 const plans=s.preview(f.data,{version:'0.2.0',files:f.m.files},{home:f.base,cwd:f.base}).map(r=>({...r,observedFiles:s.snapshot(r.directory)}));const results=s.synchronize(f.root,f.data,plans);assert.equal(results.length,2);for(const r of results){assert.equal(r.state,'updated');assert.equal(fs.readFileSync(path.join(r.backup,'SKILL.md'),'utf8'),'old');assert.ok(!r.backup.startsWith(path.dirname(r.directory)+path.sep));assert.ok(s.sameFiles(s.snapshot(r.directory),f.m.files));}assert.ok(s.read(f.data).installations.every(r=>r.version==='0.2.0'));
});
test('local edits, changes after preview and unsafe registrations never overwrite a Skill',t=>{
 const f=setup(t),directory=path.join(f.base,'.agents/skills/wdb');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'SKILL.md'),'old');const record={agent:'codex',scope:'project',base:f.base,directory,files:s.snapshot(directory)};s.write(f.data,{schema:1,installations:[record]});fs.writeFileSync(path.join(directory,'custom.md'),'user');let plan={...record,observedFiles:s.snapshot(directory)};assert.equal(s.synchronize(f.root,f.data,[plan])[0].reason,'local_changes');assert.equal(fs.readFileSync(path.join(directory,'custom.md'),'utf8'),'user');fs.writeFileSync(path.join(directory,'later.md'),'later');assert.equal(s.synchronize(f.root,f.data,[plan])[0].error.code,'UPDATE_SKILL_CHANGED');assert.throws(()=>s.target({...record,directory:f.dir}),{code:'UPDATE_SKILL_UNSAFE'});
});
test('unregistered Skills are discovered but never replaced without adoption',t=>{
 const f=setup(t),directory=path.join(f.base,'.agents/skills/wdb');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'SKILL.md'),'local');const plan=s.preview(f.data,f.m,{home:f.base,cwd:f.base});assert.equal(plan[0].state,'unmanaged');assert.equal(s.synchronize(f.root,f.data,plan)[0].reason,'unmanaged');assert.equal(fs.readFileSync(path.join(directory,'SKILL.md'),'utf8'),'local');
});
test('bundle tampering and concurrent update locks fail closed',t=>{
 const f=setup(t);assert.equal(s.bundle(f.root).version,'0.2.0');fs.appendFileSync(path.join(f.root,'skills/wdb/SKILL.md'),'changed');assert.throws(()=>s.bundle(f.root),{code:'UPDATE_SKILL_INVALID'});const file=path.join(f.dir,'lock'),release=s.lock(file);assert.throws(()=>s.lock(file),{code:'UPDATE_IN_PROGRESS'});release();assert.equal(fs.existsSync(file),false);
});
test('directory junctions/symlinks cannot redirect Skill updates outside the registered base',t=>{
 const f=setup(t),outside=path.join(f.dir,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'keep');fs.symlinkSync(outside,path.join(f.base,'.agents'),process.platform==='win32'?'junction':'dir');const record={agent:'codex',scope:'project',base:f.base,directory:path.join(f.base,'.agents/skills/wdb'),files:null,observedFiles:null};const result=s.synchronize(f.root,f.data,[{...record,adopt:true}]);assert.equal(result[0].error.code,'UPDATE_SKILL_UNSAFE');assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'keep');assert.equal(fs.existsSync(path.join(outside,'skills')),false);
});
test('base aliases resolve consistently for discovered and previously registered Skills',t=>{
 const f=setup(t),alias=path.join(f.dir,'project alias');fs.symlinkSync(f.base,alias,process.platform==='win32'?'junction':'dir');
 const directory=path.join(alias,'.agents/skills/wdb');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'SKILL.md'),'old');
 const record={agent:'codex',scope:'project',base:alias,directory,version:'0.1.0',files:s.snapshot(directory)};
 assert.equal(s.target(record).directory,fs.realpathSync(directory));
 s.write(f.data,{schema:1,installations:[record]});
 let plans=s.preview(f.data,f.m,{home:alias,cwd:alias}).map(row=>({...row,observedFiles:s.snapshot(row.directory)}));assert.equal(plans.length,1);assert.equal(plans[0].state,'pending');
 assert.equal(s.synchronize(f.root,f.data,plans)[0].state,'updated');
 s.write(f.data,{schema:1,installations:[]});plans=s.preview(f.data,f.m,{home:alias,cwd:alias});assert.equal(plans.length,1);assert.equal(plans[0].directory,fs.realpathSync(directory));assert.doesNotThrow(()=>s.target(plans[0]));
});
