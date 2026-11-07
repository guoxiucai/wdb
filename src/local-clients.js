'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {api,CliError}=require('./client-transport');
function localDataDirectory(){return process.platform==='win32'?path.join(process.env.ProgramData||'C:\\ProgramData','wdb'):null;}
async function localServerInstalled(){const dir=localDataDirectory();if(!dir)return false;try{await fs.access(path.join(dir,'installation.json'));return true;}catch(e){if(e.code==='ENOENT')return false;throw new CliError('LOCAL_ADMIN_UNAVAILABLE','Cannot access local WDB installation. Use the configured desktop account or an administrator.');}}
async function manageLocalClients(words,{dataDir=localDataDirectory(),timeoutMs=10000}={}){
 const action=words[0]||'list';if(!['list','revoke'].includes(action)||(action==='revoke'&&!words[1])||words.length>(action==='list'?1:2))throw new CliError('INVALID_ARGUMENT','Use clients list or clients revoke <clientId>.');
 if(!dataDir)throw new CliError('LOCAL_ADMIN_UNAVAILABLE','Local server management requires Windows.');
 let installation,token,fingerprint;try{
  installation=JSON.parse((await fs.readFile(path.join(dataDir,'installation.json'),'utf8')).replace(/^\uFEFF/,''));
  token=(await fs.readFile(path.join(dataDir,'helper-secret'),'utf8')).trim();fingerprint=(await fs.readFile(path.join(dataDir,'fingerprint'),'utf8')).trim();
 }catch{throw new CliError('LOCAL_ADMIN_UNAVAILABLE','Cannot read protected local WDB credentials. Use the configured desktop account or an administrator; repair the server if installation is missing.');}
 const address=installation.listenAddress;
 const host=!address||address==='0.0.0.0'?'127.0.0.1':address==='::'?'[::1]':address.includes(':')?'['+address+']':address;
 const device={url:`https://${host}:${installation.port||18766}`,fingerprint,token};
 const endpoint='/v1/local/clients'+(action==='revoke'?'/'+encodeURIComponent(words[1]):'');
 return api(device,action==='list'?'GET':'DELETE',endpoint,undefined,timeoutMs,{reconnectMs:0});
}
module.exports={localServerInstalled,manageLocalClients};
