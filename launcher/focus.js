'use strict';
// Native handles stay in the main process; renderer cannot supply focus targets.
function nativeAdapter(platform) {
  const ffi=require('koffi');
  if(platform==='win32') {
    const lib=ffi.load('user32.dll');
    const foreground=lib.func('void * __stdcall GetForegroundWindow()');
    const processId=lib.func('uint32_t __stdcall GetWindowThreadProcessId(void *, void *)');
    const exists=lib.func('int __stdcall IsWindow(void *)');
    const activate=lib.func('int __stdcall SetForegroundWindow(void *)');
    const pid=handle=>{if(!handle)return 0;const out=Buffer.alloc(4);processId(handle,out);return out.readUInt32LE();};
    return { currentPid:()=>pid(foreground()), capture:()=>{const handle=foreground();return handle?{handle,pid:pid(handle)}:null;}, restore:target=>!!exists(target.handle)&&pid(target.handle)===target.pid&&!!activate(target.handle), release:()=>{} };
  }
  if(platform==='darwin') {
    const lib=ffi.load('/usr/lib/libobjc.A.dylib');
    const cls=lib.func('objc_getClass','void *',['str']), selector=lib.func('sel_registerName','void *',['str']);
    const object=lib.func('objc_msgSend','void *',['void *','void *']);
    const integer=lib.func('objc_msgSend','int',['void *','void *']);
    const boolean=lib.func('objc_msgSend','bool',['void *','void *']);
    const activate=lib.func('objc_msgSend','bool',['void *','void *','uint64']);
    const release=lib.func('objc_msgSend','void',['void *','void *']);
    const front=()=>object(object(cls('NSWorkspace'),selector('sharedWorkspace')),selector('frontmostApplication'));
    return {
      currentPid:()=>{const app=front();return app?integer(app,selector('processIdentifier')):0;},
      capture:()=>{const app=front();if(!app)return null;object(app,selector('retain'));return {app,pid:integer(app,selector('processIdentifier'))};},
      restore:target=>!boolean(target.app,selector('isTerminated'))&&activate(target.app,selector('activateWithOptions:'),2),
      release:target=>release(target.app,selector('release')),
    };
  }
  return null;
}
function createFocusService({platform=process.platform, ownerPid=process.pid, adapter}={}) {
  let backend=adapter, target, initialized=!!adapter;
  function get(){if(!initialized){initialized=true;try{backend=nativeAdapter(platform);}catch{backend=null;}}return backend;}
  function discard(){if(target){try{backend?.release(target);}catch{}target=null;}}
  return {
    capture({keepWhenOwned=false}={}){try{const api=get();const next=api?.capture();if(next?.pid&&next.pid!==ownerPid){discard();target=next;}else{if(next)api.release(next);if(!keepWhenOwned)discard();}return !!target;}catch{if(!keepWhenOwned)discard();return false;}},
    restore(){try{const api=get();if(!target||!api)return false;if(api.currentPid()!==ownerPid)return false;return api.restore(target);}catch{return false;}finally{discard();}},
    discard,
  };
}
module.exports={createFocusService,nativeAdapter};
