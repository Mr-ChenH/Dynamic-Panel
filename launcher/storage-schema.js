(function (root) {
  'use strict';
  const MAX_RAW = 32 * 1024 * 1024;
  const text=(v,max=16000)=>typeof v==='string'&&v.length<=max;
  const id=v=>(typeof v==='string'||Number.isSafeInteger(v))&&String(v).length>0&&String(v).length<=160;
  function parse(key,raw,fallback) {
    if(typeof raw!=='string')return {value:fallback,invalid:false};
    if(raw.length>MAX_RAW)return {value:fallback,invalid:true};
    let source;try{source=JSON.parse(raw);}catch{return {value:fallback,invalid:true};}
    let invalid=false;
    function rows(value,validate,max=10000){if(!Array.isArray(value)){invalid=true;return [];}if(value.length>max)invalid=true;return value.slice(0,max).flatMap(row=>{const result=validate(row);if(!result)invalid=true;return result?[result]:[];});}
    let value=fallback;
    if(key==='notch-note-archive-v1')value=rows(source,n=>n&&id(n.id)&&text(n.title||'')&&text(n.content||'',2*1024*1024)?{id:n.id,title:n.title||'',content:n.content||''}:null);
    else if(key==='notch-home-commands')value=rows(source,n=>n&&id(n.id)&&text(n.text)?{id:n.id,text:n.text}:null);
    else if(key==='notch-link-groups')value=rows(source,g=>g&&id(g.id)?{id:g.id,links:rows(g.links,l=>l&&id(l.id)&&text(l.url,2048)&&text(l.title||'')?{id:l.id,title:l.title||'',url:l.url}:null,2000)}:null,1000);
    else if(key==='notch-clip-history')value=rows(source,n=>n&&n.type!=='text'?{type:'ignored'}:n&&(id(n.id)||Number.isFinite(n.timestamp))&&text(n.text)?{id:n.id,timestamp:n.timestamp,type:'text',text:n.text}:null);
    else if(key==='notch-todo-data'||key==='notch-todo-category-names-v1'){
      if(!source||typeof source!=='object'||Array.isArray(source))invalid=true;
      else value=Object.fromEntries(['P0','P1','P2','P3'].flatMap(p=>{
        if(source[p]===undefined)return [];
        if(key.endsWith('names-v1')){if(text(source[p],200))return [[p,source[p]]];invalid=true;return [];}
        return [[p,rows(source[p],n=>n&&id(n.id)&&text(n.text)&&typeof n.done==='boolean'?{id:n.id,text:n.text,done:n.done}:null)]];
      }));
    } else if(source&&typeof source===typeof fallback&&Array.isArray(source)===Array.isArray(fallback))value=source;
    else invalid=true;
    return {value,invalid};
  }
  function history(value){return Array.isArray(value)?value.slice(-20).filter(r=>r&&Number.isSafeInteger(r.at)&&r.at>=0&&Number.isSafeInteger(r.durationMs)&&r.durationMs>=0&&r.durationMs<=1e9&&['query','execute','host-action'].includes(r.operation)&&typeof r.status==='string'&&/^[a-z_-]{1,80}$/.test(r.status)).map(({at,durationMs,operation,status})=>({at,durationMs,operation,status})):[];}
  const api={parse,history,MAX_RAW};
  if(typeof module!=='undefined')module.exports=api;else root.LauncherStorage=api;
})(typeof window==='undefined'?globalThis:window);
