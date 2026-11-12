'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
function error(code,message,extra){return Object.assign(new Error(message),{code,...(extra?{extra}: {})});}
function locate(name,env=process.env){
 for(const dir of (env.PATH||env.Path||'').split(path.delimiter).filter(Boolean))for(const ext of process.platform==='win32'?['.exe','.cmd','.bat','']:['']){
  const file=path.resolve(dir,name+ext);try{if(fs.statSync(file).isFile())return file;}catch{}
 }
}
function npmCommand(){
 const near=path.dirname(process.execPath),candidates=[process.env.npm_execpath,path.join(near,'node_modules/npm/bin/npm-cli.js'),path.join(near,'../lib/node_modules/npm/bin/npm-cli.js')];
 const found=locate('npm');if(found){try{const real=fs.realpathSync(found);if(real.endsWith('.js'))candidates.push(real);if(/\.(cmd|bat)$/i.test(found))candidates.push(path.join(path.dirname(found),'node_modules/npm/bin/npm-cli.js'));}catch{}}
 for(const file of candidates)if(file&&file.endsWith('.js')&&fs.existsSync(file))return {file:process.execPath,args:[fs.realpathSync(file)]};
 // Native npm launchers can be executed with an argument array; never shell
 // interpolate .cmd paths or user-controlled prefixes/tarball names.
 if(found&&!/\.(cmd|bat)$/i.test(found))return {file:found,args:[]};
 throw error('UPDATE_NPM_UNAVAILABLE','Cannot locate npm beside this Node runtime. Install Node/npm together.');
}
function execute(file,args,{cwd,signal,timeout=180000,env=process.env}={}){
 return new Promise((resolve,reject)=>execFile(file,args,{cwd,signal,timeout,env,encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024},(e,stdout)=>{
  if(e){const code=e.name==='AbortError'?'UPDATE_CANCELLED':e.killed?'UPDATE_NPM_TIMEOUT':/EBADENGINE/.test(String(e.stderr))?'UPDATE_NODE_INCOMPATIBLE':'UPDATE_NPM_FAILED';reject(error(code,code==='UPDATE_NODE_INCOMPATIBLE'?'Candidate requires a different Node version. Update Node separately.':'npm command failed; inspect npm diagnostics locally. No automatic rollback is assumed.',{exitCode:typeof e.code==='number'?e.code:null}));}
  else resolve(stdout);
 }));
}
function client(command=npmCommand()){
 return {command,async run(args,options={}){return execute(command.file,[...command.args,...args,'--fetch-retries=0','--fetch-timeout=20000'],{...options,env:{...process.env,npm_config_update_notifier:'false',...options.env}});}};
}
function json(text){try{return JSON.parse(text);}catch{throw error('UPDATE_METADATA_INVALID','npm returned invalid JSON.');}}
module.exports={error,locate,npmCommand,execute,client,json};
