const test=require('node:test');
const assert=require('node:assert/strict');
const regex=require('../launcher/regex');
const {createApplicationActions,newWindowArgs,windowsBackend}=require('../launcher/application-actions');

test('regex matches title, aliases and content with explicit flags',()=>{
  const rows=[{id:'code',title:'Code',subtitle:'Editor'},{id:'note',title:'笔记',keywords:['task done']},{id:'alias',title:'Other'}];
  assert.deepEqual(regex.search(rows,'/^code$/i'),['code']);
  assert.deepEqual(regex.search(rows,'/笔记|(?<=task )done/u'),['note']);
  assert.deepEqual(regex.search(rows,'^shortcut$',{alias:'shortcut'}),['alias']);
  assert.throws(()=>regex.search(rows,'('),/Invalid regular expression/);
  assert.throws(()=>regex.parse('/code/g'),/仅支持/);
  assert.throws(()=>regex.parse('/code/ii'),/不可重复/);
  assert.throws(()=>regex.parse('a'.repeat(513)),/512/);
});

test('Windows actions preserve shortcut arguments and request distinct new/elevated modes',async()=>{
  const calls=[];
  const action=createApplicationActions({platform:'win32',resolvePath:async file=>file,readShortcut:()=>({target:'C:\\Apps\\chrome.exe',args:'--profile-directory="User Profile"',cwd:'C:\\Apps'}),backend:{launch:async(target,verb)=>calls.push({target,verb}),list:()=>[],focus:()=>false}});
  await action.run('C:\\Menu\\Browser.lnk','new');
  assert.equal(calls[0].verb,'open');assert.equal(calls[0].target.args,'--profile-directory="User Profile" --new-window about:blank');
  await action.run('C:\\Menu\\Browser.lnk','admin');assert.equal(calls[1].verb,'runas');
  await assert.rejects(action.run('C:\\Menu\\Browser.lnk','focus'),/app_window_not_found/);assert.equal(calls.length,2);
  await assert.rejects(action.run('C:\\Menu\\Browser.lnk','anything'),/invalid_action/);
});

test('focus selects an exact executable match and never starts another process',async()=>{
  const selected=[];
  const action=createApplicationActions({platform:'win32',resolvePath:async file=>file,backend:{list:()=>[{path:'D:\\Other\\App.exe',pid:1},{path:'c:\\apps\\app.exe',pid:2}],focus:window=>{selected.push(window.pid);return true;},launch:()=>{throw Error('must not launch');}}});
  await action.run('C:\\Apps\\App.exe','focus');assert.deepEqual(selected,[2]);
});

test('macOS uses open -n for a new instance and only activates existing applications',async()=>{
  const calls=[];
  const action=createApplicationActions({platform:'darwin',resolvePath:async file=>file,backend:{focus:()=> 'focused'},executeFile:(file,args,options,callback)=>{calls.push({file,args});callback(null);}});
  await action.run('/Applications/Test.app','new');assert.deepEqual(calls,[{file:'/usr/bin/open',args:['-n','/Applications/Test.app']}]);
  await action.run('/Applications/Test.app','focus');assert.equal(calls.length,1);
  await assert.rejects(action.run('/Applications/Test.app','admin'),/unsupported_app_action/);
  assert.equal(newWindowArgs({path:'C:\\Apps\\Code.exe'}),'--new-window');
});

test('native Windows enumeration reads process identities without launching or focusing',{skip:process.platform!=='win32'},()=>{
  const rows=windowsBackend().list();assert.ok(Array.isArray(rows));
  assert.ok(rows.every(row=>typeof row.path==='string'&&Number.isInteger(row.pid)));
});
