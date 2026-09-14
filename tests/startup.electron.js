const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, clipboard } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
// The production bootstrap may inspect encrypted legacy settings on this Mac.
// Use Chromium's test keychain so a regression test never prompts for user keys.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.writeFileSync(path.join(profile, 'transcription-settings.json'), JSON.stringify({ llmBaseUrl:'https://api.deepseek.com', llmModel:'deepseek-v4-flash' }));
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({version:1, localStorage:{
  'notch-home-note':'Recovered workspace note',
  'notch-link-groups':JSON.stringify([{id:'large-links',name:'Research',collapsed:false,links:Array.from({length:125},(_,i)=>({id:'large-link-'+i,title:'Research document '+i,url:'https://example.com/document/'+i,description:i<5?'A concise research reference with implementation notes and practical examples.':'',tags:i<5?['Research',i%2?'Reading':'AI']:[],favorite:i%10===0,read:i%3===0,icon:''}))}]),
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
function silentWav(seconds = 5) {
  const sampleRate = 8000, dataSize = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + dataSize, 128);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate, 28); buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40); return buffer;
}
const errors = [];
setTimeout(() => { console.error('Production startup timed out', errors); app.exit(1); }, 45000);
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
          await window.NotchLauncher.openSettings();
          await new Promise(resolve => setTimeout(resolve, 100));
          const managerInputDisabled = !window.NotchLauncher.isOpen() && document.getElementById('settings-pane-launcher').contains(document.getElementById('launcher-manager'));
          await window.NotchLauncher.open();
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
          await window.NotchLauncher.openSettings();
          const manager = document.getElementById('launcher-manager');
          const historyDeadline=performance.now()+2000;
          while(!manager.textContent.includes('最近运行记录')&&performance.now()<historyDeadline)await new Promise(resolve=>setTimeout(resolve,20));
          const sections = [...manager.querySelectorAll('.launcher-extension')];
          const b = sections.find(section => section.querySelector('strong')?.textContent === 'command:b');
          b.querySelector('input').value = 'ＡＬＰＨＡ';
          [...b.querySelectorAll('button')].find(button => button.textContent === '保存别名').click();
          const duplicateRejected = document.getElementById('settings-launcher-status').textContent.includes('占用') && JSON.parse(localStorage.getItem('notch-launcher-aliases-v1'))['command:b'] === 'beta';
          const history = manager.textContent.includes('最近运行记录');
          const timeout = manager.querySelector('input[type=number]').value;
          await window.NotchLauncher.open();
          return { grouped, contextMenu, duplicateRejected, history, timeout };
        })()`);
        assert.deepEqual(managerChecks, { grouped:true, contextMenu:true, duplicateRejected:true, history:true, timeout:'800' });
        const auditFixes = await contents.executeJavaScript(`(async () => {
          const input = document.getElementById('launcher-search');
          const noteKey = 'notch-note-archive-v1', oldNotes = localStorage.getItem(noteKey);
          const change = async value => {
            input.value=value; input.dispatchEvent(new Event('input'));
            const expectedUrl=(value.startsWith('http://')||value.startsWith('https://'))?'url:'+new URL(value).href:'';
            const deadline=performance.now()+1200;
            do { await new Promise(resolve=>setTimeout(resolve,40)); } while(expectedUrl&&document.querySelector('.launcher-result.selected')?.dataset.resultId!==expectedUrl&&performance.now()<deadline);
            if(!expectedUrl)await new Promise(resolve=>setTimeout(resolve,360));
          };
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
          await window.NotchLauncher.openSettings(); await new Promise(resolve=>setTimeout(resolve,150));
          const section=[...document.querySelectorAll('#launcher-manager .launcher-extension')].find(s=>s.querySelector('strong')?.textContent==='command:a');
          const original=Storage.prototype.setItem;
          const before=localStorage.getItem('notch-launcher-aliases-v1');
          let failureVisible=false, rolledBack=false;
          try {
            Storage.prototype.setItem=function(key,value){if(key==='notch-launcher-aliases-v1')throw new DOMException('full','QuotaExceededError');return original.call(this,key,value);};
            section.querySelector('input').value='changed';
            [...section.querySelectorAll('button')].find(b=>b.textContent==='保存别名').click();
            failureVisible=document.getElementById('settings-launcher-status').textContent.includes('无法保存')&&localStorage.getItem('notch-launcher-aliases-v1')===before;
            let fail=true;
            Storage.prototype.setItem=function(key,value){if(key==='notch-launcher-favorites-v1'&&fail){fail=false;throw new DOMException('full','QuotaExceededError');}return original.call(this,key,value);};
            [...section.querySelectorAll('button')].find(b=>b.textContent==='移除记录').click();
            rolledBack=localStorage.getItem('notch-launcher-aliases-v1')===before&&document.getElementById('settings-launcher-status').textContent.includes('撤回');
          } finally {Storage.prototype.setItem=original;}
          await window.NotchLauncher.open();
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
        const regexChecks=await contents.executeJavaScript(`(async()=>{
          const input=document.getElementById('launcher-search'),toggle=document.getElementById('launcher-regex'),status=document.getElementById('launcher-status');
          const wait=async predicate=>{const end=performance.now()+2500;while(!predicate()&&performance.now()<end)await new Promise(r=>setTimeout(r,20));return predicate();};
          toggle.click();input.value='^launcher verification text$';input.dispatchEvent(new Event('input'));
          const matched=await wait(()=>document.querySelector('#launcher-results [data-result-id="command:launcher-copy"]')&&!document.getElementById('launcher-results').inert);
          input.value='(';input.dispatchEvent(new Event('input'));
          const invalid=await wait(()=>status.textContent.includes('正则错误'));
          const before=localStorage.getItem('notch-home-commands');
          localStorage.setItem('notch-home-commands',JSON.stringify([{id:'regex-slow',text:'a'.repeat(10000)+'!'}]));
          input.value='^(a+)+$';input.dispatchEvent(new Event('input'));
          const started=performance.now();await new Promise(r=>setTimeout(r,50));const responsive=performance.now()-started<350;
          const timedOut=await wait(()=>status.textContent.includes('正则执行超时'));
          localStorage.setItem('notch-home-commands',before);
          input.value='verification';input.dispatchEvent(new Event('input'));
          const recovered=await wait(()=>!document.getElementById('launcher-results').inert&&!!document.querySelector('[data-result-id="command:launcher-copy"]'));
          input.value='^大写转换$';input.dispatchEvent(new Event('input'));
          await wait(()=>!document.getElementById('launcher-results').inert&&[...document.querySelectorAll('.launcher-result')].some(row=>row.result.kind==='extension-query'));
          [...document.querySelectorAll('.launcher-result')].find(row=>row.result.kind==='extension-query')?.click();
          const commandScope=await wait(()=>toggle.getAttribute('aria-pressed')==='false'&&input.value==='大写转换 ');
          input.value='';input.dispatchEvent(new Event('input'));
          return {matched,invalid,responsive,timedOut,recovered,commandScope};
        })()`);
        assert.deepEqual(regexChecks,{matched:true,invalid:true,responsive:true,timedOut:true,recovered:true,commandScope:true});
        if(process.platform==='win32') {
          // Observe keyboard IPC without launching programs or displaying a real UAC prompt.
          const {ipcMain}=require('electron'),applicationModes=[];
          ipcMain.removeHandler('launcher:run');
          ipcMain.handle('launcher:run',(_event,payload)=>{applicationModes.push(payload.mode);return {ok:false,error:'cancelled'};});
          try {
            const menus=await contents.executeJavaScript(`(async()=>{
              const apps=await window.notchAPI.queryLauncher('');
              const app=apps.items.find(row=>row.kind==='app');
              const input=document.getElementById('launcher-search');input.value=app?.title||'';input.dispatchEvent(new Event('input'));
              await new Promise(resolve=>setTimeout(resolve,350));
              const target=[...document.querySelectorAll('.launcher-result')].find(row=>row.result?.kind==='app');
              if(!target)return false;
              input.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
              for(let i=0;i<50&&document.querySelector('.launcher-result.selected')!==target;i++)input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
              document.getElementById('launcher-action-button').click();
              const menu=document.getElementById('launcher-actions').textContent;
              window.NotchLauncher.escape();
              for(const mods of [{ctrlKey:true,shiftKey:true},{ctrlKey:true},{altKey:true}]){
                input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...mods}));await new Promise(resolve=>setTimeout(resolve,100));
              }
              return ['以管理员身份运行','新开窗口','切换到已打开窗口'].every(text=>menu.includes(text));
            })()`);
            assert.equal(menus,true);assert.deepEqual(applicationModes,['admin','new','focus']);
          } finally {ipcMain.removeHandler('launcher:run');}
        }
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
            const focusTime=Number.isFinite(focused)?focused:performance.now();const paintTime=Number.isFinite(painted)?painted:performance.now();
            samples.push({focusMs:focusTime-started,firstFrameMs:paintTime-started});
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
        await contents.executeJavaScript("window.__startupTestStage='settings-layout'");
        await contents.executeJavaScript(`window.NotchPanel.navigate({tab:'settings'})`);
        const settingsLayout=await contents.executeJavaScript(`(async()=>{
          const page=document.getElementById('settings-page'),content=page.querySelector('.settings-content');
          const previous={width:page.style.width,height:page.style.height};
          let accessible=true,onePane=true,noOverflow=true;const overflowDetails=[],accessibilityDetails=[];
          for(const width of [1100,640]){
            page.style.width=width+'px';page.style.height='340px';
            for(const button of page.querySelectorAll('[data-settings-category]')){
              button.click();await new Promise(resolve=>requestAnimationFrame(resolve));
              if(button.dataset.settingsCategory==='launcher'){
                const deadline=performance.now()+2000;
                while(document.getElementById('launcher-manager').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
              }
              const panes=[...content.querySelectorAll('.settings-card')].filter(card=>!card.hidden);
              onePane=onePane&&panes.length===1;
              if(content.scrollWidth>content.clientWidth+1){noOverflow=false;const bounds=content.getBoundingClientRect();overflowDetails.push({width,category:button.dataset.settingsCategory,contentWidth:content.clientWidth,scrollWidth:content.scrollWidth,elements:[...panes[0].querySelectorAll('*')].filter(element=>{const rect=element.getBoundingClientRect();return rect.right>bounds.right+1||rect.left<bounds.left-1;}).slice(0,8).map(element=>({tag:element.tagName,id:element.id,className:element.className,right:Math.round(element.getBoundingClientRect().right),boundRight:Math.round(bounds.right)}))});}
              const controls=[...panes[0].querySelectorAll('button,select,input')].filter(control=>control.getClientRects().length&&getComputedStyle(control).visibility!=='hidden');
              for(const control of controls){
                control.scrollIntoView({block:'nearest'});
                const rect=control.getBoundingClientRect(),bounds=content.getBoundingClientRect();
                const reachable=rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1;
                if(!reachable)accessibilityDetails.push({width,category:button.dataset.settingsCategory,id:control.id,tag:control.tagName,top:Math.round(rect.top),bottom:Math.round(rect.bottom),boundTop:Math.round(bounds.top),boundBottom:Math.round(bounds.bottom)});
                accessible=accessible&&reachable;
              }
            }
          }
          page.style.width='640px';page.querySelector('[data-settings-category="music"]').click();const musicSourceDetails=page.querySelector('.music-source-add');musicSourceDetails.open=true;await new Promise(resolve=>requestAnimationFrame(resolve));
          const musicSourceForm=document.getElementById('music-source-form');const musicSourceEditorFits=musicSourceForm.scrollWidth<=musicSourceForm.clientWidth+1&&[...musicSourceForm.querySelectorAll('input,button')].every(control=>control.scrollWidth<=control.clientWidth+1);
          musicSourceDetails.open=false;page.style.width=previous.width;page.style.height=previous.height;
          page.querySelector('[data-settings-category="api"]').click();await new Promise(resolve=>setTimeout(resolve,80));
          const root=document.querySelector('.settings-api-card');
          if(!root)throw new Error('missing settings-api-card');
          const sidebar=root.querySelector('.ai-provider-sidebar'),config=root.querySelector('.ai-provider-config-scroll');
          if(!sidebar||!config)throw new Error('missing inline AI settings panes');
          const directLayout=getComputedStyle(root).display!=='none'&&!document.getElementById('transcription-settings-backdrop')&&!root.querySelector('[role="dialog"]');
          const inlineLayout=root.querySelector('.ai-settings-layout');if(!inlineLayout)throw new Error('missing ai-settings-layout');
          const splitLayout=getComputedStyle(inlineLayout).gridTemplateColumns.split(' ').length===2;
          const scrollable=getComputedStyle(sidebar).overflowY==='auto'&&getComputedStyle(config).overflowY==='auto';
          const save=document.getElementById('transcription-settings-save').getBoundingClientRect(),bounds=root.querySelector('.ai-provider-config').getBoundingClientRect();
          const apiReachable=save.top>=bounds.top&&save.bottom<=bounds.bottom+1;
          const diagnosticsReady=!!document.getElementById('ai-diagnostics')&&!!document.getElementById('ai-diagnostics-copy')&&!!document.getElementById('ai-diagnostics-clear');
          const provider=document.getElementById('llm-provider');
          const providerOptions=provider.options.length,providerButtons=document.querySelectorAll('[data-ai-provider]').length;
          document.getElementById('llm-model-add').click();
          const modelInputs=[...document.querySelectorAll('[data-ai-model-name]')];modelInputs[1].value='deepseek-reasoner';modelInputs[1].dispatchEvent(new Event('input',{bubbles:true}));
          document.querySelector('[data-ai-model-active="1"]').click();
          const modelEditorReady=modelInputs.length===2&&document.getElementById('llm-model').value==='deepseek-reasoner'&&!document.getElementById('ai-settings-reset').disabled;
          document.getElementById('ai-settings-reset').click();
          document.querySelector('[data-ai-provider="custom-openai"]').click();
          const customEndpointVisible=!document.getElementById('llm-base-url-field').hidden;
          const customSelected=document.querySelector('[data-ai-provider="custom-openai"]').getAttribute('aria-selected')==='true';
          document.getElementById('ai-provider-transcription').click();
          const serviceSelectionReady=!document.getElementById('ai-service-panel-transcription').hidden&&document.getElementById('ai-service-panel-content').hidden&&document.getElementById('ai-content-settings-secondary').hidden&&!!document.getElementById('transcription-provider-test')&&!!document.getElementById('transcription-provider-remove');
          const volume=document.getElementById('music-volume');const musicVolumeDefault=volume.value==='80'&&document.getElementById('music-volume-value').textContent==='80%'&&Math.abs(document.getElementById('home-music-audio').volume-.8)<.001;
          volume.value='35';volume.dispatchEvent(new Event('input',{bubbles:true}));const musicVolumeControl=Math.abs(document.getElementById('home-music-audio').volume-.35)<.001&&localStorage.getItem('notch-home-music-volume-v1')==='35';volume.value='80';volume.dispatchEvent(new Event('input',{bubbles:true}));
          page.querySelector('[data-settings-category="general"]').click();content.scrollTop=0;
          return {accessible,accessibilityDetails,onePane,noOverflow,overflowDetails,musicSourceEditorFits,directLayout,splitLayout,scrollable,apiReachable,diagnosticsReady,providerOptions,providerButtons,modelEditorReady,customEndpointVisible,customSelected,serviceSelectionReady,musicVolumeDefault,musicVolumeControl};
        })()`);
        assert.deepEqual(settingsLayout,{accessible:true,accessibilityDetails:[],onePane:true,noOverflow:true,overflowDetails:[],musicSourceEditorFits:true,directLayout:true,splitLayout:true,scrollable:true,apiReachable:true,diagnosticsReady:true,providerOptions:11,providerButtons:11,modelEditorReady:true,customEndpointVisible:true,customSelected:true,serviceSelectionReady:true,musicVolumeDefault:true,musicVolumeControl:true});
        const recordingSettingsJump=await contents.executeJavaScript(`(async()=>{await window.NotchPanel.navigate({tab:'recordings'});document.getElementById('recording-configure').click();await new Promise(resolve=>setTimeout(resolve,100));return {settingsVisible:document.querySelector('[data-tab="settings"]').getAttribute('aria-selected')==='true',apiSelected:document.querySelector('[data-settings-category="api"]').getAttribute('aria-selected')==='true',transcriptionSelected:document.getElementById('ai-provider-transcription').getAttribute('aria-selected')==='true',modalAbsent:!document.getElementById('transcription-settings-backdrop')};})()`);
        assert.deepEqual(recordingSettingsJump,{settingsVisible:true,apiSelected:true,transcriptionSelected:true,modalAbsent:true});
        await contents.executeJavaScript(`window.NotchSettings.select('api');document.querySelector('[data-ai-provider="kimi"]').click();document.getElementById('llm-model-add').click();const models=[...document.querySelectorAll('[data-ai-model-name]')];models[1].value='moonshot-v1-8k';models[1].dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-ai-model-active="1"]').click();document.querySelector('.ai-model-settings').scrollIntoView({block:'start'});`);await new Promise(resolve=>setTimeout(resolve,150));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/ai-settings-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`window.NotchSettings.select('launcher')`);await new Promise(resolve=>setTimeout(resolve,350));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/settings-launcher-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`window.NotchSettings.select('music')`);await new Promise(resolve=>setTimeout(resolve,150));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/settings-music-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`window.NotchSettings.select('general')`);await new Promise(resolve=>setTimeout(resolve,250));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/settings-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript("window.__startupTestStage='ai-no-config'");
        const aiWorkspace=await contents.executeJavaScript(`(async()=>{
          const migration=document.getElementById('settings-ai-migration'),migrationVisible=!migration.hidden;document.getElementById('settings-ai-migration-ack').click();const migrationDeadline=performance.now()+1000;while(!migration.hidden&&performance.now()<migrationDeadline)await new Promise(resolve=>setTimeout(resolve,20));
          await window.NotchPanel.navigate({tab:'todo'});window.NotchAI.openText('extractTodos');
          const root=document.getElementById('ai-workspace'),source=document.getElementById('ai-source-text');
          source.value='明晚九点前提交测试报告';source.dispatchEvent(new Event('input',{bubbles:true}));
          document.getElementById('ai-generate').click();
          const deadline=performance.now()+1500;while(document.getElementById('ai-generate').disabled&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
          const bounds=root.getBoundingClientRect(),actions=root.querySelector('.ai-workspace-actions').getBoundingClientRect();
          const result={migrationVisible,migrationAcknowledged:migration.hidden,visible:!root.hidden,title:document.getElementById('ai-workspace-title').textContent,status:document.getElementById('ai-workspace-status').textContent,characterCount:document.getElementById('ai-character-count').textContent,actionsReachable:actions.bottom<=bounds.bottom+1,panelInert:document.querySelector('.panels').inert};
          return result;
        })()`);
        assert.equal(aiWorkspace.migrationVisible,true);assert.equal(aiWorkspace.migrationAcknowledged,true);assert.equal(aiWorkspace.visible,true);assert.equal(aiWorkspace.title,'从文字提取待办');assert.match(aiWorkspace.status,/配置/);assert.match(aiWorkspace.characterCount,/11 \/ 12000/);assert.equal(aiWorkspace.actionsReachable,true);assert.equal(aiWorkspace.panelInert,true);
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/ai-workspace-review.png'),(await contents.capturePage()).toPNG());
        assert.equal(await contents.executeJavaScript(`window.NotchAI.close().then(()=>document.getElementById('ai-workspace').hidden&&!document.querySelector('.panels').inert)`),true);
        await contents.executeJavaScript("window.__startupTestStage='ai-multi-model-config'");
        const multiModelConfig=await contents.executeJavaScript(`(async()=>{const base={region:'beijing',workspaceId:'',apiKey:'',llmApiKey:'',removeAsr:false,removeContent:false,llmTimeoutMs:30000,autoNameNotes:false,autoNameRecordings:false,autoOrganizeLinks:false};await window.notchAPI.setTranscriptionConfig({...base,llmProviderId:'kimi',llmBaseUrl:'https://api.moonshot.cn/v1',llmModels:['kimi-k3','moonshot-v1-8k'],llmModel:'moonshot-v1-8k'});const result=await window.notchAPI.setTranscriptionConfig({...base,llmProviderId:'deepseek',llmBaseUrl:'https://api.deepseek.com',llmModels:['deepseek-v4-flash','deepseek-reasoner'],llmModel:'deepseek-reasoner'});return {schemaVersion:result.schemaVersion,provider:result.llmProviderId,model:result.llmModel,profiles:result.contentProviderConfigs.map(profile=>({providerId:profile.providerId,models:profile.models.map(model=>model.name),activeModel:profile.activeModel}))};})()`);
        assert.equal(multiModelConfig.schemaVersion,3);assert.equal(multiModelConfig.provider,'deepseek');assert.equal(multiModelConfig.model,'deepseek-reasoner');assert.deepEqual(multiModelConfig.profiles.find(profile=>profile.providerId==='kimi'),{providerId:'kimi',models:['kimi-k3','moonshot-v1-8k'],activeModel:'moonshot-v1-8k'});assert.deepEqual(multiModelConfig.profiles.find(profile=>profile.providerId==='deepseek'),{providerId:'deepseek',models:['deepseek-v4-flash','deepseek-reasoner'],activeModel:'deepseek-reasoner'});
        await contents.executeJavaScript("window.__startupTestStage='ai-diagnostics'");
        const transcriptionPath=path.join(profile,'transcription-settings.json');const diagnosticSettings=JSON.parse(fs.readFileSync(transcriptionPath,'utf8'));const activeProvider=diagnosticSettings.services.content.activeProviderId;diagnosticSettings.services.content.profiles[activeProvider].baseUrl='https://127.0.0.1';diagnosticSettings.services.content.baseUrl='https://127.0.0.1';diagnosticSettings.llmBaseUrl='https://127.0.0.1';fs.writeFileSync(transcriptionPath,JSON.stringify(diagnosticSettings));process.env.NOTCH_LLM_API_KEY='diagnostic-secret-key';
        for(let index=0;index<52;index+=1)await contents.executeJavaScript(`window.notchAPI.runAI({requestId:'diagnostic-${index}',action:'summarize',interactive:true,context:{sourceType:'manual',sourceId:'',sourceTitle:'',text:'diagnostic private body ${index}'},referenceTime:new Date().toISOString(),timeZone:'UTC'})`);
        const diagnosticCheck=await contents.executeJavaScript(`(async()=>{await window.NotchPanel.navigate({tab:'settings'});window.NotchSettings.select('api');let deadline=performance.now()+1200;while(document.querySelectorAll('#ai-diagnostics .ai-diagnostic-row').length<50&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const response=await window.notchAPI.getAIDiagnostics();document.getElementById('ai-diagnostics-copy').click();await new Promise(resolve=>setTimeout(resolve,40));return {count:response.items.length,rows:document.querySelectorAll('#ai-diagnostics .ai-diagnostic-row').length,serialized:JSON.stringify(response.items)};})()`);
        const diagnosticClipboard=await require('electron').clipboard.readText();assert.equal(diagnosticCheck.count,50);assert.equal(diagnosticCheck.rows,50);assert.equal(diagnosticCheck.serialized.includes('diagnostic private body'),false);assert.equal(diagnosticCheck.serialized.includes('diagnostic-secret-key'),false);assert.equal(diagnosticCheck.serialized.includes('https://'),false);assert.equal(diagnosticClipboard.includes('diagnostic private body'),false);assert.equal(diagnosticClipboard.includes('diagnostic-secret-key'),false);
        const diagnosticsCleared=await contents.executeJavaScript(`(async()=>{document.getElementById('ai-diagnostics-clear').click();let deadline=performance.now()+1000;while(document.querySelectorAll('#ai-diagnostics .ai-diagnostic-row').length&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));return (await window.notchAPI.getAIDiagnostics()).items.length===0&&document.getElementById('ai-diagnostics').textContent.includes('暂无');})()`);assert.equal(diagnosticsCleared,true);delete process.env.NOTCH_LLM_API_KEY;
        require('electron').ipcMain.removeHandler('ai:run');
        let failedChatAttempts=0,helloChatAttempts=0;
        require('electron').ipcMain.handle('ai:run',async(event,payload)=>{if(payload.context?.text==='旧文字'||payload.context?.text==='重开测试'||payload.context?.text==='动作锁定')await new Promise(resolve=>setTimeout(resolve,80));if(payload.context?.text==='流式测试'){event.sender.send('ai:event',{requestId:payload.requestId,type:'textDelta',text:'部分结果'});await new Promise(resolve=>setTimeout(resolve,80));}if(payload.context?.text==='失败测试'&&failedChatAttempts++===0)return{ok:false,error:'network_error'};if(payload.action==='chat'&&payload.context?.text==='资料测试'){const source=payload.context.sources?.[0];return source?.sourceType==='note'&&source.sourceTitle==='上下文验收'&&source.text==='冻结正文'?{ok:true,kind:'text',requestId:payload.requestId,text:'已收到冻结正文'}:{ok:false,error:'invalid_chat_sources'};}if(payload.action==='chat'&&payload.context?.text==='长回答测试')return{ok:true,kind:'text',requestId:payload.requestId,text:'# 发布计划\n\n## 准备\n\n'+'阶段内容 '.repeat(2500)+'\n\n## 执行\n\n明晚九点前提交测试报告\n\n```js\nconst release = true;\n```\n\n<img src=x onerror="window.__readerUnsafe=true">'};if(payload.action==='chat'&&payload.context?.text==='结构回答测试')return{ok:true,kind:'text',requestId:payload.requestId,text:'# 小计划\n\n## 执行\n\n明晚九点前提交测试报告'};if(payload.action==='chat'&&payload.context?.text==='你好'){const first=helloChatAttempts++===0;if(first&&!payload.history?.some(message=>message.content.includes('冻结正文')))return{ok:false,error:'invalid_history'};return{ok:true,kind:'text',requestId:payload.requestId,text:'## 清晰回答\n\n- 第一步\n\n```js\nconst ready = true;\n```'};}return payload.action==='extractTodos'?{ok:true,kind:'todos',requestId:payload.requestId,todos:[{text:'提交测试报告',categoryId:'P2',deadline:'2030-09-12T13:00:00.000Z',deadlineText:'明晚九点前',evidence:{quote:'明晚九点前提交测试报告',offset:0}}]}:payload.action==='organizeRecording'?{ok:true,kind:'recording',requestId:payload.requestId,summary:'录音摘要',decisions:[{text:'决定发布',evidence:{quote:'决定发布'}}],todos:[]}:payload.action?.startsWith('name')?{ok:true,kind:'metadata',requestId:payload.requestId,title:'AI 生成名称',category:'AI 分类'}:{ok:true,kind:'text',requestId:payload.requestId,text:'整理后的内容'};});
        await contents.executeJavaScript("window.__startupTestStage='ai-streaming-readonly'");
        const aiStreaming=await contents.executeJavaScript(`(async()=>{window.NotchAI.openText('summarize');const source=document.getElementById('ai-source-text'),result=document.getElementById('ai-text-result');source.value='流式测试';source.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('ai-generate').click();let deadline=performance.now()+500;while(result.hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));const partial=result.value==='部分结果'&&result.readOnly;deadline=performance.now()+1000;while(document.getElementById('ai-generate').disabled&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));const completed=result.value==='整理后的内容'&&!result.readOnly;await window.NotchAI.close();return {partial,completed};})()`);assert.deepEqual(aiStreaming,{partial:true,completed:true});
        await contents.executeJavaScript("window.__startupTestStage='ai-ui-races'");
        require('electron').ipcMain.removeHandler('workspace:save-data');require('electron').ipcMain.handle('workspace:save-data',async()=>{await new Promise(resolve=>setTimeout(resolve,80));return true;});
        const aiUiRaces=await contents.executeJavaScript(`(async()=>{
          const generate=async(text)=>{window.NotchAI.openText('summarize');const source=document.getElementById('ai-source-text');source.value=text;source.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('ai-generate').click();let deadline=performance.now()+1000;while(document.getElementById('ai-text-result').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));};
          await generate('重复保存测试');const before=window.NotchNotes.list().length,save=document.getElementById('ai-save-note');save.dispatchEvent(new MouseEvent('click',{bubbles:true}));save.dispatchEvent(new MouseEvent('click',{bubbles:true}));const saveLocked=save.disabled;await new Promise(resolve=>setTimeout(resolve,130));const added=window.NotchNotes.list().length-before;save.click();await new Promise(resolve=>setTimeout(resolve,130));const undone=window.NotchNotes.list().length===before;await window.NotchAI.close();
          let unhandled=false;const onUnhandled=()=>{unhandled=true;};window.addEventListener('unhandledrejection',onUnhandled);await generate('关闭保存测试');const beforeCloseSave=window.NotchNotes.list().length;document.getElementById('ai-save-note').click();await window.NotchAI.close();await new Promise(resolve=>setTimeout(resolve,130));const closeDuringSave=window.NotchNotes.list().length===beforeCloseSave+1&&!unhandled;window.removeEventListener('unhandledrejection',onUnhandled);
          window.NotchAI.openText('summarize');let source=document.getElementById('ai-source-text');source.value='重开测试';source.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('ai-generate').click();await window.NotchAI.close();window.NotchAI.openText('summarize');const reopened=!document.getElementById('ai-generate').disabled&&!document.getElementById('ai-generate').hidden&&document.getElementById('ai-stop').hidden;await new Promise(resolve=>setTimeout(resolve,120));const stayedReady=!document.getElementById('ai-generate').disabled;await window.NotchAI.close();
          window.NotchAI.openText('summarize');source=document.getElementById('ai-source-text');source.value='动作锁定';source.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('ai-generate').click();const action=document.getElementById('ai-action-select'),locked=action.disabled;action.value='translate';action.dispatchEvent(new Event('change'));const reverted=action.value==='summarize';await new Promise(resolve=>setTimeout(resolve,120));const matched=document.getElementById('ai-workspace-title').textContent==='摘要文字'&&document.getElementById('ai-text-result').value==='整理后的内容';await window.NotchAI.close();return {saveLocked,added,undone,closeDuringSave,reopened,stayedReady,locked,reverted,matched};})()`);
        assert.deepEqual(aiUiRaces,{saveLocked:true,added:1,undone:true,closeDuringSave:true,reopened:true,stayedReady:true,locked:true,reverted:true,matched:true});
        require('electron').ipcMain.removeHandler('workspace:save-data');require('electron').ipcMain.handle('workspace:save-data',()=>true);
        await contents.executeJavaScript("window.__startupTestStage='ai-stale-source'");
        const aiStaleSource=await contents.executeJavaScript(`(async()=>{
          window.NotchAI.openText('summarize');const source=document.getElementById('ai-source-text');source.value='旧文字';source.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('ai-generate').click();const locked=source.readOnly;source.value='新文字';await new Promise(resolve=>setTimeout(resolve,100));const rejected=document.getElementById('ai-workspace-status').textContent.includes('来源内容已发生变化');await window.NotchAI.close();return {locked,rejected};
        })()`);
        assert.deepEqual(aiStaleSource,{locked:true,rejected:true});
        await contents.executeJavaScript("window.__startupTestStage='ai-todo-flow'");
        const aiTodoFlow=await contents.executeJavaScript(`(async()=>{
          const before=JSON.parse(localStorage.getItem('notch-todo-data')||'{"P0":[],"P1":[],"P2":[],"P3":[]}');
          window.NotchAI.openText('extractTodos');const source=document.getElementById('ai-source-text');source.value='明晚九点前提交测试报告';source.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('ai-generate').click();
          const deadline=performance.now()+1500;while(document.getElementById('ai-todo-results').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
          const candidate=document.querySelector('.ai-todo-candidate'),apply=document.getElementById('ai-apply-todos');const ready=!!candidate&&candidate.querySelector('input[type="checkbox"]').checked&&!apply.disabled;const reviewMeta=document.getElementById('ai-workspace-meta').textContent.includes('参考')&&candidate.querySelectorAll('.ai-todo-date-shortcuts button').length===3;
          apply.click();await new Promise(resolve=>setTimeout(resolve,30));
          const afterApply=JSON.parse(localStorage.getItem('notch-todo-data'));const added=afterApply.P2.filter(item=>item.text==='提交测试报告').length;
          apply.click();await new Promise(resolve=>setTimeout(resolve,30));
          const afterUndo=JSON.parse(localStorage.getItem('notch-todo-data'));const remaining=afterUndo.P2.filter(item=>item.text==='提交测试报告').length;
          await window.NotchAI.close();return {ready,reviewMeta,added,remaining,beforeCount:before.P2.length,afterCount:afterUndo.P2.length};
        })()`);
        assert.deepEqual(aiTodoFlow,{ready:true,reviewMeta:true,added:1,remaining:0,beforeCount:0,afterCount:0});
        await contents.executeJavaScript("window.__startupTestStage='ai-module-flows'");
        const aiModuleFlows=await contents.executeJavaScript(`(async()=>{try{
          await window.NotchPanel.navigate({tab:'notes'});const note=window.NotchNotes.create();const editor=document.getElementById('notes-editor');editor.value='\\n保留这段文字\\n';editor.dispatchEvent(new Event('input',{bubbles:true}));editor.setSelectionRange(0,editor.value.length);document.querySelector('[data-action="organize-note"]').click();
          const action=document.getElementById('ai-action-select');action.value='shorten';action.dispatchEvent(new Event('change'));document.getElementById('ai-generate').click();
          let deadline=performance.now()+1500;while(document.getElementById('ai-text-result').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
          const replace=document.getElementById('ai-replace-selection'),replaceReady=!replace.hidden;document.getElementById('ai-text-result').value='编辑后的内容';replace.click();await new Promise(resolve=>setTimeout(resolve,20));
          const replaced=window.NotchNotes.list().find(item=>item.id===note.id)?.content==='编辑后的内容';replace.click();await new Promise(resolve=>setTimeout(resolve,20));
          const restored=window.NotchNotes.list().find(item=>item.id===note.id)?.content==='\\n保留这段文字\\n';await window.NotchAI.close();
          const fullEditor=document.getElementById('notes-editor');fullEditor.value='\\n保留这段文字\\n';fullEditor.dispatchEvent(new Event('input',{bubbles:true}));fullEditor.setSelectionRange(0,0);document.querySelector('[data-action="organize-note"]').click();document.getElementById('ai-generate').click();deadline=performance.now()+1500;while(document.getElementById('ai-text-result').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const trimmedSourceAccepted=!document.getElementById('ai-text-result').hidden;await window.NotchAI.close();
          const beforeTitle=window.NotchNotes.list().find(item=>item.id===note.id).title;window.NotchAI.openNote('nameNote');document.getElementById('ai-generate').click();deadline=performance.now()+1500;while(document.getElementById('ai-metadata-result').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const metadataApply=document.getElementById('ai-apply-metadata');metadataApply.click();await new Promise(resolve=>setTimeout(resolve,30));const noteNamed=window.NotchNotes.list().find(item=>item.id===note.id).title==='AI 生成名称';metadataApply.click();await new Promise(resolve=>setTimeout(resolve,30));const noteNameUndone=window.NotchNotes.list().find(item=>item.id===note.id).title===beforeTitle;await window.NotchAI.close();
          await window.NotchPanel.navigate({tab:'recordings'});const transcript=document.querySelector('.recording-transcript-editor');transcript.value='决定发布产品';transcript.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-action="organize-recording"]').click();document.getElementById('ai-generate').click();
          deadline=performance.now()+1500;while(document.getElementById('ai-text-result').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
          const save=document.getElementById('ai-save-note'),recordingReady=document.getElementById('ai-workspace-title').textContent==='整理录音'&&document.getElementById('ai-text-result').value==='录音摘要'&&document.querySelectorAll('.ai-recording-section li').length===1&&!save.hidden;
          const noteCount=window.NotchNotes.list().length;save.click();await new Promise(resolve=>setTimeout(resolve,20));const noteSaved=window.NotchNotes.list().length===noteCount+1&&save.textContent==='撤销保存';save.click();await new Promise(resolve=>setTimeout(resolve,20));const noteUndone=window.NotchNotes.list().length===noteCount;await window.NotchAI.close();
          const beforeRecording=window.NotchWorkspace.recordingContext('startup-recording').sourceTitle;window.NotchAI.openRecordingName('startup-recording');document.getElementById('ai-generate').click();deadline=performance.now()+1500;while(document.getElementById('ai-metadata-result').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const recordingNameApply=document.getElementById('ai-apply-metadata');recordingNameApply.click();await new Promise(resolve=>setTimeout(resolve,30));const recordingNamed=window.NotchWorkspace.recordingContext('startup-recording').sourceTitle==='AI 生成名称';recordingNameApply.click();await new Promise(resolve=>setTimeout(resolve,30));const recordingNameUndone=window.NotchWorkspace.recordingContext('startup-recording').sourceTitle===beforeRecording;await window.NotchAI.close();
          return {replaceReady,replaced,restored,trimmedSourceAccepted,noteNamed,noteNameUndone,recordingReady,noteSaved,noteUndone,recordingNamed,recordingNameUndone};
        }catch(error){return {scriptError:error.stack||String(error)}}})()`);
        assert.deepEqual(aiModuleFlows,{replaceReady:true,replaced:true,restored:true,trimmedSourceAccepted:true,noteNamed:true,noteNameUndone:true,recordingReady:true,noteSaved:true,noteUndone:true,recordingNamed:true,recordingNameUndone:true});
        await contents.executeJavaScript("window.__startupTestStage='ai-sync-failure'");
        require('electron').ipcMain.removeHandler('workspace:save-data');require('electron').ipcMain.handle('workspace:save-data',()=>false);
        const aiSyncFailure=await contents.executeJavaScript(`(async()=>{
          window.NotchAI.openText('extractTodos');const source=document.getElementById('ai-source-text');source.value='明晚九点前提交测试报告';source.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('ai-generate').click();let deadline=performance.now()+1500;while(document.getElementById('ai-todo-results').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const apply=document.getElementById('ai-apply-todos');apply.click();deadline=performance.now()+1500;while(!document.getElementById('ai-workspace-status').textContent.includes('同步失败')&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const warned=document.getElementById('ai-workspace-status').textContent.includes('已在本机加入 1 项')&&document.getElementById('ai-workspace-status').textContent.includes('同步失败');const persisted=JSON.parse(localStorage.getItem('notch-todo-data')).P2.some(item=>item.text==='提交测试报告');apply.click();await new Promise(resolve=>setTimeout(resolve,30));await window.NotchAI.close();return {warned,persisted};
        })()`);
        assert.deepEqual(aiSyncFailure,{warned:true,persisted:true});
        const largeLinks=await contents.executeJavaScript(`(async()=>{
          await window.NotchPanel.navigate({tab:'links'});
          const count=()=>document.querySelectorAll('#link-groups .link-item').length;
          const original=localStorage.getItem('notch-link-groups');
          const scroller=document.querySelector('.link-list');
          const chainableScroll=getComputedStyle(scroller).overflowY==='auto'&&getComputedStyle(scroller).overscrollBehaviorY==='auto';
          const section=document.querySelector('.link-group'),outer=document.getElementById('link-groups');
          const top=section.getBoundingClientRect().top,outerScroll=outer.scrollTop;
          scroller.scrollTop=100;
          const stationary=scroller.scrollTop>0&&section.getBoundingClientRect().top===top&&outer.scrollTop===outerScroll;
          const initial=count();document.querySelector('.links-load-more').click();const loaded=count();
          const search=document.getElementById('links-search');search.value='document 124';search.dispatchEvent(new Event('input'));
          const filtered=count(),targetFound=!!document.querySelector('[data-link-id="large-link-124"]');
          const unchanged=localStorage.getItem('notch-link-groups')===original;
          search.value='missing';search.dispatchEvent(new Event('input'));const empty=count()===0;
          window.NotchWorkspace.selectLink('large-link-124');await new Promise(r=>requestAnimationFrame(r));
          const located=search.value===''&&!!document.querySelector('[data-link-id="large-link-124"]');
          document.getElementById('links-collapse-all').click();const folded=count();
          search.value='document 124';search.dispatchEvent(new Event('input'));const searchesFolded=count()===1;
          search.value='';search.dispatchEvent(new Event('input'));document.getElementById('links-collapse-all').click();
          return {initial,loaded,filtered,targetFound,unchanged,empty,located,folded,searchesFolded,chainableScroll,stationary};
        })()`);
        assert.deepEqual(largeLinks,{initial:40,loaded:80,filtered:1,targetFound:true,unchanged:true,empty:true,located:true,folded:0,searchesFolded:true,chainableScroll:true,stationary:true});
        const linkNaming=await contents.executeJavaScript(`(async()=>{const before=window.NotchWorkspace.linkContext('large-link-124');window.NotchAI.openLinkName('large-link-124');document.getElementById('ai-generate').click();let deadline=performance.now()+1500;while(document.getElementById('ai-metadata-result').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const apply=document.getElementById('ai-apply-metadata');apply.click();await new Promise(resolve=>setTimeout(resolve,30));const actualTitle=window.NotchWorkspace.linkContext('large-link-124')?.sourceTitle,status=document.getElementById('ai-workspace-status').textContent;const named=actualTitle==='AI 生成名称';apply.click();await new Promise(resolve=>setTimeout(resolve,30));const restored=window.NotchWorkspace.linkContext('large-link-124')?.sourceTitle===before.sourceTitle;await window.NotchAI.close();return {named,restored,actualTitle,status};})()`);
        assert.equal(linkNaming.named,true,JSON.stringify(linkNaming));assert.equal(linkNaming.restored,true,JSON.stringify(linkNaming));
        const moduleLayouts=await contents.executeJavaScript(`(async()=>{
          const failures=[],visited=[];
          await window.notchAPI.setFeature('clip',true);
          await new Promise(resolve=>setTimeout(resolve,50));
          for(const tab of ['home','todo','notes','links','recordings','credentials','clip']){
            await window.NotchPanel.navigate({tab});await new Promise(resolve=>requestAnimationFrame(resolve));
            const panel=document.getElementById('tab-'+tab),surface=panel.firstElementChild;
            const oldHeight=surface.style.height,oldWidth=surface.style.width;
            surface.style.height='300px';
            if(['notes','links','recordings','credentials','clip'].includes(tab))surface.style.width='720px';
            if(tab==='notes'&&window.NotchNotes){localStorage.setItem('notch-note-categories-v1',JSON.stringify([{id:'startup-projects',name:'项目资料',tags:[{id:'startup-planning',name:'产品规划'}]},{id:'startup-meetings',name:'会议记录',tags:[{id:'startup-weekly',name:'周会'}]}]));window.NotchNotes.create();const category=document.querySelector('.notes-detail-category');category.value='startup-projects';category.dispatchEvent(new Event('change',{bubbles:true}));const tag=document.querySelector('.notes-detail-tag');tag.value='startup-planning';tag.dispatchEvent(new Event('change',{bubbles:true}));const categoryFilter=document.getElementById('notes-category-filter');categoryFilter.value='startup-projects';categoryFilter.dispatchEvent(new Event('change',{bubbles:true}));}
            await new Promise(resolve=>requestAnimationFrame(resolve));
            if(surface.scrollWidth>surface.clientWidth+2)failures.push(tab+':horizontal');
            if(tab==='credentials'){
              const form=panel.querySelector('.credentials-form-card'),save=document.getElementById('credential-save');
              save.scrollIntoView({block:'nearest'});const a=save.getBoundingClientRect(),b=form.getBoundingClientRect();
              if(a.bottom>b.bottom+1||a.top<b.top)failures.push('credentials:save-clipped');
            }
            if(tab==='recordings'){
              const detail=panel.querySelector('.recording-detail');
              if(detail&&getComputedStyle(detail).overflowY!=='auto')failures.push('recordings:no-scroll');
            }
            if(tab==='links'){
              const sidebar=panel.querySelector('.links-sidebar'),main=panel.querySelector('.links-main');
              const sidebarBounds=sidebar.getBoundingClientRect(),mainBounds=main.getBoundingClientRect();
              if(sidebarBounds.right>mainBounds.left+1)failures.push('links:pane-overlap');
              const favorite=panel.querySelector('[data-links-sidebar-view="favorite"]');favorite.click();await new Promise(resolve=>requestAnimationFrame(resolve));
              if(!favorite.classList.contains('active')||document.getElementById('links-result-count').textContent!=='13 / 125')failures.push('links:favorite-filter');
              panel.querySelector('[data-links-sidebar-view="all"]').click();await new Promise(resolve=>requestAnimationFrame(resolve));
              sidebar.scrollTop=0;panel.querySelector('[data-links-sidebar-group]').dispatchEvent(new WheelEvent('wheel',{deltaY:90,bubbles:true,cancelable:true}));
              if(sidebar.scrollHeight>sidebar.clientHeight&&sidebar.scrollTop<=0)failures.push('links:sidebar-wheel');
              const linkList=panel.querySelector('.link-list');if(linkList&&getComputedStyle(linkList).overscrollBehaviorY==='contain')failures.push('links:wheel-chain');
            }
            if(tab==='notes'){
              const actions=panel.querySelector('.notes-detail-actions');
              if(actions&&actions.scrollWidth>actions.clientWidth+1)failures.push('notes:actions');
              const taxonomy=panel.querySelector('.notes-taxonomy'),library=panel.querySelector('.notes-library'),detail=panel.querySelector('.notes-detail'),tree=panel.querySelector('.notes-taxonomy-tree');
              const taxonomyBounds=taxonomy.getBoundingClientRect(),libraryBounds=library.getBoundingClientRect(),detailBounds=detail.getBoundingClientRect();
              if(getComputedStyle(tree).overflowY!=='auto')failures.push('notes:taxonomy-scroll');
              if(taxonomyBounds.right>libraryBounds.left+1||libraryBounds.right>detailBounds.left+1)failures.push('notes:pane-overlap');
              if(!tree.querySelector('[data-notes-taxonomy-scope="category"].active')||!tree.querySelector('[data-notes-taxonomy-scope="tag"]'))failures.push('notes:taxonomy-state');
            }
            visited.push(tab);surface.style.height=oldHeight;surface.style.width=oldWidth;
          }
          await window.notchAPI.setFeature('clip',false);
          return {failures,visited};
        })()`);
        assert.deepEqual(moduleLayouts.failures,[]);
        assert.equal(moduleLayouts.visited.length,7);
        for(const tab of ['home','todo','notes','links','recordings','credentials']){
          await contents.executeJavaScript(`window.NotchPanel.navigate({tab:${JSON.stringify(tab)}})`);
          await new Promise(resolve=>setTimeout(resolve,300));
          fs.writeFileSync(path.join(__dirname,`../dist.noindex/module-${tab}-review.png`),(await contents.capturePage()).toPNG());
        }
        const noteTyping = await contents.executeJavaScript(`(async()=>{
          await window.NotchPanel.navigate({tab:'notes'});
          await new Promise(resolve=>setTimeout(resolve,400));
          const editor=document.getElementById('notes-editor');
          editor.focus();editor.setSelectionRange(0,0);
          const before=editor.getBoundingClientRect().top;
          editor.dispatchEvent(new Event('input',{bubbles:true}));
          const during=editor.getBoundingClientRect().top;
          await new Promise(resolve=>setTimeout(resolve,300));
          return {before,during,after:editor.getBoundingClientRect().top,same:document.getElementById('notes-editor')===editor,focused:document.activeElement===editor,caret:editor.selectionStart};
        })()`);
        assert.equal(noteTyping.before,noteTyping.during,JSON.stringify(noteTyping));
        assert.equal(noteTyping.during,noteTyping.after,JSON.stringify(noteTyping));
        assert.equal(noteTyping.same,true);assert.equal(noteTyping.focused,true);assert.equal(noteTyping.caret,0);
        const homeChannels=['home:weather-search','home:weather','home:music-library','home:music-mode','home:music-select-playlist','home:music-refresh-source','home:music-add-source','home:music-remove-source','home:music-select-online-playlist','home:music-browse-categories','home:music-browse-user-playlists','home:music-choose-files','home:music-choose-folder','home:music-add-network','home:music-remove','home:music-load','home:music-cover'];
        for (const channel of homeChannels) require('electron').ipcMain.removeHandler(channel);
        require('electron').ipcMain.handle('home:weather-search',()=>({ok:true,locations:[{name:'北京',country:'中国',latitude:39,longitude:116}]}));
        require('electron').ipcMain.handle('home:weather',()=>({ok:true,temperature:22,apparentTemperature:21,humidity:58,precipitation:0,windSpeed:11,windDirection:45,isDay:true,code:0,high:25,low:16,sunrise:'2026-09-12T05:50',sunset:'2026-09-12T18:20',hours:Array.from({length:12},(_,index)=>({time:`2026-09-12T${String(index+10).padStart(2,'0')}:00`,temperature:22+index/2,code:index>7?2:0,precipitationProbability:index*3,isDay:index<8})),days:Array.from({length:7},(_,index)=>({date:`2026-09-${String(index+12).padStart(2,'0')}`,code:index>3?2:0,high:25+index,low:16+index,precipitationProbability:index*5,sunrise:'2026-09-12T05:50',sunset:'2026-09-12T18:20'})),updatedAt:Date.now()}));
        const testMusicSources=[{id:'built-in',type:'library',name:'我的音乐',detail:'本地文件与 HTTPS 直链',removable:false,playlists:[{id:'local',title:'本地音乐',trackCount:2},{id:'network',title:'网络音乐',trackCount:1}]},{id:'catalog-test',type:'music-dl',name:'聚合音乐',detail:'http://127.0.0.1:8080/music',removable:true,playlists:[{id:'morning',title:'晨间歌单',trackCount:1},{id:'evening',title:'夜间歌单',trackCount:1}]}];
        testMusicSources[1].browser={platformSources:[{id:'netease',name:'网易云',search:true,categories:true,recommend:true}],activePlatform:'netease',categories:[],onlinePlaylists:[{id:'online-test',remoteId:'online-test',title:'在线精选',provider:'netease',trackCount:1,hasCover:true}]};
        const testMusicQueues={local:[{id:'test-track',kind:'local',title:'测试歌曲',detail:'test.wav',mimeType:'audio/wav'},{id:'test-track-next',kind:'local',title:'下一首测试歌曲',detail:'next.wav',mimeType:'audio/wav'}],network:[{id:'network-track',kind:'network',title:'网络测试歌曲',detail:'media.example.com',mimeType:'audio/wav'}],morning:[{id:'catalog-morning',kind:'catalog',title:'晨光',artist:'测试歌手',detail:'测试歌手 · netease',provider:'netease',mimeType:'audio/wav',hasCover:true}],evening:[{id:'catalog-evening',kind:'catalog',title:'夜航',artist:'另一位歌手',detail:'另一位歌手 · qq',provider:'qq',mimeType:'audio/wav'}],['online-test']:[{id:'catalog-online',kind:'catalog',title:'在线精选歌曲',artist:'在线歌手',detail:'在线歌手 · netease',provider:'netease',mimeType:'audio/wav'}]};
        let testMusicSelection={sourceId:'built-in',playlistId:'local'};
        const currentTestMusicLibrary=()=>{const source=testMusicSources.find(item=>item.id===testMusicSelection.sourceId),playlists=source.id==='catalog-test'&&testMusicSelection.playlistId==='online-test'?[{id:'online-test',remoteId:'online-test',title:'在线精选',provider:'netease',trackCount:1,hasCover:true}]:source.playlists;return{ok:true,schemaVersion:2,mode:testMusicSelection.sourceId==='built-in'&&testMusicSelection.playlistId==='network'?'network':'local',...testMusicSelection,sources:testMusicSources,playlists,tracks:testMusicQueues[testMusicSelection.playlistId]||[],browser:source.browser||null};};
        require('electron').ipcMain.handle('home:music-library',currentTestMusicLibrary);
        require('electron').ipcMain.handle('home:music-mode',(_event,mode)=>{testMusicSelection={sourceId:'built-in',playlistId:mode};return currentTestMusicLibrary();});
        require('electron').ipcMain.handle('home:music-select-playlist',(_event,payload)=>{testMusicSelection={sourceId:payload.sourceId,playlistId:payload.playlistId};return currentTestMusicLibrary();});
        require('electron').ipcMain.handle('home:music-select-online-playlist',(_event,payload)=>{testMusicSelection={sourceId:payload.sourceId,playlistId:payload.playlistId};return currentTestMusicLibrary();});
        require('electron').ipcMain.handle('home:music-browse-categories',(_event,payload)=>{testMusicSources[1].browser.activePlatform=payload.platform;testMusicSources[1].browser.categories=[{id:'popular',name:'流行',group:'风格'}];return currentTestMusicLibrary();});
        require('electron').ipcMain.handle('home:music-browse-user-playlists',()=>currentTestMusicLibrary());
        require('electron').ipcMain.handle('home:music-refresh-source',()=>currentTestMusicLibrary());
        require('electron').ipcMain.handle('home:music-add-source',()=>currentTestMusicLibrary());
        require('electron').ipcMain.handle('home:music-remove-source',()=>{testMusicSelection={sourceId:'built-in',playlistId:'local'};return currentTestMusicLibrary();});
        require('electron').ipcMain.handle('home:music-choose-files',()=>currentTestMusicLibrary());
        require('electron').ipcMain.handle('home:music-choose-folder',()=>currentTestMusicLibrary());
        require('electron').ipcMain.handle('home:music-add-network',()=>currentTestMusicLibrary());
        require('electron').ipcMain.handle('home:music-remove',()=>currentTestMusicLibrary());
        require('electron').ipcMain.handle('home:music-load',()=>({ok:true,bytes:silentWav(),mimeType:'audio/wav'}));
        require('electron').ipcMain.handle('home:music-cover',()=>({ok:true,bytes:Buffer.from(noteImageBase64,'base64'),mimeType:'image/png'}));
        contents.send('clipboard:new-entry',{type:'text',text:'上下文剪贴文字',imagePath:null});
        contents.send('clipboard:new-entry',{type:'image',text:null,imagePath:'clipboard-images/context-test.png'});
        await new Promise(resolve=>setTimeout(resolve,40));
        await contents.executeJavaScript("window.__startupTestStage='home-reader-audit'");
        const homeAudit=await contents.executeJavaScript(`(async()=>{
          await window.NotchPanel.navigate({tab:'home'});
          const pause=()=>new Promise(resolve=>setTimeout(resolve,120));
          const capture=document.getElementById('home-capture-input');capture.value='首页快速收集测试';capture.dispatchEvent(new Event('input',{bubbles:true}));
          document.getElementById('home-capture-save').click();await pause();
          const saved=window.NotchNotes.list().some(note=>note.content==='首页快速收集测试')&&capture.value==='';
          document.getElementById('home-weather-city').value='北京';document.getElementById('home-weather-form').requestSubmit();await pause();
          document.querySelector('#home-weather-results button').click();await pause();
          const weather=document.getElementById('home-weather-temperature').textContent==='22°'&&document.querySelectorAll('#home-weather-metrics>div').length===4&&document.getElementById('home-weather-metrics').textContent.includes('6h 降雨');
          document.getElementById('home-weather-details').click();await pause();
          const weatherDetail=!!(!document.getElementById('home-weather-detail').hidden
            &&document.querySelectorAll('#home-weather-detail-hours .weather-hour').length===12
            &&document.querySelectorAll('#home-weather-detail-hours .weather-chart-point').length===12
            &&document.querySelectorAll('#home-weather-detail-hours .weather-chart-rain').length===11
            &&document.querySelectorAll('#home-weather-detail-days .weather-day').length===7
            &&document.querySelector('#home-weather-detail-days .weather-day.is-today .weather-temperature-now'));
          document.getElementById('home-weather-detail-close').click();
          document.getElementById('home-weather-clear').click();
          const cleared=!localStorage.getItem('notch-home-weather-v1');
          document.getElementById('home-media-refresh').click();await pause();document.querySelector('[data-home-media="toggle"]').click();await new Promise(resolve=>setTimeout(resolve,300));
          const media=document.getElementById('home-media-title').textContent==='测试歌曲'
            &&document.getElementById('home-media-source').textContent.includes('本地音乐')
            &&document.getElementById('home-media-album').textContent==='test.wav'
            &&!document.getElementById('home-media-progress').hidden
            &&document.querySelector('.home-media').dataset.mediaPlaying==='true'
            &&document.querySelector('[data-home-media="toggle"]').getAttribute('aria-label')==='暂停';
          const audio=document.getElementById('home-music-audio'),progress=document.getElementById('home-media-progress'),progressMutations=[];const progressObserver=new MutationObserver((records)=>progressMutations.push(...records));progressObserver.observe(progress,{attributes:true,attributeFilter:['hidden'],attributeOldValue:true});document.querySelector('[data-home-media="next"]').click();await new Promise(resolve=>setTimeout(resolve,300));progressObserver.disconnect();const musicTrackSwitchStable=!progress.hidden&&!progressMutations.some(record=>record.oldValue===null)&&document.getElementById('home-media-title').textContent==='下一首测试歌曲'&&!audio.paused;
          const sourceBefore=audio.src;let emptied=0;audio.addEventListener('emptied',()=>{emptied+=1;});
          document.getElementById('home-media-library').click();await pause();const sourceSelect=document.getElementById('music-source-select');sourceSelect.value='catalog-test';sourceSelect.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,300));
          const firstPlaylistPlaying=audio.src!==sourceBefore&&!audio.paused&&emptied>0&&document.getElementById('home-media-title').textContent==='晨光'&&document.getElementById('music-playlist-select').value==='morning';
          const settingsCategoriesLoaded=document.getElementById('music-category-select').options.length===3;
          const coverLoaded=!document.getElementById('home-media-cover').hidden&&document.querySelector('.home-media').dataset.mediaCover==='true';
          document.getElementById('home-media-discover').click();await pause();const homeOnlineDiscovery=!document.getElementById('home-media-discovery').hidden&&document.getElementById('home-media-platform-select').options.length===1&&document.getElementById('home-media-category-select').options.length===3&&document.querySelectorAll('#home-media-online-results .home-media-online-result').length===1;document.querySelector('#home-media-online-results .home-media-online-result').click();await pause();const onlinePlaylistDisplayed=document.getElementById('home-media-queue-label').textContent.includes('在线精选');document.getElementById('home-media-discovery-close').click();document.querySelector('[data-music-catalog-view="mine"]').click();await pause();
          const playlistSelect=document.getElementById('music-playlist-select');audio.pause();await pause();playlistSelect.value='evening';playlistSelect.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,300));
          const musicPlaylistSwitch=firstPlaylistPlaying&&!audio.paused&&document.getElementById('home-media-title').textContent==='夜航'
            &&document.getElementById('home-media-source-label').textContent==='聚合音乐'
            &&!document.querySelector('[data-music-source-panel="catalog"]').hidden;
          await window.NotchPanel.navigate({tab:'home'});await pause();
          document.getElementById('home-chat-open').click();const input=document.getElementById('home-chat-input');const noImplicitHistory=!localStorage.getItem('notch-ai-chat-sessions-v1');
          const markdownProbe=document.createElement('div');window.NotchMarkdown.render(markdownProbe,'<img src=x onerror="window.__markdownUnsafe=true">');const markdownSafe=!markdownProbe.querySelector('img')&&!window.__markdownUnsafe&&markdownProbe.textContent.includes('<img');
          input.value='第一行\\n第二行\\n第三行';input.dispatchEvent(new Event('input',{bubbles:true}));const composerGrows=parseFloat(input.style.height)>40;
          await window.NotchNotes.saveGenerated('上下文验收','冻结正文','user');document.getElementById('home-chat-context-add').click();const pickerOpened=!document.getElementById('home-chat-context-picker').hidden;const chatSurface=document.getElementById('home-chat');chatSurface.style.width='520px';const pickerFits=chatSurface.scrollWidth<=chatSurface.clientWidth+1&&document.getElementById('home-chat-context-picker').scrollWidth<=document.getElementById('home-chat-context-picker').clientWidth+1;chatSurface.style.width='';const clips=JSON.parse(localStorage.getItem('notch-clip-history')||'[]'),clipboardContexts=window.NotchClipboard.chatContexts();const clipImageExcluded=clips.some(item=>item.type==='image')&&clipboardContexts.some(item=>item.text==='上下文剪贴文字')&&clipboardContexts.length===clips.filter(item=>item.type!=='image'&&item.text?.trim()).length&&!JSON.stringify(clipboardContexts).includes('context-test.png');const contextSearch=document.getElementById('home-chat-context-search');contextSearch.value='上下文验收';contextSearch.dispatchEvent(new Event('input',{bubbles:true}));const contextRow=document.querySelector('#home-chat-context-list [data-chat-source]');contextRow.click();const contextSelected=document.getElementById('home-chat-context-chips').textContent.includes('上下文验收')&&document.getElementById('home-chat-count').textContent.includes('1 份资料');document.getElementById('home-chat-context-close').click();
          input.value='资料测试';document.getElementById('home-chat-form').requestSubmit();await pause();const contextReply=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].at(-1);const contextSent=contextReply?.dataset.state==='complete'&&contextReply.querySelector('.home-chat-message-body').textContent==='已收到冻结正文'&&document.querySelector('[data-role="user"] .home-chat-message-sources')?.textContent.includes('上下文验收')&&document.getElementById('home-chat-context-chips').hidden;
          const archive=JSON.parse(localStorage.getItem('notch-note-archive-v1'));archive.find(note=>note.title==='上下文验收').content='资料已变化';localStorage.setItem('notch-note-archive-v1',JSON.stringify(archive));contextReply.querySelector('[aria-label="重新生成"]').click();await pause();const contextRetry=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].at(-1);const contextFrozen=contextRetry?.dataset.state==='complete'&&contextRetry.querySelector('.home-chat-message-body').textContent==='已收到冻结正文'&&contextReply.dataset.version==='previous';
          input.value='你好';document.getElementById('home-chat-form').requestSubmit();await pause();
          const firstReply=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].at(-1);
          const chatted=firstReply?.querySelector('h3')?.textContent==='清晰回答'&&firstReply.querySelector('li')?.textContent==='第一步'&&firstReply.querySelector('code')?.textContent==='const ready = true;';
          const noteCount=window.NotchNotes.list().length;firstReply.querySelector('[aria-label="保存为笔记"]').click();await pause();
          const chatNoteSaved=window.NotchNotes.list().length===noteCount+1&&firstReply.querySelector('[aria-label="撤销保存"]');firstReply.querySelector('[aria-label="撤销保存"]').click();await pause();
          const chatNoteUndone=window.NotchNotes.list().length===noteCount;
          input.value='流式测试';document.getElementById('home-chat-form').requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));document.getElementById('home-chat-stop').click();await pause();
          const stoppedReply=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].at(-1);
          const cancelled=stoppedReply?.dataset.state==='stopped'&&stoppedReply.querySelector('.home-chat-message-body').textContent==='部分结果'&&!input.readOnly&&document.getElementById('home-chat-form').dataset.busy==='false';
          input.value='失败测试';document.getElementById('home-chat-form').requestSubmit();await pause();
          const failedReply=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].at(-1);
          const failedUser=[...document.querySelectorAll('#home-chat-messages [data-role="user"]')].at(-1);
          const recoverable=failedReply?.dataset.state==='error'&&failedReply.textContent.includes('无法连接内容模型')&&failedReply.querySelector('[aria-label="重试"]')&&failedUser?.textContent==='失败测试';
          const recoverDebug={state:failedReply?.dataset.state||'',text:failedReply?.textContent||'',retry:Boolean(failedReply?.querySelector('[aria-label="重试"]')),user:failedUser?.textContent||'',busy:document.getElementById('home-chat-form').dataset.busy};
          failedReply.querySelector('[aria-label="重试"]').click();await pause();
          const retriedReply=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].at(-1);
          const retryRecovered=retriedReply?.dataset.state==='complete'&&retriedReply.querySelector('.home-chat-message-body').textContent==='整理后的内容'&&document.querySelectorAll('#home-chat-messages [data-role="user"]').length===4;
          window.__startupTestStage='reader-open-long';input.value='长回答测试';document.getElementById('home-chat-form').requestSubmit();await pause();const longReply=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].at(-1),readerEntry=longReply?.querySelector('[aria-label="打开长回答工作台"]');const readerEligibility=!!readerEntry&&!stoppedReply.querySelector('[aria-label="打开长回答工作台"]')&&!failedReply.querySelector('[aria-label="打开长回答工作台"]');input.value='下一条草稿';input.dispatchEvent(new Event('input',{bubbles:true}));readerEntry.click();await pause();
          const readerRoot=document.getElementById('home-chat-reader'),readerBody=document.getElementById('home-chat-reader-content'),readerTodos=document.getElementById('home-chat-reader-todos');const readerOpened=!readerRoot.hidden&&document.getElementById('home-chat-reader-title').textContent==='发布计划'&&document.querySelectorAll('#home-chat-reader-outline button').length===3&&!readerBody.querySelector('img')&&!window.__readerUnsafe&&readerBody.textContent.includes('<img');const readerTodoNeedsSelection=readerTodos.getAttribute('aria-disabled')==='true';
          chatSurface.style.width='520px';const readerFits=chatSurface.scrollWidth<=chatSurface.clientWidth+1&&readerRoot.scrollWidth<=readerRoot.clientWidth+1&&readerBody.scrollWidth<=readerBody.clientWidth+1;chatSurface.style.width='';document.querySelector('#home-chat-reader-outline button:last-child').click();await new Promise(resolve=>setTimeout(resolve,300));const outlineMoved=readerBody.scrollTop>0;
          document.getElementById('home-chat-reader-copy').click();await pause();const readerFullCopied=document.getElementById('home-chat-reader-status').textContent==='全文已复制';readerBody.querySelector('[data-markdown-copy]').click();await pause();const readerCodeCopied=document.getElementById('home-chat-reader-status').textContent==='代码已复制';
          const selectReaderText=(needle)=>{const walker=document.createTreeWalker(readerBody,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const index=node.data.indexOf(needle);if(index>=0){const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+needle.length);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return true;}}return false;};
          const selectedAction=selectReaderText('明晚九点前提交测试报告');await new Promise(resolve=>setTimeout(resolve,30));const readerSelectionReady=selectedAction&&!document.getElementById('home-chat-reader-copy-selection').disabled&&!readerTodos.disabled;document.getElementById('home-chat-reader-copy-selection').click();await pause();const readerSelectionCopied=document.getElementById('home-chat-reader-status').textContent.includes('已复制');
          window.__startupTestStage='reader-note-actions';const readerNoteCount=window.NotchNotes.list().length;document.getElementById('home-chat-reader-save').click();await pause();const readerNoteSaved=window.NotchNotes.list().length===readerNoteCount+1&&document.getElementById('home-chat-reader-save').getAttribute('aria-label')==='撤销保存笔记'&&!!longReply.querySelector('[aria-label="撤销保存"]');document.getElementById('home-chat-reader-save').click();await pause();const readerNoteUndone=window.NotchNotes.list().length===readerNoteCount&&document.getElementById('home-chat-reader-save').getAttribute('aria-label')==='保存为笔记';
          window.__startupTestStage='reader-selection-todo';selectReaderText('明晚九点前提交测试报告');await new Promise(resolve=>setTimeout(resolve,30));readerTodos.click();const readerTodoSource=document.getElementById('ai-source-text').value==='明晚九点前提交测试报告'&&!document.getElementById('ai-workspace').hidden;document.getElementById('ai-generate').click();window.__startupTestStage='reader-selection-todo-close';let readerDeadline=performance.now()+1200;while(document.getElementById('ai-todo-results').hidden&&performance.now()<readerDeadline)await new Promise(resolve=>setTimeout(resolve,20));const readerTodoPreview=!!document.querySelector('#ai-todo-results .ai-todo-candidate'),readerTodoApply=document.getElementById('ai-apply-todos'),readerTodoBefore=JSON.parse(localStorage.getItem('notch-todo-data')).P2.length;readerTodoApply.click();await new Promise(resolve=>setTimeout(resolve,30));const readerTodoAdded=JSON.parse(localStorage.getItem('notch-todo-data')).P2.length===readerTodoBefore+1;readerTodoApply.click();await new Promise(resolve=>setTimeout(resolve,30));const readerTodoAppliedUndone=readerTodoAdded&&JSON.parse(localStorage.getItem('notch-todo-data')).P2.length===readerTodoBefore;await window.NotchAI.close();await pause();const readerReturned=!readerRoot.hidden,readerFocusRestored=document.activeElement===readerTodos;document.getElementById('home-chat-reader-close').click();const readerClosed=readerRoot.hidden&&input.value==='下一条草稿';
          window.__startupTestStage='reader-full-todo';input.value='结构回答测试';document.getElementById('home-chat-form').requestSubmit();await pause();const structuredReply=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].at(-1);structuredReply.querySelector('[aria-label="打开长回答工作台"]').click();await pause();const readerFullTodoReady=readerTodos.getAttribute('aria-disabled')==='false'&&document.getElementById('home-chat-reader-copy-selection').disabled;readerTodos.click();const readerFullTodoSource=document.getElementById('ai-source-text').value==='# 小计划\\n\\n## 执行\\n\\n明晚九点前提交测试报告'&&!document.getElementById('ai-workspace').hidden;await window.NotchAI.close();await pause();const readerFullTodoFocusRestored=document.activeElement===readerTodos;document.getElementById('home-chat-reader-close').click();
          document.getElementById('home-chat-session-save').click();await pause();const saveDisclosure=!document.getElementById('home-chat-session-panel').hidden&&!localStorage.getItem('notch-ai-chat-sessions-v1')&&!document.getElementById('home-chat-session-confirm-save').hidden&&document.getElementById('home-chat-session-panel').textContent.includes('资料的文字快照');
          document.getElementById('home-chat-session-confirm-save').click();await pause();const storedSessions=JSON.parse(localStorage.getItem('notch-ai-chat-sessions-v1')||'{}').sessions||[];const sessionSaved=storedSessions.length===1&&storedSessions[0].records.some(record=>record.sources?.[0]?.text==='冻结正文')&&storedSessions[0].records.some(record=>record.state==='stopped')&&storedSessions[0].records.some(record=>record.state==='error')&&document.getElementById('home-chat-session-state').textContent.includes('已保存到当前工作区');
          document.querySelector('#home-chat-session-list [aria-label="重命名会话"]').click();const titleEditor=document.querySelector('.home-chat-session-edit input');titleEditor.value='项目发布对话';titleEditor.closest('form').requestSubmit();await pause();const sessionRenamed=document.getElementById('home-chat-title').textContent==='项目发布对话'&&JSON.parse(localStorage.getItem('notch-ai-chat-sessions-v1')).sessions[0].title==='项目发布对话';
          document.getElementById('home-chat-new').click();document.getElementById('home-chat-sessions').click();const sessionHistorySearch=document.getElementById('home-chat-session-search');sessionHistorySearch.value='发布';sessionHistorySearch.dispatchEvent(new Event('input',{bubbles:true}));const sessionSearchWorks=document.querySelectorAll('.home-chat-session-row').length===1;document.querySelector('.home-chat-session-open').click();const sessionRestored=document.getElementById('home-chat-title').textContent==='项目发布对话'&&document.querySelectorAll('#home-chat-messages [data-role="assistant"]').length>=4&&document.querySelector('#home-chat-messages .home-chat-message-sources')?.textContent.includes('上下文验收')&&!!document.querySelector('#home-chat-messages [data-state="stopped"]')&&!!document.querySelector('#home-chat-messages [data-state="error"]');
          const chatFits=document.getElementById('home-chat').scrollWidth<=document.getElementById('home-chat').clientWidth+1&&[...document.querySelectorAll('.home-chat-message-body')].every(node=>node.scrollWidth<=node.clientWidth+1||node.querySelector('pre'));
          document.getElementById('home-chat-sessions').click();chatSurface.style.width='520px';const sessionPanelFits=chatSurface.scrollWidth<=chatSurface.clientWidth+1&&document.getElementById('home-chat-session-panel').scrollWidth<=document.getElementById('home-chat-session-panel').clientWidth+1;chatSurface.style.width='';document.getElementById('home-chat-session-close').click();
          document.getElementById('home-chat-new').click();const clearChat=!document.querySelector('#home-chat-messages .home-chat-message')&&!document.getElementById('home-chat-empty').hidden;
          document.getElementById('home-chat-close').click();
          const classicRemoved=!document.getElementById('home-view-toggle')&&document.getElementById('home-bento').hidden&&document.getElementById('home-bento').inert;
          const dashboard=document.getElementById('home-dashboard');let fits=dashboard.scrollWidth<=dashboard.clientWidth+1;
          dashboard.style.width='720px';
          fits=fits&&dashboard.scrollWidth<=dashboard.clientWidth+1&&[...dashboard.children].every(card=>card.scrollWidth<=card.clientWidth+1);
          dashboard.style.width='';
          return {saved,weather,weatherDetail,cleared,media,musicTrackSwitchStable,coverLoaded,homeOnlineDiscovery,settingsCategoriesLoaded,onlinePlaylistDisplayed,musicPlaylistSwitch,noImplicitHistory,markdownSafe,composerGrows,pickerOpened,pickerFits,clipImageExcluded,contextSelected,contextSent,contextFrozen,chatted,chatNoteSaved:Boolean(chatNoteSaved),chatNoteUndone,cancelled,recoverable:Boolean(recoverable),retryRecovered,readerEligibility,readerOpened,readerTodoNeedsSelection,readerFits,outlineMoved,readerFullCopied,readerCodeCopied,readerSelectionReady,readerSelectionCopied,readerNoteSaved,readerNoteUndone,readerTodoSource,readerTodoPreview,readerTodoAppliedUndone,readerReturned,readerFocusRestored,readerClosed,readerFullTodoReady,readerFullTodoSource,readerFullTodoFocusRestored,saveDisclosure,sessionSaved,sessionRenamed,sessionSearchWorks,sessionRestored,sessionPanelFits,chatFits,recoverDebug,clearChat,classicRemoved,fits};
        })()`);
        assert.equal(homeAudit.recoverable,true,JSON.stringify(homeAudit.recoverDebug));delete homeAudit.recoverDebug;
        assert.deepEqual(homeAudit,{saved:true,weather:true,weatherDetail:true,cleared:true,media:true,musicTrackSwitchStable:true,coverLoaded:true,homeOnlineDiscovery:true,settingsCategoriesLoaded:true,onlinePlaylistDisplayed:true,musicPlaylistSwitch:true,noImplicitHistory:true,markdownSafe:true,composerGrows:true,pickerOpened:true,pickerFits:true,clipImageExcluded:true,contextSelected:true,contextSent:true,contextFrozen:true,chatted:true,chatNoteSaved:true,chatNoteUndone:true,cancelled:true,recoverable:true,retryRecovered:true,readerEligibility:true,readerOpened:true,readerTodoNeedsSelection:true,readerFits:true,outlineMoved:true,readerFullCopied:true,readerCodeCopied:true,readerSelectionReady:true,readerSelectionCopied:true,readerNoteSaved:true,readerNoteUndone:true,readerTodoSource:true,readerTodoPreview:true,readerTodoAppliedUndone:true,readerReturned:true,readerFocusRestored:true,readerClosed:true,readerFullTodoReady:true,readerFullTodoSource:true,readerFullTodoFocusRestored:true,saveDisclosure:true,sessionSaved:true,sessionRenamed:true,sessionSearchWorks:true,sessionRestored:true,sessionPanelFits:true,chatFits:true,clearChat:true,classicRemoved:true,fits:true});
        assert.equal(await clipboard.readText(),'明晚九点前提交测试报告');
        await contents.executeJavaScript("window.__startupTestStage='reader-keyboard-setup'");
        const readerKeyboardSetup=await contents.executeJavaScript(`(async()=>{document.getElementById('home-chat-open').click();document.getElementById('home-chat-sessions').click();const sessionButton=document.querySelector('.home-chat-session-open');if(!sessionButton)return{error:'session_missing'};sessionButton.click();const reply=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].find(item=>item.textContent.includes('阶段内容')),entry=reply?.querySelector('[aria-label="打开长回答工作台"]');if(!entry)return{error:'reader_entry_missing'};entry.click();await new Promise(resolve=>setTimeout(resolve,50));const reader=document.getElementById('home-chat-reader'),outside=document.querySelector('.home-switchbar strong')?.firstChild;if(!outside)return{error:'outside_text_missing'};const range=document.createRange();range.selectNodeContents(outside);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);await new Promise(resolve=>setTimeout(resolve,30));const outsideSelectionBlocked=document.getElementById('home-chat-reader-copy-selection').disabled;selection.removeAllRanges();document.querySelector('#home-chat-reader-content [data-markdown-copy]').click();await new Promise(resolve=>setTimeout(resolve,50));return{opened:!reader.hidden,outsideSelectionBlocked,role:reader.getAttribute('role'),topbarAvailable:!document.querySelector('.topbar').inert};})()`);
        assert.deepEqual(readerKeyboardSetup,{opened:true,outsideSelectionBlocked:true,role:'region',topbarAvailable:true});
        assert.equal(await clipboard.readText(),'const release = true;');
        const readerExpectedCopy=await contents.executeJavaScript(`(async()=>{document.getElementById('home-chat-reader-copy').click();await new Promise(resolve=>setTimeout(resolve,50));return JSON.parse(localStorage.getItem('notch-ai-chat-sessions-v1')).sessions[0].records.find(item=>item.answer.includes('阶段内容')).answer;})()`);
        assert.equal(await clipboard.readText(),readerExpectedCopy);
        await contents.executeJavaScript("document.getElementById('home-chat-reader-close').focus()");
        contents.sendInputEvent({type:'keyDown',keyCode:'Tab'});contents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await new Promise(resolve=>setTimeout(resolve,50));
        assert.equal(await contents.executeJavaScript('document.activeElement?.id'),'home-chat-reader-copy');
        contents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['shift']});contents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['shift']});await new Promise(resolve=>setTimeout(resolve,50));
        assert.equal(await contents.executeJavaScript('document.activeElement?.id'),'home-chat-reader-close');
        contents.send('key:escape');await new Promise(resolve=>setTimeout(resolve,100));
        const readerEscapeAudit=await contents.executeJavaScript(`(()=>{const reader=document.getElementById('home-chat-reader');return{closed:reader.hidden,panelStayedOpen:document.getElementById('app').classList.contains('expanded'),chatRestored:[...reader.parentElement.children].filter(node=>node!==reader).every(node=>!node.inert),focusRestored:document.activeElement?.getAttribute('aria-label')==='打开长回答工作台'};})()`);
        assert.deepEqual(readerEscapeAudit,{closed:true,panelStayedOpen:true,chatRestored:true,focusRestored:true});
        await contents.executeJavaScript(`document.getElementById('home-chat-close').click()`);
        await contents.executeJavaScript(`document.getElementById('home-weather-city').value='北京';document.getElementById('home-weather-form').requestSubmit()`);
        await new Promise(resolve=>setTimeout(resolve,100));
        await contents.executeJavaScript(`document.querySelector('#home-weather-results button').click()`);
        await new Promise(resolve=>setTimeout(resolve,150));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/home-weather-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`document.getElementById('home-weather-details').click()`);
        await new Promise(resolve=>setTimeout(resolve,100));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/home-weather-detail-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`document.getElementById('home-weather-detail-close').click()`);
        await new Promise(resolve=>setTimeout(resolve,100));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/home-workbench-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`document.getElementById('home-chat-open').click()`);
        await new Promise(resolve=>setTimeout(resolve,100));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/home-chat-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`document.getElementById('home-chat-context-add').click()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/home-chat-context-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`const search=document.getElementById('home-chat-context-search');search.value='上下文验收';search.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#home-chat-context-list [data-chat-source]').click();document.getElementById('home-chat-context-close').click();document.getElementById('home-chat-input').value='你好';document.getElementById('home-chat-form').requestSubmit()`);
        await new Promise(resolve=>setTimeout(resolve,150));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/home-chat-conversation-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`document.getElementById('home-chat-sessions').click();document.querySelector('.home-chat-session-open')?.click();[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].find(item=>item.textContent.includes('明晚九点前提交测试报告'))?.querySelector('[aria-label="打开长回答工作台"]')?.click()`);
        await new Promise(resolve=>setTimeout(resolve,100));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/home-chat-reader-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`document.getElementById('home-chat-reader-close').click();document.getElementById('home-chat-sessions').click()`);
        await new Promise(resolve=>setTimeout(resolve,80));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/home-chat-sessions-review.png'),(await contents.capturePage()).toPNG());
        const reloaded=new Promise(resolve=>contents.once('did-finish-load',resolve));contents.reload();await reloaded;await new Promise(resolve=>setTimeout(resolve,500));
        const sessionReloadAudit=await contents.executeJavaScript(`(async()=>{await window.NotchPanel.navigate({tab:'home'});document.getElementById('home-chat-open').click();document.getElementById('home-chat-sessions').click();const row=document.querySelector('.home-chat-session-row'),listed=row?.textContent.includes('项目发布对话');row?.querySelector('.home-chat-session-open')?.click();const restored=document.getElementById('home-chat-title').textContent==='项目发布对话'&&document.querySelectorAll('#home-chat-messages [data-role="assistant"]').length>=4&&document.querySelector('#home-chat-messages .home-chat-message-sources')?.textContent.includes('上下文验收')&&!!document.querySelector('#home-chat-messages [data-state="stopped"]')&&!!document.querySelector('#home-chat-messages [data-state="error"]');const frozenReply=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].find(item=>item.querySelector('.home-chat-message-body')?.textContent==='已收到冻结正文');frozenReply?.querySelector('[aria-label="重新生成"]')?.click();await new Promise(resolve=>setTimeout(resolve,120));const restoredRetry=[...document.querySelectorAll('#home-chat-messages [data-role="assistant"]')].at(-1)?.querySelector('.home-chat-message-body')?.textContent==='已收到冻结正文';document.getElementById('home-chat-sessions').click();document.querySelector('#home-chat-session-list [aria-label="删除会话"]')?.click();document.querySelector('#home-chat-session-list [data-confirm="true"]')?.click();await new Promise(resolve=>setTimeout(resolve,30));return{listed,restored,restoredRetry,deleted:!localStorage.getItem('notch-ai-chat-sessions-v1')&&document.getElementById('home-chat-session-list').textContent.includes('还没有保存的对话')};})()`);
        assert.deepEqual(sessionReloadAudit,{listed:true,restored:true,restoredRetry:true,deleted:true});
        console.log('Production workspace, note attachment, home workbench, saved AI sessions and launcher checks passed');
        app.quit();
      } catch (error) {
        const stage = await contents.executeJavaScript('window.__startupTestStage || "unknown"').catch(() => 'renderer-unavailable');
        console.error(`Startup test failed during ${stage}`, error);
        app.exit(1);
      }
    }, 2000);
  });
});
require('../main.js');
