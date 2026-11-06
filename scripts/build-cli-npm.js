#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {npm}=require('./npm-tools');
const root=path.resolve(__dirname,'..');
function build(options={}) {
  const output=path.resolve(options.output||path.join(root,'dist','npm',crypto.randomUUID()));
  if(fs.existsSync(output))throw Error('Output must be a new directory: '+output);
  const development=options.development===true||options.development==='true';
  if(!development&&(!options.name||!options.license||!options['license-file']))throw Error('Release requires --name, --license and --license-file. Use --development true for local testing.');
  const name=options.name||'wdb-cli-local-test';
  if(!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name))throw Error('Invalid npm name');
  const stage=path.join(output,'stage');fs.mkdirSync(stage,{recursive:true});
  const copied=new Set();
  function copy(relative) {
    relative=relative.replace(/\\/g,'/');if(copied.has(relative))return;
    const source=path.resolve(root,relative);if(!source.startsWith(root+path.sep))throw Error('Source escapes repository');
    if(fs.lstatSync(source).isSymbolicLink())throw Error('Symlinks are not packaged');
    const dest=path.join(stage,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);copied.add(relative);
    if(relative.endsWith('.md')) {
      const text=fs.readFileSync(source,'utf8');
      for(const m of text.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)) {
        const link=m[1].split('#')[0];if(!link||/^[a-z]+:/i.test(link)||link.startsWith('/'))continue;
        const target=path.relative(root,path.resolve(path.dirname(source),decodeURIComponent(link))).replace(/\\/g,'/');
        if(/^(docs\/|skills\/).*\.md$/.test(target)&&fs.existsSync(path.join(root,target)))copy(target);
      }
    }
  }
  for(const file of ['bin/wdb.js',...['cli','client-transport','device-id','client-stream','stream-channel','stream-flow','stream-protocol','stream-tcp','forward-client','terminal-client'].map(n=>'src/'+n+'.js'),'docs/CLI.md','docs/WINDOWS-CLI-VALIDATION.md','docs/MACOS-CLIENT.md','docs/STREAMING.md'])copy(file);
  for(const entry of fs.readdirSync(path.join(root,'skills/wdb'),{recursive:true,withFileTypes:true})) {
    if(entry.isFile())copy(path.relative(root,path.join(entry.parentPath,entry.name)));
  }
  fs.copyFileSync(path.join(root,'packaging/npm/README.md'),path.join(stage,'README.md'));
  if(options['license-file'])fs.copyFileSync(path.resolve(options['license-file']),path.join(stage,'LICENSE'));
  else fs.writeFileSync(path.join(stage,'LICENSE'),'UNLICENSED\nDevelopment artifact only. Project distribution license has not been configured.\n');
  const pkg={...JSON.parse(fs.readFileSync(path.join(root,'packaging/npm/package.template.json'))),name,version:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,license:options.license||'UNLICENSED',...(development?{private:true}:{})};
  pkg.dependencies={ws:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).dependencies.ws};
  fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  const info={version:pkg.version,buildId:options['build-id']||path.basename(output),sourceCommit:git(['rev-parse','HEAD']),sourceDirty:!!git(['status','--porcelain']),builtAt:new Date().toISOString(),nodeRange:pkg.engines.node,development};
  fs.writeFileSync(path.join(stage,'BUILD-INFO.json'),JSON.stringify(info,null,2)+'\n');fs.chmodSync(path.join(stage,'bin/wdb.js'),0o755);
  const dry=JSON.parse(npm(['pack','--dry-run','--json','--ignore-scripts'],{cwd:stage}))[0];
  const allowed=new Set([...copied,'README.md','LICENSE','package.json','BUILD-INFO.json']);
  for(const file of dry.files)if(!allowed.has(file.path))throw Error('Unexpected npm file: '+file.path);
  const packed=JSON.parse(npm(['pack','--json','--ignore-scripts','--pack-destination',output],{cwd:stage}))[0];
  if(packed.size>=1024*1024||packed.unpackedSize>=1024*1024)throw Error('CLI exceeds 1 MiB package budget; review package files');
  const tarball=path.join(output,packed.filename);
  const report={...info,tarball,bytes:packed.size,unpackedBytes:packed.unpackedSize,integrity:packed.integrity,sha256:crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex'),files:packed.files.map(f=>f.path)};
  fs.writeFileSync(path.join(output,'npm-package.json'),JSON.stringify(report,null,2));
  return report;
}
if(require.main===module){const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i].replace(/^--/,'')]=process.argv[i+1];try{console.log(JSON.stringify(build(options),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={build};
