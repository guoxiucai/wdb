'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {error}=require('./npm-client');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function dataDirectory(options={}){return path.resolve(options.config||process.env.WDB_CONFIG||(process.platform==='win32'?path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'wdb/client'):process.platform==='darwin'?path.join(os.homedir(),'Library/Application Support/wdb/client'):path.join(os.homedir(),'.config/wdb/client')));}
function safeRelative(p){return typeof p==='string'&&!/[\\:\x00-\x1f]/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!/[. ]$/.test(s)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));}
function snapshot(dir){
 if(!fs.existsSync(dir))return null;const rows=[];let bytes=0;
 function walk(folder,relative=''){if(fs.lstatSync(folder).isSymbolicLink())throw error('UPDATE_SKILL_UNSAFE','Linked Skill paths are not update targets.');for(const item of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,item.name),name=relative+item.name;if(item.isSymbolicLink())throw error('UPDATE_SKILL_UNSAFE','Linked Skill resources are not update targets.');if(item.isDirectory())walk(file,name+'/');else if(item.isFile()){bytes+=fs.statSync(file).size;if(rows.length>=256||bytes>5*1024*1024)throw error('UPDATE_SKILL_UNSAFE','Skill exceeds resource limits.');const b=fs.readFileSync(file);rows.push({path:name,bytes:b.length,sha256:sha(b)});}else throw error('UPDATE_SKILL_UNSAFE','Non-regular Skill resource.');}}
 walk(dir);return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
function sameFiles(a,b){const normalize=v=>v&&[...v].sort((a,b)=>a.path.localeCompare(b.path)).map(x=>[x.path,x.bytes,x.sha256]);return JSON.stringify(normalize(a))===JSON.stringify(normalize(b));}
function bundle(root){
 const m=JSON.parse(fs.readFileSync(path.join(root,'SKILL-MANIFEST.json'),'utf8')),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 if(m.schema!==1||m.package!==pkg.name||m.version!==pkg.version||!Array.isArray(m.files)||!m.files.length||m.files.length>256||!m.files.some(f=>f.path==='SKILL.md')||m.files.some(f=>!safeRelative(f.path)||!(/^[a-f0-9]{64}$/).test(f.sha256)))throw error('UPDATE_SKILL_INVALID','Invalid packaged Skill manifest.');
 if(!sameFiles(m.files,snapshot(path.join(root,'skills/wdb'))))throw error('UPDATE_SKILL_INVALID','Packaged Skill failed its content manifest.');return m;
}
function makeManifest(root,info){const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));return {schema:1,package:pkg.name,version:pkg.version,sourceCommit:info.sourceCommit,files:snapshot(path.join(root,'skills/wdb'))};}
function receiptFile(dir){return path.join(dir,'skill-installs.json');}
function read(dir){const file=receiptFile(dir);if(!fs.existsSync(file))return {schema:1,installations:[]};if(fs.statSync(file).size>2*1024*1024)throw error('UPDATE_SKILL_INVALID','Skill installation registry too large.');const r=JSON.parse(fs.readFileSync(file,'utf8'));if(r.schema!==1||!Array.isArray(r.installations)||r.installations.length>256)throw error('UPDATE_SKILL_INVALID','Invalid Skill installation registry.');return r;}
function write(dir,value){fs.mkdirSync(dir,{recursive:true,mode:0o700});if(fs.lstatSync(dir).isSymbolicLink()||fs.existsSync(receiptFile(dir))&&fs.lstatSync(receiptFile(dir)).isSymbolicLink())throw error('UPDATE_SKILL_UNSAFE','Linked update registry.');const temp=path.join(dir,'.skill-registry-'+crypto.randomUUID()+'.tmp');try{fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,receiptFile(dir));}finally{fs.rmSync(temp,{force:true});}}
function lock(dir){try{fs.mkdirSync(dir,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw error('UPDATE_IN_PROGRESS','An update/install lock exists. Inspect the owning process before retrying.');throw e;}try{fs.writeFileSync(path.join(dir,'owner.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});}catch(e){fs.rmdirSync(dir);throw e;}return ()=>{fs.unlinkSync(path.join(dir,'owner.json'));fs.rmdirSync(dir);};}
function target(record){
 if(!['codex','claude'].includes(record.agent)||!['user','project'].includes(record.scope)||!path.isAbsolute(record.base)||!path.isAbsolute(record.directory))throw error('UPDATE_SKILL_UNSAFE','Invalid registered Skill target.');
 const base=fs.realpathSync(record.base),parts=[record.agent==='codex'?'.agents':'.claude','skills','wdb'],directory=path.join(base,...parts);
 if(path.resolve(record.directory)!==directory)throw error('UPDATE_SKILL_UNSAFE','Skill target does not match its registered base.');let current=base;
 for(const part of parts){current=path.join(current,part);if(fs.existsSync(current)){const st=fs.lstatSync(current);if(st.isSymbolicLink()||!st.isDirectory())throw error('UPDATE_SKILL_UNSAFE','Linked/non-directory Skill target.');}}
 return {base,directory};
}
function preview(dir,desired,{home=os.homedir(),cwd=process.cwd()}={}){
 const rows=read(dir).installations,targets=rows.map(record=>{try{target(record);const actual=snapshot(record.directory);return {...record,state:actual&&!sameFiles(actual,record.files)?'conflict':actual&&record.version===desired.version&&sameFiles(actual,desired.files)?'current':'pending'};}catch{return {...record,state:'unavailable'};}});
 const seen=new Set(targets.map(t=>t.directory));for(const [scope,base] of [['user',home],['project',cwd]])for(const agent of ['codex','claude']){
  const directory=path.join(base,agent==='codex'?'.agents':'.claude','skills','wdb');if(!seen.has(directory)&&fs.existsSync(directory)){targets.push({agent,scope,base:fs.realpathSync(base),directory,state:'unmanaged'});seen.add(directory);}
 }
 return targets;
}
function removeStage(stage,parent){if(path.dirname(stage)!==parent||!path.basename(stage).startsWith('.wdb-stage-'))throw error('UPDATE_SKILL_UNSAFE','Invalid staging cleanup scope');fs.rmSync(stage,{recursive:true,force:true});}
function synchronize(root,dir,plans){
 const desired=bundle(root);fs.mkdirSync(dir,{recursive:true,mode:0o700});const release=lock(path.join(dir,'.skill-installs.lock')),results=[];
 try{
  const registry=read(dir);
  for(const plan of plans){
   if(plan.state==='unmanaged'){results.push({directory:plan.directory,state:'skipped',reason:'unmanaged'});continue;}
   let unlock,stage,parent,backup;
   try{
    const registered=registry.installations.find(r=>r.directory===plan.directory);if(!registered&&!plan.adopt)throw error('UPDATE_SKILL_CHANGED','Skill registration changed after confirmation.');
    const record=registered||plan;target(record);const actual=snapshot(record.directory);
    if(!sameFiles(actual,plan.observedFiles))throw error('UPDATE_SKILL_CHANGED','Skill files changed after confirmation.');
    if(actual&&!sameFiles(actual,record.files)&&!sameFiles(actual,desired.files)){results.push({directory:record.directory,state:'skipped',reason:'local_changes'});continue;}
    parent=path.dirname(record.directory);fs.mkdirSync(parent,{recursive:true,mode:0o700});target(record);unlock=lock(path.join(parent,'.wdb-install.lock'));if(!sameFiles(actual,snapshot(record.directory)))throw error('UPDATE_SKILL_CHANGED','Skill changed before the target lock was acquired.');
    if(!sameFiles(actual,desired.files)){
     stage=fs.mkdtempSync(path.join(parent,'.wdb-stage-'));
     for(const file of desired.files){const out=path.join(stage,...file.path.split('/'));fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});fs.copyFileSync(path.join(root,'skills/wdb',...file.path.split('/')),out);}
     if(actual){const backups=path.join(path.dirname(parent),'wdb-skill-backups');fs.mkdirSync(backups,{recursive:true,mode:0o700});if(fs.lstatSync(backups).isSymbolicLink())throw error('UPDATE_SKILL_UNSAFE','Linked Skill backup directory.');backup=path.join(backups,'wdb-'+Date.now()+'-'+crypto.randomUUID());fs.renameSync(record.directory,backup);}
     try{fs.renameSync(stage,record.directory);stage=null;}catch(e){if(backup)fs.renameSync(backup,record.directory);throw e;}
    }
    const saved={agent:record.agent,scope:record.scope,base:record.base,directory:record.directory,version:desired.version,sourceCommit:desired.sourceCommit,files:desired.files,updatedAt:new Date().toISOString()};
    registry.installations=registry.installations.filter(r=>r.directory!==saved.directory).concat(saved);write(dir,registry);
    results.push({directory:record.directory,state:sameFiles(actual,desired.files)?'current':'updated',version:desired.version,...(backup?{backup}:{})});
   }catch(e){results.push({directory:plan.directory,state:'failed',error:{code:e.code||'UPDATE_SKILL_FAILED',message:e.code?e.message:'Skill update failed. Inspect target and retained backup before retrying.'},...(backup?{backup}:{})});}
   finally{if(stage)removeStage(stage,parent);unlock?.();}
  }
 }finally{release();}
 return results;
}
module.exports={sha,dataDirectory,safeRelative,snapshot,sameFiles,bundle,makeManifest,read,write,lock,target,preview,synchronize};
