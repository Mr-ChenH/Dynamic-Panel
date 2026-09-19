(function exposeClipboardController() {
  function createController(host = {}) {
    const { generateId, escapeHtml, showStatusToast, setActiveTab, store } = host;

// ============ 首页 · 收藏剪贴 ============
const clipfavListEl = document.getElementById('clipfav-list');

function renderClipFavs() {
  if (!clipfavListEl) return;
  // 脏标记：clipHistory / clipFavorites / clipImageCache 均未变则跳过重建
  if (clipDataVersion === lastRenderedFavsVersion) return;

  // 按 clipFavorites 顺序取条目（过滤掉已删的）
  const favEntries = clipFavorites
    .map((id) => clipHistory.find((e) => e.id === id))
    .filter(Boolean);

  if (!favEntries.length) {
    clipfavListEl.innerHTML =
      '<button class="clipfav-empty" type="button" data-action="goto-clip">' +
      '去"剪贴板"Tab 给常用记录加星 →' +
      '</button>';
    lastRenderedFavsVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  // 渲染每条收藏
  clipfavListEl.innerHTML = favEntries
    .map((entry) => {
      const safeId = escapeHtml(entry.id);

      if (entry.type === 'image') {
        const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
        const mediaHtml = dataUrl
          ? `<img class="clipfav-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
          : `<div class="clipfav-thumb-placeholder">图</div>`;
        return (
          `<div class="clipfav-item clip-type-image" data-id="${safeId}" role="button" tabindex="0" title="图片">` +
          mediaHtml +
          `<span class="clipfav-text">图片</span>` +
          `</div>`
        );
      }

      // text | url
      const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
      const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
      let preview = entry.text || '';
      if (isUrl) {
        try {
          preview = new URL(entry.text).hostname || entry.text;
        } catch (_) {
          preview = entry.text || '';
        }
      }
      const safePreview = escapeHtml(preview);
      const safeTitle = escapeHtml(entry.text || '');
      return (
        `<div class="clipfav-item ${typeClass}" data-id="${safeId}" role="button" tabindex="0" title="${safeTitle}">` +
        `<span class="clipfav-text">${safePreview}</span>` +
        `</div>`
      );
    })
    .join('');
  lastRenderedFavsVersion = clipDataVersion; // 标记本次渲染版本

  // 按需预加载图片缩略图（命中后二次渲染刷新）
  // preloadClipImage 会自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  const missingImageEntries = favEntries.filter(
    (e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath)
  );
  if (missingImageEntries.length > 0) {
    Promise.all(missingImageEntries.map((e) => preloadClipImage(e.imagePath))).then(() => {
      const anyLoaded = missingImageEntries.some((e) => clipImageCache.has(e.imagePath));
      if (anyLoaded) renderClipFavs();
    });
  }
}

if (clipfavListEl) {
  clipfavListEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    // 空态：跳转 clip Tab
    if (e.target.closest('[data-action="goto-clip"]')) {
      setActiveTab('clip');
      return;
    }
    // 条目点击：复制
    const item = e.target.closest('.clipfav-item[data-id]');
    if (item) {
      const id = item.dataset.id;
      if (await copyClipEntry(id)) {
        item.classList.add('copied');
        setTimeout(() => item.classList.remove('copied'), 800);
      }
    }
  });
  clipfavListEl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.repeat) return;
    const item = e.target.closest('.clipfav-item[data-id]');
    if (!item) return;
    e.preventDefault();
    if (await copyClipEntry(item.dataset.id)) {
      item.classList.add('copied');
      setTimeout(() => item.classList.remove('copied'), 800);
    }
  });
}

// ============ 剪贴板历史 ============
const CLIP_MAX = 100;
const CLIP_URL_RE = /^https?:\/\//i;
const starOutlineSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';
const starFilledSvg = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';
const clipboardStore = store || window.NotchClipboardStore.createController({
  generateId,
  Domain: window.NotchDomain,
  notchAPI: window.notchAPI,
  maxEntries: CLIP_MAX,
});
Object.defineProperties(window, {
  clipHistory: { configurable: true, get: () => clipboardStore.history(), set: (value) => clipboardStore.replaceHistory(value) },
  clipFavorites: { configurable: true, get: () => clipboardStore.favorites(), set: (value) => clipboardStore.replaceFavorites?.(value) },
  clipImageCache: { configurable: true, get: () => clipboardStore.imageCache() },
  clipDataVersion: { configurable: true, get: () => clipboardStore.version(), set: (value) => clipboardStore.setVersion(value) },
});
let clipFilter = 'all'; // all | text | image | faved
let lastRenderedClipVersion = -1; // renderClipList 上次渲染时的版本号
let lastRenderedFavsVersion = -1; // renderClipFavs 上次渲染时的版本号

const clipListEl = document.getElementById('clip-list');
const clipToolbarEl = document.getElementById('clip-toolbar');
const clipResultCountEl = document.getElementById('clip-result-count');
const clipClearBtn = document.getElementById('clip-clear-btn');
let clipClearArmed = false;

// 防重入标志：renderClipList 内按需图片预加载完成后的二次渲染
let clipRenderPending = false;

async function preloadClipImage(imagePath) {
  return clipboardStore.preloadImage(imagePath);
}

function clipEntryHtml(entry, faved) {
  const favClass = faved ? ' faved' : '';
  const star = faved ? starFilledSvg : starOutlineSvg;
  const favLabel = faved ? '取消收藏' : '收藏';
  const moment = window.NotchClipboardDomain.formatMoment(entry.timestamp);
  const relative = moment.relative ? `<span class="clip-time-relative">${escapeHtml(moment.relative)}</span>` : '';
  const timeHtml = `<time class="clip-time" datetime="${escapeHtml(moment.iso)}" title="${escapeHtml(moment.full)}"><span>${escapeHtml(moment.clock)}</span>${relative}</time>`;
  const safeId = escapeHtml(entry.id);

  if (entry.type === 'image') {
    const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
    const thumbHtml = dataUrl
      ? `<img class="clip-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
      : `<span class="clip-thumb-placeholder">图片加载中…</span>`;
    return `<div class="clip-item clip-item-image clip-type-image" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制图片">
    <span class="clip-thumb-wrap">${thumbHtml}</span>
    <span class="clip-meta">${timeHtml}</span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
  }

  // text | url 条目
  const safeText = escapeHtml(entry.text || '');
  const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
  const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
  const accessiblePreview = escapeHtml(
    (entry.text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '空白内容'
  );
  return `<div class="clip-item clip-item-text ${typeClass}" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制：${accessiblePreview}">
    <span class="clip-text">${safeText}</span>
    <span class="clip-meta">${timeHtml}</span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
}

function getFilteredClipItems() {
  if (clipFilter === 'all') return clipHistory;
  if (clipFilter === 'text') return clipHistory.filter((e) => e.type === 'text' || e.type === 'url');
  if (clipFilter === 'image') return clipHistory.filter((e) => e.type === 'image');
  if (clipFilter === 'faved') {
    const favSet = new Set(clipFavorites);
    return clipHistory.filter((e) => favSet.has(e.id));
  }
  return clipHistory;
}

function renderClipList() {
  if (!clipListEl) return;
  // 脏标记：数据/过滤器/图片缓存均未变则跳过全量重建
  if (clipDataVersion === lastRenderedClipVersion) return;

  const items = getFilteredClipItems();
  const favSet = new Set(clipFavorites);
  if (clipResultCountEl) clipResultCountEl.textContent = `${items.length} 条`;

  if (items.length === 0) {
    clipListEl.innerHTML =
      '<div class="clip-empty">' +
      (clipHistory.length ? '没有符合条件的记录' : '复制点什么，历史会出现在这里') +
      '</div>';
    lastRenderedClipVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  clipListEl.innerHTML = window.NotchClipboardDomain.groupByDay(items).map((group) => {
    const headingId = `clip-day-${group.key}`;
    return `<section class="clip-timeline-group" aria-labelledby="${headingId}">
  <div class="clip-timeline-heading">
    <span class="clip-timeline-node" aria-hidden="true"></span>
    <time id="${headingId}" datetime="${group.key}">${escapeHtml(window.NotchClipboardDomain.formatDay(group.timestamp))}</time>
    <span>${group.items.length} 条</span>
  </div>
  <div class="clip-timeline-items">${group.items.map((entry) => clipEntryHtml(entry, favSet.has(entry.id))).join('')}</div>
</section>`;
  }).join('');
  lastRenderedClipVersion = clipDataVersion; // 标记本次渲染版本（在预加载之前）

  // 按需预加载图片：收集当前 items 里 cache 未命中的 image 条目
  // preloadClipImage 成功后自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  if (clipRenderPending) return; // 防重入：已有预加载任务在途
  const missingPaths = items
    .filter((e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath))
    .map((e) => e.imagePath);

  if (missingPaths.length === 0) return;

  clipRenderPending = true;
  Promise.all(missingPaths.map((p) => preloadClipImage(p)))
    .then(() => {
      clipRenderPending = false;
      // 只有至少有一条路径成功填入 cache 才重渲，避免无意义刷新
      const anyLoaded = missingPaths.some((p) => clipImageCache.has(p));
      if (anyLoaded) renderClipList();
    })
    .catch(() => {
      clipRenderPending = false;
    });
}

// ---- 工具栏事件委托 ----
if (clipToolbarEl) {
  clipToolbarEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const filterBtn = e.target.closest('.clip-filter');
    if (filterBtn) {
      clipFilter = filterBtn.dataset.filter || 'all';
      clipToolbarEl.querySelectorAll('.clip-filter').forEach((b) => {
        const selected = b === filterBtn;
        b.classList.toggle('active', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
      clipDataVersion++; // clipFilter 已变 → 输出变化
      renderClipList();
      return;
    }
    if (e.target.closest('#clip-clear-btn')) {
      requestClearClipHistory();
    }
  });
  clipToolbarEl.querySelectorAll('.clip-filter').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
  });
}

// ---- 列表事件委托 ----
if (clipListEl) {
  clipListEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.clip-item');
    if (!item) return;
    const id = item.dataset.id;
    if (!id) return;

    // 优先判断子按钮
    const favoriteButton = e.target.closest('.clip-fav-btn');
    if (favoriteButton) {
      toggleClipFavorite(id, {
        restoreFocus: document.activeElement === favoriteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    const deleteButton = e.target.closest('.clip-del-btn');
    if (deleteButton) {
      deleteClipEntry(id, {
        restoreFocus: document.activeElement === deleteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    if (e.target.closest('[data-action="copy"]')) copyClipEntry(id);
  });
}

function focusClipControl(ids, action = 'copy') {
  if (!clipListEl) return;
  for (const id of ids.filter(Boolean)) {
    const target = clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="${action}"]`
    );
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
  }
  const activeFilter = clipToolbarEl && clipToolbarEl.querySelector('.clip-filter.active');
  if (activeFilter) activeFilter.focus({ preventScroll: true });
}

function toggleClipFavorite(id, focusContext = null) {
  clipboardStore.toggleFavorite(id);
  renderClipList();
  renderClipFavs();
  if (focusContext && focusContext.restoreFocus) {
    const sameItemButton = clipListEl && clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="fav"]`
    );
    if (sameItemButton) {
      sameItemButton.focus({ preventScroll: true });
    } else {
      focusClipControl([focusContext.nextId, focusContext.previousId]);
    }
  }
}

function deleteClipEntry(id, focusContext = null) {
  const snapshot = clipboardStore.removeEntry(id);
  if (!snapshot) return;
  const { entry } = snapshot;
  renderClipList();
  renderClipFavs();
  if (focusContext && focusContext.restoreFocus) {
    focusClipControl([focusContext.nextId, focusContext.previousId]);
  }
  showStatusToast('已删除剪贴记录', {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      if (!clipboardStore.restoreEntry(snapshot)) return;
      renderClipList();
      renderClipFavs();
      focusClipControl([id]);
      showStatusToast('已撤销删除');
    },
    onExpire: () => {
      if (entry.type !== 'image' || !entry.imagePath) return;
      clipImageCache.delete(entry.imagePath);
      if (window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
        window.notchAPI.deleteClipImages([entry.imagePath]).catch(() => {});
      }
    },
  });
}

function resetClipClearConfirmation() {
  clipClearArmed = false;
  if (clipClearBtn) {
    clipClearBtn.classList.remove('confirming');
    clipClearBtn.setAttribute('aria-label', '清空历史');
  }
}

function requestClearClipHistory() {
  if (clipHistory.length === 0) {
    showStatusToast('剪贴板历史已是空的');
    return;
  }
  if (!clipClearArmed) {
    clipClearArmed = true;
    if (clipClearBtn) {
      clipClearBtn.classList.add('confirming');
      clipClearBtn.setAttribute('aria-label', `再次点击确认清空 ${clipHistory.length} 条历史`);
    }
    showStatusToast(`再点一次垃圾桶，清空 ${clipHistory.length} 条记录`, {
      duration: 3000,
      onExpire: resetClipClearConfirmation,
    });
    return;
  }
  resetClipClearConfirmation();
  clearClipHistory();
}

if (clipClearBtn) {
  clipClearBtn.addEventListener('keydown', (event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
    }
  });
}

function clearClipHistory() {
  const removedCount = clipHistory.length;
  const imagePaths = clipboardStore.clear();
  if (imagePaths.length > 0 && window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
    window.notchAPI.deleteClipImages(imagePaths).catch(() => {});
  }
  renderClipList();
  renderClipFavs();
  showStatusToast(`已清空 ${removedCount} 条剪贴记录`);
}

async function copyClipEntry(id) {
  const entry = clipHistory.find((e) => e.id === id);
  if (!entry) return false;
  if (!window.notchAPI) return false;
  try {
    const result = typeof window.notchAPI.pasteClipboard === 'function'
      ? await window.notchAPI.pasteClipboard(entry)
      : { ok: await window.notchAPI.writeClipboard(entry), pasted: false };
    if (!result?.ok) {
      showStatusToast('复制失败，请重试');
      return false;
    }
    showStatusToast(result.pasted
      ? '已填入刚才的输入框'
      : result.permissionRequired
        ? '请开启辅助功能权限；内容已复制'
        : entry.type === 'image' ? '图片已复制，可直接粘贴' : '已复制，可直接粘贴');
  } catch (e) {
    showStatusToast('复制失败，请重试');
    return false;
  }
  // 视觉反馈：800ms 后移除 copied 类
  const itemEl = clipListEl && clipListEl.querySelector(`.clip-item[data-id="${CSS.escape(id)}"]`);
  if (itemEl) {
    itemEl.classList.add('copied');
    setTimeout(() => itemEl.classList.remove('copied'), 800);
  }
  return true;
}

// ---- 剪贴板 store 变更监听 ----
clipboardStore.subscribe(() => {
  renderClipList();
  renderClipFavs();
});

const api = Object.freeze({
  chatContexts: () => clipHistory.filter((entry) => entry.type !== 'image' && entry.text?.trim()).map((entry) => ({
    sourceType: 'clipboard',
    sourceId: entry.id,
    sourceTitle: entry.type === 'url' ? '剪贴板链接' : String(entry.text).replace(/\s+/g, ' ').trim().slice(0, 48),
    sourceRevision: String(entry.timestamp || ''),
    text: entry.text,
    detail: new Date(entry.timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    updatedAt: entry.timestamp || 0,
  })),
});


    window.renderClipList = renderClipList;
    window.renderClipFavs = renderClipFavs;
    window.clearClipHistory = clearClipHistory;
    renderClipList();
    renderClipFavs();
    return Object.freeze({ ...api, render: () => { renderClipList(); renderClipFavs(); }, renderList: renderClipList, renderFavs: renderClipFavs });
  }

  window.NotchClipboardController = Object.freeze({ createController });
})();
