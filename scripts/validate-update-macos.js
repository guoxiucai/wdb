#!/usr/bin/env node
'use strict';
// Opt-in fixture registry and isolated real npm prefixes; never publishes.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFile,execFileSync}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile),{build}=require('./build-cli-npm'),{npm}=require('./npm-tools'),skills=require('../src/update-skills');
const root=path.resolve(__dirname,'..'),output=path.resolve(process.argv[2]||path.join(root,'artifacts','update-live-'+Date.now()));
if(process.platform!=='darwin')throw Error('This real-shim acceptance runs on macOS');if(fs.existsSync(output))throw Error('Use a new output directory');fs.mkdirSync(output,{recursive:true});
const report={status:'running',startedAt:new Date().toISOString(),cases:[],sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()},requests=[],versions={};let latest='0.1.1',registryFailure=false,server;
const prefix=path.join(output,'prefix 中文'),config=path.join(output,'client config'),project=path.join(output,'project 中文'),npmEntry=require('../src/npm-client').npmCommand().args[0];
function save(){fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
async function check(name,fn){const start=Date.now();try{const evidence=await fn();report.cases.push({name,status:'pass',durationMs:Date.now()-start,evidence});console.log('pass '+name);}catch(e){report.cases.push({name,status:'fail',error:{code:e.code,message:e.message,stack:e.stack}});console.log('fail '+name+': '+e.message.slice(0,300));}save();}
async function processRun(file,args,env){try{return {...await exec(file,args,{env,cwd:output,windowsHide:true,windowsVerbatimArguments:path.basename(file).toLowerCase()==='cmd.exe',timeout:240000,maxBuffer:4*1024*1024}),code:0};}catch(e){if(typeof e.code!=='number')throw e;return {code:e.code,stdout:e.stdout,stderr:e.stderr};}}
function packageVersion(){return JSON.parse(fs.readFileSync(path.join(prefix,'lib/node_modules/@tsingwill/wdb/package.json'),'utf8')).version;}
async function main(){
 const built=build({output:path.join(output,'build'),name:'@tsingwill/wdb',license:'MIT','license-file':path.join(root,'LICENSE')});
 const stage=path.join(output,'build/stage');
 for(const [version,engines] of [['0.1.0','>=22'],['0.1.1','>=22'],['0.1.2','>=22'],['0.1.3','>=99']]){
  const pkg=JSON.parse(fs.readFileSync(path.join(stage,'package.json')));pkg.version=version;pkg.engines.node=engines;fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(pkg));
  fs.writeFileSync(path.join(stage,'skills/wdb/references/update-fixture.md'),'Fixture Skill for '+version+'\n');fs.writeFileSync(path.join(stage,'SKILL-MANIFEST.json'),JSON.stringify(skills.makeManifest(stage,{sourceCommit:'fixture-'+version})));
  const packed=JSON.parse(npm(['pack','--json','--ignore-scripts','--pack-destination',output],{cwd:stage}))[0];versions[version]={pkg,filename:packed.filename,integrity:packed.integrity};
 }
 const wsPackage=path.dirname(require.resolve('ws/package.json')),ws=JSON.parse(fs.readFileSync(path.join(wsPackage,'package.json'))),wsPack=JSON.parse(npm(['pack',wsPackage,'--json','--ignore-scripts','--pack-destination',output],{cwd:output}))[0];
 const openssl='openssl',key=path.join(output,'key.private.pem'),cert=path.join(output,'cert.pem');execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore',windowsHide:true});
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
 const env={...process.env,npm_config_userconfig:userconfig,npm_config_cache:path.join(output,'cache'),npm_config_update_notifier:'false',WDB_CONFIG:config,PATH:path.join(prefix,'bin')+path.delimiter+process.env.PATH};
 const npmRun=args=>processRun(process.execPath,[npmEntry,...args,'--ignore-scripts','--omit=optional','--no-audit','--no-fund'],env);
 async function terminal(shim,flags,answer){
  const driver=path.join(output,'terminal.py');
  fs.writeFileSync(driver,`import os, pty, select, sys, time, json, signal
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], [sys.argv[1], 'update'] + json.loads(sys.argv[2]))
text = b''
answered = False
handled = 0
try:
    deadline = time.monotonic() + 120
    while True:
        if time.monotonic() > deadline:
            raise RuntimeError('Interactive updater did not exit: ' + text[-1500:].decode('utf-8', errors='replace'))
        if select.select([fd], [], [], 0.05)[0]:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            text += chunk
        prompt = b'Back up and replace it with the packaged Skill? [y/N]'
        count = text.count(prompt)
        if count > handled:
            handled = count
            os.write(fd, bytes([13]))
        if not answered and b'Update this CLI and the listed managed Skills? [y/N]' in text:
            answered = True
            os.write(fd, sys.argv[3].encode() + bytes([13]))
    _, status = os.waitpid(pid, 0)
    if not answered or os.waitstatus_to_exitcode(status) != 0:
        raise RuntimeError(text.decode('utf-8', errors='replace'))
    expected = b'WDB update: ' + (b'updated' if sys.argv[3] else b'cancelled')
    if expected not in text:
        raise RuntimeError(text.decode('utf-8', errors='replace'))
    print(json.dumps({'confirmation': 'yes' if sys.argv[3] else 'default-no', 'unmanagedAdoptionsDenied': handled}))
finally:
    try:
        done, _ = os.waitpid(pid, os.WNOHANG)
        if not done:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    except ChildProcessError:
        pass
    os.close(fd)
`);
  const r=await processRun('python3',[driver,shim,JSON.stringify(flags?flags.split(' '):[]),answer],env);assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout);
 }
 async function cli(args){const p=await processRun(path.join(prefix,'bin/wdb'),args,env);let result;try{result=JSON.parse(p.stdout);}catch{throw Error('Invalid updater stdout: '+p.stdout.slice(0,300)+' '+p.stderr.slice(0,300));}assert.deepEqual(fs.readFileSync(path.join(config,'devices.json')),credentials);return {...p,result};}

 try{
  await check('install real A package and register two bundled project Skills',async()=>{
   const install=await npmRun(['install','--global','--prefix',prefix,path.join(output,versions['0.1.0'].filename)]);assert.equal(install.code,0,install.stderr);
   const r=await processRun(process.execPath,[path.join(root,'scripts/install-skill.js'),'--agent','both','--scope','project','--project',project,'--yes'],env);assert.equal(r.code,0,r.stderr);assert.match(r.stdout,/Skill source: @tsingwill\/wdb @ 0.1.0/);const records=skills.read(config).installations;assert.equal(records.length,2);assert.ok(records.every(r=>r.version==='0.1.0'));return {version:packageVersion(),targets:records.length};
  });
  await check('JSON check and no-TTY confirmation cannot install',async()=>{
   const before=skills.sha(fs.readFileSync(path.join(prefix,'lib/node_modules/@tsingwill/wdb/package.json'))),a=await cli(['update','--check','--json']);assert.equal(a.code,0,JSON.stringify(a.result));assert.equal(a.result.data.latestVersion,'0.1.1');assert.equal(a.result.data.updated,false);
   const b=await cli(['update','--json']);assert.equal(b.result.data.state,'update_available');
   const c=await cli(['update','--check','--yes','--json']);assert.equal(c.result.error.code,'INVALID_ARGUMENT');
   const entry=path.join(prefix,'lib/node_modules/@tsingwill/wdb/bin/wdb.js'),d=await processRun(process.execPath,[entry,'update'],env);assert.equal(d.code,1);assert.match(d.stderr,/CONFIRMATION_REQUIRED/);
   assert.equal(skills.sha(fs.readFileSync(path.join(prefix,'lib/node_modules/@tsingwill/wdb/package.json'))),before);
  });
  await check('real macOS PTY default confirmation cancels without changing package/Skills',async()=>{const result=await terminal(path.join(prefix,'bin/wdb'),'','');assert.equal(packageVersion(),'0.1.0');assert.ok(skills.read(config).installations.every(r=>r.version==='0.1.0'));return result;});
  await check('real macOS PTY yes confirms a separate CLI-only update',async()=>{const another=path.join(output,'interactive prefix 中文');const installed=await npmRun(['install','--global','--prefix',another,path.join(output,versions['0.1.0'].filename)]);assert.equal(installed.code,0,installed.stderr);const result=await terminal(path.join(another,'bin/wdb'),'--no-skill','yes');assert.equal(JSON.parse(fs.readFileSync(path.join(another,'lib/node_modules/@tsingwill/wdb/package.json'))).version,'0.1.1');assert.ok(skills.read(config).installations.every(r=>r.version==='0.1.0'));return result;});
  await check('real running macOS npm shim self-updates A to B and syncs exact Skills',async()=>{
   const r=await cli(['update','--yes','--json']);fs.writeFileSync(path.join(output,'upgrade-b.json'),JSON.stringify(r.result,null,2));assert.equal(r.code,0,JSON.stringify(r.result));assert.equal(r.result.data.updated,true);assert.equal(packageVersion(),'0.1.1');
   for(const record of skills.read(config).installations){assert.equal(record.version,'0.1.1');assert.equal(fs.readFileSync(path.join(record.directory,'references/update-fixture.md'),'utf8'),'Fixture Skill for 0.1.1\n');const result=r.result.data.skills.find(s=>s.directory===record.directory);assert.ok(result.backup&&!result.backup.includes(path.sep+'skills'+path.sep));assert.equal(fs.readFileSync(path.join(result.backup,'references/update-fixture.md'),'utf8'),'Fixture Skill for 0.1.0\n');}
   const version=await cli(['--version','--json']);assert.equal(version.result.data.version,'0.1.1');return {version:packageVersion(),shim:'bin/wdb',skills:2};
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
