'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
function npm(args,options={}) {
  const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),path.join(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  if(process.platform!=='win32') {try{candidates.push(fs.realpathSync(execFileSync('which',['npm'],{encoding:'utf8'}).trim()));}catch{}}
  const entry=candidates.find(p=>fs.existsSync(p)&&p.endsWith('.js'));
  if(!entry)throw Error('npm-cli.js not found beside Node; run this builder through npm or install Node/npm together.');
  return execFileSync(process.execPath,[entry,...args],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,...options});
}
module.exports={npm};
