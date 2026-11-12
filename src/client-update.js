'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {error,client,json,locate}=require('./npm-client');
const PACKAGE='@tsingwill/wdb';
const skills=require('./update-skills');
function stable(value){if(typeof value!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))throw error('UPDATE_METADATA_INVALID','Only stable X.Y.Z releases are supported.');const parts=value.split('.').map(Number);if(parts.some(v=>!Number.isSafeInteger(v)))throw error('UPDATE_METADATA_INVALID','Invalid release version.');return parts;}
function compare(a,b){const x=stable(a),y=stable(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
function same(a,b){const normalize=s=>process.platform==='win32'?path.resolve(s).toLowerCase():path.resolve(s);return normalize(a)===normalize(b);}
function installation(root=path.resolve(__dirname,'..'),platform=process.platform){
 root=fs.realpathSync(root);const packageBytes=fs.readFileSync(path.join(root,'package.json')),pkg=JSON.parse(packageBytes);
 const unsupported={supported:false,root,currentVersion:pkg.version,reason:'Use the original installer for server/portable/source/local installations.'};
 if(pkg.name!==PACKAGE||pkg.private||pkg.bin?.wdb!=='bin/wdb.js'||!fs.existsSync(path.join(root,'BUILD-INFO.json')))return unsupported;
 const info=JSON.parse(fs.readFileSync(path.join(root,'BUILD-INFO.json'),'utf8'));if(info.development)return unsupported;
 const modules=path.dirname(path.dirname(root));if(path.basename(modules)!=='node_modules'||path.basename(path.dirname(root))!=='@tsingwill')return unsupported;
 let prefix=path.dirname(modules);if(platform!=='win32'){if(path.basename(prefix)!=='lib')return unsupported;prefix=path.dirname(prefix);}
 if(prefix.split(path.sep).includes('_npx')||fs.existsSync(path.join(prefix,'package.json')))return unsupported;
 stable(pkg.version);return {supported:true,root,prefix,currentVersion:pkg.version,pkg,packageHash:skills.sha(packageBytes)};
}
async function inspect({root,npm,signal}={}){
 const install=installation(root);if(!install.supported)return {install,npm,data:{package:PACKAGE,currentVersion:install.currentVersion,state:'unsupported_installation',updated:false,installationType:'unsupported',reason:install.reason}};
 npm ||= client();
 const call=(args,options)=>npm.run(args,{...options,signal});
 const cwd=os.tmpdir();const actualRoot=(await call(['root','--global','--prefix',install.prefix],{cwd,timeout:30000})).trim();
 if(!same(fs.realpathSync(path.join(actualRoot,PACKAGE)),install.root))throw error('UPDATE_INSTALLATION_UNSUPPORTED','npm global layout does not match the running CLI.');
 const runtime=json(await call(['--versions','--json'],{cwd,timeout:30000}));if(runtime.node!==process.versions.node)throw error('UPDATE_NPM_RUNTIME_MISMATCH','npm uses a different Node runtime. Select the matching Node/npm installation.');
 let registry=(await call(['config','get','@tsingwill:registry'],{cwd,timeout:30000})).trim();if(!registry||registry==='undefined'||registry==='null')registry=(await call(['config','get','registry'],{cwd,timeout:30000})).trim();
 let endpoint;try{endpoint=new URL(registry);}catch{throw error('UPDATE_METADATA_INVALID','Invalid npm registry.');}
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw error('UPDATE_REGISTRY_UNSUPPORTED','Updates require an HTTPS registry without URL credentials. Use npm authentication configuration.');
 const registryArgs=['--registry',endpoint.href,'--@tsingwill:registry='+endpoint.href];
 const candidate=json(await call(['view',PACKAGE+'@latest','name','version','engines','dist','--json','--prefer-online',...registryArgs],{cwd,timeout:45000}));
 if(candidate.name!==PACKAGE||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(candidate.dist?.integrity||''))throw error('UPDATE_METADATA_INVALID','Release identity or SHA512 integrity is missing.');
 const order=compare(candidate.version,install.currentVersion),pathEntry=locate('wdb'),shim=path.join(install.prefix,process.platform==='win32'?'wdb.cmd':'bin/wdb');
 return {install,npm,candidate,registryArgs,data:{package:PACKAGE,currentVersion:install.currentVersion,latestVersion:candidate.version,state:order>0?'update_available':order===0?'up_to_date':'newer_than_release',updateAvailable:order>0,updated:false,installationType:'npm-global',targetPath:install.root,registry:endpoint.href,pathShadowed:!!pathEntry&&!same(pathEntry,shim)}};
}
async function update(options,io,dependencies={}){
 const controller=new AbortController();let checking=true;const cancel=()=>controller.abort();process.on('SIGINT',cancel);
 try{return await updateInternal(options,io,{...dependencies,signal:controller.signal,onChecked:()=>{checking=false;}});}catch(e){if(checking&&controller.signal.aborted)return {package:PACKAGE,state:'cancelled',updated:false};throw e;}finally{process.removeListener('SIGINT',cancel);controller.abort();}
}
async function updateInternal(options,io,dependencies={}){
 if(options.check&&options.yes)throw error('INVALID_ARGUMENT','--check and --yes cannot be combined.');
 const context=await inspect(dependencies);dependencies.onChecked?.();
 if(dependencies.signal?.aborted)return {...context.data,state:'cancelled'};
 if(!context.install.supported){if(options.yes)throw error('UPDATE_INSTALLATION_UNSUPPORTED',context.data.reason);return context.data;}
 const dataDir=skills.dataDirectory(options);skills.assertExternal(context.install.root,dataDir);
 const desired=skills.bundle(context.install.root),targetVersion=context.data.updateAvailable?context.candidate.version:desired.version;
 const targets=options['no-skill']?[]:skills.preview(dataDir,{...desired,version:targetVersion},dependencies).map(row=>{let observedFiles;try{if(row.state!=='unmanaged')observedFiles=skills.snapshot(row.directory);}catch{}return {...row,observedFiles};});
 const summarize=()=>targets.map(({agent,scope,directory,state,version})=>({agent,scope,directory,state,version,targetVersion}));
 context.data.skills=summarize();context.data.skillUpdateAvailable=targets.some(t=>t.state==='pending');context.data.skillAttentionRequired=targets.some(t=>['conflict','unavailable','unmanaged'].includes(t.state));
 if(options.check||options.json&&!options.yes)return context.data;
 const interactive=!!dependencies.ask||!!(io.stdin?.isTTY&&(io.stderr?.isTTY||io.stdout?.isTTY));
 const ask=dependencies.ask||((text)=>question(text,io));
 if(!options.yes&&interactive)for(const row of targets.filter(t=>t.state==='unmanaged')){
  if(dependencies.signal?.aborted)return {...context.data,state:'cancelled'};
  if(/^y(es)?$/i.test((await ask(`Unregistered ${row.agent} Skill: ${row.directory}\nBack up and replace it with the packaged Skill? [y/N] `)).trim())){skills.target(row);row.files=skills.snapshot(row.directory);row.observedFiles=row.files;row.state='pending';row.adopt=true;}
 }
 if(dependencies.signal?.aborted)return {...context.data,state:'cancelled'};
 context.data.skills=summarize();const pending=targets.some(r=>r.state!=='current'&&r.state!=='unmanaged');
 if(!context.data.updateAvailable&&!pending)return context.data;
 io.stderr.write(`WDB CLI ${context.data.currentVersion} -> ${context.data.updateAvailable?context.data.latestVersion:context.data.currentVersion}\nRegistry: ${context.data.registry}\nTarget: ${context.install.root}\n`);
 if(context.candidate.engines?.node)io.stderr.write('Candidate Node requirement: '+JSON.stringify(context.candidate.engines.node)+'\n');
 for(const row of targets)io.stderr.write(`Skill ${row.agent} (${row.state}): ${row.directory}\n`);
 if(!options.yes){if(!interactive)throw error('CONFIRMATION_REQUIRED','No interactive terminal. Use --check, or --yes only after the user authorizes this update.',context.data);if(!/^y(es)?$/i.test((await ask('Update this CLI and the listed managed Skills? [y/N] ')).trim()))return {...context.data,state:'cancelled'};}
 if(dependencies.signal?.aborted)return {...context.data,state:'cancelled'};
 const plan={root:context.install.root,prefix:context.install.prefix,packageHash:context.install.packageHash,version:targetVersion,integrity:context.candidate.dist.integrity,registryArgs:context.registryArgs,npmCommand:context.npm.command,data:context.data,dataDir,installCli:context.data.updateAvailable,noSkill:!!options['no-skill'],targets};
 const result=await (dependencies.worker||runWorker)(plan);
 if(!result.ok)throw error(result.error.code,result.error.message,result.data);
 return result.data;
}
function question(text,io){return new Promise(resolve=>{const rl=require('node:readline').createInterface({input:io.stdin,terminal:false});let settled=false;const finish=value=>{if(settled)return;settled=true;process.removeListener('SIGINT',cancel);rl.close();resolve(value);},cancel=()=>finish('');process.once('SIGINT',cancel);rl.once('close',()=>finish(''));io.stderr.write(text);rl.question('',finish);});}
async function runWorker(plan){
 const {fork}=require('node:child_process'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'wdb-update-'));let success=false;
 try{
  for(const name of ['update-worker','update-skills','update-package','npm-client'])fs.copyFileSync(path.join(__dirname,name+'.js'),path.join(temp,name+'.js'));
  const file=path.join(temp,'plan.json');fs.writeFileSync(file,JSON.stringify(plan),{mode:0o600});
  const result=await new Promise((resolve,reject)=>{
   const child=fork(path.join(temp,'update-worker.js'),[file],{cwd:temp,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});let reply;
   const cancel=()=>{if(child.connected)child.send({type:'cancel'});};process.on('SIGINT',cancel);
   const timer=setTimeout(cancel,360000),deadline=setTimeout(()=>{child.kill();reject(error('UPDATE_OUTCOME_UNKNOWN','Updater exceeded its deadline. Inspect the retained result and installation before retrying.',{recoveryDirectory:temp}));},390000);
   const cleanup=()=>{clearTimeout(timer);clearTimeout(deadline);process.removeListener('SIGINT',cancel);};
   child.on('message',value=>{reply=value;});child.once('error',()=>{cleanup();reject(error('UPDATE_WORKER_FAILED','Could not start updater.',{recoveryDirectory:temp}));});
   child.once('exit',code=>{cleanup();if(reply&&typeof reply.ok==='boolean')resolve(reply);else reject(error('UPDATE_OUTCOME_UNKNOWN','Updater exited without a verified result.',{recoveryDirectory:temp,exitCode:code}));});
  });
  success=result.ok;if(!success)result.data={...result.data,recoveryDirectory:temp};return result;
 }finally{if(success){if(path.dirname(temp)!==os.tmpdir()||!path.basename(temp).startsWith('wdb-update-'))throw error('UPDATE_CLEANUP_FAILED','Unexpected updater directory.');fs.rmSync(temp,{recursive:true,force:true});}}
}
module.exports={PACKAGE,stable,compare,same,installation,inspect,update,question,runWorker};
