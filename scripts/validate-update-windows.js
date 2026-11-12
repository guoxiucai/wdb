#!/usr/bin/env node
'use strict';
// Opt-in fixture registry and isolated real npm prefixes; never publishes.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFile,execFileSync}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile),{build}=require('./build-cli-npm'),{npm}=require('./npm-tools'),skills=require('../src/update-skills');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2]||path.join(root,'artifacts','update-live-'+Date.now()));
if(process.platform!=='win32')throw Error('This real-shim acceptance runs on Windows');if(fs.existsSync(output))throw Error('Use a new output directory');fs.mkdirSync(output,{recursive:true});
const report={status:'running',startedAt:new Date().toISOString(),cases:[],sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()},requests=[],versions={};let latest='0.1.1',registryFailure=false,server;
const prefix=path.join(output,'prefix 中文'),config=path.join(output,'client config'),project=path.join(output,'project 中文'),npmEntry=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
function save(){fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
async function check(name,fn){const start=Date.now();try{const evidence=await fn();report.cases.push({name,status:'pass',durationMs:Date.now()-start,evidence});console.log('pass '+name);}catch(e){report.cases.push({name,status:'fail',error:{code:e.code,message:e.message,stack:e.stack}});console.log('fail '+name+': '+e.message.slice(0,300));}save();}
async function processRun(file,args,env){try{return {...await exec(file,args,{env,cwd:output,windowsHide:true,windowsVerbatimArguments:path.basename(file).toLowerCase()==='cmd.exe',timeout:240000,maxBuffer:4*1024*1024}),code:0};}catch(e){if(typeof e.code!=='number')throw e;return {code:e.code,stdout:e.stdout,stderr:e.stderr};}}
function packageVersion(){return JSON.parse(fs.readFileSync(path.join(prefix,'node_modules/@tsingwill/wdb/package.json'),'utf8')).version;}
async function main(){
 const built=build({output:path.join(output,'build'),name:'@tsingwill/wdb',license:'MIT','license-file':path.join(root,'LICENSE')});
 const stage=path.join(output,'build/stage');
 for(const [version,engines] of [['0.1.0','>=22'],['0.1.1','>=22'],['0.1.2','>=22'],['0.1.3','>=99']]){
  const pkg=JSON.parse(fs.readFileSync(path.join(stage,'package.json')));pkg.version=version;pkg.engines.node=engines;fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(pkg));
  fs.writeFileSync(path.join(stage,'skills/wdb/references/update-fixture.md'),'Fixture Skill for '+version+'\n');fs.writeFileSync(path.join(stage,'SKILL-MANIFEST.json'),JSON.stringify(skills.makeManifest(stage,{sourceCommit:'fixture-'+version})));
  const packed=JSON.parse(npm(['pack','--json','--ignore-scripts','--pack-destination',output],{cwd:stage}))[0];versions[version]={pkg,filename:packed.filename,integrity:packed.integrity};
 }
 const wsPackage=path.dirname(require.resolve('ws/package.json')),ws=JSON.parse(fs.readFileSync(path.join(wsPackage,'package.json'))),wsPack=JSON.parse(npm(['pack',wsPackage,'--json','--ignore-scripts','--pack-destination',output],{cwd:output}))[0];
 const openssl=path.join(process.env.ProgramFiles,'Git/usr/bin/openssl.exe'),key=path.join(output,'key.private.pem'),cert=path.join(output,'cert.pem');execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore',windowsHide:true});
 let origin;
 server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{
  requests.push({method:req.method,path:req.url});res.setHeader('content-type','application/json');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('{}');return;}
  const pathname=decodeURIComponent(new URL(req.url,'https://localhost').pathname);
  if(pathname==='/@tsingwill/wdb'){
   if(registryFailure){res.writeHead(503);res.end('{}');return;}
   const rows={};for(const [version,v]of Object.entries(versions))rows[version]={...v.pkg,dist:{tarball:origin+'/tar/'+v.filename,integrity:v.integrity}};
   res.end(JSON.stringify({name:'@tsingwill/wdb','dist-tags':{latest},versions:rows}));return;
  }
  if(pathname==='/ws'){res.end(JSON.stringify({name:'ws','dist-tags':{latest:ws.version},versions:{[ws.version]:{...ws,dist:{tarball:origin+'/tar/'+wsPack.filename,integrity:wsPack.integrity}}}}));return;}
  const name=pathname.slice('/tar/'.length);if(pathname.startsWith('/tar/')&&path.basename(name)===name&&fs.existsSync(path.join(output,name))){res.setHeader('content-type','application/octet-stream');fs.createReadStream(path.join(output,name)).pipe(res);return;}
  res.writeHead(404);res.end('{}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='https://127.0.0.1:'+server.address().port;
 const userconfig=path.join(output,'npmrc.private');fs.writeFileSync(userconfig,`registry=${origin}/\n@tsingwill:registry=${origin}/\ncafile=${cert.replace(/\\/g,'/')}\nstrict-ssl=true\n`);
 fs.mkdirSync(config);fs.mkdirSync(project);const credentials=Buffer.from('{"devices":[{"token":"NON_SECRET_FIXTURE"}]}');fs.writeFileSync(path.join(config,'devices.json'),credentials);
 const env={...process.env,npm_config_userconfig:userconfig,npm_config_cache:path.join(output,'cache'),npm_config_update_notifier:'false',WDB_CONFIG:config,PATH:prefix+path.delimiter+process.env.PATH};
 const npmRun=args=>processRun(process.execPath,[npmEntry,...args,'--ignore-scripts','--omit=optional','--no-audit','--no-fund'],env);
 async function terminal(shim,flags,answer){
  const c=await require('../src/pty-host').openPty({kind:'shell',program:'cmd',admin:false,cwd:output,env:Object.fromEntries(['PATH','WDB_CONFIG','npm_config_userconfig','npm_config_cache','npm_config_update_notifier'].map(k=>[k,env[k]])),terminal:{cols:160,rows:40,term:'xterm-256color'}});
  let text='',consumed=0,exit,handled=0;const decoder=new (require('node:string_decoder').StringDecoder)('utf8');c.on('data',b=>{text+=decoder.write(b);consumed+=b.length;c.control({type:'credit',consumed});});c.on('control',m=>{if(m.type==='exit')exit=m;});const plain=()=>text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,''),write=s=>c.binary(Buffer.from(s));
  async function until(fn){const deadline=Date.now()+60000;while(!fn()){if(exit||Date.now()>deadline)throw Error('Interactive update deadline: '+plain().slice(-1000));await new Promise(r=>setTimeout(r,20));}}
  try{await c.ready();await until(()=>plain().includes('>'));write('"'+shim+'" update '+flags+'\r');
   await until(()=>{const p=plain();if(p.includes('Update this CLI and the listed managed Skills? [y/N]'))return true;const count=(p.match(/Back up and replace it with the packaged Skill\? \[y\/N\]/g)||[]).length;if(count>handled){handled=count;write('\r');}return false;});
   write(answer+'\r');await until(()=>plain().includes('WDB update: '+(answer?'updated':'cancelled')));write('exit\r');await until(()=>exit);assert.equal(exit.exitCode,0);return {confirmation:answer?'yes':'default-no',unmanagedAdoptionsDenied:handled};
  }finally{await c.dispose();}
 }
 async function cli(args){for(const arg of args)assert.ok(!/[%!"^&|<>\r\n]/.test(arg));const shim=path.join(prefix,'wdb.cmd'),command='""'+shim+'" '+args.map(a=>'"'+a+'"').join(' ')+'"';const p=await processRun(process.env.ComSpec||'cmd.exe',['/d','/s','/c',command],env);let result;try{result=JSON.parse(p.stdout);}catch{throw Error('Invalid updater stdout: '+p.stdout.slice(0,300)+' '+p.stderr.slice(0,300));}assert.deepEqual(fs.readFileSync(path.join(config,'devices.json')),credentials);return {...p,result};}
 try{
  await check('install real A package and register two bundled project Skills',async()=>{
   const install=await npmRun(['install','--global','--prefix',prefix,path.join(output,versions['0.1.0'].filename)]);assert.equal(install.code,0,install.stderr);
   const r=await processRun(process.execPath,[path.join(root,'scripts/install-skill.js'),'--agent','both','--scope','project','--project',project,'--yes'],env);assert.equal(r.code,0,r.stderr);assert.match(r.stdout,/Skill source: @tsingwill\/wdb @ 0.1.0/);const records=skills.read(config).installations;assert.equal(records.length,2);assert.ok(records.every(r=>r.version==='0.1.0'));return {version:packageVersion(),targets:records.length};
  });
  await check('JSON check and no-TTY confirmation cannot install',async()=>{
   const before=skills.sha(fs.readFileSync(path.join(prefix,'node_modules/@tsingwill/wdb/package.json'))),a=await cli(['update','--check','--json']);assert.equal(a.code,0,JSON.stringify(a.result));assert.equal(a.result.data.latestVersion,'0.1.1');assert.equal(a.result.data.updated,false);
   const b=await cli(['update','--json']);assert.equal(b.result.data.state,'update_available');
   const c=await cli(['update','--check','--yes','--json']);assert.equal(c.result.error.code,'INVALID_ARGUMENT');
   const entry=path.join(prefix,'node_modules/@tsingwill/wdb/bin/wdb.js'),d=await processRun(process.execPath,[entry,'update'],env);assert.equal(d.code,1);assert.match(d.stderr,/CONFIRMATION_REQUIRED/);
   assert.equal(skills.sha(fs.readFileSync(path.join(prefix,'node_modules/@tsingwill/wdb/package.json'))),before);
  });
  await check('real ConPTY default confirmation cancels without changing package/Skills',async()=>{const result=await terminal(path.join(prefix,'wdb.cmd'),'','');assert.equal(packageVersion(),'0.1.0');assert.ok(skills.read(config).installations.every(r=>r.version==='0.1.0'));return result;});
  await check('real ConPTY yes confirms a separate CLI-only update',async()=>{const another=path.join(output,'interactive prefix 中文');const installed=await npmRun(['install','--global','--prefix',another,path.join(output,versions['0.1.0'].filename)]);assert.equal(installed.code,0,installed.stderr);const result=await terminal(path.join(another,'wdb.cmd'),'--no-skill','yes');assert.equal(JSON.parse(fs.readFileSync(path.join(another,'node_modules/@tsingwill/wdb/package.json'))).version,'0.1.1');assert.ok(skills.read(config).installations.every(r=>r.version==='0.1.0'));return result;});
  await check('real running Windows cmd shim self-updates A to B and syncs exact Skills',async()=>{
   const r=await cli(['update','--yes','--json']);fs.writeFileSync(path.join(output,'upgrade-b.json'),JSON.stringify(r.result,null,2));assert.equal(r.code,0,JSON.stringify(r.result));assert.equal(r.result.data.updated,true);assert.equal(packageVersion(),'0.1.1');
   for(const record of skills.read(config).installations){assert.equal(record.version,'0.1.1');assert.equal(fs.readFileSync(path.join(record.directory,'references/update-fixture.md'),'utf8'),'Fixture Skill for 0.1.1\n');const result=r.result.data.skills.find(s=>s.directory===record.directory);assert.ok(result.backup&&!result.backup.includes(path.sep+'skills'+path.sep));assert.equal(fs.readFileSync(path.join(result.backup,'references/update-fixture.md'),'utf8'),'Fixture Skill for 0.1.0\n');}
   const version=await cli(['--version','--json']);assert.equal(version.result.data.version,'0.1.1');return {version:packageVersion(),shim:'wdb.cmd',skills:2};
  });
  await check('same version and older latest do not reinstall/downgrade',async()=>{
   const a=await cli(['update','--yes','--json']);assert.equal(a.result.data.state,'up_to_date');latest='0.1.0';const b=await cli(['update','--yes','--json']);assert.equal(b.result.data.state,'newer_than_release');assert.equal(packageVersion(),'0.1.1');latest='0.1.2';
  });
  await check('concurrent update lock prevents package writes',async()=>{
   const release=skills.lock(path.join(prefix,'.wdb-client-update.lock'));try{const r=await cli(['update','--yes','--json']);assert.equal(r.result.error.code,'UPDATE_IN_PROGRESS');assert.equal(packageVersion(),'0.1.1');}finally{release();}
  });
  await check('local Skill edits survive CLI upgrade and produce partial failure',async()=>{
   const directory=path.join(project,'.claude/skills/wdb');fs.writeFileSync(path.join(directory,'custom.md'),'KEEP_USER_CHANGES');const r=await cli(['update','--yes','--json']);fs.writeFileSync(path.join(output,'partial-c.json'),JSON.stringify(r.result,null,2));assert.equal(r.code,1);assert.equal(r.result.error.code,'UPDATE_SKILL_PARTIAL');assert.equal(r.result.data.updated,true);assert.equal(packageVersion(),'0.1.2');assert.equal(fs.readFileSync(path.join(directory,'custom.md'),'utf8'),'KEEP_USER_CHANGES');assert.equal(fs.readFileSync(path.join(project,'.agents/skills/wdb/references/update-fixture.md'),'utf8'),'Fixture Skill for 0.1.2\n');
  });
  await check('CLI current can repair an older managed Skill without reinstalling CLI',async()=>{
   const records=skills.read(config),record=records.installations.find(r=>r.agent==='claude');fs.unlinkSync(path.join(record.directory,'custom.md'));const before=requests.length;const r=await cli(['update','--yes','--json']);assert.equal(r.code,0,JSON.stringify(r.result));assert.equal(r.result.data.updated,false);assert.equal(r.result.data.state,'skills_updated');assert.equal(skills.read(config).installations.find(r=>r.agent==='claude').version,'0.1.2');assert.ok(!requests.slice(before).some(r=>r.path.startsWith('/tar/')));
  });
  await check('candidate Node engine incompatibility is rejected before replacing CLI',async()=>{
   latest='0.1.3';const r=await cli(['update','--yes','--json']);assert.equal(r.code,1);assert.equal(r.result.error.code,'UPDATE_NODE_INCOMPATIBLE');assert.equal(packageVersion(),'0.1.2');latest='0.1.2';
  });
  await check('registry failure is an error, never up-to-date',async()=>{registryFailure=true;try{const r=await cli(['update','--check','--json']);assert.equal(r.code,1);assert.notEqual(r.result.data?.state,'up_to_date');assert.equal(packageVersion(),'0.1.2');}finally{registryFailure=false;}});
  await check('no publish/config changes or leaked updater locks',async()=>{assert.ok(requests.every(r=>['GET','HEAD'].includes(r.method)));assert.equal(fs.existsSync(path.join(prefix,'.wdb-client-update.lock')),false);assert.equal(fs.existsSync(path.join(config,'.skill-installs.lock')),false);assert.deepEqual(fs.readFileSync(path.join(config,'devices.json')),credentials);});
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));report.status=report.cases.some(c=>c.status==='fail')?'fail':'pass';report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'requests.json'),JSON.stringify(requests,null,2));save();if(report.status!=='pass')process.exitCode=1;}
}
main().catch(e=>{report.status='fail';report.fatal={message:e.message,stack:e.stack};save();if(server){server.closeAllConnections();server.close();}console.error(e.stack);process.exitCode=1;});
