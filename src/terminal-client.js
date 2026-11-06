'use strict';
const {Transform}=require('node:stream');
const {check,error}=require('./stream-protocol');const {Flow}=require('./stream-flow');
const {openStream,capability,maintainLease,streamOptions}=require('./client-stream');
// ConPTY can enable Win32 input mode (CSI Vk;Sc;Uc;Kd;Cs;Rc _). Recognize only
// our two control keys; keep all other bytes, including split UTF-8, unchanged.
function terminalInput(onEscape,disabled=false){let carry=Buffer.alloc(0),timer;const stream=new Transform({highWaterMark:65536,transform(chunk,encoding,callback){clearTimeout(timer);if(disabled){this.push(chunk);callback();return;}const bytes=Buffer.concat([carry,chunk]);carry=Buffer.alloc(0);let start=0,i=0;while(i<bytes.length){if(bytes[i]===0x1d){if(i>start)this.push(bytes.subarray(start,i));onEscape();callback();return;}if(bytes[i]===0x1b){const tail=bytes.subarray(i,Math.min(bytes.length,i+128)).toString('latin1');const match=/^\x1b\[((?:\d*;){5}\d*)_/.exec(tail);if(match){const p=match[1].split(';').map(Number);if(p[3]===1&&(p[2]===29||p[2]===3)){if(i>start)this.push(bytes.subarray(start,i));if(p[2]===29){onEscape();callback();return;}this.push(Buffer.from([3]));i+=match[0].length;start=i;continue;}i+=match[0].length;continue;}if(bytes.length-i<128&&/^\x1b(?:\[(?:\d|;)*)?$/.test(tail)){if(i>start)this.push(bytes.subarray(start,i));carry=bytes.subarray(i);timer=setTimeout(()=>{if(carry.length){this.push(carry);carry=Buffer.alloc(0);}},20);callback();return;}}i++;}if(start<bytes.length)this.push(bytes.subarray(start));callback();},flush(callback){clearTimeout(timer);if(carry.length)this.push(carry);callback();},destroy(err,callback){clearTimeout(timer);callback(err);}});return stream;}
function validateInteractive(options,words,io){const explicit=options.interactive===true||options.interactive==='true',script=options.script!==undefined||options['script-file']!==undefined||words.length>0;if(explicit)check(!script&&!options.json&&!options.detach&&!options.follow,'--interactive cannot be combined with scripts, --json, --detach or --follow');if(script)return false;check(io.stdin?.isTTY&&io.stdout?.isTTY,'Interactive shell requires TTY stdin and stdout','TTY_REQUIRED');check(!options.json&&!options.detach&&!options.follow,'Interactive shell cannot use --json, --detach or --follow');return true;}
async function runInteractiveShell(device,options,io){
 const settings=streamOptions(options);check(options.escape===undefined||options.escape==='none','Only --escape none is supported');const input=io.stdin,output=io.stdout,signals=io.signals||process;check(input?.isTTY&&output?.isTTY,'Interactive shell requires TTY stdin and stdout','TTY_REQUIRED');
 const program=options.program||'powershell';check(['powershell','cmd','pwsh'].includes(program),'Use --program powershell, cmd or pwsh');let env={};if(options.env!==undefined){try{env=JSON.parse(options.env);}catch{throw error('INVALID_ARGUMENT','Invalid JSON environment');}}
 await capability(device,'interactiveShell',settings.timeoutMs);
 const channel=await openStream(device,{kind:'shell',program,admin:options.admin===true||options.admin==='true',...(options.cwd===undefined?{}:{cwd:options.cwd}),env,terminal:{cols:output.columns||80,rows:output.rows||24,term:'xterm-256color'}},settings);
 const wasRaw=!!input.isRaw,wasPaused=input.isPaused(),wasFlowing=input.readableFlowing;let localExit=false,stopLease,resizeTimer,flow,rawChanged=false,piped=false,remoteExit,complete;
 const finished=new Promise((resolve,reject)=>complete={resolve,reject});finished.catch(()=>{});
 const closeLocal=()=>{if(localExit)return;localExit=true;channel.request('close',{reason:'client_interrupt'},'closed').then(()=>complete.resolve(130),e=>complete.resolve(130));};
 const source=terminalInput(closeLocal,options.escape==='none');
 channel.on('control',m=>{if(m.type==='exit'){remoteExit=m;if(m.exitCode>255)io.stderr.write(`Remote Windows exit code: ${m.exitCode}\n`);complete.resolve(m.exitCode!==null&&m.exitCode<=255?m.exitCode:1);}});
 channel.on('failure',e=>{if(!localExit)complete.reject(e);});channel.on('closed',()=>{if(localExit)complete.resolve(130);else if(!remoteExit)complete.reject(channel.failure||error('STREAM_INTERRUPTED','Shell connection ended; commands will not be replayed.'));});
 const resize=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(channel.closed)return;channel.request('resize',{cols:output.columns||80,rows:output.rows||24}).catch(e=>channel.fail(e));},50);};
 try{
  flow=new Flow(channel,source,output);input.setRawMode(true);rawChanged=true;signals.on('SIGINT',closeLocal);signals.on('SIGTERM',closeLocal);output.on('resize',resize);input.pipe(source);piped=true;
  const ready=await channel.ready();io.stderr.write(`Shell: ${ready.execution.identity}${ready.execution.isElevated?' (SYSTEM/admin)':''}; Ctrl+] closes the session.\n`);flow.activate();stopLease=maintainLease(channel,device);return await finished;
 }finally{
  clearTimeout(resizeTimer);stopLease?.();signals.removeListener('SIGINT',closeLocal);signals.removeListener('SIGTERM',closeLocal);output.removeListener('resize',resize);if(piped)input.unpipe(source);flow?.stop();source.destroy();
  // A never-read stdin has flowing=null but isPaused() is false. Resuming that
  // dormant handle would keep the completed CLI alive and swallow local keys.
  try{if(rawChanged)input.setRawMode(wasRaw);}finally{if(wasPaused||wasFlowing!==true)input.pause();else input.resume();}
  if(!channel.closed){try{if(!remoteExit&&!localExit)await channel.request('close',{reason:'client_close'},'closed');}catch{}channel.close();}
  await new Promise(resolve=>{const timer=setTimeout(resolve,1000);output.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1006l\x1b[?2004l\x1b[?9001l\x1b[?1049l\x1b[?25h\x1b[0m',()=>{clearTimeout(timer);resolve();});});
 }
}
module.exports={validateInteractive,runInteractiveShell,terminalInput};
