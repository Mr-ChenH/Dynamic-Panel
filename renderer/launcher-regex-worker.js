importScripts('../launcher/regex.js');
self.onmessage=({data})=>{
  try {self.postMessage({key:data.key,ids:self.LauncherRegex.search(data.results,data.query,data.aliases,data.limit)});}
  catch(error){self.postMessage({key:data.key,error:`正则错误：${error.message}`});}
};
