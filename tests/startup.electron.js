const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
// The production bootstrap may inspect encrypted legacy settings on this Mac.
// Use Chromium's test keychain so a regression test never prompts for user keys.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({version:1, localStorage:{
  'notch-home-note':'Recovered workspace note',
  'notch-launcher-favorites-v1': JSON.stringify(['command:migrated']),
  'notch-launcher-aliases-v1': JSON.stringify({ 'command:migrated': 'restored-alias' }),
  'notch-recordings':JSON.stringify([{id:'startup-recording',createdAt:1788709776699,durationMs:1558,transcript:'',audioPath:'recordings/retained.webm',mimeType:'audio/webm',title:'Saved recording',category:'未分类'}]),
}}));
const noteImageBase64 = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'assets', 'app-logo-128.png')).toString('base64');
const extensionFixture = require('../examples/launcher/local-tools/manifest.json');
fs.mkdirSync(path.join(profile, 'launcher/extensions'), { recursive: true });
fs.cpSync(path.join(__dirname, '../examples/launcher/local-tools'), path.join(profile, 'launcher/extensions', extensionFixture.id), { recursive: true });
const confirmationFixture={schemaVersion:1,id:'confirmation-test',name:'Confirmation test',version:'1.0.0',description:'Test confirmation policy',author:'Tests',permissions:['clipboard','writeFiles'],commands:[{id:'confirm',title:'Confirmation action',description:'Requires confirmation',mode:'declarative',action:{type:'copy-text',text:'CONFIRMED'}}]};
fs.writeFileSync(path.join(profile, 'launcher/registry.json'), JSON.stringify({ [extensionFixture.id]: { manifest: extensionFixture, enabled: true }, [confirmationFixture.id]:{manifest:confirmationFixture,enabled:true} }));
const errors = [];
setTimeout(() => { console.error('Production startup timed out', errors); app.exit(1); }, 25000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  contents.once('did-finish-load', () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    setTimeout(async () => {
      try {
        const state = await contents.executeJavaScript(`
          (async () => {
            const encoded = '${noteImageBase64}';
            const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
            const saved = await window.notchAPI.saveNoteImage({ noteId: 'startup-note', bytes });
            const source = saved.ok ? await window.notchAPI.readNoteImage(saved.imagePath) : null;
            const deleted = await window.notchAPI.deleteNoteImages('startup-note');
            const afterDelete = saved.ok ? await window.notchAPI.readNoteImage(saved.imagePath) : null;
            return {
              home: !!window.NotchHome,
              workspace: !!window.NotchWorkspace,
              note: document.getElementById('home-note').value,
              recordings: document.querySelectorAll('.recording-item').length,
              imageSaved: saved.ok,
              imagePath: saved.imagePath,
              imageReadable: String(source || '').startsWith('data:image/png;base64,'),
              imageDeleted: deleted,
              imageGone: afterDelete === null,
            };
          })()
        `);
        assert.deepEqual(errors, []);
        assert.deepEqual(state, {
          home: true,
          workspace: true,
          note: 'Recovered workspace note',
          recordings: 1,
          imageSaved: true,
          imagePath: state.imagePath,
          imageReadable: true,
          imageDeleted: true,
          imageGone: true,
        });
        assert.match(state.imagePath, /^note-images\/startup-note\/image-[a-f0-9-]{36}\.png$/);
        const restoredLauncher = await contents.executeJavaScript(`({ favorites:JSON.parse(localStorage.getItem('notch-launcher-favorites-v1')), aliases:JSON.parse(localStorage.getItem('notch-launcher-aliases-v1')) })`);
        assert.deepEqual(restoredLauncher, { favorites:['command:migrated'], aliases:{ 'command:migrated':'restored-alias' } });
        const launcherState = await contents.executeJavaScript(`(async () => {
          localStorage.setItem('notch-home-commands', JSON.stringify([{ id: 'launcher-copy', text: 'launcher verification text' }]));
          await window.NotchLauncher.open();
          const input = document.getElementById('launcher-search');
          input.value = 'launcher verification';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const focused = document.activeElement === input;
          const row = document.querySelector('#launcher-results .launcher-result');
          const title = row?.querySelector('strong')?.textContent;
          document.getElementById('launcher-action-button').click();
          const actionVisible = !document.getElementById('launcher-actions').hidden;
          [...document.querySelectorAll('#launcher-actions button')].find(b => b.textContent === '收藏').click();
          const favorite = JSON.parse(localStorage.getItem('notch-launcher-favorites-v1')).includes('command:launcher-copy');
          await window.NotchLauncher.close();
          return { focused, title, actionVisible, favorite, closed: document.getElementById('launcher').hidden };
        })()`);
        assert.deepEqual(launcherState, { focused: true, title: 'launcher verification text', actionVisible: true, favorite: true, closed: true });
        const regressions = await contents.executeJavaScript(`(async () => {
          const opening = window.NotchLauncher.open();
          await window.NotchLauncher.close();
          await opening;
          const queuedClose = !window.NotchLauncher.isOpen();
          const duplicateEscapeHandled = window.NotchLauncher.handleEscape();
          await window.NotchLauncher.open();
          const search = document.getElementById('launcher-search');
          localStorage.setItem('notch-note-archive-v1', JSON.stringify([{ id:'stale-note', title:'Stale target', content:'text' }]));
          search.value = 'Stale target'; search.dispatchEvent(new Event('input'));
          localStorage.setItem('notch-note-archive-v1', '[]');
          document.querySelector('#launcher-results .launcher-result').click();
          await new Promise(resolve => setTimeout(resolve, 30));
          const failedVisible = window.NotchLauncher.isOpen() && document.getElementById('launcher-status').textContent.includes('不存在');
          const failedUsage = JSON.parse(localStorage.getItem('notch-launcher-usage-v1') || '{}')['note:stale-note'];
          document.getElementById('launcher-manage').click();
          await new Promise(resolve => setTimeout(resolve, 30));
          const managerInputDisabled = search.disabled;
          window.NotchLauncher.escape();
          const restoredInput = !search.disabled;
          await window.NotchLauncher.close();
          data.P0.push({ id:'completed-launcher-test', text:'Completed target', done:true, deadline:Date.now() });
          await window.NotchPanel.navigate({ tab:'todo', id:'completed-launcher-test' });
          await new Promise(resolve => requestAnimationFrame(resolve));
          const completedVisible = !!document.querySelector('[data-id="completed-launcher-test"]');
          data.P0 = data.P0.filter(t => t.id !== 'completed-launcher-test'); renderList('P0');
          return { queuedClose, duplicateEscapeHandled, failedVisible, failedUsage: !!failedUsage, managerInputDisabled, restoredInput, completedVisible };
        })()`);
        assert.deepEqual(regressions, { queuedClose:true, duplicateEscapeHandled:true, failedVisible:true, failedUsage:false, managerInputDisabled:true, restoredInput:true, completedVisible:true });
        assert.deepEqual(errors, []);
        await contents.executeJavaScript('window.NotchLauncher.open()');
        await new Promise(resolve => setTimeout(resolve, 300));
        const extensionRun = await contents.executeJavaScript(`(async () => {
          const response = await window.notchAPI.queryLauncher('大写转换 production', 90210);
          const row = response.items?.find(item => item.title === 'PRODUCTION');
          if (!row) return { ok:false };
          return window.notchAPI.runLauncher(row.id);
        })()`);
        assert.equal(extensionRun.ok, true);
        assert.equal(await require('electron').clipboard.readText(), 'PRODUCTION');
        const confirmationId=await contents.executeJavaScript(`(async()=>{const r=await window.notchAPI.queryLauncher('Confirmation action');return r.items.find(i=>i.title==='Confirmation action').id;})()`);
        const electronDialog=require('electron').dialog, originalDialog=electronDialog.showMessageBox;
        try {
          electronDialog.showMessageBox=async()=>({response:0});
          const cancelled=await contents.executeJavaScript(`window.notchAPI.runLauncher(${JSON.stringify(confirmationId)})`);
          assert.equal(cancelled.error,'cancelled');assert.equal(await require('electron').clipboard.readText(),'PRODUCTION');
          electronDialog.showMessageBox=async()=>({response:1});
          const accepted=await contents.executeJavaScript(`window.notchAPI.runLauncher(${JSON.stringify(confirmationId)})`);
          assert.equal(accepted.ok,true);assert.equal(await require('electron').clipboard.readText(),'CONFIRMED');
        } finally {electronDialog.showMessageBox=originalDialog;}
        const managerChecks = await contents.executeJavaScript(`(async () => {
          const grouped = !!document.querySelector('.launcher-group');
          const result = document.querySelector('.launcher-result');
          result.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, cancelable:true }));
          const contextMenu = !document.getElementById('launcher-actions').hidden;
          window.NotchLauncher.escape();
          localStorage.setItem('notch-launcher-aliases-v1', JSON.stringify({ 'command:a':'alpha', 'command:b':'beta' }));
          document.getElementById('launcher-manage').click();
          await new Promise(resolve => setTimeout(resolve, 40));
          const manager = document.getElementById('launcher-manager');
          const sections = [...manager.querySelectorAll('.launcher-extension')];
          const b = sections.find(section => section.querySelector('strong')?.textContent === 'command:b');
          b.querySelector('input').value = 'ＡＬＰＨＡ';
          [...b.querySelectorAll('button')].find(button => button.textContent === '保存别名').click();
          const duplicateRejected = document.getElementById('launcher-status').textContent.includes('占用') && JSON.parse(localStorage.getItem('notch-launcher-aliases-v1'))['command:b'] === 'beta';
          const history = manager.textContent.includes('最近运行记录');
          const timeout = manager.querySelector('input[type=number]').value;
          window.NotchLauncher.escape();
          return { grouped, contextMenu, duplicateRejected, history, timeout };
        })()`);
        assert.deepEqual(managerChecks, { grouped:true, contextMenu:true, duplicateRejected:true, history:true, timeout:'800' });
        const auditFixes = await contents.executeJavaScript(`(async () => {
          const input = document.getElementById('launcher-search');
          const noteKey = 'notch-note-archive-v1', oldNotes = localStorage.getItem(noteKey);
          const change = async value => { input.value=value; input.dispatchEvent(new Event('input')); await new Promise(resolve=>setTimeout(resolve,400)); };
          const selected = () => document.querySelector('.launcher-result.selected')?.dataset.resultId;
          localStorage.setItem(noteKey,JSON.stringify([{id:'audit-a',title:'alpha target',content:''},{id:'audit-b',title:'beta target',content:''}]));
          await change('alpha target'); await change('beta target');
          const fallback = selected(); await change(''); const retained = selected();
          await change('https://a.example/'); const firstUrl=selected();
          await change('https://b.example/'); const secondUrl=selected();
          document.getElementById('launcher-action-button').click();
          const transientProtected = ![...document.querySelectorAll('#launcher-actions button')].some(b=>b.textContent==='收藏'||b.textContent==='保存别名');
          window.NotchLauncher.escape();
          if(oldNotes===null)localStorage.removeItem(noteKey);else localStorage.setItem(noteKey,oldNotes);
          document.getElementById('launcher-manage').click(); await new Promise(resolve=>setTimeout(resolve,50));
          const section=[...document.querySelectorAll('#launcher-manager .launcher-extension')].find(s=>s.querySelector('strong')?.textContent==='command:a');
          const original=Storage.prototype.setItem;
          const before=localStorage.getItem('notch-launcher-aliases-v1');
          let failureVisible=false, rolledBack=false;
          try {
            Storage.prototype.setItem=function(key,value){if(key==='notch-launcher-aliases-v1')throw new DOMException('full','QuotaExceededError');return original.call(this,key,value);};
            section.querySelector('input').value='changed';
            [...section.querySelectorAll('button')].find(b=>b.textContent==='保存别名').click();
            failureVisible=document.getElementById('launcher-status').textContent.includes('无法保存')&&localStorage.getItem('notch-launcher-aliases-v1')===before;
            let fail=true;
            Storage.prototype.setItem=function(key,value){if(key==='notch-launcher-favorites-v1'&&fail){fail=false;throw new DOMException('full','QuotaExceededError');}return original.call(this,key,value);};
            [...section.querySelectorAll('button')].find(b=>b.textContent==='移除记录').click();
            rolledBack=localStorage.getItem('notch-launcher-aliases-v1')===before&&document.getElementById('launcher-status').textContent.includes('撤回');
          } finally {Storage.prototype.setItem=original;}
          window.NotchLauncher.escape();
          return {fallback,retained,distinctUrls:firstUrl!==secondUrl,transientProtected,failureVisible,rolledBack};
        })()`);
        assert.deepEqual(auditFixes,{fallback:'note:audit-b',retained:'note:audit-b',distinctUrls:true,transientProtected:true,failureVisible:true,rolledBack:true});
        const visualChecks=await contents.executeJavaScript(`(async()=>{
          const bar=document.querySelector('.topbar'),oldWidth=bar.style.width;
          let separate=true;
          for(const width of [1192,872,640]){
            bar.style.width=width+'px';
            const search=document.getElementById('launcher-open').getBoundingClientRect();
            for(const tab of document.querySelectorAll('.tabs .tab:not([hidden])')){
              const rect=tab.getBoundingClientRect();
              if(rect.width&&rect.right>search.left&&rect.left<search.right&&rect.top<search.bottom&&rect.bottom>search.top)separate=false;
            }
          }
          bar.style.width=oldWidth;
          const input=document.getElementById('launcher-search');
          input.value='launcher';input.dispatchEvent(new Event('input'));await new Promise(resolve=>setTimeout(resolve,200));
          const before=document.querySelector('[data-result-id="command:launcher-copy"]');
          input.value='launcher v';input.dispatchEvent(new Event('input'));
          const immediate=before===document.querySelector('[data-result-id="command:launcher-copy"]');
          await new Promise(resolve=>setTimeout(resolve,200));
          const final=before===document.querySelector('[data-result-id="command:launcher-copy"]');
          const icons=[...document.querySelectorAll('.launcher-result')].every(row=>row.querySelector('.launcher-result-icon svg,.launcher-result-icon img'));
          const unboxed=getComputedStyle(input).outlineStyle==='none'&&getComputedStyle(input).borderTopWidth==='0px';
          input.value='';input.dispatchEvent(new Event('input'));
          return {separate,immediate,final,icons,unboxed};
        })()`);
        assert.deepEqual(visualChecks,{separate:true,immediate:true,final:true,icons:true,unboxed:true});
        const renderBenchmark = await contents.executeJavaScript(`(async () => {
          const key = 'notch-note-archive-v1', previous = localStorage.getItem(key);
          const search = document.getElementById('launcher-search');
          const notes = Array.from({length:1000}, (_,i) => ({id:'bench-'+i,title:'Benchmark note '+i,content:'Local workspace information'}));
          localStorage.setItem(key, JSON.stringify(notes));
          const times = [];
          for (let i=0;i<20;i++) {
            const started = performance.now(); search.value='Benchmark note '+(i%10); search.dispatchEvent(new Event('input'));
            await new Promise(resolve => requestAnimationFrame(resolve)); times.push(performance.now()-started);
          }
          if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
          search.value=''; search.dispatchEvent(new Event('input'));
          times.sort((a,b)=>a-b);
          return {dataset:1000,samples:20,p50Ms:times[9],p95Ms:times[18],scope:'Local input event to next animation frame; excludes OS hotkey and remote applications'};
        })()`);
        console.log('Launcher renderer benchmark:', JSON.stringify(renderBenchmark));
        const activationBenchmark = await contents.executeJavaScript(`(async () => {
          const samples=[];await window.NotchLauncher.close();
          for(let i=0;i<5;i++){
            const search=document.getElementById('launcher-search'),list=document.getElementById('launcher-results');
            let focused,painted;
            const focus=()=>{focused=performance.now();requestAnimationFrame(()=>{if(painted===undefined)painted=performance.now();});};search.addEventListener('focus',focus,{once:true});
            const observer=new MutationObserver(()=>{observer.disconnect();requestAnimationFrame(()=>{painted=performance.now();});});observer.observe(list,{childList:true});
            const started=performance.now();await window.NotchLauncher.open();await new Promise(resolve=>requestAnimationFrame(resolve));
            observer.disconnect();search.removeEventListener('focus',focus);
            samples.push({focusMs:focused-started,firstFrameMs:painted-started});
            if(i<4)await window.NotchLauncher.close();
          }
          return {samples,scope:'Programmatic launcher open through production preload/native mode, warm app cache; excludes OS hotkey delivery'};
        })()`);
        console.log('Launcher activation benchmark:',JSON.stringify(activationBenchmark));
        assert.ok(activationBenchmark.samples.every(s=>Number.isFinite(s.focusMs)&&Number.isFinite(s.firstFrameMs)));
        const geometry = await contents.executeJavaScript(`(() => {
          const root = document.getElementById('launcher').getBoundingClientRect();
          const footer = document.querySelector('.launcher-footer').getBoundingClientRect();
          return { width: root.width, height: root.height, bottom: root.bottom, footerBottom: footer.bottom, viewport: innerHeight, workspaceHidden: [...document.querySelectorAll('#panel, #panel *')].every(el => getComputedStyle(el).visibility === 'hidden') };
        })()`);
        assert.equal(geometry.workspaceHidden, true);
        assert.ok(geometry.width <= 640 && geometry.height <= 520);
        assert.ok(geometry.footerBottom <= geometry.bottom + 1 && geometry.bottom <= geometry.viewport);
        const capture = await contents.capturePage();
        const shot = path.join(__dirname, '../dist.noindex/launcher-review.png');
        fs.mkdirSync(path.dirname(shot), { recursive: true }); fs.writeFileSync(shot, capture.toPNG());
        await contents.executeJavaScript('window.NotchLauncher.close()');
        console.log('Production workspace, note attachment and launcher checks passed');
        app.quit();
      } catch (error) { console.error(error); app.exit(1); }
    }, 2000);
  });
});
require('../main.js');
