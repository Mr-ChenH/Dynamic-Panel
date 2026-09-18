(function exposeWorkspaceLinksRenderer() {
  function linkHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
      return url;
    }
  }

  function createRenderer(host) {
    const {
      Domain,
      getGroups,
      getSelection,
      getAddingGroupId,
      getLimit,
      setLimit,
      getSearch,
      getGroupFilter,
      getViewFilter,
      getTagFilter,
      elements,
      createIconButton,
      icons,
      setStatus,
      pageSize,
    } = host;
    const { linkGroupsEl, linkBulkDelete, linksSidebarGroups, linksSidebarTags } = elements;
    const makeIconButton = (action, label, danger = false) => createIconButton(action, label, icons[action] || '', danger);

    const normalizeSearch = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase();
    const allLinks = () => getGroups().flatMap((group) => Array.isArray(group.links) ? group.links : []);

    function updateBulkAction() {
      if (!linkBulkDelete) return;
      const selection = getSelection();
      linkBulkDelete.hidden = selection.size === 0;
      linkBulkDelete.textContent = '删除';
      linkBulkDelete.setAttribute('aria-label', selection.size ? `删除 ${selection.size} 项` : '删除所选');
    }

    function render() {
      if (!linkGroupsEl) return;
      const groups = getGroups();
      const selection = getSelection();
      const groupScroll = new Map([...linkGroupsEl.querySelectorAll('.link-group')].map((section) => [
        section.dataset.groupId,
        section.querySelector('.link-list')?.scrollTop || 0,
      ]));
      linkGroupsEl.replaceChildren();
      updateBulkAction();
      const query = normalizeSearch(getSearch()?.value).trim();
      const parsedQuery = Domain.parseLinkQuery(query);
      const selected = getGroupFilter()?.value || '';
      const selectedTag = getTagFilter()?.value || '';
      const groupFilter = getGroupFilter();
      const tagFilter = getTagFilter();
      if (groupFilter) {
        const options = [['', '全部分组'], ...groups.map((group) => [String(group.id), `${group.name || '未命名分组'} (${(group.links || []).length})`])];
        const signature = JSON.stringify(options);
        if (groupFilter.dataset.signature !== signature) {
          groupFilter.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
          groupFilter.value = selected;
          groupFilter.dataset.signature = signature;
        }
      }
      if (tagFilter) {
        const tags = [...new Set(allLinks().flatMap((link) => Domain.normalizeLinkTags(link.tags)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        const options = [['', '全部标签'], ...tags.map((tag) => [tag, `#${tag}`])];
        const signature = JSON.stringify(options);
        if (tagFilter.dataset.signature !== signature) {
          tagFilter.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
          tagFilter.value = selectedTag;
          tagFilter.dataset.signature = signature;
        }
      }
      const view = getViewFilter()?.value || 'all';
      const allLinkRows = allLinks();
      const sidebarCounts = {
        all: allLinkRows.length,
        unread: allLinkRows.filter((link) => link.read !== true).length,
        favorite: allLinkRows.filter((link) => link.favorite === true).length,
        read: allLinkRows.filter((link) => link.read === true).length,
      };
      Object.entries(sidebarCounts).forEach(([key, value]) => {
        const node = document.getElementById(`links-sidebar-${key === 'all' ? 'total' : key}`);
        if (node) node.textContent = String(value);
      });
      document.querySelectorAll('[data-links-sidebar-view]').forEach((button) => button.classList.toggle('active', button.dataset.linksSidebarView === view));
      if (linksSidebarGroups) {
        linksSidebarGroups.replaceChildren(...[
          ['', '全部分组', allLinkRows.length],
          ...groups.map((group) => [String(group.id), group.name || '未命名分组', (group.links || []).length]),
        ].map(([value, label, count]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.linksSidebarGroup = value;
          button.classList.toggle('active', value === (groupFilter?.value || ''));
          const text = document.createElement('span');
          text.textContent = label;
          const amount = document.createElement('b');
          amount.textContent = String(count);
          button.append(text, amount);
          return button;
        }));
      }
      if (linksSidebarTags) {
        const tagCounts = new Map();
        allLinkRows.forEach((link) => Domain.normalizeLinkTags(link.tags).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)));
        const popular = [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).slice(0, 10).map(([tag, count]) => [tag, tag, count]);
        linksSidebarTags.replaceChildren(...[
          ['', '全部标签', tagCounts.size],
          ...popular,
        ].map(([value, label, count]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.linksSidebarTag = value;
          button.classList.toggle('active', value === (tagFilter?.value || ''));
          const text = document.createElement('span');
          text.textContent = value ? `# ${label}` : label;
          const amount = document.createElement('b');
          amount.textContent = String(count);
          button.append(text, amount);
          return button;
        }));
      }
      const pageHeading = document.querySelector('.links-page-title h1');
      if (pageHeading) pageHeading.textContent = view === 'favorite' ? '收藏链接' : view === 'unread' ? '稍后阅读' : view === 'read' ? '已读链接' : groupFilter?.value ? (groups.find((group) => String(group.id) === groupFilter.value)?.name || '链接') : '全部链接';
      const pageSubtitle = document.getElementById('links-page-subtitle');
      if (pageSubtitle) pageSubtitle.textContent = `${groups.length} 个分组 · ${sidebarCounts.unread} 条未读 · ${sidebarCounts.favorite} 条收藏`;
      const visibleGroups = groups.filter((group) => !groupFilter?.value || String(group.id) === groupFilter.value).map((group) => ({
        group,
        links: (group.links || []).filter((link) => Domain.linkMatchesQuery(link, group, parsedQuery)
          && (!selectedTag || Domain.normalizeLinkTags(link.tags).some((tag) => tag === selectedTag))
          && (!view || view === 'all' || (view === 'favorite' && link.favorite === true) || (view === 'unread' && link.read !== true) || (view === 'read' && link.read === true))),
      })).filter((entry) => entry.links.length || (!query && view === 'all' && !selectedTag));
      const matched = visibleGroups.reduce((sum, entry) => sum + entry.links.length, 0);
      const total = allLinks().length;
      const counter = document.getElementById('links-result-count');
      if (counter) counter.textContent = `${matched} / ${total}`;
      const collapseButton = document.getElementById('links-collapse-all');
      if (collapseButton) {
        collapseButton.disabled = !!query || view !== 'all' || !!selectedTag || !groups.length;
        collapseButton.textContent = groups.some((group) => !group.collapsed) ? '全部折叠' : '全部展开';
      }
      if (!groups.length) {
        const empty = document.createElement('div');
        empty.className = 'links-empty';
        empty.innerHTML = '<strong>链接库还是空的</strong><span>粘贴一个网址，开始建立你的本地收藏。</span>';
        linkGroupsEl.appendChild(empty);
        return;
      }
      if (!visibleGroups.length) {
        const empty = document.createElement('div');
        empty.className = 'links-empty';
        empty.textContent = '没有匹配链接，试试其他关键词或分组';
        linkGroupsEl.append(empty);
        return;
      }
      visibleGroups.forEach(({ group, links }) => {
        const collapsed = group.collapsed && !query;
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
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.disabled = !!query;
        toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';
        const name = document.createElement('input');
        name.className = 'group-name-input';
        name.value = String(group.name || '未命名分组');
        name.dataset.action = 'rename-group';
        name.setAttribute('aria-label', '分组名称');
        const count = document.createElement('span');
        count.className = 'group-count';
        count.textContent = query ? `${links.length} / ${(group.links || []).length}` : `${links.length}`;
        header.append(toggle, name, count);
        header.appendChild(makeIconButton('add-link-to-group', `在“${group.name || '当前分组'}”中新增链接`));
        header.appendChild(makeIconButton('delete-group', '删除分组及其中所有链接', true));
        const body = document.createElement('div');
        body.className = 'link-group-body';
        if (getAddingGroupId() === group.id) {
          const addRow = document.createElement('div');
          addRow.className = 'group-link-add';
          addRow.innerHTML = `<input data-group-link-input type="text" placeholder="粘贴网址并回车，添加到此分组" aria-label="添加链接到${String(group.name || '当前分组').replace(/[<>"&]/g, '')}" autocomplete="off" spellcheck="false"><button type="button" data-action="cancel-group-link-add" aria-label="取消">×</button>`;
          body.appendChild(addRow);
        }
        const list = document.createElement('div');
        list.className = 'link-list';
        const limit = getLimit(group.id) || pageSize;
        (collapsed ? [] : links.slice(0, limit)).forEach((link) => {
          const row = document.createElement('article');
          row.className = `link-item${selection.has(link.id) ? ' multi-selected' : ''}${link.read !== true ? ' is-unread' : ''}${link.favorite === true ? ' is-favorite' : ''}`;
          row.dataset.linkId = link.id;
          row.dataset.groupId = group.id;
          const mark = document.createElement('span');
          mark.className = 'link-favicon';
          if (link.icon && String(link.icon).startsWith('data:image/')) {
            const image = document.createElement('img');
            image.src = link.icon;
            image.alt = '';
            image.loading = 'lazy';
            image.decoding = 'async';
            mark.appendChild(image);
          } else mark.textContent = (linkHostname(link.url).charAt(0) || '·').toUpperCase();
          const open = document.createElement('button');
          open.className = 'link-open';
          open.type = 'button';
          open.dataset.action = 'open-link';
          const title = document.createElement('strong');
          title.textContent = link.title || linkHostname(link.url);
          const domain = document.createElement('span');
          domain.className = 'link-domain';
          domain.textContent = linkHostname(link.url);
          const details = document.createElement('small');
          details.className = 'link-summary';
          if (link.description) {
            const description = document.createElement('span');
            description.className = 'link-description';
            description.textContent = link.description;
            details.appendChild(description);
          }
          const tags = Domain.normalizeLinkTags(link.tags);
          if (tags.length) {
            const tagList = document.createElement('span');
            tagList.className = 'link-tag-list';
            tags.slice(0, 4).forEach((tag) => {
              const chip = document.createElement('span');
              chip.textContent = tag;
              tagList.appendChild(chip);
            });
            details.appendChild(tagList);
          }
          details.hidden = !details.childElementCount;
          const flags = document.createElement('span');
          flags.className = 'link-state-flags';
          if (link.read !== true) { const unread = document.createElement('span'); unread.className = 'unread'; unread.textContent = '未读'; flags.appendChild(unread); }
          if (link.favorite === true) { const starred = document.createElement('span'); starred.className = 'favorite'; starred.textContent = '收藏'; flags.appendChild(starred); }
          flags.hidden = !flags.childElementCount;
          open.append(title, flags, domain, details);
          const actions = document.createElement('div');
          actions.className = 'link-actions';
          const favorite = makeIconButton('toggle-link-favorite', link.favorite ? '取消收藏' : '收藏链接');
          favorite.classList.toggle('is-active', link.favorite === true);
          favorite.setAttribute('aria-pressed', String(link.favorite === true));
          const read = makeIconButton('toggle-link-read', link.read ? '标记为未读' : '标记为已读');
          read.classList.toggle('is-active', link.read === true);
          read.setAttribute('aria-pressed', String(link.read === true));
          actions.append(favorite, read, makeIconButton('open-link', '打开链接'), makeIconButton('name-link-ai', '智能生成名称、分类与标签'), makeIconButton('edit-link', '编辑链接信息'), makeIconButton('delete-link', '删除链接', true));
          row.append(mark, open, actions);
          list.appendChild(row);
        });
        body.append(list);
        if (!collapsed && links.length > limit) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'links-load-more';
          more.textContent = `再显示 ${Math.min(pageSize, links.length - limit)} 条 · 还有 ${links.length - limit} 条`;
          more.addEventListener('click', () => {
            setLimit(group.id, limit + pageSize);
            const top = linkGroupsEl.scrollTop;
            render();
            linkGroupsEl.scrollTop = top;
            const sectionAfter = [...linkGroupsEl.children].find((element) => element.dataset.groupId === String(group.id));
            const firstNew = sectionAfter?.querySelectorAll('.link-open')[limit];
            firstNew?.focus({ preventScroll: true });
            const scroller = sectionAfter?.querySelector('.link-list');
            if (scroller && firstNew) scroller.scrollTop += firstNew.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          });
          body.append(more);
        }
        section.append(header, body);
        linkGroupsEl.appendChild(section);
        list.scrollTop = groupScroll.get(String(group.id)) || 0;
      });
    }

    return render;
  }

  window.NotchWorkspaceLinksRenderer = Object.freeze({ createRenderer });
})();
