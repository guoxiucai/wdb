'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {fail}=require('./common');
const {targets,chooseTarget,CdpConnection,endpointUrl}=require('./cdp');
const {queryPage}=require('./electron-dom');
function duration(value,fallback,max=300000){const n=value===undefined?fallback:Number(value);if(!Number.isFinite(n)||n<1||n>max)throw fail('INVALID_ARGUMENT','Duration must be 1..'+max+' ms');return n;}
function artifact(file,type){return {path:file,type,size:fs.statSync(file).size};}
async function evaluated(connection,expression){
  const result=await connection.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw fail('CDP_EVALUATION_FAILED',result.exceptionDetails.exception?.description||result.exceptionDetails.text||'Renderer script failed');
  if(result.result?.subtype==='error')throw fail('CDP_EVALUATION_FAILED',result.result.description||'Renderer script failed');
  return result.result?.value;
}
async function query(connection,args,mode){const result=await evaluated(connection,'('+queryPage.toString()+')('+JSON.stringify({...args,mode})+')');if(result?.error)throw fail(result.error.code,result.error.message);return result;}
async function runCdp(operation,args,ctx){
  const total=duration(ctx.timeoutMs,120000,86400000),signal=AbortSignal.any([AbortSignal.timeout(total),...(ctx.signal?[ctx.signal]:[])]);
  const traceFile=path.join(ctx.dir,'cdp-trace.jsonl');let connection,mutationSent=false,target;
  const trace=event=>fs.appendFileSync(traceFile,JSON.stringify({at:new Date().toISOString(),...event})+'\n');
  const started=Date.now();const remaining=()=>Math.max(1,total-(Date.now()-started));
  trace({operation,stage:'discover',endpoint:endpointUrl(args.endpoint).origin});
  try {
    const list=await targets(args.endpoint,signal,Math.min(duration(args.connectTimeoutMs,5000,30000),remaining()));
    if(operation==='targets')return {backend:'cdp',endpoint:endpointUrl(args.endpoint).origin,targets:list.map(({webSocketDebuggerUrl,...rest})=>rest),artifacts:[artifact(traceFile,'application/x-ndjson')]};
    target=chooseTarget(list,args.target);trace({stage:'attach',target:target.id});
    connection=new CdpConnection(target.webSocketDebuggerUrl,{signal,timeoutMs:Math.min(duration(args.commandTimeoutMs,10000,120000),remaining()),trace});await connection.ready;
    let data;
    if(operation==='tree'||operation==='find')data=await query(connection,args,operation);
    else if(operation==='wait'){
      const timeout=duration(args.timeoutMs,10000);const state=args.state||'visible';if(!['visible','hidden','attached','detached'].includes(state))throw fail('INVALID_ARGUMENT','Wait state must be visible, hidden, attached or detached');
      if(!args.selector&&args.name===undefined)throw fail('INVALID_ARGUMENT','Wait needs selector or name');
      const start=Date.now();while(true){const found=await query(connection,{...args,visible:['visible','hidden'].includes(state)},'find');const ok=['hidden','detached'].includes(state)?found.count===0:found.count>0;if(ok){data={state,count:found.count,elapsedMs:Date.now()-start};break;}if(Date.now()-start>=timeout)throw fail('TIMEOUT','DOM state wait timed out');await delay(100,null,{signal});}
    }else if(operation==='eval'){
      if(typeof args.expression!=='string'||!args.expression.trim())throw fail('INVALID_ARGUMENT','eval requires expression');
      mutationSent=true;data={value:await evaluated(connection,args.expression),method:'Runtime.evaluate'};
    }else if(operation==='action'){
      const action=args.action||'click';if(!['click','fill','type'].includes(action))throw fail('INVALID_ARGUMENT','CDP action supports click, fill or type');
      if(action!=='click'&&typeof args.text!=='string')throw fail('INVALID_ARGUMENT','fill/type requires text');
      const located=await query(connection,args,'prepare');trace({stage:'located',action});
      mutationSent=true;
      if(action==='click'){
        let releaseSent=false;try{await connection.send('Input.dispatchMouseEvent',{type:'mousePressed',x:located.x,y:located.y,button:'left',clickCount:1});releaseSent=true;await connection.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:located.x,y:located.y,button:'left',clickCount:1});}finally{if(!releaseSent&&!signal.aborted)await connection.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:located.x,y:located.y,button:'left',clickCount:1}).catch(()=>{});}
      }else{
        await query(connection,args,'focus-edit');
        if(action==='fill'){
          await connection.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
          await connection.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
          await connection.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
          await connection.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
        }
        if(args.text)await connection.send('Input.insertText',{text:args.text});
      }
      data={action,method:'CDP.Input',coordinateSpace:'css-viewport',control:located.control,needsObservation:true};
    }else if(operation==='screenshot'){
      const result=await connection.send('Page.captureScreenshot',{format:'png'});if(typeof result.data!=='string')throw fail('INVALID_CDP_RESPONSE','Missing screenshot');
      const file=path.join(ctx.dir,'electron-page.png'),bytes=Buffer.from(result.data,'base64');if(bytes.length<24||bytes.subarray(1,4).toString()!=='PNG')throw fail('INVALID_CDP_RESPONSE','Screenshot was not a PNG');fs.writeFileSync(file,bytes);
      data={path:file,coordinateSpace:'page-image-pixels',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),artifacts:[artifact(file,'image/png')]};
    }else if(operation==='logs'){
      const events=[];let bytes=0,truncated=false;const limit=Math.min(Number(args.limit)||200,2000);
      connection.onEvent(event=>{if(!['Runtime.consoleAPICalled','Runtime.exceptionThrown','Log.entryAdded'].includes(event.method))return;const encoded=JSON.stringify(event);if(events.length>=limit||bytes+Buffer.byteLength(encoded)>1024*1024){truncated=true;return;}bytes+=Buffer.byteLength(encoded);events.push(event);});
      await connection.send('Runtime.enable');await connection.send('Log.enable').catch(e=>{if(e.code!=='CDP_PROTOCOL_ERROR')throw e;});
      await delay(duration(args.durationMs,1000,60000),null,{signal});
      const file=path.join(ctx.dir,'electron-console.json');fs.writeFileSync(file,JSON.stringify({events,truncated},null,2));data={events,truncated,artifacts:[artifact(file,'application/json')]};
    }else throw fail('UNKNOWN_OPERATION','Unknown Electron CDP operation: '+operation);
    trace({stage:'completed',operation});
    return {...data,backend:'cdp',target:{id:target.id,title:target.title,url:target.url},artifacts:[...(data.artifacts||[]),artifact(traceFile,'application/x-ndjson')]};
  }catch(error){
    let e=error;if(signal.aborted)e=fail(ctx.signal?.aborted?'CANCELLED':'TIMEOUT','Electron operation ended before completion');
    trace({stage:'failed',code:e.code||'CDP_FAILED',mutationSent});
    if(mutationSent){e=Object.assign(fail('ACTION_OUTCOME_UNKNOWN','CDP action may have executed; observe before retrying. '+e.message),{details:{cause:e.code,operation,target:target?.id}});}
    e.artifacts=[artifact(traceFile,'application/x-ndjson')];throw e;
  }finally{connection?.close();}
}
module.exports={runCdp,evaluated,query,duration};
