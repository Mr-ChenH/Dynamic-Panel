const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
// The production bootstrap may inspect encrypted legacy settings on this Mac.
// Use Chromium's test keychain so a regression test never prompts for user keys.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.writeFileSync(path.join(profile, 'transcription-settings.json'), JSON.stringify({ llmBaseUrl:'https://api.deepseek.com', llmModel:'deepseek-v4-flash' }));
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({version:1, localStorage:{
  'notch-home-note':'Recovered workspace note',
  'notch-link-groups':JSON.stringify([{id:'large-links',name:'Research',collapsed:false,links:Array.from({length:125},(_,i)=>({id:'large-link-'+i,title:'Research document '+i,url:'https://example.com/document/'+i,icon:''}))}]),
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
          let accessible=true,onePane=true,noOverflow=true;
          for(const width of [1100,640]){
            page.style.width=width+'px';page.style.height='340px';
            for(const button of page.querySelectorAll('[data-settings-category]')){
              button.click();await new Promise(resolve=>requestAnimationFrame(resolve));
              if(button.dataset.settingsCategory==='launcher'){
                const deadline=performance.now()+2000;
                while(document.getElementById('launcher-manager').hidden&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
              }
              const panes=[...content.querySelectorAll('.settings-card')].filter(card=>!card.hidden);
              onePane=onePane&&panes.length===1;noOverflow=noOverflow&&content.scrollWidth<=content.clientWidth+1;
              const controls=[...panes[0].querySelectorAll('button,select,input')].filter(control=>control.getClientRects().length&&getComputedStyle(control).visibility!=='hidden');
              for(const control of controls){
                control.scrollIntoView({block:'nearest'});
                const rect=control.getBoundingClientRect(),bounds=content.getBoundingClientRect();
                accessible=accessible&&rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1;
              }
            }
          }
          page.style.width=previous.width;page.style.height=previous.height;
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
          page.querySelector('[data-settings-category="general"]').click();content.scrollTop=0;
          return {accessible,onePane,noOverflow,directLayout,splitLayout,scrollable,apiReachable,diagnosticsReady,providerOptions,providerButtons,modelEditorReady,customEndpointVisible,customSelected,serviceSelectionReady};
        })()`);
        assert.deepEqual(settingsLayout,{accessible:true,onePane:true,noOverflow:true,directLayout:true,splitLayout:true,scrollable:true,apiReachable:true,diagnosticsReady:true,providerOptions:11,providerButtons:11,modelEditorReady:true,customEndpointVisible:true,customSelected:true,serviceSelectionReady:true});
        const recordingSettingsJump=await contents.executeJavaScript(`(async()=>{await window.NotchPanel.navigate({tab:'recordings'});document.getElementById('recording-configure').click();await new Promise(resolve=>setTimeout(resolve,100));return {settingsVisible:document.querySelector('[data-tab="settings"]').getAttribute('aria-selected')==='true',apiSelected:document.querySelector('[data-settings-category="api"]').getAttribute('aria-selected')==='true',transcriptionSelected:document.getElementById('ai-provider-transcription').getAttribute('aria-selected')==='true',modalAbsent:!document.getElementById('transcription-settings-backdrop')};})()`);
        assert.deepEqual(recordingSettingsJump,{settingsVisible:true,apiSelected:true,transcriptionSelected:true,modalAbsent:true});
        await contents.executeJavaScript(`window.NotchSettings.select('api');document.querySelector('[data-ai-provider="kimi"]').click();document.getElementById('llm-model-add').click();const models=[...document.querySelectorAll('[data-ai-model-name]')];models[1].value='moonshot-v1-8k';models[1].dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-ai-model-active="1"]').click();document.querySelector('.ai-model-settings').scrollIntoView({block:'start'});`);await new Promise(resolve=>setTimeout(resolve,150));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/ai-settings-review.png'),(await contents.capturePage()).toPNG());
        await contents.executeJavaScript(`window.NotchSettings.select('launcher')`);await new Promise(resolve=>setTimeout(resolve,350));
        fs.writeFileSync(path.join(__dirname,'../dist.noindex/settings-launcher-review.png'),(await contents.capturePage()).toPNG());
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
        require('electron').ipcMain.handle('ai:run',async(event,payload)=>{if(payload.context?.text==='旧文字'||payload.context?.text==='重开测试'||payload.context?.text==='动作锁定')await new Promise(resolve=>setTimeout(resolve,80));if(payload.context?.text==='流式测试'){event.sender.send('ai:event',{requestId:payload.requestId,type:'textDelta',text:'部分结果'});await new Promise(resolve=>setTimeout(resolve,80));}return payload.action==='extractTodos'?{ok:true,kind:'todos',requestId:payload.requestId,todos:[{text:'提交测试报告',categoryId:'P2',deadline:'2030-09-12T13:00:00.000Z',deadlineText:'明晚九点前',evidence:{quote:'明晚九点前提交测试报告',offset:0}}]}:payload.action==='organizeRecording'?{ok:true,kind:'recording',requestId:payload.requestId,summary:'录音摘要',decisions:[{text:'决定发布',evidence:{quote:'决定发布'}}],todos:[]}:payload.action?.startsWith('name')?{ok:true,kind:'metadata',requestId:payload.requestId,title:'AI 生成名称',category:'AI 分类'}:{ok:true,kind:'text',requestId:payload.requestId,text:'整理后的内容'};});
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
          const independentScroll=getComputedStyle(scroller).overflowY==='auto'&&getComputedStyle(scroller).overscrollBehaviorY==='contain';
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
          return {initial,loaded,filtered,targetFound,unchanged,empty,located,folded,searchesFolded,independentScroll,stationary};
        })()`);
        assert.deepEqual(largeLinks,{initial:40,loaded:80,filtered:1,targetFound:true,unchanged:true,empty:true,located:true,folded:0,searchesFolded:true,independentScroll:true,stationary:true});
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
        for (const channel of ['home:weather-search','home:weather','home:media-status','home:media-control']) require('electron').ipcMain.removeHandler(channel);
        require('electron').ipcMain.handle('home:weather-search',()=>({ok:true,locations:[{name:'北京',country:'中国',latitude:39,longitude:116}]}));
        require('electron').ipcMain.handle('home:weather',()=>({ok:true,temperature:22,apparentTemperature:21,humidity:58,precipitation:0,windSpeed:11,windDirection:45,isDay:true,code:0,high:25,low:16,sunrise:'2026-09-12T05:50',sunset:'2026-09-12T18:20',hours:Array.from({length:12},(_,index)=>({time:`2026-09-12T${String(index+10).padStart(2,'0')}:00`,temperature:22+index/2,code:index>7?2:0,precipitationProbability:index*3,isDay:index<8})),days:Array.from({length:7},(_,index)=>({date:`2026-09-${String(index+12).padStart(2,'0')}`,code:index>3?2:0,high:25+index,low:16+index,precipitationProbability:index*5,sunrise:'2026-09-12T05:50',sunset:'2026-09-12T18:20'})),updatedAt:Date.now()}));
        require('electron').ipcMain.handle('home:media-status',()=>({ok:true,title:'测试歌曲',artist:'测试歌手',playing:true,canPlayPause:true,canPrevious:true,canNext:true}));
        require('electron').ipcMain.handle('home:media-control',()=>({ok:true}));
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
          document.getElementById('home-media-refresh').click();await pause();
          const media=document.getElementById('home-media-title').textContent==='测试歌曲';
          document.getElementById('home-chat-open').click();const input=document.getElementById('home-chat-input');input.value='你好';document.getElementById('home-chat-form').requestSubmit();await pause();
          const chatted=document.querySelector('#home-chat-messages [data-role="assistant"] p')?.textContent==='整理后的内容';
          input.value='流式测试';document.getElementById('home-chat-form').requestSubmit();document.getElementById('home-chat-stop').click();await pause();
          const cancelled=document.querySelectorAll('#home-chat-messages [data-role="assistant"]').length===1&&input.value==='流式测试';
          document.getElementById('home-chat-clear').click();const clearChat=document.getElementById('home-chat-messages').children.length===0;
          document.getElementById('home-chat-close').click();
          const classicRemoved=!document.getElementById('home-view-toggle')&&document.getElementById('home-bento').hidden&&document.getElementById('home-bento').inert;
          const dashboard=document.getElementById('home-dashboard');let fits=dashboard.scrollWidth<=dashboard.clientWidth+1;
          dashboard.style.width='720px';
          fits=fits&&dashboard.scrollWidth<=dashboard.clientWidth+1&&[...dashboard.children].every(card=>card.scrollWidth<=card.clientWidth+1);
          dashboard.style.width='';
          return {saved,weather,weatherDetail,cleared,media,chatted,cancelled,clearChat,classicRemoved,fits};
        })()`);
        assert.deepEqual(homeAudit,{saved:true,weather:true,weatherDetail:true,cleared:true,media:true,chatted:true,cancelled:true,clearChat:true,classicRemoved:true,fits:true});
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
        console.log('Production workspace, note attachment, home workbench and launcher checks passed');
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
