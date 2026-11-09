#!/usr/bin/env node
'use strict';
// Shared by the two root bootstraps. No runtime dependencies beyond Node 22.
const fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const REPO='guoxiucai/wdb',PACKAGE='@tsingwill/wdb',MAX_BYTES=5*1024*1024;
const HELP=`WDB CLI + Skill installer (Node >=22)
  --agent codex|claude|both   --scope user|project
  --project <directory>      Existing project directory (default: current directory)
  --yes                      Replace existing wdb Skill with a retained backup
  --ref <revision>           Repository revision (default: main)
  --help
Missing agent/scope are prompted on the terminal, including curl ... | bash.
Only installs WDB CLI/Skill; does not install Node, an Agent, or Windows server.`;
function parseArgs(args){
 const o={ref:'main'};
 for(let i=0;i<args.length;i++){
  const key=args[i];if(key==='--yes'||key==='--help'){o[key.slice(2)]=true;continue;}
  if(!['--agent','--scope','--project','--ref'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Invalid arguments.\n'+HELP);
  o[key.slice(2)]=args[++i];
 }
 if(o.agent&&!['codex','claude','both'].includes(o.agent))throw Error('--agent must be codex, claude or both');
 if(o.scope&&!['user','project'].includes(o.scope))throw Error('--scope must be user or project');
 if(o.project&&o.scope==='user')throw Error('--project cannot be combined with --scope user');
 if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(o.ref))throw Error('Invalid repository revision');
 return o;
}
function targets({agent,scope,project},home=os.homedir(),cwd=process.cwd()){
 const base=path.resolve(scope==='user'?home:project||cwd);
 return (agent==='both'?['codex','claude']:[agent]).map(name=>({agent:name,base,directory:path.join(base,name==='codex'?'.agents':'.claude','skills','wdb')}));
}
function terminalPrompt(){
 const readline=require('node:readline');let input=process.stdin,output=process.stdout,owned=false;
 if(!input.isTTY){
  if(process.platform==='win32')throw Error('No interactive terminal. Supply --agent and --scope.');
  try{const tty=require('node:tty');input=new tty.ReadStream(syncFs.openSync('/dev/tty','r'));output=new tty.WriteStream(syncFs.openSync('/dev/tty','w'));owned=true;}catch{throw Error('No terminal. Supply --agent and --scope.');}
 }
 // Prevent an unavailable /dev/tty from turning into an unhandled stream error.
 const rl=readline.createInterface({input,terminal:false}),lines=rl[Symbol.asyncIterator]();
 let failure;input.on('error',e=>{failure=e;rl.close();});if(owned)output.on('error',e=>{failure=e;rl.close();});
 return {async ask(message){output.write(message);const next=await lines.next();if(failure||next.done)throw Error('No terminal input. Supply --agent and --scope (and --yes to replace an existing Skill).');return next.value.trim();},close(){rl.close();if(owned){input.destroy();output.destroy();}}};
}
async function choose(options,ask){
 const o={...options},promptedScope=!options.scope;
 while(!o.agent){const a=(await ask('Install Skill for: 1) Codex  2) Claude Code  3) Both [1]: ')).toLowerCase();o.agent=({'':'codex','1':'codex','2':'claude','3':'both',codex:'codex',claude:'claude',both:'both'})[a];}
 while(!o.scope){const a=(await ask('Install scope: 1) User (all projects)  2) Project [1]: ')).toLowerCase();o.scope=({'':'user','1':'user','2':'project',user:'user',project:'project'})[a];}
 if(o.project&&o.scope==='user')throw Error('A project path was supplied; select project scope.');
 if(o.scope==='project'&&!o.project){o.project=promptedScope?((await ask(`Project directory [${process.cwd()}]: `))||process.cwd()):process.cwd();}
 return o;
}
async function download(url,fetcher=fetch){
 const r=await fetcher(url,{headers:{'User-Agent':'wdb-skill-installer'},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error(`Download failed: HTTP ${r.status} (${url}). Check network access and rerun.`);
 const chunks=[];let size=0;
 for await(const chunk of r.body){size+=chunk.length;if(size>MAX_BYTES)throw Error('Download exceeds installer size limit');chunks.push(chunk);}
 return Buffer.concat(chunks);
}
async function fetchSkill(ref,{get=download}={}){
 const manifest=JSON.parse(await get(`https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(ref)}/scripts/skill-install-manifest.json`));
 const sha=manifest.sourceCommit,files=manifest.files;
 if(manifest.version!==1||!/^[a-f0-9]{40}$/.test(sha)||!Array.isArray(files))throw Error('Invalid Skill install manifest');
 if(!files.length||files.length>256)throw Error('Invalid Skill file count');
 const result=new Map();let total=0;
 for(const file of files){
  const relative=file.path;
  if(!['100644','100755'].includes(file.mode)||relative.split('/').some(p=>!p||p==='.'||p==='..')||/[\\:\x00-\x1f]/.test(relative)||relative.split('/').some(p=>/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('Unsafe Skill file: '+file.path);
  const key=relative.toLowerCase();if([...result.keys()].some(p=>p.toLowerCase()===key))throw Error('Duplicate Skill file: '+relative);
  const bytes=await get(`https://raw.githubusercontent.com/${REPO}/${sha}/skills/wdb/${file.path.split('/').map(encodeURIComponent).join('/')}`);
  total+=bytes.length;if(total>MAX_BYTES)throw Error('Skill exceeds installer size limit');
  const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  if(bytes.length!==file.bytes||hash!==file.sha256)throw Error('Skill SHA-256 verification failed: '+relative);
  result.set(relative,{bytes,mode:file.mode==='100755'?0o755:0o644});
 }
 if(!result.get('SKILL.md')?.bytes.toString().startsWith('---'))throw Error('Skill entry point is missing or invalid');
 return {sha,files:result};
}
function locate(name,env=process.env,platform=process.platform){
 for(const dir of (env.PATH||env.Path||'').split(path.delimiter)){
  if(!dir)continue;
  for(const ext of platform==='win32'?['.exe','.cmd','.bat','']:['']){
   const file=path.resolve(dir,name+ext);try{if(syncFs.statSync(file).isFile()){syncFs.accessSync(file,platform==='win32'?syncFs.constants.F_OK:syncFs.constants.X_OK);return file;}}catch{}
  }
 }
}
function invoke(file,args,options={}){
 if(process.platform==='win32'&&/\.(cmd|bat)$/i.test(file)){
  if(/[%"\r\n]/.test(file)||args.some(a=>!/^[a-z0-9@/._-]+$/i.test(a)))throw Error('Unsupported command shim path. Run from a standard Node/npm installation.');
  return spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`""${file}" ${args.join(' ')}"`],{...options,windowsHide:true,windowsVerbatimArguments:true});
 }
 return spawnSync(file,args,{...options,windowsHide:true});
}
function ensureCli({find=locate,run=invoke,log=console.log}={}){
 let cli=find('wdb');
 const works=file=>{const r=run(file,['--version','--json'],{encoding:'utf8',timeout:15000});try{return !r.error&&r.status===0&&/^\d+\.\d+\.\d+/.test(JSON.parse(r.stdout).data?.version||'');}catch{return false;}};
 if(cli&&works(cli)){log('Using existing WDB CLI: '+cli);return cli;}
 const npm=find('npm');if(!npm)throw Error('npm is missing. Install Node 24 LTS with npm, then rerun.');
 log('Installing @tsingwill/wdb from npm...');
 const installed=run(npm,['install','--global',PACKAGE],{stdio:'inherit',timeout:180000});
 if(installed.error||installed.status!==0)throw Error('npm installation failed. Check registry access/global-prefix permissions; no sudo or PATH changes were attempted.');
 cli=find('wdb');if(!cli||!works(cli))throw Error('CLI installed but wdb is not runnable on PATH. Add the npm global bin directory to PATH, open a new terminal and rerun.');
 log('WDB CLI ready: '+cli);return cli;
}
async function stat(file){try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function installSkill(target,skill,{yes=false,ask,log=console.log}={}){
 const base=await fs.realpath(target.base);if(!(await fs.stat(base)).isDirectory())throw Error('Not a directory: '+target.base);
 const relative=path.relative(target.base,target.directory);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Invalid installation target');
 let parent=base;
 for(const segment of relative.split(path.sep).slice(0,-1)){
  parent=path.join(parent,segment);await fs.mkdir(parent,{recursive:true,mode:0o700});
  const info=await fs.lstat(parent);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Refusing linked/non-directory Skill path: '+parent);
 }
 const destination=path.join(parent,'wdb'),lock=path.join(parent,'.wdb-install.lock');
 try{await fs.mkdir(lock);}catch(e){if(e.code==='EEXIST')throw Error('Another install may be active: '+lock);throw e;}
 let stage,backup;
 try{
  const existing=await stat(destination);
  if(existing&&(existing.isSymbolicLink()||!existing.isDirectory()))throw Error('Refusing to replace a linked/non-directory Skill: '+destination);
  if(existing&&!yes){const answer=await ask(`Existing Skill: ${destination}\nReplace it and retain a backup? [y/N]: `);if(!/^y(es)?$/i.test(answer))throw Error('Skill replacement cancelled; existing files preserved.');}
  stage=await fs.mkdtemp(path.join(parent,'.wdb-stage-'));
  for(const [file,{bytes,mode}] of skill.files){const output=path.join(stage,...file.split('/'));await fs.mkdir(path.dirname(output),{recursive:true,mode:0o700});await fs.writeFile(output,bytes,{flag:'wx',mode});}
  if(existing){const backupRoot=path.join(path.dirname(parent),'wdb-skill-backups');await fs.mkdir(backupRoot,{recursive:true,mode:0o700});if((await fs.lstat(backupRoot)).isSymbolicLink())throw Error('Refusing linked backup path: '+backupRoot);backup=path.join(backupRoot,`wdb-${Date.now()}-${crypto.randomUUID().slice(0,8)}`);await fs.rename(destination,backup);}
  try{await fs.rename(stage,destination);stage=null;}catch(e){if(backup)await fs.rename(backup,destination);throw e;}
  log('Installed '+target.agent+' Skill: '+destination);if(backup)log('Previous Skill retained at: '+backup);
  return {destination,backup,sha:skill.sha};
 }finally{if(stage)await fs.rm(stage,{recursive:true,force:true});await fs.rmdir(lock);}
}
async function main(argv=process.argv.slice(2)){
 const options=parseArgs(argv);if(options.help){console.log(HELP);return;}
 if(Number(process.versions.node.split('.')[0])<22)throw Error('Node >=22 is required');
 let prompt;const ask=message=>(prompt||=terminalPrompt()).ask(message);
 try{
  const chosen=await choose(options,ask),plan=targets(chosen);
  console.log('WDB Skill installation targets:');for(const target of plan){await fs.realpath(target.base);console.log('  '+target.agent+': '+target.directory);}
  const skill=await fetchSkill(chosen.ref);console.log('Skill source: '+REPO+' @ '+skill.sha);
  ensureCli();
  for(const target of plan)await installSkill(target,skill,{yes:chosen.yes,ask});
  console.log('Done. Start a new Claude Code / Codex session in the target project.');
  console.log('Ask the Agent to debug your Windows device and provide its address. First connection needs approval on Windows.');
  console.log('Windows server is installed separately: https://github.com/guoxiucai/wdb/releases/latest');
 }finally{prompt?.close();}
}
if(require.main===module)main().catch(e=>{console.error('WDB installation failed: '+e.message);process.exitCode=1;});
module.exports={parseArgs,targets,choose,fetchSkill,download,ensureCli,installSkill,main};
