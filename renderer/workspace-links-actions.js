(function exposeWorkspaceLinksActions() {
  function createController(host) {
    const {
      Domain,
      elements,
      getGroups,
      setGroups,
      getSelection,
      setSelection,
      getSelectionAnchor,
      setSelectionAnchor,
      getAddingGroupId,
      setAddingGroupId,
      persist,
      render,
      addLink,
    } = host;
    const { linkGroupsEl } = elements;

    function findLink(group, linkId) {
      return group && (group.links || []).find((link) => link.id === linkId);
    }

    function editLink(row, link) {
      const openButton = row.querySelector('.link-open');
      if (!openButton) return;
      const editor = document.createElement('div');
      editor.className = 'link-edit-fields';
      const titleInput = document.createElement('input');
      titleInput.className = 'link-title-edit';
      titleInput.value = link.title || '';
      titleInput.placeholder = '链接名称';
      titleInput.setAttribute('aria-label', '链接名称');
      titleInput.dataset.linkEditInput = 'title';
      const descriptionInput = document.createElement('input');
      descriptionInput.className = 'link-description-edit';
      descriptionInput.value = link.description || '';
      descriptionInput.placeholder = '网页描述';
      descriptionInput.setAttribute('aria-label', '网页描述');
      descriptionInput.dataset.linkEditInput = 'description';
      const tagsInput = document.createElement('input');
      tagsInput.className = 'link-tags-edit';
      tagsInput.value = Domain.normalizeLinkTags(link.tags).join(', ');
      tagsInput.placeholder = '标签，用逗号分隔';
      tagsInput.setAttribute('aria-label', '链接标签');
      tagsInput.dataset.linkEditInput = 'tags';
      const noteInput = document.createElement('textarea');
      noteInput.className = 'link-note-edit';
      noteInput.value = link.note || '';
      noteInput.placeholder = '私人备注';
      noteInput.setAttribute('aria-label', '私人备注');
      noteInput.dataset.linkEditInput = 'note';
      editor.append(titleInput, descriptionInput, tagsInput, noteInput);
      openButton.replaceWith(editor);
      let finished = false;
      const finish = (save) => {
        if (finished) return;
        finished = true;
        if (save) {
          link.title = titleInput.value.trim() || link.title || '未命名';
          link.description = descriptionInput.value.trim().slice(0, 500);
          link.tags = Domain.normalizeLinkTags(tagsInput.value);
          link.note = noteInput.value.trim().slice(0, 2000);
          link.updatedAt = Date.now();
          persist();
        }
        render();
      };
      editor.addEventListener('focusout', () => setTimeout(() => {
        if (!editor.contains(document.activeElement)) finish(true);
      }, 0));
      editor.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
        if (event.key === 'Enter' && !event.isComposing && !event.target.matches('.link-note-edit')) {
          event.preventDefault();
          event.target.blur();
        }
      });
      titleInput.focus();
      titleInput.select();
    }

    linkGroupsEl?.addEventListener('change', (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      const groups = getGroups();
      if (event.target.matches('.group-name-input')) {
        setGroups(Domain.renameGroup(groups, groupSection.dataset.groupId, event.target.value));
        persist();
        render();
      }
      if (!event.target.matches('.link-title-edit, .link-description-edit, .link-tags-edit, .link-note-edit')) return;
      const row = event.target.closest('[data-link-id]');
      const group = groups.find((item) => item.id === groupSection.dataset.groupId);
      const link = findLink(group, row && row.dataset.linkId);
      if (link) {
        if (event.target.matches('.link-title-edit') && event.target.value.trim()) link.title = event.target.value.trim();
        if (event.target.matches('.link-description-edit')) link.description = event.target.value.trim().slice(0, 500);
        if (event.target.matches('.link-tags-edit')) link.tags = Domain.normalizeLinkTags(event.target.value);
        if (event.target.matches('.link-note-edit')) link.note = event.target.value.trim().slice(0, 2000);
        link.updatedAt = Date.now();
      }
      persist();
      render();
    });

    linkGroupsEl?.addEventListener('keydown', (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('[data-group-link-input]')) {
        if (event.key === 'Escape') {
          setAddingGroupId('');
          render();
        } else if (event.key === 'Enter' && !event.isComposing && !event.repeat) {
          event.preventDefault();
          if (addLink(event.target.value, groupSection.dataset.groupId)) {
            setAddingGroupId('');
            render();
          }
        }
        return;
      }
      if (event.target.matches('.group-name-input') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
      if (event.target.matches('.link-title-edit, .link-description-edit, .link-tags-edit, .link-note-edit') && event.key === 'Enter' && !event.target.matches('.link-note-edit')) {
        event.preventDefault();
        event.target.blur();
      }
    });

    linkGroupsEl?.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      const groupId = groupSection.dataset.groupId;
      const groups = getGroups();
      const group = groups.find((item) => item.id === groupId);
      const row = event.target.closest('[data-link-id]');
      const link = findLink(group, row && row.dataset.linkId);
      if (event.shiftKey && link) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          [...linkGroupsEl.querySelectorAll('.link-item[data-link-id]')].map((item) => item.dataset.linkId),
          [...getSelection()],
          link.id,
          getSelectionAnchor(),
          true
        );
        setSelection(new Set(result.selected));
        setSelectionAnchor(result.anchor);
        render();
        return;
      }
      if (link) setSelectionAnchor(link.id);
      if (!action) return;
      if (action.dataset.action === 'add-link-to-group') {
        setAddingGroupId(groupId);
        group.collapsed = false;
        persist();
        render();
        requestAnimationFrame(() => linkGroupsEl.querySelector(`[data-group-id="${CSS.escape(groupId)}"] [data-group-link-input]`)?.focus());
      }
      if (action.dataset.action === 'cancel-group-link-add') {
        setAddingGroupId('');
        render();
      }
      if (action.dataset.action === 'toggle-group') {
        group.collapsed = !group.collapsed;
        persist();
        render();
      }
      if (action.dataset.action === 'delete-group') {
        (group.links || []).forEach((item) => getSelection().delete(item.id));
        setGroups(groups.filter((item) => item.id !== groupId));
        persist();
        render();
      }
      if (action.dataset.action === 'open-link' && link && window.notchAPI) {
        link.read = true;
        link.lastOpenedAt = Date.now();
        link.updatedAt = link.updatedAt || Date.now();
        persist();
        window.notchAPI.openExternal(link.url);
        render();
      }
      if (action.dataset.action === 'toggle-link-favorite' && link) {
        link.favorite = link.favorite !== true;
        link.updatedAt = Date.now();
        persist();
        render();
      }
      if (action.dataset.action === 'toggle-link-read' && link) {
        link.read = link.read !== true;
        link.updatedAt = Date.now();
        persist();
        render();
      }
      if (action.dataset.action === 'delete-link' && link) {
        group.links = group.links.filter((item) => item.id !== link.id);
        getSelection().delete(link.id);
        persist();
        render();
      }
      if (action.dataset.action === 'name-link-ai' && link) window.NotchAI?.openLinkName?.(link.id);
      if (action.dataset.action === 'edit-link' && link && row) editLink(row, link);
    });
  }

  window.NotchWorkspaceLinksActions = Object.freeze({ createController });
})();
