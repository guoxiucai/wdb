#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {npm}=require('./npm-tools');
function inspect(tarball) {
  const bytes=fs.readFileSync(tarball),tar=zlib.gunzipSync(bytes),files=new Map();
  for(let offset=0;offset+512<=tar.length;) {
    const header=tar.subarray(offset,offset+512);if(header.every(b=>b===0))break;
    const str=(a,b)=>header.subarray(a,b).toString().replace(/\0.*$/s,'');
    const name=(str(345,500)?str(345,500)+'/':'')+str(0,100),size=parseInt(str(124,136).trim(),8),type=str(156,157);
    if(!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length)throw Error('Invalid tar size');
    if(!name.startsWith('package/')||name.includes('..')||name.includes('\\')||files.has(name)||!['0',''].includes(type))throw Error('Unsafe npm tar entry: '+name);
    const relative=name.slice(8);
    if(!/^(?:package\.json|README\.md|LICENSE|BUILD-INFO\.json|bin\/wdb\.js|src\/(?:cli|client-transport|device-id|client-stream|stream-channel|stream-flow|stream-protocol|stream-tcp|forward-client|terminal-client)\.js|docs\/[A-Za-z0-9_.-]+\.md|skills\/wdb\/[A-Za-z0-9_./-]+\.md)$/.test(relative))throw Error('Unexpected npm file: '+name);
    files.set(name,tar.subarray(offset+512,offset+512+size));offset+=512+Math.ceil(size/512)*512;
  }
  const pkg=JSON.parse(files.get('package/package.json'));
  assert.deepEqual(pkg.bin,{wdb:'bin/wdb.js'});assert.ok(!pkg.scripts&&!pkg.optionalDependencies);assert.deepEqual(pkg.dependencies,{ws:'8.22.1'});
  for(const name of ['bin/wdb.js','src/cli.js','src/client-transport.js','src/device-id.js','skills/wdb/SKILL.md','LICENSE','BUILD-INFO.json'])assert.ok(files.has('package/'+name),name+' missing');
  const unpackedBytes=[...files.values()].reduce((sum,b)=>sum+b.length,0);assert.ok(bytes.length<1024*1024&&unpackedBytes<1024*1024);
  return {pkg,files,bytes:bytes.length,unpackedBytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
function verify(tarball,prefix) {
  tarball=path.resolve(tarball);const inspected=inspect(tarball);prefix=path.resolve(prefix||path.join(os.tmpdir(),'wdb npm 中文 '+crypto.randomUUID()));
  if(fs.existsSync(prefix))throw Error('Use a new isolated npm prefix');fs.mkdirSync(prefix,{recursive:true});
  npm(['install','--global','--prefix',prefix,tarball,'--omit=optional','--ignore-scripts','--offline','--no-audit','--no-fund']);
  const installed=path.join(prefix,process.platform==='win32'?'node_modules':'lib/node_modules',inspected.pkg.name);
  const entry=path.join(installed,'bin/wdb.js');
  const actual=JSON.parse(execFileSync(process.execPath,[entry,'--version','--json'],{encoding:'utf8',cwd:os.tmpdir(),windowsHide:true}));assert.equal(actual.data.version,inspected.pkg.version);
  assert.match(execFileSync(process.execPath,[entry,'--help'],{encoding:'utf8',cwd:os.tmpdir(),windowsHide:true}),/wdb connect/);
  if(process.platform==='win32') {
    const shim=path.join(prefix,'wdb.cmd');if(shim.includes('"')||shim.includes('%'))throw Error('Unsupported test prefix characters');
    assert.equal(JSON.parse(execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`""${shim}" --version --json"`],{encoding:'utf8',cwd:os.tmpdir(),windowsHide:true,windowsVerbatimArguments:true})).data.version,inspected.pkg.version);
  }else assert.equal(JSON.parse(execFileSync(path.join(prefix,'bin/wdb'),['--version','--json'],{encoding:'utf8',cwd:os.tmpdir()})).data.version,inspected.pkg.version);
  // A private profile beside (not inside) the program installation survives both
  // npm update and removal. No real credentials are needed for this invariant.
  const profile=path.join(prefix,'validation-profile');fs.mkdirSync(profile);const config=path.join(profile,'devices.json');
  const configBytes=Buffer.from(JSON.stringify({devices:[{url:'https://127.0.0.1:18766',clientId:'validation-only',token:'non-secret-fixture'}]}));fs.writeFileSync(config,configBytes);
  const npmOptions=['--global','--prefix',prefix,'--omit=optional','--ignore-scripts','--offline','--no-audit','--no-fund'];
  npm(['install',...npmOptions,tarball]);assert.deepEqual(fs.readFileSync(config),configBytes);
  npm(['uninstall',...npmOptions,inspected.pkg.name]);assert.deepEqual(fs.readFileSync(config),configBytes);assert.ok(!fs.existsSync(entry));
  npm(['install',...npmOptions,tarball]);assert.equal(JSON.parse(execFileSync(process.execPath,[entry,'--version','--json'],{encoding:'utf8',windowsHide:true})).data.version,inspected.pkg.version);
  let installedWithDependenciesBytes=0;for(const entry of fs.readdirSync(installed,{recursive:true,withFileTypes:true})){if(entry.isDirectory())continue;assert.ok(entry.isFile()&&!/\.(?:node|exe|dll)$/i.test(entry.name));installedWithDependenciesBytes+=fs.statSync(path.join(entry.parentPath,entry.name)).size;}const wsPath=require.resolve('ws/package.json',{paths:[installed]});assert.ok(wsPath.startsWith(installed+path.sep));const ws=JSON.parse(fs.readFileSync(wsPath));assert.equal(ws.version,inspected.pkg.dependencies.ws);assert.ok(fs.existsSync(path.join(path.dirname(wsPath),'LICENSE')));
  return {status:'pass',platform:process.platform,arch:process.arch,node:process.version,ws:ws.version,installedWithDependenciesBytes,tarball,prefix,installed,cli:path.join(installed,'src/cli.js'),version:actual.data.version,bytes:inspected.bytes,unpackedBytes:inspected.unpackedBytes,files:inspected.files.size,sha256:inspected.sha256,updateUninstallPreservedProfile:true};
}
if(require.main===module){try{const report=verify(process.argv[2],process.argv[3]);console.log(JSON.stringify(report,null,2));}catch(e){console.error(e.stack);process.exitCode=1;}}
module.exports={inspect,verify};
