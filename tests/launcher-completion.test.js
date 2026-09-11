const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const transfer=require('../launcher/data-transfer');
const storage=require('../launcher/storage-schema');
const {createFocusService,nativeAdapter}=require('../launcher/focus');
const {queryExtension}=require('../launcher/extension-host');
const example=require('../examples/launcher/local-tools/manifest.json');

test('focus restoration only reactivates the captured application while we own foreground',()=>{
  let foreground=42,restores=0,releases=0;
  const service=createFocusService({ownerPid:10,adapter:{capture:()=>({pid:foreground}),currentPid:()=>foreground,restore:()=>{restores++;return true;},release:()=>{releases++;}}});
  service.capture();foreground=77;assert.equal(service.restore(),false);assert.equal(restores,0);
  foreground=42;service.capture();foreground=10;assert.equal(service.restore(),true);assert.equal(restores,1);
  assert.equal(service.restore(),false);assert.equal(releases,2);
  service.capture();assert.equal(service.restore(),false);assert.equal(restores,1);
});

test('Windows foreground adapter can inspect a native target without activating it',{skip:process.platform!=='win32'},()=>{
  const adapter=nativeAdapter('win32'),target=adapter.capture();
  if(target){assert.ok(Number.isInteger(target.pid));assert.ok(target.pid>=0);adapter.release(target);}
});

test('selected extension data round-trips and invalid imports preserve existing data',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'launcher-transfer-'));
  try{
    const a=path.join(root,'a'),b=path.join(root,'b');await fs.mkdir(a);await fs.mkdir(b);
    await fs.writeFile(path.join(a,'data.json'),'original');await fs.writeFile(path.join(b,'untouched.txt'),'other');
    const archive=await transfer.exportData(a,'extension-a');
    await fs.writeFile(path.join(a,'data.json'),'changed');await transfer.importData(a,'extension-a',archive);
    assert.equal(await fs.readFile(path.join(a,'data.json'),'utf8'),'original');
    assert.equal(await fs.readFile(path.join(b,'untouched.txt'),'utf8'),'other');
    for(const invalid of [{...archive,extensionId:'other'},{...archive,files:[{path:'../escape',data:'YQ=='}]},{...archive,files:[{path:'safe.txt:stream',data:'YQ=='}]},{...archive,files:[{path:'a',data:'bad'}]},{...archive,files:[{path:'a',data:'YQ=='},{path:'a/b',data:'Yg=='}]}])await assert.rejects(transfer.importData(a,'extension-a',invalid));
    assert.equal(await fs.readFile(path.join(a,'data.json'),'utf8'),'original');
    await fs.symlink(b,path.join(a,'outside'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(transfer.exportData(a,'extension-a'),/extension_symlink/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('source schemas reject malformed rows without mutating raw data',()=>{
  const raw=JSON.stringify([{id:'good',title:'Title',content:'text'},{id:{bad:true},title:'Bad'},{id:'large',content:'a'.repeat(2*1024*1024+1)}]);
  const result=storage.parse('notch-note-archive-v1',raw,[]);
  assert.equal(result.invalid,true);assert.deepEqual(result.value,[{id:'good',title:'Title',content:'text'}]);assert.equal(JSON.parse(raw).length,3);
  assert.equal(storage.parse('notch-home-commands','[',[]).invalid,true);
  assert.deepEqual(storage.history([{at:1,durationMs:3,operation:'query',status:'success',secret:'drop'},{at:1,durationMs:-1,operation:'query',status:'success'}]),[{at:1,durationMs:3,operation:'query',status:'success'}]);
});

test('extension permissions allow private data but deny outside IO, code writes and child processes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'launcher-permissions-'));
  try{
    const code=path.join(root,'code'),data=path.join(root,'data'),outside=path.join(root,'workspace.txt');
    await fs.mkdir(code);await fs.mkdir(data);await fs.writeFile(outside,'untouched');
    await fs.writeFile(path.join(code,'index.js'),`require('readline').createInterface({input:process.stdin}).once('line',line=>{
      const r=JSON.parse(line),fs=require('fs'),path=require('path');const check=fn=>{try{fn();return 'allowed';}catch(e){return e.code;}};
      const results={private:check(()=>fs.writeFileSync(path.join(r.context.storagePath,'own.txt'),'ok')),read:check(()=>fs.readFileSync(r.query)),write:check(()=>fs.writeFileSync(r.query,'bad')),code:check(()=>fs.writeFileSync(path.join(__dirname,'overwrite'),'bad')),process:check(()=>require('child_process').spawnSync(process.execPath,['-e','']))};
      process.stdout.write(JSON.stringify({type:'result',requestId:r.requestId,items:[{id:'test',title:'Permissions',action:{type:'copy-text',text:JSON.stringify(results)}}]})+'\\n');
    });`);
    for (const executable of [process.execPath,require('electron')]) {
      const response=await queryExtension(code,example,'upper',outside,undefined,executable,{storagePath:data});
      assert.deepEqual(JSON.parse(response[0].action.text),{private:'allowed',read:'ERR_ACCESS_DENIED',write:'ERR_ACCESS_DENIED',code:'ERR_ACCESS_DENIED',process:'ERR_ACCESS_DENIED'});
    }
    assert.equal(await fs.readFile(outside,'utf8'),'untouched');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
