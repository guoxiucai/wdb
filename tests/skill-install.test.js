'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {parseArgs,targets,choose,fetchSkill,download,ensureCli,installSkill}=require('../scripts/install-skill');
const sha='a'.repeat(40);
function fixtureFiles(){return new Map([['SKILL.md',{bytes:Buffer.from('---\nname: wdb\ndescription: test\n---\n'),mode:0o644}],['references/说明.md',{bytes:Buffer.from('完整的参考内容'),mode:0o644}]]);}
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'wdb-install-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('arguments, both agent locations, project spaces/Unicode and interactive choices',async()=>{
 assert.throws(()=>parseArgs(['--scope','system']),/scope/);assert.throws(()=>parseArgs(['--agent']),/arguments/);assert.throws(()=>parseArgs(['--project','x','--scope','user']),/cannot/);
 const home=path.resolve('user home'),project=path.resolve('中文 project');
 assert.deepEqual(targets({agent:'both',scope:'user'},home).map(t=>t.directory),[path.join(home,'.agents/skills/wdb'),path.join(home,'.claude/skills/wdb')]);
 assert.deepEqual(targets({agent:'both',scope:'project',project},home).map(t=>t.directory),[path.join(project,'.agents/skills/wdb'),path.join(project,'.claude/skills/wdb')]);
 const answers=['wrong','3','2',project];const result=await choose({},async()=>answers.shift());assert.equal(result.agent,'both');assert.equal(result.scope,'project');assert.equal(result.project,project);
});
test('CLI reuse avoids npm; missing/broken CLI installs once and verifies result',()=>{
 const good={status:0,stdout:JSON.stringify({data:{version:'0.1.0'}})};let installs=0,ready=false;
 assert.equal(ensureCli({find:n=>n==='wdb'?'/wdb':undefined,run:()=>good,log(){}}),'/wdb');
 const found=ensureCli({find:n=>n==='npm'?'/npm':ready?'/wdb':undefined,run:(file,args)=>{if(args[0]==='install'){installs++;ready=true;assert.deepEqual(args,['install','--global','@tsingwill/wdb']);return {status:0};}return good;},log(){}});
 assert.equal(found,'/wdb');assert.equal(installs,1);
 assert.throws(()=>ensureCli({find:n=>'/'+n,run:()=>({status:1}),log(){}}),/npm installation failed/);
});
test('downloads pinned Skill files without GitHub API, verifies hashes and rejects bad manifests',async()=>{
 const payload=fixtureFiles(),urls=[];
 const tree=[...payload].map(([file,{bytes}])=>({path:file,mode:'100644',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
 const get=async url=>{urls.push(url);if(url.endsWith('/scripts/skill-install-manifest.json'))return Buffer.from(JSON.stringify({version:1,sourceCommit:sha,files:tree}));const name=decodeURIComponent(url.split('/skills/wdb/')[1]);return payload.get(name).bytes;};
 const skill=await fetchSkill('main',{get});assert.equal(skill.sha,sha);assert.equal(skill.files.size,2);assert.ok(urls.filter(u=>u.includes('/skills/wdb/')).every(u=>u.includes('/'+sha+'/')));assert.ok(urls.every(u=>!u.includes('api.github')));
 await assert.rejects(fetchSkill(sha,{get:async()=>Buffer.from(JSON.stringify({version:2,sourceCommit:sha,files:[]}))}),/Invalid/);
 for(const item of [{path:'../outside',mode:'100644'},{path:'link',mode:'120000'},{path:'CON.txt',mode:'100644'}]){
  await assert.rejects(fetchSkill(sha,{get:async()=>Buffer.from(JSON.stringify({version:1,sourceCommit:sha,files:[item]}))}),/Unsafe/);
 }
 await assert.rejects(fetchSkill(sha,{get:async url=>url.endsWith('/scripts/skill-install-manifest.json')?Buffer.from(JSON.stringify({version:1,sourceCommit:sha,files:tree})):Buffer.from('corrupt')}),/verification failed/);
 await assert.rejects(download('https://test.invalid',async()=>new Response('missing',{status:404})),/HTTP 404/);
});
test('all four destinations contain complete resources; existing files are backed up outside discovery',async t=>{
 const root=await temporary(t),home=path.join(root,'home'),project=path.join(root,'中文 project');await fs.mkdir(home);await fs.mkdir(project);
 const skill={sha,files:fixtureFiles()};
 for(const scope of ['user','project'])for(const target of targets({agent:'both',scope,project},home)){
  await installSkill(target,skill,{log(){}});assert.equal(await fs.readFile(path.join(target.directory,'references/说明.md'),'utf8'),'完整的参考内容');
  await fs.writeFile(path.join(target.directory,'custom.txt'),'keep');
  await assert.rejects(installSkill(target,skill,{ask:async()=> 'n',log(){}}),/cancelled/);
  assert.equal(await fs.readFile(path.join(target.directory,'custom.txt'),'utf8'),'keep');
  const result=await installSkill(target,skill,{yes:true,log(){}});assert.ok(!result.backup.startsWith(path.dirname(target.directory)+path.sep));
  assert.equal(await fs.readFile(path.join(result.backup,'custom.txt'),'utf8'),'keep');
  await assert.rejects(fs.stat(path.join(target.directory,'custom.txt')),{code:'ENOENT'});
 }
});
test('failed staging preserves an existing Skill; linked targets and concurrent installs are refused',async t=>{
 const root=await temporary(t),target=targets({agent:'codex',scope:'user'},root)[0],skill={sha,files:fixtureFiles()};await installSkill(target,skill,{log(){}});
 const old=await fs.readFile(path.join(target.directory,'SKILL.md'));
 await assert.rejects(installSkill(target,{sha,files:new Map([['broken',{bytes:null}]])},{yes:true,log(){}}));assert.deepEqual(await fs.readFile(path.join(target.directory,'SKILL.md')),old);
 const lock=path.join(path.dirname(target.directory),'.wdb-install.lock');await fs.mkdir(lock);await assert.rejects(installSkill(target,skill,{yes:true}),/Another install/);await fs.rmdir(lock);
 if(process.platform!=='win32'){
  await fs.rm(target.directory,{recursive:true});const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.symlink(outside,target.directory);
  await assert.rejects(installSkill(target,skill,{yes:true}),/linked/);assert.deepEqual(await fs.readdir(outside),[]);
 }
 assert.ok(!(await fs.readdir(path.dirname(target.directory))).some(n=>n.startsWith('.wdb-stage-')));
});

test('download-and-run bootstrap installs through npm and copies resources without a repository checkout',async t=>{
 const {spawnSync}=require('node:child_process');const root=await temporary(t),bin=path.join(root,'bin'),project=path.join(root,'独立 project');await fs.mkdir(bin);await fs.mkdir(project);
 const payload=fixtureFiles(),tree=[...payload].map(([file,{bytes}])=>({path:file,mode:'100644',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
 const responses={};responses['https://raw.githubusercontent.com/guoxiucai/wdb/main/scripts/skill-install-manifest.json']=JSON.stringify({version:1,sourceCommit:sha,files:tree});responses[`https://raw.githubusercontent.com/guoxiucai/wdb/${sha}/scripts/skill-install-manifest.json`]=JSON.stringify({version:1,sourceCommit:sha,files:tree});
 responses['https://raw.githubusercontent.com/guoxiucai/wdb/main/scripts/install-skill.js']=await fs.readFile(path.join(__dirname,'../scripts/install-skill.js'),'utf8');
 for(const [file,{bytes}] of payload)responses[`https://raw.githubusercontent.com/guoxiucai/wdb/${sha}/skills/wdb/${file.split('/').map(encodeURIComponent).join('/')}`]=bytes.toString();
 const data=path.join(root,'responses.json');await fs.writeFile(data,JSON.stringify(responses));
 const preload=path.join(root,'preload.cjs');await fs.writeFile(preload,`const responses=require(${JSON.stringify(data)});global.fetch=async url=>{if(!(url in responses))throw Error('Unexpected network URL '+url);return new Response(responses[url]);};`);
 const stub=path.join(bin,'stub.cjs');await fs.writeFile(stub,`const fs=require('fs'),path=require('path');if(process.argv[2]==='install'){if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['install','--global','@tsingwill/wdb']))process.exit(2);fs.writeFileSync(path.join(__dirname,'installed'),'yes');}else{if(!fs.existsSync(path.join(__dirname,'installed')))process.exit(1);console.log(JSON.stringify({data:{version:'0.1.0'}}));}`);
 for(const name of ['npm','wdb']){
  const file=path.join(bin,name+(process.platform==='win32'?'.cmd':''));
  await fs.writeFile(file,process.platform==='win32'?`@echo off\r\n"${process.execPath}" "${stub}" %*\r\n`:`#!/bin/sh\nexec '${process.execPath.replace(/'/g,"'\\''")}' '${stub.replace(/'/g,"'\\''")}' "$@"\n`,{mode:0o755});
 }
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,NODE_OPTIONS:`--require ${JSON.stringify(preload)}`};
 let child;
 if(process.platform==='win32'){
  // Windows exercises the common entry without executing a remote bootstrap.
  child=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/install-skill.js'),'--ref',sha,'--agent','both','--scope','project','--project',project,'--yes'],{env,cwd:root,encoding:'utf8',timeout:30000});
 }else child=spawnSync('/bin/bash',['-s','--','--agent','both','--scope','project','--project',project,'--yes'],{input:await fs.readFile(path.resolve(__dirname,'../install.sh')),env,cwd:root,encoding:'utf8',timeout:30000});
 assert.equal(child.status,0,child.stderr||child.error?.message);assert.equal(await fs.readFile(path.join(bin,'installed'),'utf8'),'yes');
 for(const target of targets({agent:'both',scope:'project',project}))assert.equal(await fs.readFile(path.join(target.directory,'references/说明.md'),'utf8'),'完整的参考内容');
 assert.ok(child.stdout.includes('Done.'));
 if(process.platform==='darwin'){
  const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
  const command='cat '+quote(path.resolve(__dirname,'../install.sh'))+' | bash -s -- --project '+quote(project)+' --yes';
  const driver=path.join(root,'pty-check.py');
  await fs.writeFile(driver,`import os, pty, subprocess, fcntl, termios, select, time, signal, sys
master, slave = pty.openpty()
def setup():
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
p = subprocess.Popen(['/bin/bash', '-c', sys.argv[1]], stdin=slave, stdout=slave, stderr=slave, preexec_fn=setup)
os.close(slave)
output = b''
sent = False
try:
    deadline = time.monotonic() + 10
    while p.poll() is None:
        if time.monotonic() > deadline:
            raise RuntimeError('Installer did not exit after completing terminal prompts')
        if select.select([master], [], [], 0.05)[0]:
            try:
                output += os.read(master, 65536)
            except OSError:
                break
        if not sent and b'Install Skill for' in output:
            os.write(master, bytes([51, 10, 50, 10]))
            sent = True
    p.wait(timeout=2)
    print(output.decode('utf-8', errors='replace'))
    sys.exit(p.returncode)
finally:
    if p.poll() is None:
        os.killpg(p.pid, signal.SIGKILL)
        p.wait()
    os.close(master)
`);
  const interactive=spawnSync('python3',[driver,command],{env,cwd:root,encoding:'utf8',timeout:15000});
  assert.equal(interactive.status,0,interactive.stderr||interactive.stdout||interactive.error?.message);
  assert.ok(interactive.stdout.includes('Done.'));
 }
});

test('checked-in manifest includes every committed Skill resource with canonical Git hashes',()=>{
 const {execFileSync}=require('node:child_process'),root=path.resolve(__dirname,'..');const git=args=>execFileSync('git',args,{cwd:root});
 const manifest=JSON.parse(syncRead(path.join(root,'scripts/skill-install-manifest.json')));
 const paths=git(['ls-tree','-r','--name-only','HEAD','skills/wdb']).toString().trim().split('\n').map(p=>p.slice('skills/wdb/'.length)).sort();
 assert.deepEqual(manifest.files.map(f=>f.path).sort(),paths);
 for(const file of manifest.files){const content=git(['show','HEAD:skills/wdb/'+file.path]);assert.equal(content.length,file.bytes);assert.equal(crypto.createHash('sha256').update(content).digest('hex'),file.sha256);}
 function syncRead(file){return require('node:fs').readFileSync(file,'utf8');}
});
