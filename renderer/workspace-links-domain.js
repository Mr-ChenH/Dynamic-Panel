(function exposeWorkspaceLinksDomain() {
  const Domain = window.NotchDomain;
  if (!Domain) return;

  function normalizeLink(link) {
    const source = link && typeof link === 'object' ? link : {};
    return {
      ...source,
      title: String(source.title || '未命名').trim() || '未命名',
      description: String(source.description || '').trim().slice(0, 500),
      tags: Domain.normalizeLinkTags(source.tags),
      favorite: source.favorite === true,
      read: source.read === true,
      note: String(source.note || '').trim().slice(0, 2000),
    };
  }

  function normalizeGroups(value) {
    if (!Array.isArray(value)) return [];
    return value.map((group) => ({
      ...(group && typeof group === 'object' ? group : {}),
      links: (Array.isArray(group?.links) ? group.links : []).map(normalizeLink),
    }));
  }

  function linkContext(groups, id) {
    for (const group of normalizeGroups(groups)) {
      const link = (group.links || []).find((item) => String(item.id) === String(id));
      if (!link) continue;
      const tags = Domain.normalizeLinkTags(link.tags);
      return {
        sourceType: 'link',
        sourceId: link.id,
        sourceTitle: link.title,
        text: `URL: ${link.url}\n网页标题: ${link.title}${link.description ? `\n网页描述: ${link.description}` : ''}${tags.length ? `\n标签: ${tags.join('、')}` : ''}${link.note ? `\n私人备注: ${link.note}` : ''}`,
        createdAt: link.createdAt || Date.now(),
        updatedAt: link.updatedAt || link.createdAt || Date.now(),
      };
    }
    return null;
  }

  function chatRows(groups) {
    return normalizeGroups(groups).flatMap((group) => (group.links || []).map((link) => {
      const tags = Domain.normalizeLinkTags(link.tags);
      return {
        sourceType: 'link',
        sourceId: link.id,
        sourceTitle: link.title || link.url,
        sourceRevision: String(link.updatedAt || link.createdAt || ''),
        text: `URL: ${link.url}\n网页标题: ${link.title || ''}${link.description ? `\n网页描述: ${link.description}` : ''}${tags.length ? `\n标签: ${tags.join('、')}` : ''}${link.note ? `\n私人备注: ${link.note}` : ''}`,
        detail: `${group.name || '未分组'}${link.favorite ? ' · 收藏' : ''}${link.read ? ' · 已读' : ' · 未读'}`,
        updatedAt: link.updatedAt || link.createdAt || 0,
      };
    }));
  }

  window.NotchWorkspaceLinksDomain = Object.freeze({
    normalizeLink,
    normalizeGroups,
    linkContext,
    chatRows,
  });
})();
