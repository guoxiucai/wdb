'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {fail}=require('./common');const {serviceUrl,VmConnection}=require('./flutter-rpc');
const PREFIX='ext.flutter.inspector.';
function integer(value,fallback,min,max){const n=value===undefined?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)throw fail('INVALID_ARGUMENT','Expected integer '+min+'..'+max);return n;}
function selectIsolate(list,id){const matches=id?list.filter(x=>x.id===id):list.filter(x=>(x.extensionRPCs||[]).some(n=>n.startsWith('ext.flutter.')));if(!matches.length)throw fail('FLUTTER_ISOLATE_NOT_FOUND','No matching Flutter isolate; run flutter info');if(matches.length!==1)throw fail('AMBIGUOUS_FLUTTER_ISOLATE','Multiple Flutter isolates; provide --isolate');return matches[0];}
function flatten(root,args){
  const depth=integer(args.depth,400,0,1000),limit=integer(args.limit,1000,1,10000),nodes=[],queue=root?[{node:root,depth:0,path:'0'}]:[];let truncated=false;
  for(let i=0;i<queue.length;i++){
    if(nodes.length===limit){truncated=true;break;}
    const item=queue[i],n=item.node;if(!n||typeof n!=='object')continue;
    const description=String(n.description||''),widgetType=n.widgetRuntimeType||description.match(/^([\w$]+)/)?.[1]||'';
    nodes.push({path:item.path,depth:item.depth,description,widgetType,name:n.name||'',properties:n.properties||[],diagnosticId:n.valueId||n.objectId,valueId:n.valueId,creationLocation:n.creationLocation});
    const children=n.children||[];if(item.depth<depth)for(let j=0;j<children.length;j++)queue.push({node:children[j],depth:item.depth+1,path:item.path+'.'+j});else if(children.length)truncated=true;
  }return {nodes,truncated};
}
function matches(node,args){return (args.description===undefined||node.description===args.description)&&(args.widgetType===undefined||node.widgetType===args.widgetType)&&(args.contains===undefined||node.description.includes(args.contains))&&(args.sourceFile===undefined||node.creationLocation?.file===args.sourceFile)&&(args.line===undefined||node.creationLocation?.line===Number(args.line));}
function selectNodes(tree,args){
  let nodes=tree.nodes;
  if(args.ancestor){
    if(typeof args.ancestor!=='object'||!Object.keys(args.ancestor).some(k=>['description','widgetType','contains','sourceFile'].includes(k)))throw fail('INVALID_ARGUMENT','ancestor requires a widget selector');
    if(tree.truncated)throw fail('FLUTTER_TREE_TRUNCATED','Cannot prove an ancestor selection is unique');
    const parents=nodes.filter(n=>matches(n,args.ancestor));if(!parents.length)throw fail('CONTROL_NOT_FOUND','Ancestor widget was not found');if(parents.length!==1)throw fail('AMBIGUOUS_CONTROL','Ancestor selector matches multiple widgets');
    nodes=nodes.filter(n=>n.path.startsWith(parents[0].path+'.'));
  }
  return nodes.filter(n=>matches(n,args));
}
function publicNode({diagnosticId,valueId,properties,...node}){return node;}
function artifact(file,type='application/json'){return {path:file,type,size:fs.statSync(file).size};}
async function runVm(operation,args,ctx){
  const timeout=integer(ctx.timeoutMs,120000,1,86400000),signal=AbortSignal.any([AbortSignal.timeout(timeout),...(ctx.signal?[ctx.signal]:[])]),uri=serviceUrl(args.endpoint);
  const traceFile=path.join(ctx.dir,'flutter-trace.jsonl'),trace=e=>fs.appendFileSync(traceFile,JSON.stringify({at:new Date().toISOString(),...e})+'\n');
  const client=new VmConnection(uri.href,{signal,timeoutMs:Math.min(timeout,integer(args.commandTimeoutMs,5000,1,120000)),trace});
  let isolate,group,groupAttempted=false,cleanup;const artifacts=[];
  const ext=async(name,values={})=>{if(!isolate.extensionRPCs?.includes(PREFIX+name))throw fail('FLUTTER_INSPECTOR_UNAVAILABLE','Inspector extension '+name+' is absent; use UIA/visual or a Debug build');const reply=await client.send(PREFIX+name,{isolateId:isolate.id,...values});let result=reply?.result;if(typeof result==='string'&&/^[\[{]/.test(result)){try{result=JSON.parse(result);}catch{}}return result;};
  const dispose=async()=>{if(!groupAttempted)return;try{await ext('disposeGroup',{objectGroup:group});cleanup={released:true};}catch(e){cleanup={released:false,error:e.code};}finally{groupAttempted=false;}};
  const snapshot=async()=>{
    await dispose();if(cleanup?.released===false)throw fail('FLUTTER_CLEANUP_FAILED','Inspector group could not be released');
    group='wdb-'+crypto.randomUUID();groupAttempted=true;
    let root;
    if(args.treeMode!=='full')root=await ext('getRootWidgetSummaryTree',{objectGroup:group});
    else if(isolate.extensionRPCs.includes(PREFIX+'getRootWidgetTree'))root=await ext('getRootWidgetTree',{groupName:group,isSummaryTree:'false',withPreviews:'false',fullDetails:'false'});
    else throw fail('FLUTTER_INSPECTOR_UNAVAILABLE','This engine lacks full tree traversal; use summary tree mode');
    if(!root)throw fail('FLUTTER_TREE_NOT_READY','Flutter root has not been mounted');
    return flatten(root,args);
  };
  try{
    const vm=await client.send('getVM');if(!vm||!Array.isArray(vm.isolates))throw fail('INVALID_FLUTTER_RESPONSE','VM did not return isolates');
    if(args.pid!==undefined&&Number(args.pid)!==Number(vm.pid))throw fail('FLUTTER_PROCESS_MISMATCH','VM PID does not match the selected application');
    const refs=vm.isolates;if(refs.length>64)throw fail('FLUTTER_RESPONSE_TOO_LARGE','VM has too many isolates for bounded discovery');
    const isolates=[];for(const ref of refs)isolates.push(await client.send('getIsolate',{isolateId:ref.id}));
    const info={endpoint:uri.origin+'/<redacted>/ws',pid:vm.pid,vmVersion:vm.version,isolates:isolates.map(i=>({id:i.id,name:i.name,runnable:i.runnable,rootLibrary:i.rootLib?.uri,extensions:i.extensionRPCs||[],capabilities:{inspector:(i.extensionRPCs||[]).includes(PREFIX+'getRootWidget'),memory:true,logs:true},pauseKind:i.pauseEvent?.kind})),backend:'flutter'};
    let data;
    if(operation==='info'||operation==='isolates')data=info;
    else{
      isolate=selectIsolate(isolates,args.isolate);
      if(['tree','find','properties','wait'].includes(operation)){
        if(args.treeMode!==undefined&&!['full','summary'].includes(args.treeMode))throw fail('INVALID_ARGUMENT','treeMode must be full or summary');
        const hasSelector=['description','widgetType','contains','sourceFile'].some(k=>typeof args[k]==='string'&&args[k].length>0);
        if(operation!=='tree'&&!hasSelector)throw fail('INVALID_ARGUMENT','Provide description, widgetType or contains');
        const start=Date.now(),waitMs=integer(args.timeoutMs,10000,1,300000),state=args.state||'present';
        if(operation==='wait'&&!['present','absent'].includes(state))throw fail('INVALID_ARGUMENT','Flutter wait supports present or absent');
        while(true){
          const tree=await snapshot(),selected=selectNodes(tree,args);
          if(operation==='wait'){
            if(state==='absent'&&tree.truncated)throw fail('FLUTTER_TREE_TRUNCATED','Cannot prove absence from a truncated tree; increase depth/limit');
            let satisfied=state==='present'?selected.length>0:selected.length===0,property;
            if(args.property!==undefined){
              if(state!=='present'||args.value===undefined)throw fail('INVALID_ARGUMENT','Property wait requires present state and value');
              if(tree.truncated)throw fail('FLUTTER_TREE_TRUNCATED','Property wait requires a unique complete selection');
              if(selected.length>1)throw fail('AMBIGUOUS_CONTROL','Property wait matched multiple widgets');
              const props=selected.length?await ext('getProperties',{arg:selected[0].diagnosticId,objectGroup:group}):[];
              property=(props||[]).find(p=>p.name===args.property);satisfied=!!property&&property.description===String(args.value);
            }
            if(satisfied){data={state,count:selected.length,elapsedMs:Date.now()-start,...(property?{property:{name:property.name,description:property.description}}:{})};break;}
            if(Date.now()-start>=waitMs)throw fail('TIMEOUT','Flutter widget wait timed out');await delay(150,null,{signal});continue;
          }
          if(operation==='properties'){
            if(tree.truncated)throw fail('FLUTTER_TREE_TRUNCATED','Cannot prove unique selection from a truncated tree');
            if(!selected.length)throw fail('CONTROL_NOT_FOUND','No matching Flutter widget');if(selected.length!==1)throw fail('AMBIGUOUS_CONTROL','Multiple widgets match; refine the selector');
            if(!selected[0].diagnosticId)throw fail('STALE_FLUTTER_OBJECT','Widget lacks an Inspector reference');
            const props=await ext('getProperties',{arg:selected[0].diagnosticId,objectGroup:group});
            data={node:publicNode(selected[0]),properties:(props||[]).map(p=>({name:p.name,description:p.description,propertyType:p.propertyType,level:p.level}))};
          }else data={count:selected.length,truncated:tree.truncated,scope:args.treeMode==='full'?'full-widget-tree':'application-widget-summary',nodes:selected.map(publicNode)};
          break;
        }
      }else if(operation==='memory')data={memory:await client.send('getMemoryUsage',{isolateId:isolate.id})};
      else if(operation==='logs'){
        const events=[],limit=integer(args.limit,200,1,2000),durationMs=integer(args.durationMs,1000,1,60000);let size=0,truncated=false;const streams=[];
        client.onEvent(m=>{if(m.method!=='streamNotify')return;const e=m.params?.event;if(!e||e.isolate?.id&&e.isolate.id!==isolate.id)return;const bytes=Buffer.byteLength(JSON.stringify(m.params));if(events.length>=limit||size+bytes>1024*1024){truncated=true;return;}size+=bytes;const entry={...m.params};if(e.bytes)entry.event={...e,text:Buffer.from(e.bytes,'base64').toString('utf8')};events.push(entry);});
        for(const streamId of ['Stdout','Stderr','Logging','Extension']){try{await client.send('streamListen',{streamId});streams.push(streamId);}catch(e){if(e.code!=='FLUTTER_PROTOCOL_ERROR')throw e;}}
        if(!streams.length)throw fail('FLUTTER_LOGS_UNAVAILABLE','No requested streams are available');
        await delay(durationMs,null,{signal});const file=path.join(ctx.dir,'flutter-events.json');fs.writeFileSync(file,JSON.stringify({events,truncated,streams},null,2));artifacts.push(artifact(file));data={events,truncated,streams,durationMs};
      }else throw fail('UNKNOWN_OPERATION','Unknown Flutter observation: '+operation);
      data={...data,backend:'flutter',pid:vm.pid,isolate:{id:isolate.id,name:isolate.name}};
    }
    await dispose();trace({stage:'completed',operation,cleanup});return {...data,...(cleanup?{cleanup}:{}),artifacts:[...artifacts,artifact(traceFile,'application/x-ndjson')]};
  }catch(e){await dispose();if(signal.aborted)e=fail(ctx.signal?.aborted?'CANCELLED':'TIMEOUT','Flutter observation ended before completion');trace({stage:'failed',operation,code:e.code,cleanup});e.details={...e.details,...(cleanup?{cleanup}:{})};e.artifacts=[...artifacts,artifact(traceFile,'application/x-ndjson')];throw e;}
  finally{client.close();}
}
module.exports={runVm,selectIsolate,flatten,matches,integer};
