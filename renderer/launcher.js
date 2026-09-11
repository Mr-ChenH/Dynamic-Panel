(function initLauncher() {
  const api = window.notchAPI;
  const root = document.getElementById('launcher');
  if (!root || !window.NotchPanel) return;
  const input = document.getElementById('launcher-search');
  const list = document.getElementById('launcher-results');
  const status = document.getElementById('launcher-status');
  const actions = document.getElementById('launcher-actions');
  const manager = document.getElementById('launcher-manager');
  let openState = false, transition = false, wasExpanded = false, previousFocus, previousInert;
  let rows = [], remote = [], selectedId = '', generation = 0, timer, running = false, pendingClose = false;
  let preferredId = '', searchPending = false, pendingProviders = [], restoreFocusOnClose = true, escapeGuardUntil = 0;
  let settings = { shortcut: 'CommandOrControl+Space', sources: { apps: true, workspace: true, clipboard: false, extensions: true } };
  let features = {};
  const KEY = 'notch-launcher-';
  let regexEnabled=false,regexWorker=null,regexTimer,regexJobKey='',regexResult=null,resultsVersion=0;
  const regexKey=()=>`${generation}:${resultsVersion}`;
  function stopRegex(){regexWorker?.terminate();regexWorker=null;clearTimeout(regexTimer);regexJobKey='';}
  function regexReady(){return !regexEnabled||!input.value||regexResult?.key===regexKey()&&!regexResult.error;}
  function requestRegex(candidates,aliases,final){
    const key=regexKey();if(regexJobKey===key)return;
    stopRegex();regexJobKey=key;
    const finish=result=>{if(key!==regexKey()||!openState)return;stopRegex();regexResult={key,...result};render(final);};
    try {
      regexWorker=new Worker('launcher-regex-worker.js');
      regexWorker.onmessage=event=>{if(event.data.key===key)finish(event.data);};
      regexWorker.onerror=event=>{event.preventDefault();finish({error:'正则搜索暂时不可用'});};
      regexTimer=setTimeout(()=>finish({error:'正则执行超时，请简化表达式'}),500);
      regexWorker.postMessage({key,query:input.value,aliases,limit:50,results:candidates.map(({id,title,subtitle,keywords,persistable})=>({id,title,subtitle,keywords,persistable}))});
    }catch{queueMicrotask(()=>finish({error:'无法启动正则搜索'}));}
  }
  function toggleRegex(){
    if(running||!manager.hidden)return;
    regexEnabled=!regexEnabled;stopRegex();regexResult=null;
    document.getElementById('launcher-regex').setAttribute('aria-pressed',String(regexEnabled));
    input.placeholder=regexEnabled?'正则表达式，例如 ^Chrome|笔记$':'搜索应用、笔记、链接…';
    search();input.focus();
  }
  function stored(key, fallback) {
    const value = data(KEY + key + '-v1', fallback);
    if (key === 'favorites') return value.filter(v => typeof v === 'string' && v.length <= 300).slice(-500);
    return Object.fromEntries(Object.entries(value).slice(-500).filter(([id, v]) => id.length <= 300 && (key === 'aliases' ? typeof v === 'string' && v.length <= 40 : v && Number.isFinite(v.count) && Number.isFinite(v.lastUsedAt))));
  }
  function save(key, value) { try { localStorage.setItem(KEY + key + '-v1', JSON.stringify(value)); resultsVersion++; return true; } catch { status.textContent = '无法保存，存储空间可能已满'; return false; } }
  function saveRecords(records) {
    const previous = new Map();
    try {
      for (const key of Object.keys(records)) previous.set(key, localStorage.getItem(KEY + key + '-v1'));
      for (const [key, value] of Object.entries(records)) localStorage.setItem(KEY + key + '-v1', JSON.stringify(value));
      return true;
    } catch {
      let restored = true;
      for (const [key, value] of previous) {
        try { if (value === null) localStorage.removeItem(KEY + key + '-v1'); else localStorage.setItem(KEY + key + '-v1', value); } catch { restored = false; }
      }
      status.textContent = restored ? '无法保存，修改已撤回' : '无法保存，部分记录可能已变更，请检查存储空间';
      return false;
    }
  }
  const dataCache = new Map(), invalidSources = new Set();
  function data(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      const cached = dataCache.get(key); if (cached?.raw === raw) return cached.value;
      const {value,invalid}=window.LauncherStorage.parse(key,raw,fallback);
      if(invalid)invalidSources.add(key);else invalidSources.delete(key);
      dataCache.set(key, { raw, value }); return value;
    } catch { return fallback; }
  }
  function errorMessage(error) {
    return ({ app_window_not_found:'未找到该应用已打开的窗口；没有启动新实例',app_focus_denied:'系统未允许切换窗口，可能需要相同权限',app_not_found:'应用目标已不存在，请重新搜索',unsupported_app_target:'该快捷方式不指向可直接操作的应用程序',unsupported_app_action:'当前平台不支持此应用动作',elevation_cancelled_or_denied:'管理员启动已取消或被系统拒绝', invalid_path: '路径不存在，或不支持直接打开此文件类型', app_open_failed: '无法打开，文件可能已移动或没有关联应用', extension_timeout: '扩展响应超时，可在设置中调整等待时间', extension_disabled: '扩展已停用', cancelled: '操作已取消', invalid_target: '结果已失效，请重新搜索', extension_cleanup_failed: '扩展未能正常退出，请重启应用后重试' })[error] || error;
  }
  function button(text, handler) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      b.disabled = true;
      try { await handler(); } catch (error) { status.textContent = `操作失败：${error.message || '请重试'}`; }
      finally { b.disabled = false; }
    }); return b;
  }
  async function manageOperation(operation) {
    if (running) return;
    running = true;
    try {
      const result = await operation();
      if (!result?.ok) { if (result?.error !== 'cancelled') status.textContent = `操作失败：${result?.error || '请重试'}`; return; }
      if (openState && !manager.hidden) await showManager();
    } finally { running = false; if (pendingClose) { pendingClose = false; await close(); } }
  }
  let localSignature = [], localIndex = [];
  function withDirectUrl(result) {
    if(regexEnabled)return result;
    const query = input.value.trim();
    if (!/^https?:\/\/\S+$/i.test(query)) return result;
    try { const url = new URL(query).href; return [...result, { id: `url:${url}`, persistable: false, title: query, subtitle: '在浏览器中打开公开网址', kind: 'url', target: { url } }]; } catch { return result; }
  }
  function localResults() {
    const signature = ['notch-note-archive-v1', 'notch-todo-category-names-v1', 'notch-todo-data', 'notch-link-groups', 'notch-home-commands', 'notch-clip-history'].map(key => localStorage.getItem(key));
    signature.push(settings.sources.workspace, settings.sources.clipboard, features.notes, features.todo, features.links, features.clip);
    if (signature.length === localSignature.length && signature.every((value, i) => value === localSignature[i])) return withDirectUrl(localIndex);
    const result = [];
    if (settings.sources.workspace) {
      if (features.notes !== false) {
        result.push({ id: 'builtin:new-note', kind: 'navigate', title: '新建笔记', subtitle: '笔记', target: { tab: 'notes', create: 'note' } });
        data('notch-note-archive-v1', []).filter(Boolean).forEach((n) => result.push({ id: `note:${n.id}`, kind: 'navigate', title: n.title || '未命名笔记', subtitle: '笔记', keywords: [String(n.content || '').slice(0, 16000)], target: { tab: 'notes', id: n.id } }));
      }
      if (features.todo !== false) {
        result.push({ id: 'builtin:new-todo', kind: 'navigate', title: '新建待办', subtitle: '选择责任领域和截止时间', target: { tab: 'todo' } });
        const names = data('notch-todo-category-names-v1', {});
        Object.entries(data('notch-todo-data', {})).forEach(([priority, items]) => {
          if (!Array.isArray(items)) return;
          items.filter(Boolean).forEach((t) => result.push({ id: `todo:${priority}:${t.id}`, kind: 'navigate', title: String(t.text || ''), subtitle: `${names[priority] || priority} · ${t.done ? '已完成' : '待办'}`, target: { tab: 'todo', id: t.id } }));
        });
      }
      if (features.links !== false) data('notch-link-groups', []).filter(Boolean).flatMap((g) => Array.isArray(g.links) ? g.links : []).filter(Boolean).forEach((l) => result.push({ id: `link:${l.id || l.url}`, kind: 'url', title: l.title || l.url, subtitle: l.url, target: { url: l.url, id: l.id } }));
      data('notch-home-commands', []).filter((c) => c && typeof c.text === 'string').forEach((c) => result.push({ id: `command:${c.id}`, kind: 'copy', title: c.text, subtitle: '常用指令 · 复制文本', target: { text: c.text } }));
    }
    if (settings.sources.clipboard && features.clip === true) data('notch-clip-history', []).filter((c) => c?.type === 'text' && c.text).forEach((c) => result.push({ id: `clip:${c.id || c.timestamp}`, title: c.text, subtitle: '剪贴板 · 复制', kind: 'copy', target: { text: c.text } }));
    localSignature = signature;
    localIndex = result.filter((r) => typeof r.id === 'string' && r.id.length <= 300 && typeof r.title === 'string' && r.title.length <= 16000 && (r.kind !== 'url' || typeof r.target.url === 'string')).slice(0, 50000);
    return withDirectUrl(localIndex);
  }
  const iconCache = new Map();
  let queuedRun = null, operationFeedback = '';
  function resultIcon(result) {
    const type = result.id.split(':')[0];
    const icons = {
      app: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
      note: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5',
      todo: 'M9 6h11 M9 12h11 M9 18h8 M3 5l1 1 2-2 M3 11l1 1 2-2 M3 17l1 1 2-2',
      link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
      command: 'm5 7 5 5-5 5 M13 17h6', clip: 'M9 4H5v17h14V4h-4 M9 3h6v4H9z',
      path: 'M3 6h7l2 3h9v11H3z', extension: 'm12 3 9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
    };
    const category = type === 'builtin' ? (result.target?.tab === 'todo' ? 'todo' : 'note') : type === 'url' ? 'link' : (icons[type] ? type : 'extension');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round'})) svg.setAttribute(key,value);
    const shape=document.createElementNS(svg.namespaceURI,'path'); shape.setAttribute('d',icons[category]);svg.append(shape);
    return {svg,category};
  }
  function render(final = false) {
    const favorites = stored('favorites', []), aliases = stored('aliases', {}), usage = stored('usage', {});
    const candidates=window.LauncherDomain.mergeLauncherResults([localResults(), remote]).map(window.LauncherDomain.describeLauncherResult).map(r=>({...r,favorite:r.persistable&&favorites.includes(r.id),usage:r.persistable?usage[r.id]:undefined}));
    if(regexEnabled&&input.value){
      if(regexResult?.key!==regexKey()) {requestRegex(candidates,aliases,final);status.textContent='正在匹配正则…';list.inert=true;list.setAttribute('aria-busy','true');return;}
      if(regexResult.error){status.textContent=regexResult.error;input.setAttribute('aria-invalid','true');input.removeAttribute('aria-activedescendant');list.inert=true;list.setAttribute('aria-busy','false');return;}
      const byId=new Map(candidates.map(r=>[r.id,r]));rows=regexResult.ids.map(id=>byId.get(id)).filter(Boolean);
    }else rows=window.LauncherDomain.searchLauncherResults(candidates,input.value,aliases,input.value.trim()?50:12);
    list.inert=false;input.removeAttribute('aria-invalid');
    rows = rows.map(window.LauncherDomain.describeLauncherResult);
    const groupName = (r) => !input.value.trim() && r.favorite ? '收藏' : !input.value.trim() && usage[r.id] ? '最近使用' : r.source.label;
    const groups = new Map(); rows.forEach(r => { const label = groupName(r); if (!groups.has(label)) groups.set(label, []); groups.get(label).push(r); });
    if (!input.value.trim()) rows = [...groups.values()].flat();
    if (rows.some((r) => r.id === preferredId)) selectedId = preferredId;
    else if (!rows.some((r) => r.id === selectedId)) selectedId = rows[0]?.id || '';
    if (final) preferredId = selectedId;
    const previous = new Map([...list.children].map(node => [node.dataset.key,node]));
    const desired = []; let previousGroup;
    rows.forEach((r, index) => {
      const group = groupName(r);
      if (group !== previousGroup) {
        const key = `group:${group}:${r.id}`;
        const heading = previous.get(key) || document.createElement('div');
        heading.dataset.key=key; heading.className='launcher-group';heading.setAttribute('role','presentation');
        if(heading.textContent!==group)heading.textContent=group;
        desired.push(heading);previousGroup=group;
      }
      let row=previous.get(r.id);
      if(!row) {
        row=button('',()=>{selectedId=row.result.id;return run(row.result);});
        row.dataset.key=r.id;row.dataset.resultId=r.id;row.className='launcher-result';row.setAttribute('role','option');row.tabIndex=-1;
        row.addEventListener('contextmenu',event=>{event.preventDefault();selectedId=row.result.id;preferredId=selectedId;render();showActions();});
        const icon=document.createElement('i');icon.className='launcher-result-icon';icon.setAttribute('aria-hidden','true');
        const {svg,category}=resultIcon(r);icon.dataset.category=category;icon.append(svg);
        const copy=document.createElement('div');copy.className='launcher-result-copy';copy.append(document.createElement('strong'),document.createElement('span'));
        const type=document.createElement('small');type.className='launcher-result-type';row.append(icon,copy,type);
      }
      row.result=r;row.id=`launcher-option-${index}`;
      row.setAttribute('aria-selected',String(r.id===selectedId));row.classList.toggle('selected',r.id===selectedId);
      const title=row.querySelector('strong'),sub=row.querySelector('.launcher-result-copy span'),type=row.querySelector('.launcher-result-type');
      const titleText=`${r.favorite?'★ ':''}${r.title}`;
      const subText=[r.subtitle,r.persistable&&aliases[r.id]?`别名 ${aliases[r.id]}`:'',r.risk==='local-code'?'本地代码':'',...(r.permissions||[]).map(permission=>({network:'网络',readFiles:'读文件',writeFiles:'写文件',shell:'Shell',clipboard:'剪贴板'})[permission]||permission)].filter(Boolean).join(' · ');
      if(title.textContent!==titleText)title.textContent=titleText;
      if(sub.textContent!==subText){sub.textContent=subText;sub.title=subText;}
      if(type.textContent!==r.source.label)type.textContent=r.source.label;
      const icon=row.querySelector('.launcher-result-icon');
      if(r.kind==='app'&&api.launcherIcon&&!icon.querySelector('img')) {
        if(!iconCache.has(r.id)) {
          if(iconCache.size>=256)iconCache.delete(iconCache.keys().next().value);
          const pending=api.launcherIcon(r.id).then(response=>{if(!response?.icon)iconCache.delete(r.id);return response?.icon||'';}).catch(()=>{iconCache.delete(r.id);return '';});
          iconCache.set(r.id,pending);
        }
        iconCache.get(r.id).then(value=>{if(!value||!icon.isConnected||icon.querySelector('img'))return;const image=new Image(26,26);image.alt='';image.src=value;icon.replaceChildren(image);icon.classList.add('native-icon');});
      }
      desired.push(row);
      if(r.id===selectedId)input.setAttribute('aria-activedescendant',row.id);
    });
    const keep=new Set(desired);
    for(const node of [...list.children])if(!keep.has(node))node.remove();
    desired.forEach((node,index)=>{if(list.children[index]!==node)list.insertBefore(node,list.children[index]||null);});
    if (!rows.length) input.removeAttribute('aria-activedescendant');
    status.textContent = operationFeedback || (rows.length ? `${rows.length} 个结果` : '没有匹配结果，可在管理中开启来源或安装扩展') + (pendingProviders.length ? ` · 正在查询：${pendingProviders.map(p=>p.title).join('、')}` : '');
    if(invalidSources.size)status.textContent+=' · 部分数据格式或大小异常，未纳入搜索';
    list.setAttribute('aria-busy', String(pendingProviders.length > 0));
    if(queuedRun?.generation===generation&&!searchPending&&regexReady()) {
      const pending=queuedRun,target=rows.find(row=>row.id===pending.id);queuedRun=null;
      queueMicrotask(()=>{if(!openState||pending.generation!==generation)return;if(target)run(target,pending.mode);else status.textContent='该结果已不再匹配，请重新选择';});
    }
  }
  function search() {
    if (!openState || !manager.hidden || running) return;
    if (!searchPending) preferredId = selectedId;
    searchPending = true; pendingProviders = []; operationFeedback = '';
    clearTimeout(timer); const revision = ++generation; queuedRun = null;
    api?.cancelLauncher?.(); actions.hidden = true; render();
    timer = setTimeout(async () => {
      try {
        const response = await api?.queryLauncher?.(input.value.slice(0, 1000), revision, regexEnabled);
        if (revision !== generation || !openState) return;
        searchPending = false; pendingProviders = [];
        if (response?.ok) {
          remote = response.items; resultsVersion++; render(true);
        }
        else if (response) { queuedRun=null; render(true); status.textContent = '应用或扩展查询失败，工作区搜索仍然可用'; }
      } catch { if (revision === generation) { searchPending = false; pendingProviders = []; queuedRun=null; render(true); status.textContent = '查询暂时不可用'; } }
    }, 30);
  }
  async function animateLauncher(opening) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !root.animate) return;
    const tokens = getComputedStyle(root);
    const hidden = { opacity: 0, transform: `translateX(-50%) translateY(calc(-1 * ${tokens.getPropertyValue('--launcher-offset').trim()})) scale(${tokens.getPropertyValue('--launcher-scale').trim()})` }, shown = { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)' };
    await root.animate(opening ? [hidden, shown] : [shown, hidden], { duration: parseFloat(tokens.getPropertyValue('--d-fast')) || 140, easing: tokens.getPropertyValue('--ease-out').trim() || 'ease-out' }).finished.catch(() => {});
  }
  async function open() {
    if (transition) { if (openState) pendingClose = true; return; }
    if (window.NotchPanel.busy()) return;
    if (openState) return close();
    transition = true;
    wasExpanded = window.NotchPanel.isExpanded(); previousFocus = document.activeElement;
    const panel = document.getElementById('panel'); previousInert = panel.inert; panel.inert = true;
    openState = true; root.hidden = false; document.body.classList.add('launcher-open');
    selectedId = ''; preferredId = ''; searchPending = false; restoreFocusOnClose = true; escapeGuardUntil = 0;
    input.disabled = false; input.value = ''; manager.hidden = true; list.hidden = false; actions.hidden = true;
    try {
      await window.NotchPanel.setNativeMode('launcher');
      input.focus(); search();
      await animateLauncher(true);
      const [config, appSettings] = await Promise.all([api?.launcherSettings?.(), api?.getAppSettings?.()]);
      if (config?.ok) settings = config;
      features = appSettings?.features || {};
      if (openState) search();
    } finally { transition = false; if (pendingClose) { pendingClose = false; await close(); } }
  }
  async function close(reason = 'dismiss') {
    if (reason !== 'dismiss') restoreFocusOnClose = false;
    if (!openState) return;
    if (transition || running) { pendingClose = true; return; }
    transition = true; openState = false; ++generation; stopRegex(); clearTimeout(timer); api?.cancelLauncher?.();
    await animateLauncher(false);
    root.hidden = true; document.body.classList.remove('launcher-open');
    document.getElementById('panel').inert = previousInert;
    try {
      await window.NotchPanel.setNativeMode(wasExpanded ? 'expanded' : 'collapsed');
      if (previousFocus?.isConnected && wasExpanded) previousFocus.focus({ preventScroll: true });
      await api?.finishLauncherFocus?.(restoreFocusOnClose);
    } finally { transition = false; escapeGuardUntil = performance.now() + 250; }
  }
  async function run(r,mode='default') {
    if (running || !r || r.kind === 'error') return;
    if(!regexReady()){status.textContent=regexResult?.error||'请等待正则匹配完成';return;}
    if(mode!=='default'&&(!r.appModes?.includes(mode))){status.textContent='此应用或平台不支持该动作';return;}
    if(searchPending&&remote.some(row=>row.id===r.id)){queuedRun={id:r.id,generation,mode};status.textContent='正在确认最新结果…';return;}
    let navigationToken;
    running = true; status.textContent = '正在执行…';
    try {
      if (r.kind === 'navigate') window.NotchPanel.validateTarget(r.target);
      let response = { ok: true };
      if (r.kind === 'copy') response = await api.writeClipboard({ type: 'text', text: r.target.text });
      else if (r.kind === 'url') response = await api.openLauncherUrl(r.target.url);
      else if (r.kind !== 'navigate') response = await api.runLauncher(r.id,mode);
      if (response === false || response?.ok === false) throw Error(response?.error || '执行失败');
      if (response?.query != null) {
        if(regexEnabled){regexEnabled=false;stopRegex();regexResult=null;document.getElementById('launcher-regex').setAttribute('aria-pressed','false');input.placeholder='搜索应用、笔记、链接…';}
        input.value = response.query; running = false; search(); input.focus(); return;
      }
      navigationToken = response?.navigationToken;
      const navigation = r.kind === 'navigate' ? r.target : response?.navigation;
      if (navigation) { window.NotchPanel.validateTarget(navigation); await window.NotchPanel.navigate(navigation); }
      if (navigation) { wasExpanded = true; previousInert = false; previousFocus = null; }
      if (navigationToken) { await api.completeLauncherNavigation(navigationToken, true); navigationToken = null; }
      const usage = stored('usage', {});
      usage[r.id] = { count: Math.min(10000, (Number(usage[r.id]?.count) || 0) + 1), lastUsedAt: Date.now() };
      if (r.persistable !== false && !save('usage', Object.fromEntries(Object.entries(usage).sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt).slice(0, 500)))) { status.textContent = '动作已完成，但使用记录未保存'; return; }
      running = false; await close('action');
    } catch (error) {
      if (navigationToken) await api.completeLauncherNavigation(navigationToken, false).catch(() => {});
      operationFeedback = `无法执行：${errorMessage(error.message)}`; status.textContent = operationFeedback; pendingClose = false;
    }
    finally { running = false; if (pendingClose) { pendingClose = false; await close(); } }
  }
  function aliasConflict(aliases, id, value) {
    const entry = Object.entries(aliases).find(([key,text])=>key!==id && window.LauncherDomain.normalizeText(text)===value);
    if(!value || !entry)return '';
    return [...localResults(),...remote].find(row=>row.id===entry[0])?.title || entry[0];
  }
  function showActions() {
    const r = rows.find((item) => item.id === selectedId); if (!r || !manager.hidden || !regexReady()) return;
    actions.replaceChildren(); actions.hidden = false;
    actions.append(button(r.actions.find(a => a.id === 'primary').title, () => run(r)));
    for(const action of r.actions.filter(a=>a.mode)){
      const control=button('',()=>run(r,action.mode));
      const label=document.createElement('span');label.textContent=action.title;
      const key=document.createElement('kbd');key.textContent=action.shortcut;control.append(label,key);actions.append(control);
    }
    if(r.kind==='app'){const hint=document.createElement('p');hint.className='launcher-action-hint';hint.textContent='新窗口由应用决定；切换动作不会额外启动应用。';actions.append(hint);}
    if (r.persistable) actions.append(button(r.favorite ? '取消收藏' : '收藏', () => {
      const favorites = stored('favorites', []); if (!save('favorites', r.favorite ? favorites.filter((id) => id !== r.id) : [...new Set([...favorites, r.id])].slice(-500))) return; actions.hidden = true; render(); input.focus();
    }));
    actions.append(button('复制名称', async () => { await api.writeClipboard({ type: 'text', text: r.title }); actions.hidden = true; input.focus(); }));
    if (r.copyTarget || r.target?.url || r.target?.text) actions.append(button('复制内容', async () => { await api.writeClipboard({ type: 'text', text: r.copyTarget || r.target.url || r.target.text }); actions.hidden = true; input.focus(); }));
    if (r.actions.some(a => a.id === 'source')) actions.append(button('打开链接页面', () => run({ ...r, kind: 'navigate', target: { tab: 'links', id: r.target.id } })));
    if (!r.persistable) {
      const note = document.createElement('p'); note.textContent = '临时结果不支持收藏或别名；网址可先保存到链接页。'; actions.append(note);
      actions.querySelector('button').focus(); return;
    }
    const label = document.createElement('label'); label.textContent = '别名';
    const alias = document.createElement('input'); alias.value = stored('aliases', {})[r.id] || ''; alias.maxLength = 40; alias.setAttribute('aria-label', '结果别名'); label.append(alias); actions.append(label);
    actions.append(button('保存别名', () => {
      const aliases = stored('aliases', {}), value = window.LauncherDomain.normalizeText(alias.value);
      const owner=aliasConflict(aliases,r.id,value);
      if (owner) { status.textContent = `此别名已被“${owner}”占用`; return; }
      if (value) aliases[r.id] = value; else delete aliases[r.id];
      if (!save('aliases', aliases)) return; actions.hidden = true; render(); input.focus();
    }));
    actions.querySelector('button').focus();
  }
  async function showManager() {
    const managerRevision = generation + 1;
    ++generation; stopRegex(); clearTimeout(timer); api?.cancelLauncher?.();
    input.disabled = true;
    manager.hidden = false; list.hidden = true; actions.hidden = true; manager.replaceChildren();
    const title = document.createElement('h3'); title.textContent = '启动器设置'; manager.append(title);
    const label = document.createElement('label'); label.textContent = '全局快捷键（留空禁用）';
    const shortcut = document.createElement('input'); shortcut.value = settings.shortcut; shortcut.setAttribute('aria-label', '启动器全局快捷键'); label.append(shortcut); manager.append(label);
    const timeoutLabel = document.createElement('label'); timeoutLabel.textContent = '扩展查询超时（毫秒，300–5000）';
    const timeout = document.createElement('input'); timeout.type = 'number'; timeout.min = '300'; timeout.max = '5000'; timeout.step = '100'; timeout.value = settings.queryTimeoutMs || 800; timeout.setAttribute('aria-label', '扩展查询超时'); timeoutLabel.append(timeout); manager.append(timeoutLabel);
    const executionLabel = document.createElement('label'); executionLabel.textContent = '扩展执行超时（毫秒，500–10000）';
    const executionTimeout = document.createElement('input'); executionTimeout.type='number'; executionTimeout.min='500';executionTimeout.max='10000';executionTimeout.step='500';executionTimeout.value=settings.executeTimeoutMs||5000;executionTimeout.setAttribute('aria-label','扩展执行超时');executionLabel.append(executionTimeout);manager.append(executionLabel);
    const checks = {};
    for (const [key, name] of Object.entries({ apps: '本机应用', workspace: '工作区内容', clipboard: '剪贴板文字（需先启用剪贴板功能）', extensions: '本地扩展' })) {
      const l = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = settings.sources[key]; checks[key] = check; l.append(check, name); manager.append(l);
    }
    manager.append(button('保存设置', async () => {
      const next = { shortcut: shortcut.value.trim(), queryTimeoutMs: Number(timeout.value), executeTimeoutMs: Number(executionTimeout.value), sources: Object.fromEntries(Object.entries(checks).map(([key, check]) => [key, check.checked])) };
      const response = await api.saveLauncherSettings(next);
      if (response?.ok) { settings = next; status.textContent = '已保存'; } else status.textContent = '快捷键无效或已被占用，设置未保存';
    }));
    const savedTitle = document.createElement('h3'); savedTitle.textContent = '收藏与别名'; manager.append(savedTitle);
    const aliases = stored('aliases', {}), favorites = stored('favorites', []);
    const known = new Map([...localResults(), ...remote].map(r => [r.id, r]));
    const ids = [...new Set([...favorites, ...Object.keys(aliases)])];
    if (!ids.length) { const empty = document.createElement('p'); empty.textContent = '在搜索结果动作菜单中收藏或设置别名。'; manager.append(empty); }
    for (const id of ids) {
      const line = document.createElement('section'); line.className = 'launcher-extension';
      const name = document.createElement('strong'); name.textContent = known.get(id)?.title || id;
      const info = document.createElement('p'); info.textContent = `${favorites.includes(id) ? '已收藏' : '未收藏'}${known.has(id) ? '' : ' · 当前未加载，可移除失效记录'}`;
      const alias = document.createElement('input'); alias.value = aliases[id] || ''; alias.maxLength = 40; alias.setAttribute('aria-label', `${name.textContent}的别名`);
      line.append(name, info, alias, button('保存别名', () => {
        const current = stored('aliases', {}), value = window.LauncherDomain.normalizeText(alias.value);
        const owner=aliasConflict(current,id,value);
        if (owner) { status.textContent = `此别名已被“${owner}”占用`; return; }
        if (value) current[id] = value; else delete current[id]; if (save('aliases', current)) status.textContent = '别名已保存';
      }), button('移除记录', async () => {
        const current = stored('aliases', {}), usage = stored('usage', {}); delete current[id]; delete usage[id];
        if (saveRecords({ aliases: current, usage, favorites: stored('favorites', []).filter(value => value !== id) })) await showManager();
      })); manager.append(line);
    }
    const extTitle = document.createElement('h3'); extTitle.textContent = '本地扩展'; manager.append(extTitle);
    const warning = document.createElement('p'); warning.textContent = '扩展只能直接读取自身代码并读写专属数据目录；派生进程、原生插件和 Worker 被禁用。网络尚无系统级隔离，仍仅安装信任的代码。'; manager.append(warning);
    manager.append(button('从目录安装扩展', () => manageOperation(() => api.installLauncherExtension())));
    const response = await api?.listLauncherExtensions?.();
    if (!openState || manager.hidden || managerRevision !== generation) return;
    for (const ext of response?.items || []) {
      const section = document.createElement('section'); section.className = 'launcher-extension';
      const name = document.createElement('strong'); name.textContent = `${ext.name} ${ext.version}`;
      const detail = document.createElement('p'); detail.textContent = `${ext.commands.length} 个命令 · ${ext.permissions.join('、') || '声明式操作'} · 入口：${ext.runtime?.entry || '声明式'} · 最近运行：${ext.lastRunAt ? new Date(ext.lastRunAt).toLocaleString() : '尚未运行'}${ext.error ? ' · ' + ext.error : ''}`;
      if (ext.history?.length) {
        const history = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '最近运行记录'; history.append(summary);
        for (const entry of [...ext.history].reverse()) { const line = document.createElement('p'); line.textContent = `${new Date(entry.at).toLocaleString()} · ${entry.operation} · ${entry.status} · ${entry.durationMs}ms`; history.append(line); }
        section.append(history);
      }
      section.append(button('导出数据',()=>manageOperation(()=>api.transferLauncherData(ext.id,'export'))),button('导入数据',()=>manageOperation(()=>api.transferLauncherData(ext.id,'import'))));
      section.append(name, detail, button('复制诊断', async () => { await api.writeClipboard({ type: 'text', text: JSON.stringify({ id: ext.id, version: ext.version, enabled: ext.enabled, error: ext.error || null, lastRunAt: ext.lastRunAt, history: ext.history }) }); status.textContent = '已复制诊断'; }), button(ext.enabled ? '禁用' : '启用', () => manageOperation(() => api.toggleLauncherExtension(ext.id, !ext.enabled))), button('卸载', () => manageOperation(() => api.removeLauncherExtension(ext.id)))); manager.append(section);
    }
    status.textContent = settings.registered === false ? '默认快捷键未注册，请设置其他组合键' : '设置仅保存在本机；收藏和别名随工作区保存';
    shortcut.focus();
  }
  function escape() {
    if (!actions.hidden) { actions.hidden = true; input.focus(); }
    else if (!manager.hidden) { manager.hidden = true; input.disabled = false; list.hidden = false; input.focus(); search(); }
    else close();
  }
  root.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Tab') {
      const focusable = [...root.querySelectorAll('input, button, [tabindex="0"]')].filter((e) => !e.disabled && e.getClientRects().length && e.tabIndex !== -1);
      const index = focusable.indexOf(document.activeElement);
      if ((!event.shiftKey && index === focusable.length - 1) || (event.shiftKey && index <= 0)) { event.preventDefault(); focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus(); }
      return;
    }
    if(event.target===input&&event.altKey&&!event.ctrlKey&&!event.metaKey&&(event.code==='KeyR'||event.key.toLowerCase()==='r')){event.preventDefault();toggleRegex();return;}
    if(event.key==='Enter'&&!event.isComposing&&manager.hidden&&(event.target===input||event.target.tagName!=='INPUT')){
      const selected=rows.find(r=>r.id===selectedId);
      const mode=event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey?'focus':(event.ctrlKey||event.metaKey)&&!event.altKey?(event.shiftKey?'admin':'new'):null;
      if(mode&&selected?.kind==='app'){event.preventDefault();run(selected,mode);return;}
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); showActions(); return; }
    if (event.key === 'Escape') { event.preventDefault(); /* Production Escape is forwarded by preload. */ if (!api?.onEscape) escape(); return; }
    if (!actions.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); const buttons = [...actions.querySelectorAll('button, input')]; const index = buttons.indexOf(document.activeElement);
      buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); return;
    }
    if (event.target !== input) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const current = Math.max(0, rows.findIndex((r) => r.id === selectedId));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % Math.max(rows.length, 1);
      selectedId = rows[next]?.id || ''; preferredId = selectedId; render(); list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') { event.preventDefault(); run(rows.find((r) => r.id === selectedId)); }
  });
  document.getElementById('launcher-regex').addEventListener('click',toggleRegex);
  input.addEventListener('input', (event) => { if (!event.isComposing) search(); });
  input.addEventListener('compositionend', search);
  document.getElementById('launcher-manage').addEventListener('click', showManager);
  document.getElementById('launcher-action-button').addEventListener('click', showActions);
  document.getElementById('launcher-close').addEventListener('click', escape);
  document.getElementById('launcher-open').addEventListener('click', open);
  document.getElementById('settings-launcher-open').addEventListener('click', async () => { await open(); await showManager(); });
  api?.onLauncherPartial?.((payload) => {
    if (!openState || !manager.hidden || payload.requestId !== generation || !Array.isArray(payload.items)) return;
    remote = window.LauncherDomain.mergeLauncherResults([payload.items,remote]); resultsVersion++; pendingProviders = payload.pending || []; render();
  });
  api?.onLauncherToggle?.(open); api?.onLauncherClose?.(() => { if (actions.hidden) close('blur'); });
  window.NotchLauncher = { open, close, escape, handleEscape: () => { if (!openState && !transition && performance.now() >= escapeGuardUntil) return false; if (openState) escape(); return true; }, isOpen: () => openState, refresh: search };
})();
