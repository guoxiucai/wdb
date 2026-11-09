#!/usr/bin/env node
'use strict';
// Generate after committing Skill changes; hashes use Git bytes, not CRLF checkout bytes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const git=args=>execFileSync('git',args,{cwd:root});
function build(){
 if(git(['status','--porcelain','--','skills/wdb']).toString().trim())throw Error('Commit skills/wdb changes before generating the install manifest.');
 const sourceCommit=git(['rev-parse','HEAD']).toString().trim();
 const files=git(['ls-tree','-r','--full-tree','HEAD','skills/wdb']).toString().trim().split('\n').map(line=>{
  const match=/^(100644|100755) blob [a-f0-9]{40}\t(skills\/wdb\/.+)$/.exec(line);if(!match)throw Error('Only regular Skill files may be installed');
  const bytes=git(['show',sourceCommit+':'+match[2]]);
  return {path:match[2].slice('skills/wdb/'.length),mode:match[1],bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 });
 const manifest={version:1,sourceCommit,files};fs.writeFileSync(path.join(__dirname,'skill-install-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(require.main===module){try{const m=build();console.log(`Manifest: ${m.files.length} files at ${m.sourceCommit}`);}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={build};
