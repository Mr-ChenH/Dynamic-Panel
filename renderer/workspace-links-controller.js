(function exposeWorkspaceLinksController() {
  function createController(host) {
    const {
      elements,
      getGroups,
      getSelection,
      clearSelection,
      clearLimits,
      clearSelectionAnchor,
      persist,
      render,
      setStatus,
      addLink,
      deleteSelected,
    } = host;
    const {
      linkInput,
      linkBulkDelete,
      linksSearch,
      groupFilter,
      viewFilter,
      tagFilter,
      linksSidebar,
      linksSidebarGroups,
      linksSidebarTags,
      linksCollapseAll,
      linksAddSubmit,
    } = elements;

    function resetView() {
      clearLimits();
      clearSelection();
      clearSelectionAnchor();
      render();
      const groups = elements.linkGroups;
      if (groups) groups.scrollTop = 0;
    }

    linksSearch?.addEventListener('input', resetView);
    groupFilter?.addEventListener('change', resetView);
    viewFilter?.addEventListener('change', resetView);
    tagFilter?.addEventListener('change', resetView);

    linksSidebar?.addEventListener('wheel', (event) => {
      if (!event.deltaY || event.ctrlKey) return;
      const maxScroll = Math.max(0, linksSidebar.scrollHeight - linksSidebar.clientHeight);
      if (!maxScroll) return;
      const next = Math.max(0, Math.min(maxScroll, linksSidebar.scrollTop + event.deltaY));
      if (next === linksSidebar.scrollTop) return;
      event.preventDefault();
      linksSidebar.scrollTop = next;
    }, { passive: false });

    document.querySelector('.links-sidebar-nav')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-links-sidebar-view]');
      if (!button || !viewFilter) return;
      viewFilter.value = button.dataset.linksSidebarView || 'all';
      resetView();
    });
    linksSidebarGroups?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-links-sidebar-group]');
      if (!button || !groupFilter) return;
      groupFilter.value = button.dataset.linksSidebarGroup || '';
      resetView();
    });
    linksSidebarTags?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-links-sidebar-tag]');
      if (!button || !tagFilter) return;
      tagFilter.value = button.dataset.linksSidebarTag || '';
      resetView();
    });

    linksCollapseAll?.addEventListener('click', () => {
      const groups = getGroups();
      const collapse = groups.some((group) => !group.collapsed);
      groups.forEach((group) => { group.collapsed = collapse; });
      persist();
      render();
    });

    function submit(value, groupId = '') {
      if (!linkInput) return;
      if (addLink(value, groupId)) linkInput.value = '';
      linkInput.focus();
    }
    linkInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      submit(linkInput.value);
    });
    linksAddSubmit?.addEventListener('click', () => submit(linkInput.value));

    linkBulkDelete?.addEventListener('click', () => {
      if (!getSelection().size) return;
      deleteSelected();
      setStatus('已删除所选链接');
    });

    return Object.freeze({ resetView });
  }

  window.NotchWorkspaceLinksController = Object.freeze({ createController });
})();
