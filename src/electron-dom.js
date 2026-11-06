'use strict';
// Serialized into the selected renderer. Keep this function free of Node dependencies.
function queryPage(args) {
  function problem(code,message){return {error:{code,message}};}
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const name=e=>clean(e.getAttribute('aria-label')||(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')||e.labels?.[0]?.textContent||e.innerText||e.getAttribute('title')||e.getAttribute('alt')||e.getAttribute('placeholder'));
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const summary=e=>{const r=e.getBoundingClientRect();return {tag:e.localName,id:e.id,className:e.getAttribute('class'),testId:e.getAttribute('data-testid'),role:e.getAttribute('role'),name:name(e).slice(0,500),type:e.getAttribute('type'),value:e.type==='password'?undefined:typeof e.value==='string'?e.value.slice(0,2000):undefined,disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true',visible:visible(e),bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};};
  const roots=[document],all=[];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*')){all.push(e);if(e.shadowRoot)roots.push(e.shadowRoot);}
  let matches;
  try {matches=args.selector?roots.flatMap(root=>Array.from(root.querySelectorAll(args.selector))):all.filter(e=>e.matches('button,input,textarea,select,a,[role],[tabindex],[data-testid],[aria-label],[title],[onclick]'));}
  catch(e){return problem('INVALID_SELECTOR',e.message);}
  if(args.name!==undefined)matches=matches.filter(e=>name(e)===args.name);
  if(args.visible!==false)matches=matches.filter(visible);
  const limit=Math.min(Math.max(Number(args.limit)||100,1),1000);
  if(args.mode==='find'||args.mode==='tree')return {title:document.title,url:location.href,coordinateSpace:'css-viewport',devicePixelRatio,viewport:{width:innerWidth,height:innerHeight},count:matches.length,truncated:matches.length>limit,controls:matches.slice(0,limit).map(summary),frames:Array.from(document.querySelectorAll('iframe')).map(e=>({src:e.src,title:e.title})),scope:'current-document-and-open-shadow-roots'};
  if(!args.selector&&args.name===undefined)return problem('INVALID_ARGUMENT','Action needs selector or exact accessible name');
  if(!matches.length)return problem('CONTROL_NOT_FOUND','No matching visible DOM control');
  if(matches.length!==1)return problem('AMBIGUOUS_CONTROL','Matched '+matches.length+' controls; refine selector');
  const element=matches[0];if(element.disabled||element.getAttribute('aria-disabled')==='true')return problem('CONTROL_DISABLED','DOM control is disabled');
  if(args.mode==='prepare'){
    element.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    const r=element.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    let hit=document.elementFromPoint(x,y);while(hit?.shadowRoot){const next=hit.shadowRoot.elementFromPoint(x,y);if(!next||next===hit)break;hit=next;}
    if(!hit||!(element===hit||element.contains(hit)))return problem('CONTROL_OCCLUDED','Control center is covered; inspect screenshot');
    return {control:summary(element),x,y,coordinateSpace:'css-viewport'};
  }
  if(args.mode==='focus-edit'){
    if(!element.matches('input,textarea')&&!element.isContentEditable)return problem('CONTROL_NOT_EDITABLE','Control is not editable');
    if(element.readOnly)return problem('CONTROL_READ_ONLY','Control is read-only');
    element.focus();let active=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;
    if(active!==element)return problem('FOCUS_DENIED','DOM focus did not reach the target');
    if(args.action==='fill'){
      if(typeof element.select==='function')element.select();
      else {const range=document.createRange();range.selectNodeContents(element);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
    }
    return {control:summary(element)};
  }
  return problem('INVALID_ARGUMENT','Unknown DOM query mode');
}
module.exports={queryPage};
