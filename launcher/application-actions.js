'use strict';
const path=require('node:path');
const fs=require('node:fs/promises');
const {execFile}=require('node:child_process');
let windows;
function windowsBackend(){
  if(windows)return windows;
  const ffi=require('koffi'),user=ffi.load('user32.dll'),kernel=ffi.load('kernel32.dll'),shell=ffi.load('shell32.dll');
  const callback=ffi.proto('int __stdcall LauncherAppEnumProc(void *, intptr_t)');
  const enumerate=user.func('EnumWindows','int',[ffi.pointer(callback),'intptr_t']);
  const visible=user.func('int __stdcall IsWindowVisible(void *)');
  const titleLength=user.func('int __stdcall GetWindowTextLengthW(void *)');
  const pidFor=user.func('uint32_t __stdcall GetWindowThreadProcessId(void *, void *)');
  const openProcess=kernel.func('void * __stdcall OpenProcess(uint32_t, int, uint32_t)');
  const imageName=kernel.func('int __stdcall QueryFullProcessImageNameW(void *, uint32_t, void *, void *)');
  const closeHandle=kernel.func('int __stdcall CloseHandle(void *)');
  const show=user.func('int __stdcall ShowWindowAsync(void *, int)');
  const minimized=user.func('int __stdcall IsIconic(void *)');
  const activate=user.func('int __stdcall SetForegroundWindow(void *)');
  const shellExecute=shell.func('intptr_t __stdcall ShellExecuteW(void *, str16, str16, str16, str16, int)');
  function list(){
    const found=[],processes=new Map();
    enumerate(handle=>{
      if(!visible(handle)||!titleLength(handle))return 1;
      const output=Buffer.alloc(4);pidFor(handle,output);const pid=output.readUInt32LE();
      if(!processes.has(pid)){
        const processHandle=openProcess(0x1000,0,pid);let file='';
        if(processHandle){try{const buffer=Buffer.alloc(65536),length=Buffer.alloc(4);length.writeUInt32LE(32768);if(imageName(processHandle,0,buffer,length))file=buffer.toString('utf16le',0,length.readUInt32LE()*2);}finally{closeHandle(processHandle);}}
        processes.set(pid,file);
      }
      if(processes.get(pid))found.push({handle,pid,path:processes.get(pid)});
      return 1;
    },0);
    return found;
  }
  windows={list,focus:window=>{const output=Buffer.alloc(4);pidFor(window.handle,output);if(output.readUInt32LE()!==window.pid)return false;if(minimized(window.handle))show(window.handle,9);return !!activate(window.handle);},launch:(target,verb,owner)=>new Promise((resolve,reject)=>{
    shellExecute.async(owner||null,verb,target.path,target.args||null,target.cwd||null,1,(error,result)=>{if(error)reject(error);else if(Number(result)<=32)reject(Error(verb==='runas'?'elevation_cancelled_or_denied':'app_open_failed'));else resolve();});
  })};
  return windows;
}
let mac;
function macBackend(){
  if(mac)return mac;
  const ffi=require('koffi'),lib=ffi.load('/usr/lib/libobjc.A.dylib');
  const cls=lib.func('objc_getClass','void *',['str']),sel=lib.func('sel_registerName','void *',['str']);
  const object=lib.func('objc_msgSend','void *',['void *','void *']);
  const count=lib.func('objc_msgSend','uint64',['void *','void *']);
  const item=lib.func('objc_msgSend','void *',['void *','void *','uint64']);
  const text=lib.func('objc_msgSend','str',['void *','void *']);
  const activate=lib.func('objc_msgSend','bool',['void *','void *','uint64']);
  mac={focus:appPath=>{
    const workspace=object(cls('NSWorkspace'),sel('sharedWorkspace'));
    const apps=object(workspace,sel('runningApplications'));
    for(let i=0;i<Number(count(apps,sel('count')));i++){
      const app=item(apps,sel('objectAtIndex:'),i),url=object(app,sel('bundleURL'));
      if(!url)continue;
      const value=object(url,sel('path'));
      if(value&&text(value,sel('UTF8String'))===appPath)return activate(app,sel('activateWithOptions:'),2)?'focused':'denied';
    }
    return 'missing';
  }};
  return mac;
}
function newWindowArgs(target){
  const name=path.win32.basename(target.path).toLowerCase();
  if(['chrome.exe','msedge.exe','brave.exe','vivaldi.exe','opera.exe'].includes(name))return '--new-window about:blank';
  if(name==='firefox.exe')return '-new-window about:blank';
  if(['code.exe','code - insiders.exe','cursor.exe','windsurf.exe'].includes(name))return '--new-window';
  if(['wt.exe','windowsterminal.exe'].includes(name))return '-w new';
  if(name==='winword.exe')return '/w';
  if(name==='excel.exe')return '/x';
  if(name==='notepad++.exe')return '-multiInst -nosession';
  if(['sublime_text.exe','subl.exe'].includes(name))return '--new-window';
  return '';
}
function createApplicationActions({platform=process.platform,readShortcut,owner=()=>null,backend,executeFile=execFile,resolvePath=fs.realpath}={}){
  async function resolve(file){
    let target={path:file,args:'',cwd:''};
    if(platform==='win32'&&/\.lnk$/i.test(file)){
      const shortcut=readShortcut(file);target={path:shortcut.target,args:shortcut.args||'',cwd:shortcut.cwd||''};
      const expand=value=>value.replace(/%([^%]+)%/g,(token,key)=>process.env[key]||token);
      target.path=expand(target.path);target.cwd=expand(target.cwd);
    }
    const parser=platform==='win32'?path.win32:path.posix;
    if(!parser.isAbsolute(target.path)||/[\0\r\n]/.test(target.path)||target.path.startsWith('\\\\'))throw Error('unsupported_app_target');
    if(platform==='win32'&&!/\.exe$/i.test(target.path))throw Error('unsupported_app_target');
    try{target.path=await resolvePath(target.path);}catch{throw Error('app_not_found');}
    return target;
  }
  return {async run(file,mode){
    if(!['admin','new','focus'].includes(mode))throw Error('invalid_action');
    if(platform==='darwin'&&mode==='admin')throw Error('unsupported_app_action');
    const target=await resolve(file);
    if(platform==='win32'){
      const api=backend||windowsBackend();
      if(mode==='focus'){
        const window=api.list().find(w=>path.win32.normalize(w.path).toLowerCase()===path.win32.normalize(target.path).toLowerCase());
        if(!window)throw Error('app_window_not_found');
        if(!api.focus(window))throw Error('app_focus_denied');
      }else{
        if(mode==='new'){const args=newWindowArgs(target);target.args=[target.args,args].filter(Boolean).join(' ');}
        await api.launch(target,mode==='admin'?'runas':'open',owner());
      }
    }else if(platform==='darwin'){
      if(mode==='focus'){const result=(backend||macBackend()).focus(target.path);if(result!=='focused')throw Error(result==='missing'?'app_window_not_found':'app_focus_denied');}
      else await new Promise((resolve,reject)=>executeFile('/usr/bin/open',['-n',target.path],{timeout:10000},error=>error?reject(Error('app_open_failed')):resolve()));
    }else throw Error('unsupported_app_action');
    return {ok:true};
  }};
}
module.exports={createApplicationActions,newWindowArgs,windowsBackend};
