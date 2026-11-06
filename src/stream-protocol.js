'use strict';
const PROTOCOL='wdb.stream.v1',HELPER_PROTOCOL='wdb.helper-shell.v1';
const LIMITS=Object.freeze({binaryMessageBytes:65536,controlMessageBytes:16384,windowBytes:262144,leaseIntervalMs:5000,leaseTimeoutMs:30000});
const QUEUE_LIMIT=524288;
class StreamError extends Error{constructor(code,message){super(message);this.code=code;}}
const error=(code,message)=>new StreamError(code,message);
function check(value,message,code='INVALID_ARGUMENT'){if(!value)throw error(code,message);}
function integer(n,min=0,max=Number.MAX_SAFE_INTEGER){return Number.isSafeInteger(n)&&n>=min&&n<=max;}
function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function fields(x,required,optional=[]){check(object(x),'Expected an object');for(const k of required)check(Object.hasOwn(x,k),`Missing ${k}`);for(const k of Object.keys(x))check([...required,...optional].includes(k),`Unknown field ${k}`);}
function id(x){return typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);}
function endpoint(x,listen=false){fields(x,['host','port']);check(['127.0.0.1','::1'].includes(x.host),'Endpoint must be literal 127.0.0.1 or ::1');check(integer(x.port,listen?0:1,65535),'Invalid TCP port');return x;}
function parseEndpoint(text,listen=false){const m=/^tcp:(?:(127\.0\.0\.1|\[::1\]):)?(\d+)$/.exec(text||'');check(m,'Use tcp:<port>, tcp:127.0.0.1:<port> or tcp:[::1]:<port>');return endpoint({host:m[1]==='[::1]'?'::1':'127.0.0.1',port:Number(m[2])},listen);}
function shellOptions(m){
 check(['powershell','cmd','pwsh'].includes(m.program),'Unsupported shell program');check(typeof m.admin==='boolean','admin must be boolean');
 if(m.cwd!==undefined)check(typeof m.cwd==='string'&&m.cwd.length>0&&m.cwd.length<=32767&&!m.cwd.includes('\0'),'Invalid cwd');
 check(object(m.env)&&Object.keys(m.env).length<=128,'Invalid environment');for(const [k,v]of Object.entries(m.env))check(k.length>0&&!/[=\0]/.test(k)&&typeof v==='string'&&!v.includes('\0')&&k.length+v.length<=32767,'Invalid environment entry');
 fields(m.terminal,['cols','rows','term']);check(integer(m.terminal.cols,1,1000)&&integer(m.terminal.rows,1,1000),'Invalid terminal size');check(typeof m.terminal.term==='string'&&m.terminal.term.length<=64&&!m.terminal.term.includes('\0'),'Invalid term');
}
const schemas={
 hello:[['version','deviceId','serverInstanceId','channelId','limits'],['ipcVersion']],
 opened:[['replyTo','kind'],['sessionId','program','backend','execution','forwardId','listen','target','connectionId']],
 ready:[['requestId'],['listen']], 'ready.ack':[['replyTo'],['sessionId','pid','execution','forwardId','connectionId','listen','target']],
 lease:[['requestId'],[]],'lease.ack':[['replyTo','leaseTimeoutMs'],[]],resize:[['requestId','cols','rows'],[]],'resize.ack':[['replyTo','cols','rows'],[]],
 credit:[['consumed'],[]],incoming:[['forwardId','connectionId','attachTimeoutMs'],[]],fin:[[],[]],reset:[['code','message'],[]],
 exit:[['sessionId','exitCode','reason'],[]],close:[['requestId','reason'],[]],closed:[['replyTo','reason'],[]],error:[['code','message'],['replyTo']]
};
const fromClient=new Set(['open','ready','lease','resize','credit','fin','reset','close']);
const fromServer=new Set(['hello','opened','ready.ack','lease.ack','resize.ack','credit','incoming','fin','reset','exit','closed','error']);
function validate(m,direction){
 check(object(m)&&typeof m.type==='string','Invalid control message');check((direction==='client'?fromClient:fromServer).has(m.type),'Unknown or wrong-direction message','INVALID_STATE');
 if(m.type==='open'){
  const extra=m.kind==='shell'?['program','admin','env','terminal']:m.kind==='tcp'?['forwardId']:['listen','target'];
  check(['shell','forward','reverse','tcp'].includes(m.kind),'Unknown stream kind');fields(m,['type','requestId','kind',...extra],m.kind==='shell'?['cwd']:m.kind==='tcp'?['connectionId']:[]);
  if(m.kind==='shell')shellOptions(m);else if(m.kind==='tcp'){check(id(m.forwardId),'Invalid forwardId');if(m.connectionId!==undefined)check(id(m.connectionId),'Invalid connectionId');}else{endpoint(m.listen,true);endpoint(m.target);}
 }else {const s=schemas[m.type];fields(m,['type',...s[0]],s[1]);}
 if(m.requestId!==undefined)check(integer(m.requestId,1),'Invalid requestId');if(m.replyTo!==undefined)check(integer(m.replyTo,1),'Invalid replyTo');
 if(m.type==='credit')check(integer(m.consumed),'Invalid consumed counter','FLOW_CONTROL_ERROR');
 if(['resize','resize.ack'].includes(m.type))check(integer(m.cols,1,1000)&&integer(m.rows,1,1000),'Invalid terminal size');
 if(['close','closed'].includes(m.type))check(['client_close','client_interrupt'].includes(m.reason),'Invalid close reason');
 for(const k of ['sessionId','forwardId','connectionId','channelId','serverInstanceId'])if(m[k]!==undefined)check(id(m[k]),`Invalid ${k}`);
 if(m.listen!==undefined)endpoint(m.listen,true);if(m.target!==undefined)endpoint(m.target);
 if(m.execution!==undefined){fields(m.execution,['identity','sid','isElevated','windowsSessionId']);check(typeof m.execution.identity==='string'&&typeof m.execution.sid==='string'&&typeof m.execution.isElevated==='boolean'&&integer(m.execution.windowsSessionId),'Invalid execution identity');}
 if(m.type==='hello'){check(m.version===1&&/^[a-f0-9]{16}$/.test(m.deviceId),'Invalid stream identity','INCOMPATIBLE_STREAM_PROTOCOL');fields(m.limits,Object.keys(LIMITS));for(const [k,v] of Object.entries(LIMITS))check(m.limits[k]===v,'Unsupported stream limits','INCOMPATIBLE_STREAM_PROTOCOL');}
 if(m.type==='exit')check((integer(m.exitCode,0,0xffffffff)&&m.reason==='process_exit')||(m.exitCode===null&&m.reason==='terminated'),'Invalid shell exit');
 if(['error','reset'].includes(m.type))check(typeof m.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(m.code)&&typeof m.message==='string'&&m.message.length<=2048,'Invalid error');
 if(m.type==='incoming')check(integer(m.attachTimeoutMs,1,30000),'Invalid attach timeout');
 return m;
}
module.exports={PROTOCOL,HELPER_PROTOCOL,LIMITS,QUEUE_LIMIT,StreamError,error,check,integer,object,fields,id,endpoint,parseEndpoint,shellOptions,validate};
