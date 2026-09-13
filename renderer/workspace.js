(function initWorkspace() {
  const Domain = window.NotchDomain;
  if (!Domain) return;

  const COMMANDS_KEY = 'notch-home-commands';
  const LINKS_KEY = 'notch-link-groups';
  const RECORDINGS_KEY = 'notch-recordings';
  const HIDDEN_WINDOWS_KEY = 'notch-hidden-windows';

  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
  const ADD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.8 6.7l3.5 3.5"/></svg>';
  const AI_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></svg>';
  const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  async function syncWorkspaceData() {
    if (!window.notchAPI?.saveWorkspaceData) return true;
    const storage = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) storage[key] = localStorage.getItem(key);
    }
    try { return await window.notchAPI.saveWorkspaceData(storage) !== false; } catch (error) { return false; }
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatShortDate(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  // ============ 常用指令 ============
  const commandInput = document.getElementById('command-add');
  const commandList = document.getElementById('command-list');
  const commandBulkDelete = document.getElementById('command-bulk-delete');
  let commands = loadJson(COMMANDS_KEY, [])
    .map((item) => Domain.createCommand(item && item.text, item && item.id, item && item.createdAt))
    .filter(Boolean);
  let commandSelection = new Set();
  let commandSelectionAnchor = null;

  function persistCommands() {
    saveJson(COMMANDS_KEY, commands);
  }

  function renderCommands() {
    if (!commandList) return;
    commandList.replaceChildren();
    if (commandBulkDelete) {
      commandBulkDelete.hidden = commandSelection.size === 0;
      commandBulkDelete.textContent = '删除';
      commandBulkDelete.setAttribute('aria-label', commandSelection.size
        ? `删除 ${commandSelection.size} 项`
        : '删除所选');
    }
    if (!commands.length) {
      const empty = document.createElement('div');
      empty.className = 'command-empty';
      empty.textContent = '把常用命令、提示词或回复模板放在这里';
      commandList.appendChild(empty);
      return;
    }
    commands.forEach((command) => {
      const row = document.createElement('div');
      row.className = `command-item${commandSelection.has(command.id) ? ' multi-selected' : ''}`;
      row.dataset.id = command.id;

      const textButton = document.createElement('button');
      textButton.className = 'command-text';
      textButton.type = 'button';
      textButton.dataset.action = 'edit-command';
      textButton.title = '点击修改';
      textButton.textContent = command.text;

      const actions = document.createElement('div');
      actions.className = 'command-actions';
      const copy = document.createElement('button');
      copy.className = 'icon-button';
      copy.type = 'button';
      copy.dataset.action = 'copy-command';
      copy.setAttribute('aria-label', '复制指令');
      copy.innerHTML = COPY_ICON;
      const remove = document.createElement('button');
      remove.className = 'icon-button danger';
      remove.type = 'button';
      remove.dataset.action = 'delete-command';
      remove.setAttribute('aria-label', '删除指令');
      remove.innerHTML = DELETE_ICON;
      actions.append(copy, remove);
      row.append(textButton, actions);
      commandList.appendChild(row);
    });
  }

  function editCommand(row) {
    const command = commands.find((item) => item.id === row.dataset.id);
    if (!command || row.querySelector('input')) return;
    const button = row.querySelector('.command-text');
    const input = document.createElement('input');
    input.className = 'command-edit';
    input.value = command.text;
    button.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (save && value) command.text = value;
      persistCommands();
      renderCommands();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) finish(true);
      if (event.key === 'Escape') finish(false);
    });
  }

  if (commandInput) {
    commandInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      const command = Domain.createCommand(commandInput.value, uid('command'), Date.now());
      if (!command) return;
      commands.unshift(command);
      commandInput.value = '';
      persistCommands();
      renderCommands();
    });
  }

  if (commandList) {
    commandList.addEventListener('click', async (event) => {
      const row = event.target.closest('.command-item');
      if (!row) return;
      const command = commands.find((item) => item.id === row.dataset.id);
      if (!command) return;
      if (event.shiftKey) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          commands.map((item) => item.id),
          [...commandSelection],
          command.id,
          commandSelectionAnchor,
          true
        );
        commandSelection = new Set(result.selected);
        commandSelectionAnchor = result.anchor;
        renderCommands();
        return;
      }
      commandSelectionAnchor = command.id;
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'edit-command') editCommand(row);
      if (action.dataset.action === 'delete-command') {
        commands = commands.filter((item) => item.id !== command.id);
        commandSelection.delete(command.id);
        persistCommands();
        renderCommands();
      }
      if (action.dataset.action === 'copy-command' && window.notchAPI) {
        const copied = await window.notchAPI.writeClipboard({ type: 'text', text: command.text });
        if (copied) {
          row.classList.add('copied');
          setTimeout(() => row.classList.remove('copied'), 700);
        }
      }
    });
  }
  commandBulkDelete?.addEventListener('click', () => {
    if (!commandSelection.size) return;
    commands = commands.filter((command) => !commandSelection.has(command.id));
    commandSelection.clear();
    commandSelectionAnchor = null;
    persistCommands();
    renderCommands();
  });

  // ============ 链接收藏夹 ============
  const linkInput = document.getElementById('link-add');
  const linkBulkDelete = document.getElementById('link-bulk-delete');
  const linkGroupsEl = document.getElementById('link-groups');
  const linksStatus = document.getElementById('links-status');
  let linkGroups = loadJson(LINKS_KEY, []);
  if (!Array.isArray(linkGroups)) linkGroups = [];
  let linkSelection = new Set();
  let linkSelectionAnchor = null;
  let addingLinkGroupId = '';
  const linksSearch=document.getElementById('links-search'),groupFilter=document.getElementById('links-group-filter');
  const linkLimits=new Map();
  const LINK_PAGE_SIZE=40;
  const normalizeLinkSearch=value=>String(value||'').normalize('NFKC').toLocaleLowerCase();
  function resetLinkView(){linkLimits.clear();linkSelection.clear();linkSelectionAnchor=null;renderLinkGroups();linkGroupsEl.scrollTop=0;}
  linksSearch?.addEventListener('input',resetLinkView);
  groupFilter?.addEventListener('change',resetLinkView);
  document.getElementById('links-collapse-all')?.addEventListener('click',()=>{
    const collapse=linkGroups.some(group=>!group.collapsed);
    linkGroups.forEach(group=>{group.collapsed=collapse;});persistLinks();renderLinkGroups();
  });

  function persistLinks() {
    return saveJson(LINKS_KEY, linkGroups);
  }

  function setLinksStatus(message, tone = '') {
    if (linksStatus) {
      linksStatus.textContent = '';
      linksStatus.dataset.tone = tone;
    }
    if (message && typeof showStatusToast === 'function') showStatusToast(message);
  }

  function allLinks() {
    return linkGroups.flatMap((group) => Array.isArray(group.links) ? group.links : []);
  }

  function updateLinkBulkAction() {
    if (!linkBulkDelete) return;
    linkBulkDelete.hidden = linkSelection.size === 0;
    linkBulkDelete.textContent = '删除';
    linkBulkDelete.setAttribute('aria-label', linkSelection.size
      ? `删除 ${linkSelection.size} 项`
      : '删除所选');
  }

  function linkHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
      return url;
    }
  }

  function createIconButton(action, label, icon, danger = false) {
    const button = document.createElement('button');
    button.className = `icon-button${danger ? ' danger' : ''}`;
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  function renderLinkGroups() {
    if (!linkGroupsEl) return;
    const groupScroll = new Map([...linkGroupsEl.querySelectorAll('.link-group')].map(section=>[section.dataset.groupId,section.querySelector('.link-list')?.scrollTop||0]));
    linkGroupsEl.replaceChildren();
    updateLinkBulkAction();
    const query=normalizeLinkSearch(linksSearch?.value).trim(),tokens=query.split(/\s+/).filter(Boolean);
    const selected=groupFilter?.value||'';
    if(groupFilter){
      const options=[['','全部分组'],...linkGroups.map(g=>[String(g.id),`${g.name||'未命名分组'} (${(g.links||[]).length})`])];
      const signature=JSON.stringify(options);
      if(groupFilter.dataset.signature!==signature){groupFilter.replaceChildren(...options.map(([value,label])=>new Option(label,value)));groupFilter.value=selected;groupFilter.dataset.signature=signature;}
    }
    const visibleGroups=linkGroups.filter(g=>!groupFilter?.value||String(g.id)===groupFilter.value).map(group=>({group,links:(group.links||[]).filter(link=>tokens.every(token=>normalizeLinkSearch(`${group.name} ${link.title} ${link.url}`).includes(token)))})).filter(entry=>!query||entry.links.length);
    const matched=visibleGroups.reduce((sum,entry)=>sum+entry.links.length,0),total=allLinks().length;
    const counter=document.getElementById('links-result-count');if(counter)counter.textContent=`${matched} / ${total} 个链接`;
    const collapseButton=document.getElementById('links-collapse-all');if(collapseButton){collapseButton.disabled=!!query||!linkGroups.length;collapseButton.textContent=linkGroups.some(g=>!g.collapsed)?'全部折叠':'全部展开';}
    if (!linkGroups.length) {
      const empty = document.createElement('div');
      empty.className = 'links-empty';
      empty.innerHTML = '<strong>还没有链接</strong><span>粘贴一个网址，TO-DO Panel 会读取标题并放进合适的分组。</span>';
      linkGroupsEl.appendChild(empty);
      return;
    }

    if(!visibleGroups.length){const empty=document.createElement('div');empty.className='links-empty';empty.textContent='没有匹配链接，试试其他关键词或分组';linkGroupsEl.append(empty);return;}
    visibleGroups.forEach(({group,links}) => {
      const collapsed=group.collapsed&&!query;
      const section = document.createElement('section');
      section.className = `link-group${collapsed ? ' collapsed' : ''}`;
      section.dataset.groupId = group.id;

      const header = document.createElement('header');
      header.className = 'link-group-head';
      const toggle = document.createElement('button');
      toggle.className = 'group-toggle';
      toggle.type = 'button';
      toggle.dataset.action = 'toggle-group';
      toggle.setAttribute('aria-label', collapsed ? '展开分组' : '折叠分组');
      toggle.setAttribute('aria-expanded',String(!collapsed));toggle.disabled=!!query;
      toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';
      const name = document.createElement('input');
      name.className = 'group-name-input';
      name.value = String(group.name || '未命名分组');
      name.dataset.action = 'rename-group';
      name.setAttribute('aria-label', '分组名称');
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = query ? `${links.length} / ${(group.links||[]).length}` : `${links.length}`;
      header.append(toggle, name, count);
      header.appendChild(createIconButton('add-link-to-group', `在“${group.name || '当前分组'}”中新增链接`, ADD_ICON));
      header.appendChild(createIconButton('delete-group', '删除分组及其中所有链接', DELETE_ICON, true));

      const body = document.createElement('div');
      body.className = 'link-group-body';
      if (addingLinkGroupId === group.id) {
        const addRow = document.createElement('div');
        addRow.className = 'group-link-add';
        addRow.innerHTML = `<input data-group-link-input type="text" placeholder="粘贴网址并回车，添加到此分组" aria-label="添加链接到${String(group.name || '当前分组').replace(/[<>"&]/g, '')}" autocomplete="off" spellcheck="false"><button type="button" data-action="cancel-group-link-add" aria-label="取消">×</button>`;
        body.appendChild(addRow);
      }
      const list = document.createElement('div');
      list.className = 'link-list';
      const limit=linkLimits.get(group.id)||LINK_PAGE_SIZE;
      (collapsed?[]:links.slice(0,limit)).forEach((link) => {
        const row = document.createElement('article');
        row.className = `link-item${linkSelection.has(link.id) ? ' multi-selected' : ''}`;
        row.dataset.linkId = link.id;
        row.dataset.groupId = group.id;
        const mark = document.createElement('span');
        mark.className = 'link-favicon';
        if (link.icon && String(link.icon).startsWith('data:image/')) {
          const image = document.createElement('img');
          image.src = link.icon;
          image.alt = ''; image.loading='lazy';image.decoding='async';
          mark.appendChild(image);
        } else {
          mark.textContent = (linkHostname(link.url).charAt(0) || '·').toUpperCase();
        }
        const open = document.createElement('button');
        open.className = 'link-open';
        open.type = 'button';
        open.dataset.action = 'open-link';
        const title = document.createElement('strong');
        title.textContent = link.title || linkHostname(link.url);
        const domain = document.createElement('span');
        domain.textContent = linkHostname(link.url);
        open.append(title, domain);
        const actions = document.createElement('div');
        actions.className = 'link-actions';
        actions.append(
          createIconButton('open-link', '打开链接', OPEN_ICON),
          createIconButton('name-link-ai', '智能生成名称与分类', AI_ICON),
          createIconButton('edit-link', '修改名称', EDIT_ICON),
          createIconButton('delete-link', '删除链接', DELETE_ICON, true)
        );
        row.append(mark, open, actions);
        list.appendChild(row);
      });

      body.append(list);
      if(!collapsed&&links.length>limit){
        const more=document.createElement('button');more.type='button';more.className='links-load-more';more.textContent=`再显示 ${Math.min(LINK_PAGE_SIZE,links.length-limit)} 条 · 还有 ${links.length-limit} 条`;
        more.addEventListener('click',()=>{linkLimits.set(group.id,limit+LINK_PAGE_SIZE);const top=linkGroupsEl.scrollTop;renderLinkGroups();linkGroupsEl.scrollTop=top;const section=[...linkGroupsEl.children].find(el=>el.dataset.groupId===String(group.id));const firstNew=section?.querySelectorAll('.link-open')[limit];firstNew?.focus({preventScroll:true});const scroller=section?.querySelector('.link-list');if(scroller&&firstNew)scroller.scrollTop+=firstNew.getBoundingClientRect().top-scroller.getBoundingClientRect().top;});body.append(more);
      }
      section.append(header, body);
      linkGroupsEl.appendChild(section);
      list.scrollTop=groupScroll.get(String(group.id))||0;
    });
  }

  function addLink(rawValue, requestedGroupId = '') {
    const normalized = Domain.normalizeHttpUrl(rawValue);
    if (!normalized) {
      setLinksStatus('请输入有效的公开网址', 'error');
      return false;
    }
    if (allLinks().some((link) => link.url === normalized)) {
      setLinksStatus('这个链接已经收藏过了', 'error');
      return false;
    }
    const link = { id: uid('link'), url: normalized, title: '未命名', icon: '', createdAt: Date.now() };
    const preferredGroupId = requestedGroupId || Domain.preferredLinkGroupId(linkGroups, normalized);
    const preferredGroup = linkGroups.find((group) => group.id === preferredGroupId);
    if (preferredGroup) {
      linkGroups = linkGroups.map((group) => group.id === preferredGroup.id
        ? { ...group, collapsed: false, links: [...(group.links || []), link] }
        : group);
    } else {
      linkGroups = Domain.addLinkToGroups(linkGroups, link, Domain.classifyLink(normalized, ''));
    }
    const destination=linkGroups.find(group=>(group.links||[]).some(item=>item.id===link.id));
    if(destination)linkLimits.set(destination.id,Math.max(LINK_PAGE_SIZE,destination.links.length));
    if(linksSearch)linksSearch.value='';if(groupFilter)groupFilter.value='';
    linkSelection.clear();linkSelectionAnchor=null;
    persistLinks();
    renderLinkGroups();
    requestAnimationFrame(()=>linkGroupsEl.querySelector(`[data-link-id="${CSS.escape(String(link.id))}"]`)?.scrollIntoView({block:'nearest'}));
    setLinksStatus('链接已保存');

    // 保存动作不等待网络或大模型。标题、图标和分组在后台静默补全。
    Promise.resolve(window.notchAPI?.inspectLink?.(normalized)).then((inspected) => {
      if (!inspected?.ok) return;
      let sourceGroup = null;
      let savedLink = null;
      linkGroups.some((group) => {
        const found = (group.links || []).find((item) => item.id === link.id);
        if (!found) return false;
        sourceGroup = group;
        savedLink = found;
        return true;
      });
      if (!savedLink || !sourceGroup) return;
      savedLink.url = inspected.url || savedLink.url;
      savedLink.title = inspected.title || savedLink.title || '未命名';
      savedLink.icon = inspected.icon || savedLink.icon || '';
      // 手动定向或同站点复用后锁定分组；自动分类只使用可预测的本地规则，
      // 避免模型自由命名生成多个近义分组。
      const lockedGroupId = preferredGroup?.id || Domain.preferredLinkGroupId(
        linkGroups.map((group) => ({
          ...group,
          links: (group.links || []).filter((item) => item.id !== savedLink.id),
        })),
        savedLink.url
      );
      const nextCategory = Domain.classifyLink(savedLink.url, savedLink.title);
      if (!lockedGroupId && nextCategory && nextCategory !== sourceGroup.name) {
        const target = linkGroups.find((group) => group.name === nextCategory);
        if (target) {
          linkGroups = Domain.moveLinkToGroup(linkGroups, savedLink.id, target.id);
        } else {
          sourceGroup.links = sourceGroup.links.filter((item) => item.id !== savedLink.id);
          linkGroups = Domain.addLinkToGroups(linkGroups, savedLink, nextCategory);
        }
      }
      persistLinks();
      renderLinkGroups();
    }).catch(() => {});
    return true;
  }

  if (linkInput) {
    linkInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      const value = linkInput.value;
      if (addLink(value)) linkInput.value = '';
      linkInput.focus();
    });
  }

  function findLink(group, linkId) {
    return group && (group.links || []).find((link) => link.id === linkId);
  }

  if (linkGroupsEl) {
    linkGroupsEl.addEventListener('change', (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('.group-name-input')) {
        linkGroups = Domain.renameGroup(linkGroups, groupSection.dataset.groupId, event.target.value);
        persistLinks();
        renderLinkGroups();
      }
      if (event.target.matches('.link-title-edit')) {
        const row = event.target.closest('[data-link-id]');
        const group = linkGroups.find((item) => item.id === groupSection.dataset.groupId);
        const link = findLink(group, row && row.dataset.linkId);
        const value = event.target.value.trim();
        if (link && value) link.title = value;
        persistLinks();
        renderLinkGroups();
      }
    });

    linkGroupsEl.addEventListener('keydown', async (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('[data-group-link-input]')) {
        if (event.key === 'Escape') {
          addingLinkGroupId = '';
          renderLinkGroups();
        } else if (event.key === 'Enter' && !event.isComposing && !event.repeat) {
          event.preventDefault();
          if (addLink(event.target.value, groupSection.dataset.groupId)) {
            addingLinkGroupId = '';
            renderLinkGroups();
          }
        }
        return;
      }
      if (event.target.matches('.group-name-input') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
      if (event.target.matches('.link-title-edit') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
    });

    linkGroupsEl.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      const groupId = groupSection.dataset.groupId;
      const group = linkGroups.find((item) => item.id === groupId);
      const row = event.target.closest('[data-link-id]');
      const link = findLink(group, row && row.dataset.linkId);
      if (event.shiftKey && link) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          [...linkGroupsEl.querySelectorAll('.link-item[data-link-id]')].map(item=>item.dataset.linkId),
          [...linkSelection],
          link.id,
          linkSelectionAnchor,
          true
        );
        linkSelection = new Set(result.selected);
        linkSelectionAnchor = result.anchor;
        renderLinkGroups();
        return;
      }
      if (link) linkSelectionAnchor = link.id;
      if (!action) return;
      if (action.dataset.action === 'add-link-to-group') {
        addingLinkGroupId = groupId;
        group.collapsed = false;
        persistLinks();
        renderLinkGroups();
        requestAnimationFrame(() => linkGroupsEl.querySelector(
          `[data-group-id="${CSS.escape(groupId)}"] [data-group-link-input]`
        )?.focus());
      }
      if (action.dataset.action === 'cancel-group-link-add') {
        addingLinkGroupId = '';
        renderLinkGroups();
      }
      if (action.dataset.action === 'toggle-group') {
        group.collapsed = !group.collapsed;
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'delete-group') {
        (group.links || []).forEach((item) => linkSelection.delete(item.id));
        linkGroups = linkGroups.filter((item) => item.id !== groupId);
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'open-link' && link && window.notchAPI) {
        window.notchAPI.openExternal(link.url);
      }
      if (action.dataset.action === 'delete-link' && link) {
        group.links = group.links.filter((item) => item.id !== link.id);
        linkSelection.delete(link.id);
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'name-link-ai' && link) {
        window.NotchAI?.openLinkName?.(link.id);
      }
      if (action.dataset.action === 'edit-link' && link && row) {
        const openButton = row.querySelector('.link-open');
        const input = document.createElement('input');
        input.className = 'link-title-edit';
        input.value = link.title;
        openButton.replaceWith(input);
        input.focus();
        input.select();
      }
    });

    // ============ 链接长按拖拽：组内排序 + 跨组搬运 ============
    // 不用 HTML5 拖拽有两个原因：一是行中间那一大块是 <button class="link-open">，
    // Chromium 里从 button 上按下不会触发祖先的 dragstart，标题区域整块拖不动；
    // 二是原生拖拽一按就走，没法和「点击打开链接」区分。改成指针事件 + 长按门槛。
    const LINK_DRAG_HOLD_MS = 340;
    const LINK_DRAG_MOVE_CANCEL = 8;
    let linkDrag = null;
    let suppressLinkClick = false;

    function clearLinkDropMarks() {
      linkGroupsEl.querySelectorAll('.drop-before, .drop-after, .drop-target').forEach((item) => {
        item.classList.remove('drop-before', 'drop-after', 'drop-target');
      });
    }

    function cancelLinkDrag() {
      if (!linkDrag) return;
      clearTimeout(linkDrag.holdTimer);
      if (linkDrag.active) {
        linkDrag.row.classList.remove('dragging');
        linkGroupsEl.classList.remove('link-dragging');
        clearLinkDropMarks();
      }
      try { linkDrag.row.releasePointerCapture(linkDrag.pointerId); } catch (error) {}
      linkDrag = null;
    }

    // 落点有两种：压在某一行上就按该行中线决定插到它前面还是后面；
    // 压在分组的空白或标题上就追加到该组末尾（index 为 null）。
    function updateLinkDropTarget(clientX, clientY) {
      clearLinkDropMarks();
      linkDrag.target = null;
      const under = document.elementFromPoint(clientX, clientY);
      if (!under || !linkGroupsEl.contains(under)) return;
      const overRow = under.closest('.link-item[data-link-id]');
      // 压在被拖那一行自己身上 = 放回原处，目标留空，松手什么都不做。
      // 少了这一步，长按后原地松手会落到「自己所在的分组」上，被当成追加到组末尾。
      if (overRow === linkDrag.row) return;
      if (overRow) {
        const rect = overRow.getBoundingClientRect();
        const after = clientY > rect.top + rect.height / 2;
        overRow.classList.add(after ? 'drop-after' : 'drop-before');
        const rows = Array.from(overRow.parentElement.children)
          .filter((item) => item.dataset && item.dataset.linkId);
        linkDrag.target = {
          groupId: overRow.dataset.groupId,
          index: rows.indexOf(overRow) + (after ? 1 : 0),
        };
        return;
      }
      const overGroup = under.closest('.link-group[data-group-id]');
      if (!overGroup) return;
      overGroup.classList.add('drop-target');
      linkDrag.target = { groupId: overGroup.dataset.groupId, index: null };
    }

    function linkOrderFingerprint() {
      return linkGroups
        .map((group) => `${group.id}:${(group.links || []).map((link) => link.id).join(',')}`)
        .join('|');
    }

    linkGroupsEl.addEventListener('pointerdown', (event) => {
      if(linksSearch?.value.trim()||groupFilter?.value)return;
      if (event.button !== 0) return;
      const row = event.target.closest('.link-item[data-link-id]');
      // 编辑 / 删除按钮和标题输入框保持原有点击语义，不参与拖拽。
      if (!row || event.target.closest('input, .link-actions')) return;
      // 上一次拖拽后若没有等到那个补发的 click（比如在列表外松手），标志会留着，
      // 否则它会把下一次正常点击吞掉，链接就打不开了。
      suppressLinkClick = false;
      cancelLinkDrag();
      linkDrag = {
        row,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        target: null,
        holdTimer: setTimeout(() => {
          if (!linkDrag) return;
          linkDrag.active = true;
          row.classList.add('dragging');
          linkGroupsEl.classList.add('link-dragging');
          try { row.setPointerCapture(linkDrag.pointerId); } catch (error) {}
          updateLinkDropTarget(linkDrag.startX, linkDrag.startY);
          setLinksStatus('拖到目标位置后松手');
        }, LINK_DRAG_HOLD_MS),
      };
    });

    // 这三个挂在 document 上（与窗口拖拽同一套写法）：长按还没满就快速划出列表时，
    // 挂在 linkGroupsEl 上收不到 move / up，计时器随后仍会启动一次拖拽。
    document.addEventListener('pointermove', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      if (!linkDrag.active) {
        // 长按还没满就移动，说明用户在滚动或只是手抖，放弃这次拖拽。
        const moved = Math.abs(event.clientX - linkDrag.startX) > LINK_DRAG_MOVE_CANCEL
          || Math.abs(event.clientY - linkDrag.startY) > LINK_DRAG_MOVE_CANCEL;
        if (moved) cancelLinkDrag();
        return;
      }
      event.preventDefault();
      updateLinkDropTarget(event.clientX, event.clientY);
    });

    document.addEventListener('pointerup', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      const wasActive = linkDrag.active;
      const target = linkDrag.target;
      const linkId = linkDrag.row.dataset.linkId;
      cancelLinkDrag();
      if (!wasActive) return;
      // 拖拽结束后浏览器仍会补一个 click，必须拦掉，否则松手即打开链接。
      suppressLinkClick = true;
      if (!target) {
        setLinksStatus('');
        return;
      }
      const before = linkOrderFingerprint();
      linkGroups = Domain.moveLinkToPosition(linkGroups, linkId, target.groupId, target.index);
      if (linkOrderFingerprint() === before) {
        setLinksStatus('');
        return;
      }
      persistLinks();
      renderLinkGroups();
      setLinksStatus('链接顺序已更新');
    });

    document.addEventListener('pointercancel', () => cancelLinkDrag());

    linkGroupsEl.addEventListener('click', (event) => {
      if (!suppressLinkClick) return;
      suppressLinkClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
  }

  linkBulkDelete?.addEventListener('click', () => {
    if (!linkSelection.size) return;
    linkGroups = linkGroups.map((group) => ({
      ...group,
      links: (group.links || []).filter((link) => !linkSelection.has(link.id)),
    }));
    linkSelection.clear();
    linkSelectionAnchor = null;
    persistLinks();
    renderLinkGroups();
    setLinksStatus('已删除所选链接');
  });

  // ============ 录音与转写 ============
  const homeRecorder = document.getElementById('home-recorder');
  const recordingDot = document.getElementById('home-recording-dot');
  const recordingStateLabel = document.getElementById('home-recording-state');
  const recordingTime = document.getElementById('home-recording-time');
  const recordingStrands = document.getElementById('recording-strands');
  const liveTranscript = document.getElementById('home-live-transcript');
  const recordStart = document.getElementById('record-start');
  const recordPause = document.getElementById('record-pause');
  const recordStop = document.getElementById('record-stop');
  const recordingNew = document.getElementById('recording-new');
  const recordingConfigure = document.getElementById('recording-configure');
  const recordingList = document.getElementById('recording-list');
  const recordingDetail = document.getElementById('recording-detail');
  const recordingCount = document.getElementById('recording-count');
  const recordingBulkDelete = document.getElementById('recording-bulk-delete');
  const aiSettingsRoot = document.querySelector('.settings-api-card');
  const aiProviderConfigBody = document.querySelector('.ai-provider-config-scroll');
  const transcriptionSettingsSave = document.getElementById('transcription-settings-save');
  const aiProviderTranscription = document.getElementById('ai-provider-transcription');
  const aiContentProviderList = document.getElementById('ai-content-provider-list');
  const aiContentSettingsSecondary = document.getElementById('ai-content-settings-secondary');
  const aiServicePanelTranscription = document.getElementById('ai-service-panel-transcription');
  const aiServicePanelContent = document.getElementById('ai-service-panel-content');
  const aiContentProviderTitle = document.getElementById('ai-content-provider-title');
  const aiContentProviderDescription = document.getElementById('ai-content-provider-description');
  const aiTranscriptionNavStatus = document.getElementById('ai-transcription-nav-status');
  const transcriptionApiKey = document.getElementById('transcription-api-key');
  const transcriptionApiStatus = document.getElementById('transcription-api-status');
  const transcriptionVerificationStatus = document.getElementById('transcription-verification-status');
  const transcriptionApiHelp = document.getElementById('transcription-api-help');
  const transcriptionRegion = document.getElementById('transcription-region');
  const transcriptionWorkspace = document.getElementById('transcription-workspace');
  const transcriptionProviderTest = document.getElementById('transcription-provider-test');
  const transcriptionProviderRemove = document.getElementById('transcription-provider-remove');
  const llmProvider = document.getElementById('llm-provider');
  const llmApiKey = document.getElementById('llm-api-key');
  const llmApiStatus = document.getElementById('llm-api-status');
  const contentVerificationStatus = document.getElementById('content-verification-status');
  const llmApiHelp = document.getElementById('llm-api-help');
  const llmApiHelpLabel = document.getElementById('llm-api-help-label');
  const llmBaseUrlField = document.getElementById('llm-base-url-field');
  const llmBaseUrl = document.getElementById('llm-base-url');
  const llmModel = document.getElementById('llm-model');
  const llmModelList = document.getElementById('llm-model-list');
  const llmModelAdd = document.getElementById('llm-model-add');
  const llmModelLimit = document.getElementById('llm-model-limit');
  const llmTimeout = document.getElementById('llm-timeout');
  const contentProviderRemove = document.getElementById('content-provider-remove');
  const aiAutoNameNotes = document.getElementById('ai-auto-name-notes');
  const aiAutoNameRecordings = document.getElementById('ai-auto-name-recordings');
  const aiAutoOrganizeLinks = document.getElementById('ai-auto-organize-links');
  const aiProviderTest = document.getElementById('ai-provider-test');
  const aiDiagnostics = document.getElementById('ai-diagnostics');
  const aiDiagnosticsCopy = document.getElementById('ai-diagnostics-copy');
  const aiDiagnosticsClear = document.getElementById('ai-diagnostics-clear');
  const settingsAiMigration = document.getElementById('settings-ai-migration');
  const settingsAiMigrationAck = document.getElementById('settings-ai-migration-ack');
  const transcriptionSettingsNote = document.getElementById('transcription-settings-note');
  const aiSettingsReset = document.getElementById('ai-settings-reset');
  const settingsFeatureList = document.getElementById('settings-feature-list');
  const settingsHomeModuleList = document.getElementById('settings-home-module-list');
  const settingsShortcutValue = document.getElementById('settings-shortcut-value');
  const settingsShortcutChange = document.getElementById('settings-shortcut-change');
  const settingsDefaultTab = document.getElementById('settings-default-tab');
  const settingsWorkspaceKind = document.getElementById('settings-workspace-kind');
  const settingsWorkspacePath = document.getElementById('settings-workspace-path');
  const settingsWorkspaceOpen = document.getElementById('settings-workspace-open');
  const settingsWorkspaceChoose = document.getElementById('settings-workspace-choose');
  const settingsAutoLaunch = document.getElementById('settings-auto-launch');
  const settingsInlineNote = document.getElementById('settings-inline-note');

  let recordings = loadJson(RECORDINGS_KEY, []).map(Domain.createRecording).filter(Boolean);
  let selectedRecordingId = recordings[0] && recordings[0].id;
  let recordingSelection = new Set();
  let recordingSelectionAnchor = selectedRecordingId || null;
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let speechRecognition = null;
  let speechRecognitionBlocked = false;
  let speechRecognitionError = '';
  let recordingStatus = 'idle';
  let recordingStartedAt = 0;
  let pausedAt = 0;
  let pausedTotalMs = 0;
  let recordingTranscript = '';
  let interimTranscript = '';
  let recordingTimer = null;
  let recordingStopDurationMs = 0;
  let recordingCaptureIssue = '';
  let recordingDraftId = '';
  let currentAudioUrl = '';
  let transcriptionConfig = {
    configured: false,
    asrNeedsReentry: false,
    region: 'beijing',
    workspaceId: '',
    transcriptionProviderLabel: '阿里云百炼',
    transcriptionModel: 'qwen3-asr-flash-realtime',
    transcriptionVerification: { state: 'missing' },
    llmConfigured: false,
    llmNeedsReentry: false,
    llmProviderId: 'deepseek',
    llmProviderLabel: 'DeepSeek',
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-flash',
    llmModels: ['deepseek-flash'],
    llmTimeoutMs: 30000,
    contentVerification: { state: 'missing' },
    contentProviders: [],
    contentProviderConfigs: [],
    autoNameNotes: false,
    autoNameRecordings: false,
    autoOrganizeLinks: false,
    aiMigrationNoticePending: false,
  };
  let settingsAppSettings = null;
  let settingsWorkspace = null;
  let activeAIServicePanel = 'content';
  let removeAsrOnSave = false;
  let removeContentOnSave = false;
  let aiSettingsDirty = false;
  let transcriptionStatus = 'idle';
  let transcriptionStartPromise = null;
  let transcriptionAudioContext = null;
  let transcriptionAudioSource = null;
  let transcriptionAudioProcessor = null;
  let transcriptionAudioMute = null;
  let transcriptionPcmQueue = [];
  let transcriptionFinishPromise = null;
  let strandsAudioContext = null;
  let strandsAudioSource = null;
  let strandsAnalyser = null;
  let strandsFrame = null;
  let strandsSamples = null;
  let strandsLevel = 0;
  const recordingStartTask = Domain.createExclusiveAsyncTask(() => updateRecordingUi());

  function isRecordingActive() {
    return ['recording', 'paused', 'saving'].includes(recordingStatus);
  }

  function isRecordingBusy() {
    return recordingStartTask.isPending() || isRecordingActive();
  }

  function stopRecordingStrands() {
    if (strandsFrame) cancelAnimationFrame(strandsFrame);
    strandsFrame = null;
    try { strandsAudioSource?.disconnect(); } catch (error) {}
    if (strandsAudioContext) strandsAudioContext.close().catch(() => {});
    strandsAudioContext = null;
    strandsAudioSource = null;
    strandsAnalyser = null;
    strandsSamples = null;
    strandsLevel = 0;
    const context = recordingStrands?.getContext('2d');
    context?.clearRect(0, 0, recordingStrands.width, recordingStrands.height);
  }

  function drawRecordingStrands(now) {
    if (!recordingStrands || !strandsAnalyser || !strandsSamples) {
      strandsFrame = null;
      return;
    }
    const bounds = recordingStrands.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (recordingStrands.width !== width || recordingStrands.height !== height) {
      recordingStrands.width = width;
      recordingStrands.height = height;
    }
    strandsAnalyser.getFloatTimeDomainData(strandsSamples);
    const measured = recordingStatus === 'recording' ? Domain.calculateAudioLevel(strandsSamples) : 0;
    strandsLevel += (measured - strandsLevel) * (measured > strandsLevel ? 0.34 : 0.08);
    const context = recordingStrands.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(dpr, dpr);
    context.globalCompositeOperation = 'lighter';
    const cssWidth = bounds.width;
    const cssHeight = bounds.height;
    const activeLevel = Math.min(1, strandsLevel * 6);
    const centerY = cssHeight * 0.55;
    const phase = now * 0.00115;
    const colors = [
      ['rgba(82, 224, 255, 0)', `rgba(82, 224, 255, ${0.2 + activeLevel * 0.44})`, 'rgba(82, 224, 255, 0)'],
      ['rgba(111, 128, 255, 0)', `rgba(111, 128, 255, ${0.22 + activeLevel * 0.5})`, 'rgba(111, 128, 255, 0)'],
      ['rgba(209, 96, 255, 0)', `rgba(209, 96, 255, ${0.19 + activeLevel * 0.46})`, 'rgba(209, 96, 255, 0)'],
      ['rgba(255, 102, 184, 0)', `rgba(255, 102, 184, ${0.17 + activeLevel * 0.4})`, 'rgba(255, 102, 184, 0)'],
      ['rgba(255, 210, 91, 0)', `rgba(255, 210, 91, ${0.14 + activeLevel * 0.34})`, 'rgba(255, 210, 91, 0)'],
    ];
    context.filter = `blur(${8 + activeLevel * 10}px)`;
    colors.forEach((palette, layer) => {
      const gradient = context.createLinearGradient(cssWidth * 0.08, 0, cssWidth * 0.92, 0);
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(0.36 + layer * 0.025, palette[1]);
      gradient.addColorStop(0.72 - layer * 0.02, palette[1]);
      gradient.addColorStop(1, palette[2]);
      const heightScale = cssHeight * (0.06 + layer * 0.012 + activeLevel * (0.18 + layer * 0.014));
      const drift = Math.sin(phase + layer * 0.92) * cssHeight * 0.025;
      context.beginPath();
      context.moveTo(cssWidth * 0.04, centerY);
      for (let x = cssWidth * 0.04; x <= cssWidth * 0.96; x += 5) {
        const progress = (x - cssWidth * 0.04) / (cssWidth * 0.92);
        const envelope = Math.sin(Math.PI * progress) ** (1.45 + layer * 0.08);
        const ripple = Math.sin(progress * Math.PI * (2.2 + layer * 0.18) + phase + layer) * heightScale * 0.16;
        context.lineTo(x, centerY - envelope * heightScale - ripple + drift);
      }
      for (let x = cssWidth * 0.96; x >= cssWidth * 0.04; x -= 5) {
        const progress = (x - cssWidth * 0.04) / (cssWidth * 0.92);
        const envelope = Math.sin(Math.PI * progress) ** (1.45 + layer * 0.08);
        const ripple = Math.cos(progress * Math.PI * (2 + layer * 0.14) - phase - layer) * heightScale * 0.14;
        context.lineTo(x, centerY + envelope * heightScale + ripple + drift);
      }
      context.closePath();
      context.fillStyle = gradient;
      context.globalAlpha = 0.58 - layer * 0.055;
      context.fill();
    });
    context.filter = 'blur(2px)';
    const core = context.createLinearGradient(cssWidth * 0.16, 0, cssWidth * 0.84, 0);
    core.addColorStop(0, 'rgba(66, 191, 255, 0)');
    core.addColorStop(0.34, `rgba(172, 238, 255, ${0.3 + activeLevel * 0.55})`);
    core.addColorStop(0.58, `rgba(255, 209, 255, ${0.38 + activeLevel * 0.58})`);
    core.addColorStop(0.78, `rgba(255, 213, 117, ${0.24 + activeLevel * 0.5})`);
    core.addColorStop(1, 'rgba(255, 130, 196, 0)');
    context.globalAlpha = 1;
    context.fillStyle = core;
    context.fillRect(cssWidth * 0.08, centerY - 1.3 - activeLevel, cssWidth * 0.84, 2.6 + activeLevel * 2);
    context.restore();
    homeRecorder?.style.setProperty('--recording-level', strandsLevel.toFixed(3));
    strandsFrame = requestAnimationFrame(drawRecordingStrands);
  }

  function startRecordingStrands(stream) {
    stopRecordingStrands();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream || !recordingStrands) return;
    try {
      strandsAudioContext = new AudioContext();
      strandsAudioSource = strandsAudioContext.createMediaStreamSource(stream);
      strandsAnalyser = strandsAudioContext.createAnalyser();
      strandsAnalyser.fftSize = 512;
      strandsAnalyser.smoothingTimeConstant = 0.72;
      strandsSamples = new Float32Array(strandsAnalyser.fftSize);
      strandsAudioSource.connect(strandsAnalyser);
      strandsFrame = requestAnimationFrame(drawRecordingStrands);
    } catch (error) {
      stopRecordingStrands();
    }
  }

  function verificationPresentation(verification, configured) {
    if (!configured) return { label: '未配置', state: 'empty' };
    if (verification?.state === 'verified') return { label: '已验证', state: 'saved' };
    if (verification?.state === 'failed') return { label: '验证失败', state: 'error' };
    return { label: '待验证', state: 'warning' };
  }

  function selectedContentProvider() {
    const providers = Array.isArray(transcriptionConfig.contentProviders) ? transcriptionConfig.contentProviders : [];
    return providers.find((provider) => provider.id === llmProvider?.value)
      || providers.find((provider) => provider.id === transcriptionConfig.llmProviderId)
      || null;
  }

  function setStatusPresentation(element, presentation) {
    if (!element) return;
    element.textContent = presentation.label;
    element.dataset.state = presentation.state;
  }

  function contentProfileFor(providerId) {
    const provider = (transcriptionConfig.contentProviders || []).find((item) => item.id === providerId);
    const saved = (transcriptionConfig.contentProviderConfigs || []).find((item) => item.providerId === providerId);
    const fallbackModel = provider?.defaultModel || '';
    const models = saved?.models?.length
      ? saved.models.map((item) => typeof item === 'string' ? { name: item, verification: { state: 'missing' } } : item)
      : fallbackModel ? [{ name: fallbackModel, verification: { state: 'missing' } }] : [{ name: '', verification: { state: 'missing' } }];
    return {
      providerId,
      baseUrl: saved?.baseUrl ?? provider?.defaultBaseUrl ?? '',
      models,
      activeModel: saved?.activeModel || models[0]?.name || '',
      timeoutMs: saved?.timeoutMs || 30000,
      saved: saved?.saved === true,
      configured: saved?.configured === true,
      needsReentry: saved?.needsReentry === true,
      credentialSource: saved?.credentialSource || 'none',
    };
  }

  function currentContentModels() {
    return [...(llmModelList?.querySelectorAll('[data-ai-model-name]') || [])]
      .map((input) => input.value.replace(/\s+/g, ' ').trim());
  }

  function contentModelDraft(names, activeModel = '') {
    const profile = contentProfileFor(llmProvider?.value);
    return {
      ...profile,
      models: names.map((name) => profile.models.find((item) => item.name === name) || { name, verification: { state: 'missing' } }),
      activeModel: names.includes(activeModel) ? activeModel : names[0] || '',
    };
  }

  function renderContentModels(profile) {
    if (!llmModelList) return;
    const models = profile.models.length ? profile.models : [{ name: '', verification: { state: 'missing' } }];
    const activeModel = models.some((item) => item.name === profile.activeModel) ? profile.activeModel : models[0].name;
    if (llmModel) llmModel.value = activeModel;
    llmModelList.replaceChildren(...models.map((item, index) => {
      const row = document.createElement('div'); row.className = 'ai-model-row';
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'active-content-model'; radio.checked = item.name === activeModel;
      radio.dataset.aiModelActive = String(index); radio.setAttribute('aria-label', `将${item.name || '新模型'}设为默认`);
      const input = document.createElement('input');
      input.type = 'text'; input.value = item.name; input.maxLength = 120; input.placeholder = selectedContentProvider()?.modelPlaceholder || '模型名称';
      input.dataset.aiModelName = String(index); input.autocomplete = 'off'; input.spellcheck = false;
      const presentation = verificationPresentation(item.verification, profile.configured);
      const status = document.createElement('i'); status.className = 'ai-model-row-status'; status.dataset.state = presentation.state; status.title = presentation.label; status.setAttribute('aria-label', presentation.label);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ai-model-remove'; remove.dataset.aiModelRemove = String(index); remove.disabled = models.length === 1; remove.setAttribute('aria-label', `删除${item.name || '该模型'}`); remove.textContent = '×';
      row.append(radio, input, status, remove);
      return row;
    }));
    if (llmModelLimit) {
      llmModelLimit.textContent = models.length >= 12 ? '已达到每个厂商 12 个模型的上限。' : `已添加 ${models.length} / 12 个模型。`;
      llmModelLimit.classList.remove('error');
    }
    if (llmModelAdd) llmModelAdd.disabled = models.length >= 12;
  }

  function transcriptionConnectionChanged() {
    return removeAsrOnSave
      || Boolean(transcriptionApiKey?.value.trim())
      || transcriptionRegion?.value !== (transcriptionConfig.region || 'beijing')
      || transcriptionWorkspace?.value.trim() !== (transcriptionConfig.workspaceId || '');
  }

  function contentProfileFieldsChanged() {
    const profile = contentProfileFor(llmProvider?.value);
    const models = currentContentModels();
    const savedModels = profile.models.map((item) => item.name);
    return removeContentOnSave
      || Boolean(llmApiKey?.value.trim())
      || llmBaseUrl?.value.trim() !== profile.baseUrl
      || models.length !== savedModels.length
      || models.some((model, index) => model !== savedModels[index])
      || llmModel?.value.trim() !== profile.activeModel
      || Number(llmTimeout?.value || 30000) !== Number(profile.timeoutMs || 30000);
  }

  function contentConnectionChanged() {
    return llmProvider?.value !== transcriptionConfig.llmProviderId || contentProfileFieldsChanged();
  }

  function hasAISettingsChanges() {
    return transcriptionConnectionChanged()
      || contentConnectionChanged()
      || aiAutoNameNotes?.checked !== (transcriptionConfig.autoNameNotes === true)
      || aiAutoNameRecordings?.checked !== (transcriptionConfig.autoNameRecordings === true)
      || aiAutoOrganizeLinks?.checked !== (transcriptionConfig.autoOrganizeLinks === true);
  }

  function contentProviderPresentation(providerId) {
    const profile = contentProfileFor(providerId);
    if (removeContentOnSave && providerId === llmProvider?.value && profile.configured) return { label: '待移除', state: 'warning' };
    if (providerId === llmProvider?.value && contentConnectionChanged()) return { label: '待保存', state: 'warning' };
    const active = profile.models.find((item) => item.name === profile.activeModel) || profile.models[0];
    return verificationPresentation(active?.verification, profile.configured);
  }

  function renderAIProviderNavigation() {
    const transcriptionPresentation = removeAsrOnSave && transcriptionConfig.configured
      ? { label: '待移除', state: 'warning' }
      : transcriptionConnectionChanged()
        ? { label: '待保存', state: 'warning' }
        : verificationPresentation(transcriptionConfig.transcriptionVerification, transcriptionConfig.configured);
    if (aiProviderTranscription) aiProviderTranscription.setAttribute('aria-selected', String(activeAIServicePanel === 'transcription'));
    if (aiTranscriptionNavStatus) {
      aiTranscriptionNavStatus.dataset.state = transcriptionPresentation.state;
      aiTranscriptionNavStatus.setAttribute('aria-label', transcriptionPresentation.label);
      aiTranscriptionNavStatus.title = transcriptionPresentation.label;
    }
    if (!aiContentProviderList) return;
    const providers = Array.isArray(transcriptionConfig.contentProviders) ? transcriptionConfig.contentProviders : [];
    aiContentProviderList.replaceChildren(...providers.map((provider) => {
      const profile = contentProfileFor(provider.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-provider-option';
      button.dataset.aiService = 'content';
      button.dataset.aiProvider = provider.id;
      button.dataset.activeProvider = String(provider.id === transcriptionConfig.llmProviderId);
      button.setAttribute('aria-selected', String(activeAIServicePanel === 'content' && llmProvider?.value === provider.id));
      const copy = document.createElement('span');
      const name = document.createElement('strong'); name.textContent = provider.label;
      const detail = document.createElement('small');
      detail.textContent = `${profile.models.length} 个模型 · ${profile.activeModel || '未命名'}`;
      const status = document.createElement('i');
      const presentation = contentProviderPresentation(provider.id);
      status.dataset.state = presentation.state;
      status.setAttribute('aria-label', presentation.label);
      status.title = presentation.label;
      copy.append(name, detail); button.append(copy, status);
      return button;
    }));
  }

  function renderContentProviderFields() {
    const provider = selectedContentProvider();
    if (!provider) return;
    const profile = contentProfileFor(provider.id);
    if (llmBaseUrlField) llmBaseUrlField.hidden = provider.endpointEditable !== true;
    if (llmBaseUrl) llmBaseUrl.placeholder = provider.endpointPlaceholder || 'https://服务地址/v1';
    if (llmApiHelp) llmApiHelp.hidden = !provider.keyUrl;
    if (llmApiHelpLabel) llmApiHelpLabel.textContent = `前往 ${provider.label} 管理 API Key`;
    if (llmApiKey) llmApiKey.placeholder = profile.configured
      ? '已配置，留空表示不更换'
      : `请输入 ${provider.label} API Key`;
    if (aiContentProviderTitle) aiContentProviderTitle.textContent = provider.label;
    if (aiContentProviderDescription) {
      aiContentProviderDescription.textContent = provider.id === 'custom-openai'
        ? '自定义公网 HTTPS 端点 · OpenAI-compatible'
        : `内容整理 · ${profile.models.length} 个模型 · 推荐 ${provider.defaultModel}`;
    }
    const credentialStatus = llmApiKey?.value.trim()
      ? { label: '待保存新密钥', state: 'warning' }
      : profile.credentialSource === 'environment'
        ? { label: '由环境变量提供', state: 'saved' }
        : profile.needsReentry
          ? { label: '需重新输入', state: 'error' }
          : profile.configured
            ? { label: '已安全保存', state: 'saved' }
            : { label: '未配置', state: 'empty' };
    setStatusPresentation(llmApiStatus, credentialStatus);
    setStatusPresentation(contentVerificationStatus, contentProviderPresentation(provider.id));
    if (contentProviderRemove) contentProviderRemove.disabled = !profile.saved && !profile.configured;
    if (aiSettingsReset) aiSettingsReset.disabled = !hasAISettingsChanges();
    renderAIProviderNavigation();
  }

  function populateContentProviders() {
    if (!llmProvider) return;
    const providers = Array.isArray(transcriptionConfig.contentProviders) ? transcriptionConfig.contentProviders : [];
    llmProvider.replaceChildren(...providers.map((provider) => {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.label;
      return option;
    }));
    llmProvider.value = providers.some((provider) => provider.id === transcriptionConfig.llmProviderId)
      ? transcriptionConfig.llmProviderId : providers[0]?.id || 'deepseek';
  }

  function updateTranscriptionConfigUi() {
    const statuses = Domain.apiCredentialStatuses(transcriptionConfig);
    const transcriptionCredentialStatus = transcriptionConfig.asrCredentialSource === 'environment'
      ? { label: '由环境变量提供', state: 'saved' }
      : statuses.transcription;
    setStatusPresentation(transcriptionApiStatus, transcriptionCredentialStatus);
    if (transcriptionRegion) transcriptionRegion.value = transcriptionConfig.region || 'beijing';
    if (transcriptionWorkspace) transcriptionWorkspace.value = transcriptionConfig.workspaceId || '';
    const transcriptionVerification = removeAsrOnSave && transcriptionConfig.configured
      ? { label: '待移除', state: 'warning' }
      : transcriptionConnectionChanged()
        ? { label: '待保存', state: 'warning' }
        : verificationPresentation(transcriptionConfig.transcriptionVerification, transcriptionConfig.configured);
    setStatusPresentation(transcriptionVerificationStatus, transcriptionVerification);
    populateContentProviders();
    const activeContentProfile = contentProfileFor(llmProvider?.value);
    if (llmBaseUrl) llmBaseUrl.value = activeContentProfile.baseUrl;
    if (llmTimeout) llmTimeout.value = String(activeContentProfile.timeoutMs || 30000);
    renderContentModels(activeContentProfile);
    renderContentProviderFields();
    if (aiAutoNameNotes) aiAutoNameNotes.checked = transcriptionConfig.autoNameNotes === true;
    if (aiAutoNameRecordings) aiAutoNameRecordings.checked = transcriptionConfig.autoNameRecordings === true;
    if (aiAutoOrganizeLinks) aiAutoOrganizeLinks.checked = transcriptionConfig.autoOrganizeLinks === true;
    if (settingsAiMigration) settingsAiMigration.hidden = transcriptionConfig.aiMigrationNoticePending !== true;
    if (transcriptionProviderRemove) transcriptionProviderRemove.disabled = !transcriptionConfig.configured || removeAsrOnSave;
    if (aiSettingsReset) aiSettingsReset.disabled = !hasAISettingsChanges();
    renderAIProviderNavigation();
  }

  function diagnosticText(items) {
    return items.map((item) => `${item.at} | ${item.action} | ${item.provider} | ${item.model || '-'} | ${item.status}${item.error ? `:${item.error}` : ''} | wait:${item.queueWaitMs || 0}ms run:${item.durationMs}ms | in:${item.usage?.inputTokens || 0} out:${item.usage?.outputTokens || 0} | ${item.promptVersion || '-'}`).join('\n');
  }

  async function renderAIDiagnostics() {
    if (!aiDiagnostics) return;
    const result = await window.notchAPI?.getAIDiagnostics?.().catch(() => ({ ok: false }));
    const items = result?.ok && Array.isArray(result.items) ? result.items.slice().reverse() : [];
    aiDiagnostics.replaceChildren();
    aiDiagnostics.dataset.copyText = '';
    if (!items.length) { const empty = document.createElement('p'); empty.textContent = result?.ok ? '暂无请求记录' : '无法读取请求诊断'; aiDiagnostics.append(empty); return; }
    items.forEach((item) => {
      const row = document.createElement('section'); row.className = 'ai-diagnostic-row';
      const name = document.createElement('strong'); name.textContent = `${item.action} · ${item.status}`;
      const time = document.createElement('time'); time.textContent = new Date(item.at).toLocaleString();
      const detail = document.createElement('span'); detail.textContent = `${item.provider} · ${item.model || '未记录模型'} · 等待 ${item.queueWaitMs || 0}ms · 请求 ${item.durationMs}ms${item.error ? ` · ${item.error}` : ''}`;
      row.append(name, time, detail); aiDiagnostics.append(row);
    });
    aiDiagnostics.dataset.copyText = diagnosticText(items.slice().reverse());
  }

  function setSettingsNote(message, error = false) {
    if (!settingsInlineNote) return;
    settingsInlineNote.textContent = message || '';
    settingsInlineNote.classList.toggle('error', error);
  }

  function showAISettingsDirtyNote() {
    if (!aiSettingsDirty || !transcriptionSettingsNote) return;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = '有未保存的 AI 配置更改。';
  }

  function renderSettingsPanel() {
    const summary = Domain.settingsSummary({
      appSettings: settingsAppSettings,
      workspace: settingsWorkspace,
      transcription: transcriptionConfig,
    });
    if (settingsShortcutValue) settingsShortcutValue.textContent = summary.shortcut;
    if (settingsDefaultTab) {
      const visibleTabs = new Set(Domain.visiblePanelTabs(
        ['home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'],
        settingsAppSettings?.features
      ));
      Array.from(settingsDefaultTab.options).forEach((option) => {
        const visible = visibleTabs.has(option.value);
        option.hidden = !visible;
        option.disabled = !visible;
      });
      settingsDefaultTab.value = visibleTabs.has(summary.defaultTab) ? summary.defaultTab : 'home';
    }
    if (settingsWorkspaceKind) settingsWorkspaceKind.textContent = summary.workspaceLabel;
    if (settingsWorkspacePath) {
      settingsWorkspacePath.textContent = summary.workspacePath || '默认数据目录';
      settingsWorkspacePath.title = summary.workspacePath || '';
    }
    if (settingsAutoLaunch) settingsAutoLaunch.checked = summary.autoLaunch;
    settingsFeatureList?.querySelectorAll('input[data-settings-feature]').forEach((input) => {
      input.checked = settingsAppSettings?.features?.[input.dataset.settingsFeature] !== false;
    });
    renderHomeModuleSettings();
  }

  function renderHomeModuleSettings() {
    const state = window.NotchHome?.getVisibility?.();
    const hidden = new Set(state?.hiddenIds || []);
    const recordingActive = window.NotchWorkspace?.isRecordingActive?.() ?? isRecordingActive();
    settingsHomeModuleList?.querySelectorAll('input[data-settings-home-module]').forEach((input) => {
      const moduleId = input.dataset.settingsHomeModule;
      const unavailable = state?.unavailableIds?.includes(moduleId) === true;
      input.closest('label').hidden = unavailable;
      input.checked = !hidden.has(moduleId);
      input.disabled = unavailable || state?.readOnly === true
        || (moduleId === 'recorder' && recordingActive && input.checked);
    });
    const recorderNote = settingsHomeModuleList?.querySelector('[data-home-module-setting-note="recorder"]');
    if (recorderNote) recorderNote.textContent = recordingActive ? '录音进行中' : '录音与转写';
    const status = document.getElementById('settings-home-module-status');
    if (status) {
      status.textContent = state?.readOnly
        ? '安全模式 · 暂不可修改'
        : state?.persisted === false
          ? '仅当前会话 · 未能保存'
          : '隐藏后自动填充 · 至少保留一个';
      status.dataset.state = state?.readOnly || state?.persisted === false ? 'warning' : 'saved';
    }
  }

  async function refreshSettingsPanel() {
    if (!window.notchAPI) return;
    const [appSettings, workspace, config] = await Promise.all([
      window.notchAPI.getAppSettings?.().catch(() => null),
      window.notchAPI.getWorkspace?.().catch(() => null),
      window.notchAPI.getTranscriptionConfig?.().catch(() => null),
    ]);
    if (appSettings) settingsAppSettings = appSettings;
    if (workspace) settingsWorkspace = workspace;
    if (config) {
      transcriptionConfig = config;
      updateTranscriptionConfigUi();
      updateRecordingUi();
    }
    renderSettingsPanel();
  }

  async function loadTranscriptionConfig() {
    if (!window.notchAPI || typeof window.notchAPI.getTranscriptionConfig !== 'function') return;
    try {
      const config = await window.notchAPI.getTranscriptionConfig();
      if (config) transcriptionConfig = config;
    } catch (error) {}
    window.NotchAISettings = { ...transcriptionConfig };
    updateTranscriptionConfigUi();
    updateRecordingUi();
    renderSettingsPanel();
  }

  function selectAIServicePanel(slot, focus = false) {
    activeAIServicePanel = slot === 'transcription' ? 'transcription' : 'content';
    const transcriptionActive = activeAIServicePanel === 'transcription';
    if (aiServicePanelTranscription) aiServicePanelTranscription.hidden = !transcriptionActive;
    if (aiServicePanelContent) aiServicePanelContent.hidden = transcriptionActive;
    if (aiContentSettingsSecondary) aiContentSettingsSecondary.hidden = transcriptionActive;
    renderAIProviderNavigation();
    if (!focus) return;
    const target = transcriptionActive
      ? aiProviderTranscription
      : aiContentProviderList?.querySelector(`[data-ai-provider="${CSS.escape(llmProvider?.value || '')}"]`);
    target?.focus();
  }

  async function openTranscriptionSettings(slot = 'content') {
    if (!document.getElementById('app')?.classList.contains('expanded')) await setMode(true);
    if (window.NotchPanel?.navigate) await window.NotchPanel.navigate({ tab: 'settings' });
    else document.querySelector('[data-tab="settings"]')?.click();
    window.NotchSettings?.select('api');
    transcriptionSettingsNote?.classList.remove('error', 'success');
    if (transcriptionSettingsNote && !aiSettingsDirty) {
      transcriptionSettingsNote.textContent = transcriptionConfig.asrNeedsReentry || transcriptionConfig.llmNeedsReentry
        ? '检测到无法解密的旧密钥，请在对应服务中重新输入。'
        : '已配置的 API Key 可留空；新输入的密钥会覆盖旧值。';
    }
    selectAIServicePanel(slot);
    void renderAIDiagnostics();
    setTimeout(() => {
      if (slot === 'transcription') aiProviderTranscription?.focus();
      else aiContentProviderList?.querySelector('[aria-selected="true"]')?.focus();
    }, 0);
  }

  async function saveTranscriptionSettings() {
    if (!window.notchAPI || !transcriptionSettingsSave) return;
    const provider = selectedContentProvider();
    const llmModels = currentContentModels();
    const normalizedModels = llmModels.map((model) => model.replace(/\s+/g, ' ').trim());
    if (!removeContentOnSave && (!provider || !normalizedModels.length || normalizedModels.some((model) => !model))) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '每个模型都需要填写有效名称。';
      selectAIServicePanel('content');
      llmModelList?.querySelector('input[value=""]')?.focus();
      return;
    }
    if (!removeContentOnSave && new Set(normalizedModels).size !== normalizedModels.length) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '同一厂商下不能添加重名模型。';
      selectAIServicePanel('content');
      return;
    }
    if (!removeContentOnSave && provider.endpointEditable && !llmBaseUrl?.value.trim()) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '请填写该厂商的 Base URL。';
      selectAIServicePanel('content');
      return;
    }
    transcriptionSettingsSave.disabled = true;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = '正在安全保存…';
    let result;
    try {
      result = await window.notchAPI.setTranscriptionConfig({
        apiKey: transcriptionApiKey.value,
        removeAsr: removeAsrOnSave,
        region: transcriptionRegion.value,
        workspaceId: transcriptionWorkspace.value,
        llmApiKey: llmApiKey.value,
        removeContent: removeContentOnSave,
        llmProviderId: llmProvider.value,
        llmBaseUrl: llmBaseUrl.value,
        llmModel: llmModel.value,
        llmModels: normalizedModels,
        llmTimeoutMs: Number(llmTimeout?.value) || 30000,
        autoNameNotes: aiAutoNameNotes?.checked === true,
        autoNameRecordings: aiAutoNameRecordings?.checked === true,
        autoOrganizeLinks: aiAutoOrganizeLinks?.checked === true,
      });
    } catch (error) {
      result = { ok: false, error: 'save_failed' };
    }
    transcriptionSettingsSave.disabled = false;
    if (!result || !result.ok) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = result && result.error === 'invalid_workspace'
        ? 'Workspace ID 格式不正确。'
        : result && result.error === 'invalid_provider'
          ? '不支持所选 AI 厂商。'
          : result && result.error === 'invalid_llm_url'
            ? '内容整理 Base URL 必须是有效的 HTTPS 地址。'
            : result && ['invalid_model', 'invalid_model_count'].includes(result.error)
              ? '请添加 1 至 12 个有效模型。'
              : result && result.error === 'duplicate_model'
                ? '同一厂商下不能添加重名模型。'
              : result && result.error === 'secure_storage_unavailable'
                ? '当前系统安全存储不可用，可改用环境变量提供 API Key。'
                : '配置保存失败，请重试。';
      return;
    }
    transcriptionConfig = result;
    window.NotchAISettings = { ...transcriptionConfig };
    window.dispatchEvent(new CustomEvent('notch:ai-settings-changed'));
    removeAsrOnSave = false;
    removeContentOnSave = false;
    aiSettingsDirty = false;
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    transcriptionSettingsNote.classList.remove('error');
    transcriptionSettingsNote.classList.add('success');
    transcriptionSettingsNote.textContent = '配置已安全保存。新配置需要单独验证后才会显示为已验证。';
    transcriptionSettingsSave.textContent = '已保存';
    setTimeout(() => {
      if (transcriptionSettingsSave) transcriptionSettingsSave.textContent = '保存更改';
    }, 1200);
    if (
      transcriptionConfig.configured
      && ['recording', 'paused'].includes(recordingStatus)
      && !transcriptionStartPromise
    ) {
      stopSpeechRecognition();
      transcriptionStatus = 'idle';
      transcriptionStartPromise = startCloudTranscription();
    }
    updateRecordingUi();
    renderSettingsPanel();
  }

  function persistRecordings() {
    return saveJson(RECORDINGS_KEY, recordings.filter((recording) => !recording.isDraft));
  }

  function currentDuration() {
    return Domain.calculateRecordingDuration({
      startedAt: recordingStartedAt,
      status: recordingStatus,
      pausedAt,
      pausedTotalMs,
      now: Date.now(),
    });
  }

  function activeRecordingDraft() {
    return recordingDraftId && recordings.find((recording) => recording.id === recordingDraftId) || null;
  }

  function currentRecordingText() {
    return `${recordingTranscript} ${interimTranscript}`.trim();
  }

  function currentRecordingFeedback() {
    if (recordingStartTask.isPending()) return '等待确认麦克风权限…';
    if (recordingCaptureIssue) return recordingCaptureIssue;
    if (recordingStatus === 'saving') return '正在保存录音…';
    if (transcriptionConfig.asrNeedsReentry) return '转写密钥已失效 · 请重新配置 API Key';
    if (transcriptionStatus === 'browser-error') return '未配置转写 API · 音频仍在录制';
    if (transcriptionStatus === 'error') return '转写连接失败 · 音频仍在录制';
    if (transcriptionStatus === 'connecting') return '正在连接转写服务';
    if (recordingStatus === 'paused') return '录音已暂停';
    if (!transcriptionConfig.configured && !currentRecordingText()) return '未配置转写 API · 音频仍会保存在本机';
    return '正在录音';
  }

  function beginRecordingDraft() {
    recordingDraftId = uid('recording');
    const draft = {
      ...Domain.createRecording({
        id: recordingDraftId,
        createdAt: recordingStartedAt,
        durationMs: 0,
        transcript: '',
      }),
      isDraft: true,
    };
    recordings.unshift(draft);
    selectedRecordingId = draft.id;
    recordingSelectionAnchor = draft.id;
    renderRecordings();
  }

  function discardRecordingDraft() {
    if (!recordingDraftId) return;
    recordings = recordings.filter((recording) => recording.id !== recordingDraftId);
    recordingSelection.delete(recordingDraftId);
    selectedRecordingId = recordings[0]?.id || '';
    recordingSelectionAnchor = selectedRecordingId || null;
    recordingDraftId = '';
    renderRecordings();
  }

  function syncRecordingDraftUi() {
    const draft = activeRecordingDraft();
    if (!draft) return;
    const durationMs = recordingStopDurationMs || currentDuration();
    const text = currentRecordingText();
    draft.durationMs = durationMs;
    draft.transcript = recordingTranscript;
    const row = recordingList?.querySelector(`.recording-item[data-id="${CSS.escape(draft.id)}"]`);
    const preview = row?.querySelector('[data-recording-preview]');
    const meta = row?.querySelector('[data-recording-meta]');
    if (preview) preview.textContent = text || currentRecordingFeedback();
    if (meta) meta.textContent = `${recordingStatus === 'saving' ? '保存中' : recordingStatus === 'paused' ? '已暂停' : '录音中'} · ${formatClock(durationMs)}`;
    if (selectedRecordingId !== draft.id) return;
    const detailState = recordingDetail?.querySelector('[data-recording-live-state]');
    const detailDot = recordingDetail?.querySelector('[data-recording-live-dot]');
    const detailTime = recordingDetail?.querySelector('[data-recording-live-time]');
    const detailTranscript = recordingDetail?.querySelector('[data-recording-live-transcript]');
    const detailFeedback = recordingDetail?.querySelector('[data-recording-live-feedback]');
    const detailConfigure = recordingDetail?.querySelector('[data-action="configure-transcription"]');
    const detailPause = recordingDetail?.querySelector('.recording-live-pause');
    const detailStop = recordingDetail?.querySelector('.recording-live-stop');
    if (detailState) detailState.textContent = recordingStatus === 'saving' ? '正在保存' : recordingStatus === 'paused' ? '已暂停' : '正在录音';
    if (detailDot) detailDot.dataset.state = recordingStatus;
    if (detailTime) detailTime.textContent = formatClock(durationMs);
    if (detailTranscript && detailTranscript.value !== text) detailTranscript.value = text;
    if (detailFeedback) detailFeedback.textContent = text ? '转写内容会随录音实时更新' : currentRecordingFeedback();
    if (detailConfigure) detailConfigure.hidden = transcriptionConfig.configured && !transcriptionConfig.asrNeedsReentry;
    if (detailPause) {
      detailPause.textContent = recordingStatus === 'paused' ? '继续' : '暂停';
      detailPause.disabled = recordingStatus === 'saving';
    }
    if (detailStop) detailStop.disabled = recordingStatus === 'saving';
  }

  function stopTranscriptionAudioPipeline() {
    if (transcriptionAudioProcessor) {
      transcriptionAudioProcessor.onaudioprocess = null;
      try { transcriptionAudioProcessor.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioSource) {
      try { transcriptionAudioSource.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioMute) {
      try { transcriptionAudioMute.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioContext) transcriptionAudioContext.close().catch(() => {});
    transcriptionAudioContext = null;
    transcriptionAudioSource = null;
    transcriptionAudioProcessor = null;
    transcriptionAudioMute = null;
    transcriptionPcmQueue = [];
  }

  function sendTranscriptionPcm(buffer) {
    if (!buffer || !buffer.byteLength || !window.notchAPI) return;
    if (transcriptionStatus === 'connected') {
      window.notchAPI.sendTranscriptionAudio(buffer);
      return;
    }
    if (transcriptionStatus === 'connecting') {
      transcriptionPcmQueue.push(buffer);
      if (transcriptionPcmQueue.length > 60) transcriptionPcmQueue.shift();
    }
  }

  function startTranscriptionAudioPipeline(stream) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream) return false;
    try {
      transcriptionAudioContext = new AudioContext({ sampleRate: 16000 });
      transcriptionAudioSource = transcriptionAudioContext.createMediaStreamSource(stream);
      transcriptionAudioProcessor = transcriptionAudioContext.createScriptProcessor(4096, 1, 1);
      transcriptionAudioMute = transcriptionAudioContext.createGain();
      transcriptionAudioMute.gain.value = 0;
      transcriptionAudioProcessor.onaudioprocess = (event) => {
        if (recordingStatus !== 'recording') return;
        const source = event.inputBuffer.getChannelData(0);
        const pcm = Domain.resampleFloat32ToPcm16(source, transcriptionAudioContext.sampleRate, 16000);
        sendTranscriptionPcm(pcm.buffer);
      };
      transcriptionAudioSource.connect(transcriptionAudioProcessor);
      transcriptionAudioProcessor.connect(transcriptionAudioMute);
      transcriptionAudioMute.connect(transcriptionAudioContext.destination);
      return true;
    } catch (error) {
      stopTranscriptionAudioPipeline();
      return false;
    }
  }

  async function startCloudTranscription() {
    if (!transcriptionConfig.configured || !window.notchAPI || !mediaStream) return { ok: false, error: 'not_configured' };
    transcriptionStatus = 'connecting';
    transcriptionPcmQueue = [];
    startTranscriptionAudioPipeline(mediaStream);
    updateRecordingUi();
    let result;
    try {
      result = await window.notchAPI.startTranscription();
    } catch (error) {
      result = { ok: false, error: 'connection_failed' };
    }
    if (!result || !result.ok) {
      transcriptionStatus = 'error';
      stopTranscriptionAudioPipeline();
      updateRecordingUi();
      return result || { ok: false };
    }
    transcriptionStatus = 'connected';
    const queued = transcriptionPcmQueue;
    transcriptionPcmQueue = [];
    queued.forEach((buffer) => window.notchAPI.sendTranscriptionAudio(buffer));
    updateRecordingUi();
    return result;
  }

  async function finishCloudTranscription() {
    if (!transcriptionStartPromise) return { ok: false, error: 'not_active', transcript: recordingTranscript };
    stopTranscriptionAudioPipeline();
    await transcriptionStartPromise;
    transcriptionStartPromise = null;
    if (transcriptionStatus !== 'connected') return { ok: false, error: 'not_connected', transcript: recordingTranscript };
    transcriptionStatus = 'finishing';
    updateRecordingUi();
    let result;
    try {
      result = await window.notchAPI.finishTranscription();
    } catch (error) {
      result = { ok: false, error: 'finish_failed', transcript: recordingTranscript };
    }
    if (result && result.transcript) recordingTranscript = result.transcript;
    transcriptionStatus = result && result.ok ? 'idle' : 'error';
    interimTranscript = '';
    updateRecordingUi();
    return result;
  }

  if (window.notchAPI && typeof window.notchAPI.onTranscriptionEvent === 'function') {
    window.notchAPI.onTranscriptionEvent((event) => {
      if (!event || !['recording', 'paused', 'saving'].includes(recordingStatus)) return;
      if (event.type === 'transcript') {
        recordingTranscript = String(event.final || '').trim();
        interimTranscript = String(event.interim || '').trim();
      } else if (event.type === 'error') {
        transcriptionStatus = 'error';
      }
      updateRecordingUi();
    });
  }

  function updateRecordingUi() {
    const recordingActive = isRecordingActive();
    const recordingBusy = isRecordingBusy();
    const visualState = recordingStartTask.isPending() ? 'requesting' : recordingStatus;
    if (homeRecorder) homeRecorder.dataset.state = visualState;
    if (recordingDot) recordingDot.dataset.state = visualState;
    if (recordingStateLabel) {
      recordingStateLabel.textContent = recordingStartTask.isPending()
        ? '等待录音权限'
        : recordingStatus === 'recording'
        ? '正在录音'
        : recordingStatus === 'paused'
          ? '已暂停'
          : recordingStatus === 'saving'
            ? '正在保存'
            : '快速录音';
    }
    if (recordingTime) recordingTime.textContent = formatClock(recordingActive ? currentDuration() : 0);
    if (recordStart) recordStart.disabled = recordingBusy;
    if (recordPause) {
      recordPause.disabled = !['recording', 'paused'].includes(recordingStatus);
      recordPause.setAttribute('aria-label', recordingStatus === 'paused' ? '继续录音' : '暂停录音');
      recordPause.classList.toggle('resume', recordingStatus === 'paused');
    }
    if (recordStop) recordStop.disabled = !['recording', 'paused'].includes(recordingStatus);
    if (recordingNew) {
      recordingNew.disabled = recordingBusy;
      recordingNew.textContent = recordingBusy ? '录制' : '录音';
      recordingNew.setAttribute('aria-label', recordingStartTask.isPending()
        ? '正在请求麦克风权限'
        : recordingActive ? '录音进行中' : '开始录音');
    }
    if (liveTranscript && recordingBusy) {
      const text = currentRecordingText();
      // asrNeedsReentry = 密文还在但当前应用解不开它。safeStorage 的密钥存在钥匙串里、
      // ACL 绑代码签名，所以开发版存的 Key 装成 DMG 后就读不出来（ad-hoc 签名每次打包
      // 都会换 cdhash，也是同样的结果）。这种情况下录音正常、只有转写不工作，
      // 原来只在设置面板里提示一行，录音的人看不到，表现就是「能录但不转写」。
      const fallback = currentRecordingFeedback();
      liveTranscript.textContent = text || fallback;
      liveTranscript.hidden = !(text || fallback);
    }
    syncRecordingDraftUi();
    renderHomeModuleSettings();
    document.dispatchEvent(new CustomEvent('notch:recording-state-changed', {
      detail: { active: recordingBusy },
    }));
  }

  function stopSpeechRecognition() {
    const recognition = speechRecognition;
    speechRecognition = null;
    if (recognition) {
      try { recognition.stop(); } catch (error) {}
    }
    interimTranscript = '';
  }

  function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      transcriptionStatus = 'browser-error';
      updateRecordingUi();
      return;
    }
    if (speechRecognitionBlocked || recordingStatus !== 'recording') return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      interimTranscript = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const text = String(event.results[index][0] && event.results[index][0].transcript || '').trim();
        if (!text) continue;
        if (event.results[index].isFinal) {
          recordingTranscript = `${recordingTranscript} ${text}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }
      updateRecordingUi();
    };
    recognition.onerror = (event) => {
      interimTranscript = '';
      speechRecognitionError = String(event && event.error || 'unknown');
      if (['network', 'not-allowed', 'service-not-allowed', 'audio-capture'].includes(speechRecognitionError)) {
        speechRecognitionBlocked = true;
        transcriptionStatus = 'browser-error';
      }
      updateRecordingUi();
    };
    recognition.onend = () => {
      if (speechRecognition !== recognition) return;
      speechRecognition = null;
      if (recordingStatus === 'recording' && !speechRecognitionBlocked) setTimeout(startSpeechRecognition, 180);
    };
    speechRecognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      speechRecognition = null;
    }
  }

  function stopMediaTracks() {
    stopRecordingStrands();
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  function chooseRecordingMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
  }

  async function finalizeRecording(blob, durationMs) {
    recordingStatus = 'saving';
    updateRecordingUi();
    if (!blob || blob.size === 0) {
      recordingStatus = 'idle';
      recordingCaptureIssue = '';
      discardRecordingDraft();
      if (liveTranscript) {
        liveTranscript.textContent = '录音为空 · 请检查麦克风输入';
        liveTranscript.hidden = false;
      }
      updateRecordingUi();
      return;
    }
    let saved;
    try {
      saved = window.notchAPI && await window.notchAPI.saveRecording({
        bytes: await blob.arrayBuffer(),
        mimeType: blob.type || 'audio/webm',
      });
    } catch (error) {
      saved = null;
    }
    if (saved && saved.ok) {
      const draft = activeRecordingDraft();
      const recording = Domain.createRecording({
        id: draft?.id || uid('recording'),
        createdAt: draft?.createdAt || Date.now(),
        durationMs,
        transcript: recordingTranscript,
        audioPath: saved.audioPath,
        mimeType: saved.mimeType || blob.type,
      });
      const draftIndex = recordings.findIndex((item) => item.id === recording.id);
      if (draftIndex >= 0) recordings.splice(draftIndex, 1, recording);
      else recordings.unshift(recording);
      recordingDraftId = '';
      selectedRecordingId = recording.id;
      persistRecordings();
      renderRecordings();
      if (recording.transcript && transcriptionConfig.autoNameRecordings === true && window.notchAPI?.organizeMaterial) {
        const expectedTitle = recording.title;
        const expectedCategory = recording.category;
        const expectedTranscript = recording.transcript;
        window.notchAPI.organizeMaterial({ kind: 'recording', sourceId: recording.id, text: expectedTranscript }).then((metadata) => {
          const target = recordings.find((item) => item.id === recording.id);
          if (!target || target.title !== expectedTitle || target.category !== expectedCategory || target.transcript !== expectedTranscript || !metadata || !metadata.ok) return;
          target.title = metadata.title || target.title;
          target.category = metadata.category || target.category;
          persistRecordings();
          renderRecordings();
        }).catch(() => {});
      }
      if (liveTranscript) {
        liveTranscript.textContent = recording.transcript || (transcriptionConfig.configured
          ? '录音已保存 · 暂无转写'
          : '录音已保存 · 请配置转写 API');
        liveTranscript.hidden = false;
      }
    } else {
      discardRecordingDraft();
      if (liveTranscript) {
        liveTranscript.textContent = '录音保存失败，请检查本机存储权限';
        liveTranscript.hidden = false;
      }
    }
    recordingStatus = 'idle';
    recordingStartedAt = 0;
    pausedAt = 0;
    pausedTotalMs = 0;
    audioChunks = [];
    recordingTranscript = '';
    interimTranscript = '';
    recordingCaptureIssue = '';
    updateRecordingUi();
  }

  async function startRecordingAttempt() {
    if (recordingStatus !== 'idle' || !navigator.mediaDevices || !window.MediaRecorder) return;
    try {
      if (window.notchAPI && !(await window.notchAPI.ensureMicrophone())) {
        if (liveTranscript) {
          liveTranscript.textContent = '无法访问麦克风 · 请在系统设置中授权';
          liveTranscript.hidden = false;
        }
        return;
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const audioTrack = mediaStream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== 'live') throw new Error('audio_track_unavailable');
      recordingCaptureIssue = '';
      audioTrack.addEventListener('mute', () => {
        if (!['recording', 'paused'].includes(recordingStatus)) return;
        recordingCaptureIssue = '麦克风无输入 · 请检查系统音源';
        updateRecordingUi();
      });
      audioTrack.addEventListener('unmute', () => {
        recordingCaptureIssue = '';
        updateRecordingUi();
      });
      startRecordingStrands(mediaStream);
      const mimeType = chooseRecordingMimeType();
      mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      audioChunks = [];
      recordingTranscript = '';
      interimTranscript = '';
      speechRecognitionBlocked = false;
      speechRecognitionError = '';
      recordingStartedAt = Date.now();
      recordingStopDurationMs = 0;
      pausedTotalMs = 0;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size) audioChunks.push(event.data);
      };
      mediaRecorder.onerror = () => {
        recordingCaptureIssue = '录音中断 · 请重新开始';
        updateRecordingUi();
      };
      mediaRecorder.onstop = async () => {
        const durationMs = recordingStopDurationMs || currentDuration();
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || mimeType || 'audio/webm' });
        stopMediaTracks();
        if (transcriptionFinishPromise) {
          await transcriptionFinishPromise;
          transcriptionFinishPromise = null;
        }
        finalizeRecording(blob, durationMs);
      };
      mediaRecorder.start(1000);
      recordingStatus = 'recording';
      transcriptionStatus = 'idle';
      transcriptionStartPromise = null;
      transcriptionFinishPromise = null;
      beginRecordingDraft();
      if (transcriptionConfig.configured) {
        transcriptionStartPromise = startCloudTranscription();
      } else {
        startSpeechRecognition();
      }
      clearInterval(recordingTimer);
      recordingTimer = setInterval(updateRecordingUi, 500);
      updateRecordingUi();
    } catch (error) {
      stopMediaTracks();
      recordingStatus = 'idle';
      recordingCaptureIssue = '';
      discardRecordingDraft();
      if (liveTranscript) {
        liveTranscript.textContent = '无法开始录音 · 请检查麦克风权限';
        liveTranscript.hidden = false;
      }
      updateRecordingUi();
    }
  }

  function startRecording() {
    return recordingStartTask.run(startRecordingAttempt);
  }

  function togglePauseRecording() {
    if (!mediaRecorder) return;
    if (recordingStatus === 'recording') {
      mediaRecorder.pause();
      pausedAt = Date.now();
      recordingStatus = 'paused';
      if (!transcriptionConfig.configured) stopSpeechRecognition();
    } else if (recordingStatus === 'paused') {
      pausedTotalMs += Date.now() - pausedAt;
      pausedAt = 0;
      mediaRecorder.resume();
      recordingStatus = 'recording';
      if (!transcriptionConfig.configured) startSpeechRecognition();
    }
    updateRecordingUi();
  }

  function stopRecording() {
    if (!mediaRecorder || !['recording', 'paused'].includes(recordingStatus)) return;
    recordingStopDurationMs = currentDuration();
    recordingStatus = 'saving';
    stopSpeechRecognition();
    transcriptionFinishPromise = transcriptionStartPromise
      ? finishCloudTranscription()
      : Promise.resolve({ ok: false, error: 'not_active', transcript: recordingTranscript });
    clearInterval(recordingTimer);
    recordingTimer = null;
    updateRecordingUi();
    try {
      mediaRecorder.stop();
    } catch (error) {
      stopMediaTracks();
      recordingStatus = 'idle';
      discardRecordingDraft();
      updateRecordingUi();
    }
  }

  if (recordStart) recordStart.addEventListener('click', startRecording);
  if (recordPause) recordPause.addEventListener('click', togglePauseRecording);
  if (recordStop) recordStop.addEventListener('click', stopRecording);
  if (recordingNew) recordingNew.addEventListener('click', startRecording);
  if (recordingConfigure) recordingConfigure.addEventListener('click', () => { void openTranscriptionSettings('transcription'); });
  if (transcriptionSettingsSave) transcriptionSettingsSave.addEventListener('click', saveTranscriptionSettings);
  aiProviderTranscription?.addEventListener('click', () => selectAIServicePanel('transcription'));
  aiContentProviderList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-provider]');
    if (!button || !llmProvider) return;
    const providerId = button.dataset.aiProvider;
    if (llmProvider.value === providerId) selectAIServicePanel('content');
    else {
      if (contentProfileFieldsChanged()) {
        transcriptionSettingsNote.classList.add('error');
        transcriptionSettingsNote.textContent = '当前厂商有未保存的配置，请先保存或撤销更改。';
        return;
      }
      llmProvider.value = providerId;
      llmProvider.dispatchEvent(new Event('change', { bubbles: true }));
    }
    aiContentProviderList.querySelector(`[data-ai-provider="${CSS.escape(providerId)}"]`)?.focus();
  });
  document.querySelector('.ai-provider-sidebar')?.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const options = [...document.querySelectorAll('.ai-provider-sidebar .ai-provider-option')];
    const index = options.indexOf(document.activeElement);
    if (index < 0 || !options.length) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
    options[next].click();
  });
  llmProvider?.addEventListener('change', () => {
    const provider = selectedContentProvider();
    if (!provider) return;
    const profile = contentProfileFor(provider.id);
    if (llmBaseUrl) llmBaseUrl.value = profile.baseUrl;
    if (llmTimeout) llmTimeout.value = String(profile.timeoutMs || 30000);
    if (llmApiKey) llmApiKey.value = '';
    removeContentOnSave = false;
    renderContentModels(profile);
    aiSettingsDirty = hasAISettingsChanges();
    selectAIServicePanel('content');
    if (aiProviderConfigBody) aiProviderConfigBody.scrollTop = 0;
    renderContentProviderFields();
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = profile.configured
      ? `${provider.label} 已保存 ${profile.models.length} 个模型；保存可将所选模型设为全局默认。`
      : `${provider.label} 尚未配置；添加模型和 API Key 后保存。`;
  });
  llmModelAdd?.addEventListener('click', () => {
    const models = currentContentModels();
    if (models.length >= 12) return;
    renderContentModels(contentModelDraft([...models, ''], llmModel?.value));
    aiSettingsDirty = hasAISettingsChanges();
    if (aiSettingsReset) aiSettingsReset.disabled = !aiSettingsDirty;
    showAISettingsDirtyNote();
    renderContentProviderFields();
    [...(llmModelList?.querySelectorAll('[data-ai-model-name]') || [])].at(-1)?.focus();
  });
  llmModelList?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-ai-model-remove]');
    if (!remove) return;
    const index = Number(remove.dataset.aiModelRemove);
    const models = currentContentModels();
    if (models.length <= 1 || !Number.isInteger(index) || index < 0 || index >= models.length) return;
    const removed = models.splice(index, 1)[0];
    const activeModel = llmModel?.value === removed ? models[0] : llmModel?.value;
    renderContentModels(contentModelDraft(models, activeModel));
    aiSettingsDirty = hasAISettingsChanges();
    if (aiSettingsReset) aiSettingsReset.disabled = !aiSettingsDirty;
    showAISettingsDirtyNote();
    renderContentProviderFields();
  });
  llmModelList?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-ai-model-name]');
    if (!input) return;
    const row = input.closest('.ai-model-row');
    if (row?.querySelector('[data-ai-model-active]')?.checked && llmModel) llmModel.value = input.value;
  });
  llmModelList?.addEventListener('change', (event) => {
    const radio = event.target.closest('[data-ai-model-active]');
    if (!radio || !llmModel) return;
    llmModel.value = radio.closest('.ai-model-row')?.querySelector('[data-ai-model-name]')?.value || '';
  });
  aiSettingsReset?.addEventListener('click', () => {
    removeAsrOnSave = false;
    removeContentOnSave = false;
    aiSettingsDirty = false;
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = '未保存的更改已撤销。';
  });
  aiSettingsRoot?.addEventListener('input', (event) => {
    if (!event.target.closest('.ai-service-panel, .ai-auto-settings')) return;
    if (event.target === transcriptionApiKey) {
      removeAsrOnSave = false;
      if (transcriptionProviderRemove) transcriptionProviderRemove.disabled = !transcriptionConfig.configured;
    }
    if (event.target === llmApiKey) {
      removeContentOnSave = false;
      if (contentProviderRemove) {
        const profile = contentProfileFor(llmProvider?.value);
        contentProviderRemove.disabled = !profile.saved && !profile.configured;
      }
    }
    aiSettingsDirty = hasAISettingsChanges();
    if (aiSettingsReset) aiSettingsReset.disabled = !aiSettingsDirty;
    showAISettingsDirtyNote();
    if (event.target.closest('#ai-service-panel-content')) renderContentProviderFields();
    if (event.target.closest('#ai-service-panel-transcription')) {
      setStatusPresentation(transcriptionVerificationStatus, { label: '待保存', state: 'warning' });
      renderAIProviderNavigation();
    }
  });
  aiSettingsRoot?.addEventListener('change', (event) => {
    if (!event.target.closest('.ai-service-panel, .ai-auto-settings')) return;
    aiSettingsDirty = hasAISettingsChanges();
    if (aiSettingsReset) aiSettingsReset.disabled = !aiSettingsDirty;
    showAISettingsDirtyNote();
    if (event.target.closest('#ai-service-panel-content')) renderContentProviderFields();
    if (event.target.closest('#ai-service-panel-transcription')) {
      setStatusPresentation(transcriptionVerificationStatus, transcriptionConnectionChanged()
        ? { label: '待保存', state: 'warning' }
        : verificationPresentation(transcriptionConfig.transcriptionVerification, transcriptionConfig.configured));
      renderAIProviderNavigation();
    }
  });
  transcriptionProviderRemove?.addEventListener('click', () => {
    removeAsrOnSave = true;
    aiSettingsDirty = hasAISettingsChanges();
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    transcriptionProviderRemove.disabled = true;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = transcriptionConfig.asrCredentialSource === 'environment'
      ? '保存后会移除本机转写密钥；环境变量仍会继续生效。'
      : '实时转写配置将在保存时移除。';
    setStatusPresentation(transcriptionVerificationStatus, { label: '待移除', state: 'warning' });
    if (aiSettingsReset) aiSettingsReset.disabled = false;
    renderAIProviderNavigation();
  });
  contentProviderRemove?.addEventListener('click', () => {
    removeContentOnSave = true;
    aiSettingsDirty = hasAISettingsChanges();
    if (llmApiKey) llmApiKey.value = '';
    contentProviderRemove.disabled = true;
    transcriptionSettingsNote.classList.remove('error', 'success');
    const profile = contentProfileFor(llmProvider?.value);
    transcriptionSettingsNote.textContent = profile.credentialSource === 'environment'
      ? '保存后会移除本机厂商密钥；环境变量仍会继续生效。'
      : '当前厂商配置将在保存时移除，其他厂商不受影响。';
    renderContentProviderFields();
  });
  settingsAiMigrationAck?.addEventListener('click', async () => {
    const result = await window.notchAPI?.acknowledgeAIMigration?.().catch(() => ({ ok: false }));
    if (!result?.ok) { setSettingsNote('无法保存迁移确认，请重试。', true); return; }
    transcriptionConfig = result; window.NotchAISettings = { ...transcriptionConfig }; updateTranscriptionConfigUi(); renderSettingsPanel();
  });
  aiDiagnosticsCopy?.addEventListener('click', async () => {
    const text = aiDiagnostics?.dataset.copyText || '';
    if (!text) { transcriptionSettingsNote.textContent = '暂无可复制的请求诊断。'; return; }
    const result = await window.notchAPI?.writeClipboard?.({ type: 'text', text }).catch(() => false);
    transcriptionSettingsNote.textContent = result === false || result?.ok === false ? '复制诊断失败。' : '已复制脱敏请求诊断。';
  });
  aiDiagnosticsClear?.addEventListener('click', async () => {
    const result = await window.notchAPI?.clearAIDiagnostics?.().catch(() => ({ ok: false }));
    transcriptionSettingsNote.textContent = result?.ok ? '已清空请求诊断。' : '清空请求诊断失败。';
    if (result?.ok) await renderAIDiagnostics();
  });
  async function testConfiguredProvider(slot, button) {
    const configured = slot === 'transcription' ? transcriptionConfig.configured : transcriptionConfig.llmConfigured;
    if (!configured || (slot === 'transcription' ? removeAsrOnSave : removeContentOnSave)) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '请先保存该服务的 API Key，再验证配置。';
      return;
    }
    const connectionChanged = slot === 'transcription' ? transcriptionConnectionChanged() : contentConnectionChanged();
    if (connectionChanged) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '当前服务有未保存的修改，请保存后再验证。';
      return;
    }
    button.disabled = true;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = slot === 'transcription'
      ? '正在验证实时转写连接，不会启动麦克风…'
      : '正在验证内容整理服务，可能产生少量 API 费用…';
    const result = await window.notchAPI?.testAIProvider?.(slot).catch(() => ({ ok: false, error: 'network_error' }));
    button.disabled = false;
    const refreshed = await window.notchAPI?.getTranscriptionConfig?.().catch(() => null);
    if (refreshed) {
      transcriptionConfig = refreshed;
      window.NotchAISettings = { ...transcriptionConfig };
      updateTranscriptionConfigUi();
      renderSettingsPanel();
    }
    transcriptionSettingsNote.classList.toggle('success', result?.ok === true);
    transcriptionSettingsNote.classList.toggle('error', result?.ok !== true);
    transcriptionSettingsNote.textContent = result?.ok
      ? slot === 'transcription'
        ? '实时转写连接已验证；测试过程未访问麦克风。'
        : '内容整理连接已验证，文本与结构化输出均可用。'
      : result?.error === 'structured_output_unsupported'
        ? `基础连接正常，但结构化输出不可用（${result.providerError || '格式不兼容'}）。`
        : `配置验证失败：${result?.error || '请检查配置'}`;
    if (slot === 'content') await renderAIDiagnostics();
  }
  aiProviderTest?.addEventListener('click', () => testConfiguredProvider('content', aiProviderTest));
  transcriptionProviderTest?.addEventListener('click', () => testConfiguredProvider('transcription', transcriptionProviderTest));
  if (transcriptionApiHelp) {
    transcriptionApiHelp.addEventListener('click', () => {
      window.notchAPI?.openExternal('https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key');
    });
  }
  if (llmApiHelp) {
    llmApiHelp.addEventListener('click', () => {
      const provider = selectedContentProvider();
      if (provider?.keyUrl) window.notchAPI?.openExternal(provider.keyUrl);
    });
  }
  if (window.notchAPI && typeof window.notchAPI.onOpenApiSettings === 'function') {
    window.notchAPI.onOpenApiSettings(() => { void openTranscriptionSettings(); });
  }
  window.addEventListener('notch:settings-category-change', (event) => {
    if (event.detail?.id !== 'api') return;
    renderAIProviderNavigation();
    void renderAIDiagnostics();
  });
  settingsFeatureList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-feature]');
    if (!input || !window.notchAPI?.setFeature) return;
    input.disabled = true;
    const result = await window.notchAPI.setFeature(input.dataset.settingsFeature, input.checked)
      .catch(() => ({ ok: false }));
    input.disabled = false;
    if (!result?.ok) {
      input.checked = !input.checked;
      setSettingsNote('功能显示设置保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote('显示功能已更新。');
  });
  settingsHomeModuleList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-home-module]');
    if (!input || !window.NotchHome?.setModuleVisible) return;
    input.disabled = true;
    const result = await window.NotchHome.setModuleVisible(
      input.dataset.settingsHomeModule,
      input.checked
    );
    renderHomeModuleSettings();
    if (!result?.ok) {
      const message = result?.error === 'at_least_one_required'
        ? '首页至少保留一个组件'
        : result?.error === 'recording_active'
          ? '录音进行中，暂时不能隐藏快速录音'
          : result?.error === 'layout_read_only'
            ? '首页布局已进入安全模式，本次会话不能修改组件'
            : result?.error === 'layout_invalid'
              ? '新布局校验失败，原布局已保留'
              : result?.error === 'dom_apply_failed'
                ? '布局应用失败，原布局已恢复'
                : '首页组件设置未更新';
      if (typeof showStatusToast === 'function') showStatusToast(message);
      return;
    }
    if (result.changed === false) return;
    const message = result.persisted === false
      ? '布局已更新，仅当前会话生效，设置未能保存'
      : input.checked ? '首页组件已恢复' : '首页组件已隐藏';
    if (typeof showStatusToast === 'function') showStatusToast(message);
  });
  settingsShortcutChange?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('notch:record-shortcut'));
  });
  settingsDefaultTab?.addEventListener('change', async () => {
    if (!window.notchAPI?.setDefaultTab) return;
    const previous = settingsAppSettings?.defaultTab || 'home';
    settingsDefaultTab.disabled = true;
    const result = await window.notchAPI.setDefaultTab(settingsDefaultTab.value).catch(() => ({ ok: false }));
    settingsDefaultTab.disabled = false;
    if (!result?.ok) {
      settingsDefaultTab.value = previous;
      setSettingsNote('默认展开页保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote(`下次唤出将默认显示${settingsDefaultTab.selectedOptions[0]?.textContent || '所选页面'}。`);
  });
  settingsWorkspaceOpen?.addEventListener('click', () => {
    window.notchAPI?.openWorkspace?.().catch(() => setSettingsNote('无法打开数据文件夹。', true));
  });
  settingsWorkspaceChoose?.addEventListener('click', async () => {
    const changed = await window.notchAPI?.chooseWorkspace?.().catch(() => false);
    if (!changed) return;
    settingsWorkspace = await window.notchAPI?.getWorkspace?.().catch(() => settingsWorkspace);
    renderSettingsPanel();
    setSettingsNote('数据文件夹已更新。');
  });
  settingsAutoLaunch?.addEventListener('change', async () => {
    if (!window.notchAPI?.setAutoLaunch) return;
    settingsAutoLaunch.disabled = true;
    const result = await window.notchAPI.setAutoLaunch(settingsAutoLaunch.checked).catch(() => ({ ok: false }));
    settingsAutoLaunch.disabled = false;
    if (!result?.ok) {
      settingsAutoLaunch.checked = !settingsAutoLaunch.checked;
      setSettingsNote('开机启动设置失败。', true);
      return;
    }
    settingsAutoLaunch.checked = result.autoLaunch === true;
    if (settingsAppSettings) settingsAppSettings.autoLaunch = result.autoLaunch === true;
    setSettingsNote(result.autoLaunch ? '已开启开机自动启动。' : '已关闭开机自动启动。');
  });
  window.notchAPI?.onAppSettingsChanged?.((settings) => {
    settingsAppSettings = settings;
    renderSettingsPanel();
  });
  window.notchAPI?.onWorkspaceChanged?.(() => refreshSettingsPanel());

  async function loadRecordingAudio(recording, container) {
    if (!window.notchAPI || !recording.audioPath) return;
    const result = await window.notchAPI.readRecording(recording.audioPath);
    if (!result || selectedRecordingId !== recording.id || !container.isConnected) {
      container.textContent = '音频文件不可用';
      return;
    }
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType }));
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = currentAudioUrl;
    container.replaceChildren(audio);
  }

  function renderRecordingDetail() {
    if (!recordingDetail) return;
    const recording = recordings.find((item) => item.id === selectedRecordingId);
    recordingDetail.replaceChildren();
    if (!recording) {
      const empty = document.createElement('div');
      empty.className = 'recording-detail-empty';
      empty.textContent = '完成一次录音后，音频和转写文本会保存在这里。';
      recordingDetail.appendChild(empty);
      return;
    }
    if (recording.isDraft) {
      const liveHeader = document.createElement('header');
      liveHeader.className = 'recording-live-head';
      const liveState = document.createElement('div');
      liveState.className = 'recording-live-state';
      const liveDot = document.createElement('span');
      liveDot.className = 'recording-state-dot';
      liveDot.dataset.recordingLiveDot = '';
      liveDot.dataset.state = recordingStatus;
      const liveLabel = document.createElement('strong');
      liveLabel.dataset.recordingLiveState = '';
      const liveTime = document.createElement('time');
      liveTime.dataset.recordingLiveTime = '';
      liveState.append(liveDot, liveLabel);
      liveHeader.append(liveState, liveTime);

      const liveAudio = document.createElement('div');
      liveAudio.className = 'recording-live-audio';
      const liveAudioTitle = document.createElement('strong');
      liveAudioTitle.textContent = '音频正在本机录制';
      const liveAudioHint = document.createElement('span');
      liveAudioHint.textContent = '结束后会自动保存并出现播放器';
      const liveControls = document.createElement('div');
      liveControls.className = 'recording-live-controls';
      const pause = document.createElement('button');
      pause.type = 'button';
      pause.className = 'workspace-button compact recording-live-pause';
      pause.textContent = recordingStatus === 'paused' ? '继续' : '暂停';
      pause.addEventListener('click', togglePauseRecording);
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'workspace-button compact primary recording-live-stop';
      stop.textContent = '结束并保存';
      stop.addEventListener('click', stopRecording);
      liveControls.append(pause, stop);
      liveAudio.append(liveAudioTitle, liveAudioHint, liveControls);

      const transcriptHead = document.createElement('div');
      transcriptHead.className = 'recording-transcript-head';
      const transcriptLabel = document.createElement('span');
      transcriptLabel.className = 'tile-label';
      transcriptLabel.textContent = '实时转写';
      const configure = document.createElement('button');
      configure.type = 'button';
      configure.className = 'workspace-button compact recording-live-configure';
      configure.dataset.action = 'configure-transcription';
      configure.textContent = '配置 API';
      configure.addEventListener('click', openTranscriptionSettings);
      transcriptHead.append(transcriptLabel, configure);

      const transcript = document.createElement('textarea');
      transcript.className = 'recording-transcript-editor recording-live-transcript';
      transcript.readOnly = true;
      transcript.dataset.recordingLiveTranscript = '';
      transcript.placeholder = '开始说话后，转写内容会出现在这里。';
      transcript.setAttribute('aria-label', '实时转写文本');
      const feedback = document.createElement('p');
      feedback.className = 'recording-live-feedback';
      feedback.dataset.recordingLiveFeedback = '';
      feedback.setAttribute('aria-live', 'polite');
      recordingDetail.append(liveHeader, liveAudio, transcriptHead, transcript, feedback);
      syncRecordingDraftUi();
      return;
    }
    const header = document.createElement('header');
    header.className = 'recording-detail-head';
    const title = document.createElement('input');
    title.className = 'recording-title-input';
    title.value = recording.title;
    title.setAttribute('aria-label', '录音名称');
    const meta = document.createElement('span');
    meta.textContent = `${recording.category || '未分类'} · ${formatShortDate(recording.createdAt)} · ${formatClock(recording.durationMs)}`;
    header.append(title, meta);

    const audioWrap = document.createElement('div');
    audioWrap.className = 'recording-audio';
    audioWrap.textContent = '正在读取音频…';

    const transcriptHead = document.createElement('div');
    transcriptHead.className = 'recording-transcript-head';
    const label = document.createElement('span');
    label.className = 'tile-label';
    label.textContent = '转写文本';
    const actions = document.createElement('div');
    const organize = document.createElement('button');
    organize.type = 'button'; organize.className = 'workspace-button compact recording-organize';
    organize.dataset.action = 'organize-recording'; organize.textContent = '整理录音';
    organize.disabled = !recording.transcript.trim();
    const nameWithAI = document.createElement('button');
    nameWithAI.type = 'button'; nameWithAI.className = 'workspace-button compact';
    nameWithAI.dataset.action = 'name-recording-ai'; nameWithAI.textContent = '生成名称';
    nameWithAI.disabled = !recording.transcript.trim();
    actions.append(
      nameWithAI, organize,
      createIconButton('copy-recording', '复制转写文本', COPY_ICON),
      createIconButton('reveal-recording', '在文件夹中显示', OPEN_ICON),
      createIconButton('delete-recording', '删除录音', DELETE_ICON, true)
    );
    transcriptHead.append(label, actions);

    const transcript = document.createElement('textarea');
    transcript.className = 'recording-transcript-editor';
    transcript.value = recording.transcript;
    transcript.placeholder = '当前环境没有生成实时转写。你仍可播放音频，或在这里补充文字。';
    transcript.setAttribute('aria-label', '录音转写文本');
    recordingDetail.append(header, audioWrap, transcriptHead, transcript);

    title.addEventListener('change', () => {
      if (title.value.trim()) recording.title = title.value.trim();
      title.value = recording.title;
      persistRecordings();
      renderRecordingList();
    });
    transcript.addEventListener('input', () => {
      recording.transcript = transcript.value;
      organize.disabled = !recording.transcript.trim();
      nameWithAI.disabled = !recording.transcript.trim();
      persistRecordings();
    });
    actions.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'organize-recording') {
        window.NotchAI?.openRecording?.(recording.id);
      }
      if (action.dataset.action === 'name-recording-ai') {
        window.NotchAI?.openRecordingName?.(recording.id);
      }
      if (action.dataset.action === 'copy-recording' && window.notchAPI && recording.transcript) {
        await window.notchAPI.writeClipboard({ type: 'text', text: recording.transcript });
      }
      if (action.dataset.action === 'reveal-recording' && window.notchAPI && recording.audioPath) {
        await window.notchAPI.revealRecording(recording.audioPath);
      }
      if (action.dataset.action === 'delete-recording') {
        await deleteSingleRecording(recording.id);
      }
    });
    loadRecordingAudio(recording, audioWrap);
  }

  async function deleteSingleRecording(recordingId) {
    const recording = recordings.find((item) => item.id === recordingId);
    if (!recording) return;
    if (window.notchAPI && recording.audioPath) {
      await window.notchAPI.deleteRecording(recording.audioPath).catch(() => false);
    }
    const next = Domain.removeRecordingState(
      recordings,
      recording.id,
      [...recordingSelection],
      selectedRecordingId
    );
    recordings = next.recordings;
    recordingSelection = new Set(next.selection);
    selectedRecordingId = next.selectedId;
    recordingSelectionAnchor = selectedRecordingId || null;
    persistRecordings();
    renderRecordings();
  }

  function renderRecordingList() {
    if (!recordingList) return;
    recordingList.replaceChildren();
    if (recordingBulkDelete) {
      recordingBulkDelete.hidden = recordingSelection.size === 0;
      recordingBulkDelete.textContent = '删除';
      recordingBulkDelete.setAttribute('aria-label', recordingSelection.size
        ? `删除 ${recordingSelection.size} 项`
        : '删除所选');
    }
    if (!recordings.length) {
      const empty = document.createElement('div');
      empty.className = 'recording-list-empty';
      empty.textContent = '还没有录音';
      recordingList.appendChild(empty);
      return;
    }
    recordings.forEach((recording) => {
      const row = document.createElement('div');
      row.className = `recording-item${recording.id === selectedRecordingId ? ' active' : ''}${recordingSelection.has(recording.id) ? ' multi-selected' : ''}${recording.isDraft ? ' is-live' : ''}`;
      row.dataset.id = recording.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recording-item-main';
      button.setAttribute('aria-label', `打开录音：${recording.title}`);
      const title = document.createElement('strong');
      title.textContent = recording.title;
      const preview = document.createElement('span');
      preview.dataset.recordingPreview = '';
      preview.textContent = recording.isDraft ? (currentRecordingText() || currentRecordingFeedback()) : (recording.transcript || '仅音频 · 暂无转写');
      const meta = document.createElement('time');
      meta.dataset.recordingMeta = '';
      meta.textContent = recording.isDraft
        ? `${recordingStatus === 'saving' ? '保存中' : recordingStatus === 'paused' ? '已暂停' : '录音中'} · ${formatClock(recording.durationMs)}`
        : `${formatShortDate(recording.createdAt)} · ${formatClock(recording.durationMs)}`;
      button.append(title, preview, meta);
      row.append(button);
      if (!recording.isDraft) {
        const remove = createIconButton('delete-recording-item', `删除录音：${recording.title}`, DELETE_ICON, true);
        remove.classList.add('recording-item-delete');
        row.append(remove);
      }
      recordingList.appendChild(row);
    });
  }

  function renderRecordings() {
    if (recordingCount) recordingCount.textContent = `${recordings.length} 条`;
    renderRecordingList();
    renderRecordingDetail();
  }

  if (recordingList) {
    recordingList.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-action="delete-recording-item"]');
      if (remove) {
        event.preventDefault();
        event.stopPropagation();
        const row = remove.closest('.recording-item[data-id]');
        if (row) await deleteSingleRecording(row.dataset.id);
        return;
      }
      const item = event.target.closest('.recording-item[data-id]');
      if (!item) return;
      const targetRecording = recordings.find((recording) => recording.id === item.dataset.id);
      if (event.shiftKey && targetRecording && !targetRecording.isDraft) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          recordings.filter((recording) => !recording.isDraft).map((recording) => recording.id),
          [...recordingSelection],
          item.dataset.id,
          recordingSelectionAnchor,
          true
        );
        recordingSelection = new Set(result.selected);
        recordingSelectionAnchor = result.anchor;
        renderRecordingList();
        return;
      }
      selectedRecordingId = item.dataset.id;
      recordingSelectionAnchor = selectedRecordingId;
      renderRecordings();
    });
  }

  recordingBulkDelete?.addEventListener('click', async () => {
    if (!recordingSelection.size) return;
    const targets = recordings.filter((recording) => !recording.isDraft && recordingSelection.has(recording.id));
    if (!targets.length) return;
    if (window.notchAPI) {
      await Promise.all(targets.map((recording) => recording.audioPath
        ? window.notchAPI.deleteRecording(recording.audioPath).catch(() => false)
        : Promise.resolve(true)));
    }
    const targetIds = new Set(targets.map((recording) => recording.id));
    recordings = recordings.filter((recording) => !targetIds.has(recording.id));
    recordingSelection.clear();
    selectedRecordingId = recordings[0] && recordings[0].id;
    recordingSelectionAnchor = selectedRecordingId || null;
    persistRecordings();
    renderRecordings();
  });

  // ============ 当前窗口 ============
  const windowsRefresh = document.getElementById('windows-refresh');
  const windowsHidden = document.getElementById('windows-hidden');
  const windowList = document.getElementById('window-list');
  let windows = [];
  let hiddenWindows = new Set(loadJson(HIDDEN_WINDOWS_KEY, []).filter((item) => typeof item === 'string'));
  let windowsLoading = false;
  let workspaceTab = document.querySelector('.tab.active')?.dataset.tab || 'home';
  let workspaceExpanded = document.getElementById('app')?.classList.contains('expanded') || false;
  let homeWindowsVisible = window.NotchHome?.isVisible?.('windows') !== false;
  let windowDrag = null;
  let suppressWindowClickUntil = 0;

  function windowHideKey(windowInfo) {
    return `${String(windowInfo.appName || '').trim()}\u0000${String(windowInfo.title || '').trim()}`;
  }

  function persistHiddenWindows() {
    saveJson(HIDDEN_WINDOWS_KEY, [...hiddenWindows]);
  }

  function clearWindowDragVisuals() {
    const drag = windowDrag;
    windowDrag = null;
    if (drag) {
      clearTimeout(drag.timer);
      try {
        if (drag.item.hasPointerCapture?.(drag.pointerId)) drag.item.releasePointerCapture(drag.pointerId);
      } catch (error) {}
      drag.item.classList.remove('dragging', 'remove-ready');
      drag.item.style.removeProperty('--window-drag-x');
      drag.item.style.removeProperty('--window-drag-y');
    }
    document.querySelectorAll('.home-windows.drag-active').forEach((card) => {
      card.classList.remove('drag-active');
    });
    return drag;
  }

  function renderWindows(error = '') {
    if (!windowList) return;
    // 轮询可能在长按过程中重建列表；先清理捕获与卡片移除态，避免红色区域残留。
    clearWindowDragVisuals();
    windowList.replaceChildren();
    if (error) {
      const empty = document.createElement('div');
      empty.className = 'window-empty permission';
      // 两种权限的现象完全一样（列表空），但要开的开关不同，必须分开说：
      // 「屏幕录制」决定能不能读到窗口标题，「辅助功能」决定能不能枚举和聚焦窗口。
      // 缺屏幕录制时系统既不报错也不弹提示，所以只能由这里告诉用户。
      const screenRecording = error === 'screen_recording_permission_required';
      const title = screenRecording ? '需要“屏幕录制”权限' : '需要“辅助功能”权限';
      const pane = screenRecording ? '屏幕录制与系统录音' : '辅助功能';
      const heading = document.createElement('strong');
      heading.textContent = title;
      const hint = document.createElement('span');
      hint.textContent = `系统设置 → 隐私与安全性 → ${pane}，允许 TO-DO Panel 后重试。`;
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'window-permission-open';
      action.textContent = '打开系统设置';
      action.addEventListener('click', () => {
        if (window.notchAPI && typeof window.notchAPI.openPrivacySettings === 'function') {
          window.notchAPI.openPrivacySettings(screenRecording ? 'screen-recording' : 'accessibility');
        }
      });
      empty.append(heading, hint, action);
      windowList.appendChild(empty);
      return;
    }
    const visibleWindows = Domain.numberWindowLabels(
      windows.filter((item) => !hiddenWindows.has(windowHideKey(item)))
    );
    if (windowsHidden) {
      windowsHidden.hidden = hiddenWindows.size === 0;
      windowsHidden.textContent = '隐藏';
      windowsHidden.setAttribute('aria-label', `恢复已隐藏的 ${hiddenWindows.size} 个窗口`);
    }
    if (!visibleWindows.length) {
      const empty = document.createElement('div');
      empty.className = 'window-empty';
      empty.textContent = windowsLoading
        ? '正在读取当前窗口…'
        : hiddenWindows.size
          ? '窗口均已隐藏 · 点击上方恢复'
          : '没有读取到可切换窗口';
      windowList.appendChild(empty);
      return;
    }
    visibleWindows.slice(0, 15).forEach((windowInfo) => {
      const button = document.createElement('button');
      button.className = 'window-item';
      button.type = 'button';
      button.dataset.id = windowInfo.id;
      button.title = `${windowInfo.displayName}\n${windowInfo.title}\n长按后拖出卡片可隐藏`;
      const mark = document.createElement('span');
      mark.className = 'window-app-mark';
      if (windowInfo.icon) {
        const icon = document.createElement('img');
        icon.src = windowInfo.icon;
        icon.alt = '';
        icon.draggable = false;
        mark.appendChild(icon);
      } else {
        mark.textContent = (windowInfo.appName.charAt(0) || '·').toUpperCase();
      }
      const appName = document.createElement('strong');
      appName.textContent = windowInfo.displayName;
      button.append(mark, appName);
      windowList.appendChild(button);
    });
  }

  async function refreshWindows(force = false) {
    if (document.getElementById('home-bento')?.hidden || !window.NotchHome?.isVisible?.('windows')) return;
    if (windowsLoading || !window.notchAPI || (!force && (!workspaceExpanded || workspaceTab !== 'home'))) return;
    windowsLoading = true;
    renderWindows();
    let result;
    try {
      result = await window.notchAPI.listWindows();
    } catch (error) {
      result = { items: [], error: 'accessibility_permission_required' };
    }
    windowsLoading = false;
    windows = result && Array.isArray(result.items) ? result.items : [];
    renderWindows(result && result.error);
  }

  if (windowsRefresh) windowsRefresh.addEventListener('click', () => refreshWindows(true));
  if (windowsHidden) {
    windowsHidden.addEventListener('click', () => {
      hiddenWindows.clear();
      persistHiddenWindows();
      renderWindows();
    });
  }
  if (windowList) {
    windowList.addEventListener('click', (event) => {
      if (Date.now() < suppressWindowClickUntil) return;
      const item = event.target.closest('.window-item[data-id]');
      if (item && window.notchAPI) window.notchAPI.focusWindow(item.dataset.id);
    });
    windowList.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || windowDrag) return;
      const item = event.target.closest('.window-item[data-id]');
      if (!item) return;
      windowDrag = {
        item,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        removeReady: false,
        timer: setTimeout(() => {
          if (!windowDrag || windowDrag.item !== item) return;
          windowDrag.active = true;
          item.classList.add('dragging');
          try { item.setPointerCapture(event.pointerId); } catch (error) {}
          item.closest('.home-windows')?.classList.add('drag-active');
        }, 460),
      };
    });
    document.addEventListener('pointermove', (event) => {
      if (!windowDrag || windowDrag.pointerId !== event.pointerId) return;
      const dx = event.clientX - windowDrag.startX;
      const dy = event.clientY - windowDrag.startY;
      if (!windowDrag.active) {
        if (Math.hypot(dx, dy) > 8) {
          clearTimeout(windowDrag.timer);
          windowDrag = null;
        }
        return;
      }
      event.preventDefault();
      windowDrag.item.style.setProperty('--window-drag-x', `${dx}px`);
      windowDrag.item.style.setProperty('--window-drag-y', `${dy}px`);
      const bounds = windowList.closest('.home-windows').getBoundingClientRect();
      windowDrag.removeReady = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      windowDrag.item.classList.toggle('remove-ready', windowDrag.removeReady);
    });
    const finishWindowDrag = (event) => {
      if (!windowDrag || (event.pointerId != null && windowDrag.pointerId !== event.pointerId)) return;
      const drag = clearWindowDragVisuals();
      if (!drag) return;
      if (!drag.active) return;
      suppressWindowClickUntil = Date.now() + 450;
      if (drag.removeReady) {
        const windowInfo = windows.find((item) => item.id === drag.item.dataset.id);
        if (windowInfo) {
          hiddenWindows.add(windowHideKey(windowInfo));
          persistHiddenWindows();
          renderWindows();
        }
      }
    };
    document.addEventListener('pointerup', finishWindowDrag);
    document.addEventListener('pointercancel', finishWindowDrag);
    windowList.addEventListener('lostpointercapture', () => clearWindowDragVisuals(), true);
    window.addEventListener('blur', clearWindowDragVisuals);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearWindowDragVisuals();
    });
  }

  document.addEventListener('notch:tabchange', (event) => {
    clearWindowDragVisuals();
    workspaceTab = event.detail && event.detail.tab || 'home';
    if (workspaceTab === 'home') refreshWindows();
    if (workspaceTab === 'settings') refreshSettingsPanel();
  });
  document.addEventListener('notch:modechange', (event) => {
    clearWindowDragVisuals();
    workspaceExpanded = !!(event.detail && event.detail.expanded);
    if (workspaceExpanded && workspaceTab === 'home') refreshWindows();
  });
  document.addEventListener('notch:home-modules-changed', (event) => {
    const nextVisible = Array.isArray(event.detail?.visibleIds)
      ? event.detail.visibleIds.includes('windows')
      : window.NotchHome?.isVisible?.('windows') !== false;
    const restored = !homeWindowsVisible && nextVisible;
    homeWindowsVisible = nextVisible;
    renderHomeModuleSettings();
    if (restored && workspaceExpanded && workspaceTab === 'home') refreshWindows(true);
  });
  document.addEventListener('notch:recording-state-changed', renderHomeModuleSettings);
  document.addEventListener('notch:home-view-changed', () => refreshWindows());

  // ============ 本机加密密钥库 ============
  const credentialService = document.getElementById('credential-service');
  const credentialAccount = document.getElementById('credential-account');
  const credentialPassword = document.getElementById('credential-password');
  const credentialSave = document.getElementById('credential-save');
  const credentialList = document.getElementById('credential-list');
  const credentialCount = document.getElementById('credential-count');
  const credentialSearch = document.getElementById('credential-search');
  const credentialBulkDelete = document.getElementById('credential-bulk-delete');
  const credentialsNote = document.getElementById('credentials-note');
  let credentials = [];
  let credentialSelection = new Set();
  let credentialAnchor = null;
  let editingCredentialId = '';
  let editingCredential = null;

  function updateCredentialBulkAction() {
    if (!credentialBulkDelete) return;
    credentialBulkDelete.hidden = credentialSelection.size === 0;
    credentialBulkDelete.textContent = '删除';
    credentialBulkDelete.setAttribute('aria-label', credentialSelection.size
      ? `删除 ${credentialSelection.size} 项`
      : '删除所选');
  }

  function animateCredentialExpansion(originRect) {
    const row = credentialList?.querySelector(`.credential-item.editing[data-id="${CSS.escape(editingCredentialId)}"]`);
    if (!row || !originRect || typeof row.animate !== 'function') return;
    requestAnimationFrame(() => {
      const targetRect = row.getBoundingClientRect();
      const scaleX = Math.max(0.2, originRect.width / Math.max(1, targetRect.width));
      const scaleY = Math.max(0.2, originRect.height / Math.max(1, targetRect.height));
      row.animate([
        {
          opacity: .72,
          transform: `translate(${originRect.left - targetRect.left}px, ${originRect.top - targetRect.top}px) scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left',
        },
        { opacity: 1, transform: 'translate(0, 0) scale(1)', transformOrigin: 'top left' },
      ], { duration: 360, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'both' });
    });
  }

  function renderCredentials() {
    const visibleCredentials = Domain.filterCredentials(credentials, credentialSearch?.value || '');
    if (credentialCount) credentialCount.textContent = credentialSearch?.value.trim()
      ? `${visibleCredentials.length} / ${credentials.length} 项`
      : `${credentials.length} 项`;
    if (!credentialList) return;
    credentialList.replaceChildren();
    if (!visibleCredentials.length) {
      const empty = document.createElement('div');
      empty.className = 'credential-empty';
      empty.innerHTML = credentials.length
        ? '<strong>没有匹配的密钥</strong><span>可按名称或账号继续检索</span>'
        : '<strong>还没有保存密钥</strong><span>账号与密码会加密保存在本机</span>';
      credentialList.appendChild(empty);
      updateCredentialBulkAction();
      return;
    }
    visibleCredentials.forEach((credential) => {
      if (editingCredentialId === credential.id && editingCredential) {
        const form = document.createElement('form');
        form.className = 'credential-item editing';
        form.dataset.id = credential.id;
        form.innerHTML = `
          <div class="credential-edit-head"><strong>修改密钥</strong><span>回车保存</span></div>
          <label><span>服务</span><input name="service" maxlength="80" autocomplete="off" /></label>
          <label><span>账号</span><input name="account" maxlength="320" autocomplete="off" /></label>
          <label><span>密码</span><input name="password" type="text" maxlength="4096" autocomplete="off" spellcheck="false" /></label>
          <div class="credential-edit-actions"><button type="button" data-credential-cancel>取消</button><button type="submit">保存</button></div>
        `;
        form.elements.service.value = editingCredential.service || '';
        form.elements.account.value = editingCredential.account || '';
        form.elements.password.value = editingCredential.password || '';
        credentialList.appendChild(form);
        return;
      }
      const row = document.createElement('article');
      row.className = `credential-item${credentialSelection.has(credential.id) ? ' multi-selected' : ''}`;
      row.dataset.id = credential.id;
      row.tabIndex = 0;
      const copy = document.createElement('div');
      copy.className = 'credential-copy';
      const service = document.createElement('strong');
      service.textContent = credential.service;
      const account = document.createElement('span');
      account.textContent = credential.account;
      const password = document.createElement('code');
      password.textContent = credential.passwordMask || '**********';
      copy.append(service, account, password);
      const actions = document.createElement('div');
      actions.className = 'credential-actions';
      const accountCopy = document.createElement('button');
      accountCopy.type = 'button';
      accountCopy.dataset.credentialCopy = 'account';
      accountCopy.textContent = '账号';
      accountCopy.setAttribute('aria-label', '复制账号');
      const passwordCopy = document.createElement('button');
      passwordCopy.type = 'button';
      passwordCopy.dataset.credentialCopy = 'password';
      passwordCopy.textContent = '密码';
      passwordCopy.setAttribute('aria-label', '复制密码');
      const deleteAction = Domain.credentialRowAction({ requestedAction: 'delete' });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.credentialDelete = 'true';
      remove.textContent = deleteAction.label;
      remove.setAttribute('aria-label', deleteAction.ariaLabel);
      actions.append(accountCopy, passwordCopy, remove);
      row.append(copy, actions);
      credentialList.appendChild(row);
    });
    updateCredentialBulkAction();
  }

  async function loadCredentials() {
    if (!window.notchAPI || typeof window.notchAPI.listCredentials !== 'function') return;
    let result;
    try { result = await window.notchAPI.listCredentials(); } catch (error) { result = null; }
    credentials = result && Array.isArray(result.items) ? result.items : [];
    if (credentialsNote && result && !result.secureStorage) {
      credentialsNote.textContent = '当前系统安全存储不可用，暂时无法保存密码。';
      credentialsNote.classList.add('error');
    }
    renderCredentials();
  }

  async function saveCredential() {
    if (!credentialSave || !window.notchAPI) return;
    const payload = {
      service: credentialService?.value || '',
      account: credentialAccount?.value || '',
      password: credentialPassword?.value || '',
    };
    if (!payload.service.trim() || !payload.account.trim() || !payload.password) {
      if (credentialsNote) {
        credentialsNote.textContent = '请完整填写软件、账号和密码。';
        credentialsNote.classList.add('error');
      }
      return;
    }
    credentialSave.disabled = true;
    const result = await window.notchAPI.saveCredential(payload).catch(() => ({ ok: false }));
    credentialSave.disabled = false;
    if (!result || !result.ok) {
      if (credentialsNote) {
        credentialsNote.textContent = '加密保存失败，请确认系统钥匙串可用。';
        credentialsNote.classList.add('error');
      }
      return;
    }
    if (credentialService) credentialService.value = '';
    if (credentialAccount) credentialAccount.value = '';
    if (credentialPassword) {
      credentialPassword.value = '';
      credentialPassword.placeholder = '保存后才会加密';
    }
    if (credentialsNote) {
      credentialsNote.textContent = '已使用系统安全存储加密保存。';
      credentialsNote.classList.remove('error');
    }
    await loadCredentials();
    credentialService?.focus();
  }

  credentialSave?.addEventListener('click', saveCredential);
  credentialSearch?.addEventListener('input', renderCredentials);
  [credentialService, credentialAccount, credentialPassword].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        saveCredential();
      }
    });
  });
  credentialList?.addEventListener('click', async (event) => {
    const row = event.target.closest('.credential-item[data-id]');
    if (!row) return;
    if (event.target.closest('[data-credential-cancel]')) {
      editingCredentialId = '';
      editingCredential = null;
      renderCredentials();
      return;
    }
    if (row.classList.contains('editing')) return;
    const copyField = event.target.closest('[data-credential-copy]')?.dataset.credentialCopy;
    const action = Domain.credentialRowAction({
      requestedAction: event.target.closest('[data-credential-delete]') ? 'delete' : '',
      copyField,
      rowBody: Boolean(event.target.closest('.credential-copy')),
      shiftKey: event.shiftKey,
      selected: credentialSelection.has(row.dataset.id),
    });
    if (action.type === 'delete') {
      const deleteButton = event.target.closest('[data-credential-delete]');
      if (deleteButton) deleteButton.disabled = true;
      const result = await window.notchAPI.deleteCredentials([row.dataset.id]).catch(() => ({ ok: false }));
      if (!result?.ok) {
        if (deleteButton) deleteButton.disabled = false;
        if (credentialsNote) {
          credentialsNote.textContent = '删除失败，请稍后重试。';
          credentialsNote.classList.add('error');
        }
        return;
      }
      credentialSelection.delete(row.dataset.id);
      if (editingCredentialId === row.dataset.id) {
        editingCredentialId = '';
        editingCredential = null;
      }
      await loadCredentials();
      if (credentialsNote) {
        credentialsNote.textContent = '密钥已删除。';
        credentialsNote.classList.remove('error');
      }
      return;
    }
    if (action.type === 'copy') {
      const copied = await window.notchAPI.copyCredential(row.dataset.id, action.field).catch(() => false);
      if (credentialsNote) credentialsNote.textContent = copied ? `${copyField === 'password' ? '密码' : '账号'}已复制` : '复制失败';
      return;
    }
    if (action.type === 'edit') {
      const originRect = row.getBoundingClientRect();
      const result = await window.notchAPI.getCredential(row.dataset.id).catch(() => ({ ok: false }));
      if (!result || !result.ok || !result.item) return;
      editingCredentialId = result.item.id;
      editingCredential = result.item;
      renderCredentials();
      animateCredentialExpansion(originRect);
      if (credentialsNote) {
        credentialsNote.textContent = '已展开当前密钥，回车即可保存。';
        credentialsNote.classList.remove('error');
      }
      credentialList.querySelector('.credential-item.editing input[name="service"]')?.focus();
      return;
    }
    const result = window.NotchDomain.updateRangeSelection(
      Domain.filterCredentials(credentials, credentialSearch?.value || '').map((item) => item.id),
      [...credentialSelection],
      row.dataset.id,
      credentialAnchor,
      event.shiftKey,
      true
    );
    credentialSelection = new Set(result.selected);
    credentialAnchor = result.anchor;
    renderCredentials();
  });
  credentialList?.addEventListener('submit', async (event) => {
    const form = event.target.closest('.credential-item.editing[data-id]');
    if (!form) return;
    event.preventDefault();
    if (!editingCredentialId || !window.notchAPI) return;
    const payload = {
      id: editingCredentialId,
      service: form.elements.service?.value || '',
      account: form.elements.account?.value || '',
      password: form.elements.password?.value || '',
    };
    if (!payload.service.trim() || !payload.account.trim()) return;
    const saveButton = form.querySelector('button[type="submit"]');
    if (saveButton) saveButton.disabled = true;
    const result = await window.notchAPI.saveCredential(payload).catch(() => ({ ok: false }));
    if (saveButton) saveButton.disabled = false;
    if (!result?.ok) return;
    editingCredentialId = '';
    editingCredential = null;
    await loadCredentials();
  });
  credentialBulkDelete?.addEventListener('click', async () => {
    if (!credentialSelection.size || !window.notchAPI) return;
    const result = await window.notchAPI.deleteCredentials([...credentialSelection]).catch(() => ({ ok: false }));
    if (!result || !result.ok) return;
    credentialSelection.clear();
    credentialAnchor = null;
    await loadCredentials();
  });

  document.addEventListener('notch:clear-selection', () => {
    commandSelection.clear();
    commandSelectionAnchor = null;
    linkSelection.clear();
    linkSelectionAnchor = null;
    recordingSelection.clear();
    recordingSelectionAnchor = selectedRecordingId || null;
    credentialSelection.clear();
    credentialAnchor = null;
    renderCommands();
    renderLinkGroups();
    renderRecordingList();
    renderCredentials();
  });

  setInterval(() => refreshWindows(), 6000);

  window.addEventListener('beforeunload', () => {
    stopSpeechRecognition();
    stopTranscriptionAudioPipeline();
    if (transcriptionStartPromise && window.notchAPI) window.notchAPI.finishTranscription().catch(() => {});
    stopMediaTracks();
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  });

  renderCommands();
  renderLinkGroups();
  renderRecordings();
  renderWindows();
  updateRecordingUi();
  loadTranscriptionConfig();
  refreshSettingsPanel();
  loadCredentials();

  window.NotchWorkspace = {
    hasLink: (id) => linkGroups.some((g) => (g.links || []).some((l) => String(l.id) === String(id))),
    selectLink(id) {
      const group = linkGroups.find((g) => (g.links || []).some((l) => String(l.id) === String(id)));
      if (!group) return false;
      if(linksSearch)linksSearch.value='';if(groupFilter)groupFilter.value='';
      const index=(group.links||[]).findIndex(link=>String(link.id)===String(id));
      linkLimits.set(group.id,Math.max(LINK_PAGE_SIZE,Math.ceil((index+1)/LINK_PAGE_SIZE)*LINK_PAGE_SIZE));
      group.collapsed = false; renderLinkGroups();
      requestAnimationFrame(() => {
        const row = document.querySelector(`[data-link-id="${CSS.escape(String(id))}"]`);
        row?.scrollIntoView({ block: 'center' }); row?.querySelector('button')?.focus();
      });
      return true;
    },
    linkContext(id) {
      for (const group of linkGroups) {
        const link = (group.links || []).find((item) => String(item.id) === String(id));
        if (link) return { sourceType: 'link', sourceId: link.id, sourceTitle: link.title, text: `URL: ${link.url}\n网页标题: ${link.title}`, createdAt: link.createdAt || Date.now() };
      }
      return null;
    },
    recordingContext(id = selectedRecordingId) {
      const recording = recordings.find((item) => item.id === id && !item.isDraft);
      return recording ? { sourceType: 'recording', sourceId: recording.id, sourceTitle: recording.title, text: recording.transcript, createdAt: recording.createdAt } : null;
    },
    async applyAIName(source, titleValue, categoryValue) {
      const title = String(titleValue || '').trim().slice(0, 80);
      const category = String(categoryValue || '').trim().slice(0, source.sourceType === 'link' ? 14 : 24);
      if (!title) return { ok: false, error: 'missing_title' };
      if (source.sourceType === 'recording') {
        const recording = recordings.find((item) => item.id === source.sourceId && !item.isDraft);
        if (!recording || recording.transcript.trim() !== source.text.trim() || recording.title !== source.sourceTitle) return { ok: false, error: 'source_changed' };
        const undo = { sourceType: 'recording', id: recording.id, beforeTitle: recording.title, beforeCategory: recording.category, afterTitle: title, afterCategory: category || recording.category, expectedText: recording.transcript.trim() };
        recording.title = undo.afterTitle; recording.category = undo.afterCategory;
        if (!persistRecordings()) { recording.title = undo.beforeTitle; recording.category = undo.beforeCategory; return { ok: false, error: 'save_failed' }; }
        renderRecordings();
        return { ok: true, undo, workspaceSynced: await syncWorkspaceData() };
      }
      if (source.sourceType !== 'link') return { ok: false, error: 'invalid_source' };
      const beforeGroup = linkGroups.find((group) => (group.links || []).some((item) => item.id === source.sourceId));
      const link = beforeGroup && (beforeGroup.links || []).find((item) => item.id === source.sourceId);
      if (!link || `URL: ${link.url}\n网页标题: ${link.title}`.trim() !== source.text.trim() || link.title !== source.sourceTitle) return { ok: false, error: 'source_changed' };
      const previousLinkGroups = structuredClone(linkGroups);
      let targetGroup = category ? linkGroups.find((group) => group.name === category) : beforeGroup;
      let createdGroupId = '';
      if (!targetGroup) { targetGroup = { id: uid('group'), name: category, collapsed: false, links: [] }; createdGroupId = targetGroup.id; linkGroups.push(targetGroup); }
      const undo = { sourceType: 'link', id: link.id, url: link.url, beforeTitle: link.title, beforeGroupId: beforeGroup.id, afterTitle: title, afterGroupId: targetGroup.id, createdGroupId };
      link.title = title;
      if (targetGroup !== beforeGroup) { beforeGroup.links = beforeGroup.links.filter((item) => item.id !== link.id); targetGroup.links.push(link); }
      if (!persistLinks()) { linkGroups = previousLinkGroups; return { ok: false, error: 'save_failed' }; }
      renderLinkGroups();
      return { ok: true, undo, workspaceSynced: await syncWorkspaceData() };
    },
    async undoAIName(token) {
      if (token?.sourceType === 'recording') {
        const recording = recordings.find((item) => item.id === token.id && !item.isDraft);
        if (!recording || recording.title !== token.afterTitle || recording.category !== token.afterCategory || recording.transcript.trim() !== token.expectedText) return { ok: false, error: 'conflict' };
        recording.title = token.beforeTitle; recording.category = token.beforeCategory;
        if (!persistRecordings()) { recording.title = token.afterTitle; recording.category = token.afterCategory; return { ok: false, error: 'save_failed' }; }
        renderRecordings();
        return { ok: true, workspaceSynced: await syncWorkspaceData() };
      }
      if (token?.sourceType !== 'link') return { ok: false, error: 'invalid_source' };
      const previousLinkGroups = structuredClone(linkGroups);
      const afterGroup = linkGroups.find((group) => group.id === token.afterGroupId);
      const link = afterGroup && (afterGroup.links || []).find((item) => item.id === token.id);
      const beforeGroup = linkGroups.find((group) => group.id === token.beforeGroupId);
      if (!link || !beforeGroup || link.title !== token.afterTitle || link.url !== token.url) return { ok: false, error: 'conflict' };
      link.title = token.beforeTitle;
      if (afterGroup !== beforeGroup) { afterGroup.links = afterGroup.links.filter((item) => item.id !== link.id); beforeGroup.links.push(link); }
      if (token.createdGroupId && afterGroup.links.length === 0) linkGroups = linkGroups.filter((group) => group.id !== token.createdGroupId);
      if (!persistLinks()) { linkGroups = previousLinkGroups; return { ok: false, error: 'save_failed' }; }
      renderLinkGroups();
      return { ok: true, workspaceSynced: await syncWorkspaceData() };
    },
    refreshWindows,
    startRecording,
    isRecordingActive: isRecordingBusy,
  };
})();
