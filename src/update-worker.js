'use strict';
// Copied outside the installation before npm is allowed to replace any files.
const fs=require('node:fs'),path=require('node:path');
const {client,error,execute,json}=require('./npm-client'),skills=require('./update-skills'),{unpack}=require('./update-package');
function unchanged(plan){
 if(fs.realpathSync(plan.root)!==plan.root||skills.sha(fs.readFileSync(path.join(plan.root,'package.json')))!==plan.packageHash)throw error('UPDATE_TARGET_CHANGED','CLI installation changed after confirmation. Run update again.');
}
async function perform(plan,{signal}={}){
 const npm=client(plan.npmCommand),result={...plan.data,updated:false,skills:[]};let release;
 try{
  release=skills.lock(path.join(plan.prefix,'.wdb-client-update.lock'));unchanged(plan);skills.assertExternal(plan.root,plan.dataDir);
  let source=plan.root;
  if(plan.installCli){
   const packed=json(await npm.run(['pack','@tsingwill/wdb@'+plan.version,'--json','--ignore-scripts','--pack-destination',__dirname,...plan.registryArgs],{cwd:__dirname,signal,timeout:60000}));
   if(!Array.isArray(packed)||packed.length!==1||packed[0].name!=='@tsingwill/wdb'||packed[0].version!==plan.version||packed[0].integrity!==plan.integrity||path.basename(packed[0].filename)!==packed[0].filename)throw error('UPDATE_PACKAGE_INVALID','npm pack did not return the confirmed package.');
   const archive=path.join(__dirname,packed[0].filename);source=path.join(__dirname,'candidate');unpack(archive,source,{version:plan.version,integrity:plan.integrity});
   const installArgs=['install','--global','--prefix',plan.prefix,archive,'--ignore-scripts','--omit=optional','--engine-strict','--no-audit','--no-fund',...plan.registryArgs];
   await npm.run([...installArgs,'--dry-run'],{cwd:__dirname,signal,timeout:60000});unchanged(plan);
   try{await npm.run(installArgs,{cwd:__dirname,signal,timeout:180000});}catch(e){throw error(e.code==='UPDATE_NODE_INCOMPATIBLE'?e.code:e.code==='UPDATE_CANCELLED'?e.code:'UPDATE_INSTALL_FAILED','Installation did not complete successfully. Check the target version before retrying; no rollback is assumed.');}
   const pkg=JSON.parse(fs.readFileSync(path.join(plan.root,'package.json'),'utf8'));if(pkg.name!=='@tsingwill/wdb'||pkg.version!==plan.version)throw error('UPDATE_VERIFY_FAILED','Installed package identity/version differs from the confirmed version.');
   try{const verified=json(await execute(process.execPath,[path.join(plan.root,'bin/wdb.js'),'--version','--json'],{cwd:__dirname,timeout:15000,signal}));if(verified.data?.version!==plan.version||verified.status!=='succeeded')throw Error();}catch{throw error('UPDATE_VERIFY_FAILED','New CLI could not verify its installed version. Inspect the target before retrying.');}
   skills.bundle(plan.root);result.updated=true;result.installedVersion=plan.version;result.updateAvailable=false;
  }else{skills.bundle(source);}
  if(!plan.noSkill&&plan.targets.length)result.skills=skills.synchronize(source,plan.dataDir,plan.targets);
  const incomplete=result.skills.some(r=>r.state==='failed'||r.reason==='local_changes');
  result.skillUpdateAvailable=false;result.skillAttentionRequired=result.skills.some(r=>r.state==='failed'||r.state==='skipped');
  result.state=incomplete?'updated_with_skill_errors':result.updated?'updated':result.skills.some(r=>r.state==='updated')?'skills_updated':plan.data.state;
  if(incomplete)return {ok:false,data:result,error:{code:'UPDATE_SKILL_PARTIAL',message:'CLI and Skill results are listed separately. Conflicting/failed Skills were not reported as updated.'}};
  return {ok:true,data:result};
 }catch(e){
  let actualVersion;try{actualVersion=JSON.parse(fs.readFileSync(path.join(plan.root,'package.json'),'utf8')).version;}catch{}
  return {ok:false,data:{...result,state:'update_failed',actualVersion},error:{code:typeof e.code==='string'?e.code:'UPDATE_FAILED',message:typeof e.code==='string'&&e.code.startsWith('UPDATE_')?e.message:'Update failed. Inspect the installation and retained evidence before retrying.'}};
 }finally{release?.();}
}
if(require.main===module){
 const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.once('disconnect',()=>controller.abort());process.on('message',m=>{if(m?.type==='cancel')controller.abort();});
 (async()=>{const file=process.argv[2];if(path.dirname(file)!==__dirname||fs.statSync(file).size>8*1024*1024)throw Error('Invalid update plan');const plan=JSON.parse(fs.readFileSync(file,'utf8'));const result=await perform(plan,{signal:controller.signal});fs.writeFileSync(path.join(__dirname,'result.json'),JSON.stringify(result),{mode:0o600});if(process.connected)process.send(result,()=>process.disconnect());})().catch(()=>{if(process.connected)process.send({ok:false,error:{code:'UPDATE_WORKER_FAILED',message:'Updater failed before producing a verified result.'}},()=>process.disconnect());else process.exitCode=1;});
}
module.exports={perform,unchanged};
