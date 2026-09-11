(function(root){
  'use strict';
  function parse(query){
    if(typeof query!=='string'||query.length>512)throw Error('正则表达式最多 512 个字符');
    let pattern=query,flags='i';
    if(query.startsWith('/')){const end=query.lastIndexOf('/');if(end>0){pattern=query.slice(1,end);flags=query.slice(end+1);}}
    if(!/^[imsu]*$/.test(flags)||new Set(flags).size!==flags.length)throw Error('仅支持 i、m、s、u 标志，且不可重复');
    return new RegExp(pattern,flags);
  }
  // Renderer calls this only inside its dedicated, terminable Worker.
  function search(results,query,aliases={},limit=50){
    const regex=parse(query);
    return results.map((r,index)=>{
      const alias=r.persistable===false?'':aliases[r.id];
      const title=typeof r.title==='string'?r.title:'';
      let score=alias&&regex.test(alias)?10000:regex.test(title)?7000:0;
      if(!score&&[r.subtitle,...(Array.isArray(r.keywords)?r.keywords:[])].some(text=>typeof text==='string'&&regex.test(text)))score=1000;
      return {id:r.id,index,score};
    }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(r=>r.id);
  }
  if(typeof module!=='undefined')module.exports={parse,search};else root.LauncherRegex={parse,search};
})(globalThis);
