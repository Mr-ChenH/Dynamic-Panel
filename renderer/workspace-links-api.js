(function exposeWorkspaceLinksApi() {
  function createApi(host) {
    const {
      Domain,
      LinksDomain,
      getGroups,
      setGroups,
      allLinks,
      addLink,
      persist,
      render,
      syncWorkspaceData,
      uid,
      linkLimits,
      pageSize,
      elements,
    } = host;

    return Object.freeze({
      hasLink: (id) => getGroups().some((group) => (group.links || []).some((link) => String(link.id) === String(id))),
      async saveCapturedLink(rawValue) {
        const normalized = Domain.normalizeHttpUrl(rawValue);
        if (!normalized) return { ok: false, error: 'invalid_url' };
        if (allLinks().some((link) => link.url === normalized)) return { ok: false, error: 'duplicate' };
        if (!addLink(normalized)) return { ok: false, error: 'save_failed' };
        return { ok: true, workspaceSynced: await syncWorkspaceData() };
      },
      selectLink(id) {
        const groups = getGroups();
        const group = groups.find((item) => (item.links || []).some((link) => String(link.id) === String(id)));
        if (!group) return false;
        if (elements.linksSearch) elements.linksSearch.value = '';
        if (elements.groupFilter) elements.groupFilter.value = '';
        const index = (group.links || []).findIndex((link) => String(link.id) === String(id));
        linkLimits.set(group.id, Math.max(pageSize, Math.ceil((index + 1) / pageSize) * pageSize));
        group.collapsed = false;
        render();
        requestAnimationFrame(() => {
          const row = document.querySelector(`[data-link-id="${CSS.escape(String(id))}"]`);
          row?.scrollIntoView({ block: 'center' });
          row?.querySelector('button')?.focus();
        });
        return true;
      },
      linkContext(id) {
        return LinksDomain?.linkContext(getGroups(), id) || null;
      },
      async applyAIName(source, titleValue, categoryValue, tagsValue = '') {
        if (source?.sourceType !== 'link') return { ok: false, error: 'invalid_source' };
        const title = String(titleValue || '').trim().slice(0, 80);
        const category = String(categoryValue || '').trim().slice(0, 14);
        const suggestedTags = String(tagsValue || '').trim() ? Domain.normalizeLinkTags(tagsValue) : null;
        if (!title) return { ok: false, error: 'missing_title' };
        const groups = getGroups();
        const beforeGroup = groups.find((group) => (group.links || []).some((item) => item.id === source.sourceId));
        const link = beforeGroup && (beforeGroup.links || []).find((item) => item.id === source.sourceId);
        if (!link || LinksDomain?.linkContext(groups, link.id)?.text.trim() !== source.text.trim() || link.title !== source.sourceTitle) return { ok: false, error: 'source_changed' };
        const previousGroups = structuredClone(groups);
        let targetGroup = category ? groups.find((group) => group.name === category) : beforeGroup;
        let createdGroupId = '';
        if (!targetGroup) {
          targetGroup = { id: uid('group'), name: category, collapsed: false, links: [] };
          createdGroupId = targetGroup.id;
          groups.push(targetGroup);
        }
        const nextTags = suggestedTags || Domain.normalizeLinkTags(link.tags);
        const undo = {
          sourceType: 'link', id: link.id, url: link.url,
          beforeTitle: link.title, beforeTags: Domain.normalizeLinkTags(link.tags), beforeGroupId: beforeGroup.id,
          afterTitle: title, afterTags: nextTags, afterGroupId: targetGroup.id, createdGroupId,
        };
        link.title = title;
        link.tags = nextTags;
        if (targetGroup !== beforeGroup) {
          beforeGroup.links = beforeGroup.links.filter((item) => item.id !== link.id);
          targetGroup.links.push(link);
        }
        if (!persist()) {
          setGroups(previousGroups);
          return { ok: false, error: 'save_failed' };
        }
        render();
        return { ok: true, undo, workspaceSynced: await syncWorkspaceData() };
      },
      async undoAIName(token) {
        if (token?.sourceType !== 'link') return { ok: false, error: 'invalid_source' };
        const groups = getGroups();
        const previousGroups = structuredClone(groups);
        const afterGroup = groups.find((group) => group.id === token.afterGroupId);
        const link = afterGroup && (afterGroup.links || []).find((item) => item.id === token.id);
        const beforeGroup = groups.find((group) => group.id === token.beforeGroupId);
        if (!link || !beforeGroup || link.title !== token.afterTitle || link.url !== token.url || JSON.stringify(Domain.normalizeLinkTags(link.tags)) !== JSON.stringify(Domain.normalizeLinkTags(token.afterTags))) return { ok: false, error: 'conflict' };
        link.title = token.beforeTitle;
        link.tags = Domain.normalizeLinkTags(token.beforeTags);
        if (afterGroup !== beforeGroup) {
          afterGroup.links = afterGroup.links.filter((item) => item.id !== link.id);
          beforeGroup.links.push(link);
        }
        if (token.createdGroupId && afterGroup.links.length === 0) setGroups(groups.filter((group) => group.id !== token.createdGroupId));
        if (!persist()) {
          setGroups(previousGroups);
          return { ok: false, error: 'save_failed' };
        }
        render();
        return { ok: true, workspaceSynced: await syncWorkspaceData() };
      },
    });
  }

  window.NotchWorkspaceLinksApi = Object.freeze({ createApi });
})();
