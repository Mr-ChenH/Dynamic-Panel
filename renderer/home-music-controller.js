(function exposeHomeMusicController() {
  function createController(host = {}) {
    const $ = host.$ || ((id) => document.getElementById(id));
    const documentRef = host.document || document;
    const windowRef = host.window || window;
    const storage = host.storage || windowRef.localStorage;
    const getApi = host.getApi || (() => host.api || windowRef.notchAPI);
    const setText = host.setText || ((element, text) => { if (element && element.textContent !== text) element.textContent = text; });
    const navigate = host.navigate || (async () => {});
    const MUSIC_DISCOVERY_FILTER_KEY = 'notch-home-music-discovery-filter-v1';
    const MUSIC_SHUFFLE_KEY = 'notch-home-music-shuffle-v1';
    const read = (key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
    const musicAudio = $('home-music-audio');
    const musicCover = $('home-media-cover');
    if (!musicAudio || !musicCover) return Object.freeze({ dispose() {} });

    let musicLibrary = { sourceId: 'built-in', playlistId: 'local', sources: [], playlists: [], tracks: [] };
    let activeMusicId = storage.getItem('notch-home-music-track-v1') || '';
    let loadedMusicId = '', musicObjectUrl = '', musicLoadEpoch = 0, musicLoading = false;
    let musicImporting = false, musicSelectionBusy = false;
    let musicShuffle = storage.getItem(MUSIC_SHUFFLE_KEY) === 'true';
    let musicShuffleKey = '', musicShuffleRemaining = [];
    let musicPlaybackIntent = false, musicResumeAfterTabChange = false;
    let musicCatalogView = 'mine', homeMusicDiscoveryOpen = false;
    let homeMusicDiscoverySourceId = '', homeMusicDiscoveryCategoryId = '';
    let musicCoverTrackId = '', musicCoverObjectUrl = '', musicCoverEpoch = 0;
    const savedMusicDiscoveryFilter = read(MUSIC_DISCOVERY_FILTER_KEY, {});
    if (savedMusicDiscoveryFilter && typeof savedMusicDiscoveryFilter === 'object') {
      homeMusicDiscoverySourceId = String(savedMusicDiscoveryFilter.sourceId || '');
      homeMusicDiscoveryCategoryId = String(savedMusicDiscoveryFilter.categoryId || '');
    }

    function saveMusicDiscoveryFilter(sourceId, categoryId = homeMusicDiscoveryCategoryId) {
      homeMusicDiscoverySourceId = sourceId || homeMusicDiscoverySourceId;
      homeMusicDiscoveryCategoryId = categoryId || '';
      storage.setItem(MUSIC_DISCOVERY_FILTER_KEY, JSON.stringify({ sourceId: homeMusicDiscoverySourceId, categoryId: homeMusicDiscoveryCategoryId }));
    }

    const musicArtworkUrls = new Map();
    const musicArtworkRefs = new WeakMap();
    const musicArtworkObserver = new windowRef.IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      musicArtworkObserver.unobserve(entry.target);
      void loadPlaylistArtwork(entry.target, musicArtworkRefs.get(entry.target));
    }), { rootMargin: '60px' });

    function musicTime(seconds) {
      const value = Math.max(0, Math.floor(Number(seconds) || 0));
      return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
    }

    function normalizeMusicResult(result) {
      if (!result?.ok) return null;
      if (Array.isArray(result.sources)) {
        return {
          sourceId: String(result.sourceId || 'built-in'),
          playlistId: String(result.playlistId || 'local'),
          sources: result.sources,
          playlists: Array.isArray(result.playlists) ? result.playlists : [],
          tracks: Array.isArray(result.tracks) ? result.tracks : [],
          browser: result.browser && typeof result.browser === 'object' ? result.browser : null,
        };
      }
      const mode = result.mode === 'network' ? 'network' : 'local';
      const allTracks = Array.isArray(result.tracks) ? result.tracks : [];
      const playlists = ['local', 'network'].map((id) => ({
        id,
        title: id === 'local' ? '本地音乐' : '网络音乐',
        trackCount: allTracks.filter((track) => track.kind === id).length,
      }));
      return {
        sourceId: 'built-in',
        playlistId: mode,
        sources: [{ id: 'built-in', type: 'library', name: '我的音乐', playlists }],
        playlists,
        tracks: allTracks.filter((track) => track.kind === mode),
      };
    }

    const MUSIC_PROVIDER_LABELS = { netease: '网易云', qq: 'QQ 音乐', kugou: '酷狗', kuwo: '酷我', migu: '咪咕', qianqian: '千千', bilibili: 'Bilibili', jamendo: 'Jamendo', joox: 'Joox', soda: '汽水' };
    function activeMusicSource() { return musicLibrary.sources.find((source) => source.id === musicLibrary.sourceId) || musicLibrary.sources[0] || null; }
    function activeMusicPlaylist() { return musicLibrary.playlists.find((playlist) => playlist.id === musicLibrary.playlistId) || musicLibrary.playlists[0] || null; }
    function musicPlaylistLabel(playlist, source) {
      const provider = source?.type === 'music-dl' ? (MUSIC_PROVIDER_LABELS[playlist?.provider] || playlist?.provider) : '';
      return [provider, playlist?.title].filter(Boolean).join(' · ') || '未命名歌单';
    }
    function musicArtworkKey(reference) { return `${reference?.sourceId || ''}:${reference?.playlistId || ''}`; }

    async function loadPlaylistArtwork(image, reference) {
      if (!image?.isConnected || !reference) return;
      const key = musicArtworkKey(reference);
      const cached = musicArtworkUrls.get(key);
      if (cached) { image.src = cached; image.hidden = false; return; }
      const result = await Promise.resolve(getApi()?.loadHomeMusicCover?.(reference)).catch(() => null);
      if (!image.isConnected || musicArtworkRefs.get(image) !== reference || !result?.ok) return;
      const raw = result.bytes?.data || result.bytes;
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw || []);
      if (!bytes.length) return;
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'image/jpeg' }));
      musicArtworkUrls.set(key, objectUrl);
      if (musicArtworkUrls.size > 64) {
        const oldest = musicArtworkUrls.entries().next().value;
        URL.revokeObjectURL(oldest[1]);
        musicArtworkUrls.delete(oldest[0]);
      }
      image.src = objectUrl;
      image.hidden = false;
    }

    function clearPlaylistArtwork(container) {
      container?.querySelectorAll('.home-media-playlist-art img').forEach((image) => musicArtworkObserver.unobserve(image));
    }

    function createPlaylistArtwork(source, playlist, eager = false) {
      const artwork = documentRef.createElement('span');
      artwork.className = 'home-media-playlist-art';
      if (playlist?.hasCover && source?.type === 'music-dl') {
        const image = documentRef.createElement('img');
        image.alt = '';
        image.hidden = true;
        const reference = { sourceId: source.id, playlistId: playlist.id };
        musicArtworkRefs.set(image, reference);
        artwork.append(image);
        if (eager) queueMicrotask(() => void loadPlaylistArtwork(image, reference));
        else musicArtworkObserver.observe(image);
      }
      return artwork;
    }

    function musicQueue() { return musicLibrary.tracks; }
    function musicQueueKey(queue) { return `${musicLibrary.sourceId}:${musicLibrary.playlistId}:${queue.map((track) => track.id).join(',')}`; }
    function shuffledMusicTrack(current, queue) {
      const key = musicQueueKey(queue);
      if (musicShuffleKey !== key) { musicShuffleKey = key; musicShuffleRemaining = []; }
      musicShuffleRemaining = musicShuffleRemaining.filter((id) => queue.some((track) => track.id === id) && id !== current?.id);
      if (!musicShuffleRemaining.length) musicShuffleRemaining = queue.filter((track) => track.id !== current?.id).map((track) => track.id);
      if (!musicShuffleRemaining.length) return current;
      const index = Math.floor(Math.random() * musicShuffleRemaining.length);
      const nextId = musicShuffleRemaining.splice(index, 1)[0];
      return queue.find((track) => track.id === nextId) || current;
    }
    function resetMusicShuffle() { musicShuffleKey = ''; musicShuffleRemaining = []; }
    function activeMusicTrack() {
      const loaded = musicLibrary.tracks.find((track) => track.id === loadedMusicId);
      if (loaded) return loaded;
      return musicLibrary.tracks.find((track) => track.id === activeMusicId) || musicLibrary.tracks[0] || null;
    }
    function rememberActiveMusic(track) {
      activeMusicId = track?.id || '';
      if (activeMusicId) storage.setItem('notch-home-music-track-v1', activeMusicId);
      else storage.removeItem('notch-home-music-track-v1');
    }
    function releaseMusicSource() {
      ++musicLoadEpoch;
      musicLoading = false;
      musicResumeAfterTabChange = false;
      musicPlaybackIntent = false;
      musicAudio.pause();
      musicAudio.removeAttribute('src');
      musicAudio.load();
      loadedMusicId = '';
      if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl);
      musicObjectUrl = '';
    }
    function fillMusicSelect(select, entries, selectedId, label = (entry) => entry.title || entry.name) {
      if (!select) return;
      select.replaceChildren();
      entries.forEach((entry) => {
        const option = documentRef.createElement('option');
        option.value = entry.id;
        option.textContent = label(entry);
        select.append(option);
      });
      select.value = selectedId || '';
    }
    function homeDiscoverySource() {
      const selected = musicLibrary.sources.find((source) => source.id === homeMusicDiscoverySourceId && source.type === 'music-dl');
      return selected || (activeMusicSource()?.type === 'music-dl' ? activeMusicSource() : musicLibrary.sources.find((source) => source.type === 'music-dl')) || null;
    }

    function renderHomeMusicDiscovery() {
      const panel = $('home-media-discovery');
      if (!panel) return;
      const source = homeDiscoverySource();
      const browser = source ? (source.id === musicLibrary.sourceId ? musicLibrary.browser : source.browser) : null;
      panel.hidden = !homeMusicDiscoveryOpen;
      const sourceSelect = $('home-media-source-select');
      fillMusicSelect(sourceSelect, musicLibrary.sources.filter((item) => item.type === 'music-dl'), source?.id, (item) => item.name);
      const platformSelect = $('home-media-platform-select');
      fillMusicSelect(platformSelect, Array.isArray(browser?.platformSources) ? browser.platformSources : [], browser?.activePlatform, (item) => item.name || item.id);
      const categorySelect = $('home-media-category-select');
      categorySelect.replaceChildren();
      const all = documentRef.createElement('option'); all.value = ''; all.textContent = '全部分类'; categorySelect.append(all);
      const platformCapability = browser?.platformSources?.find((item) => item.id === browser.activePlatform);
      if (platformCapability?.recommend) { const option = documentRef.createElement('option'); option.value = '__recommend__'; option.textContent = '每日推荐'; categorySelect.append(option); }
      if (platformCapability?.userPlaylists) { const option = documentRef.createElement('option'); option.value = '__user__'; option.textContent = '我的收藏夹'; categorySelect.append(option); }
      (browser?.categories || []).forEach((category) => { const option = documentRef.createElement('option'); option.value = category.id; option.textContent = category.group ? `${category.group} · ${category.name}` : category.name; categorySelect.append(option); });
      if ([...categorySelect.options].some((option) => option.value === homeMusicDiscoveryCategoryId)) categorySelect.value = homeMusicDiscoveryCategoryId;
      else if (homeMusicDiscoveryCategoryId) saveMusicDiscoveryFilter(source?.id || '', '');
      [sourceSelect, platformSelect, categorySelect, $('home-media-playlist-search'), $('home-media-playlist-search-form')].forEach((control) => { if (control) control.disabled = musicSelectionBusy; });
      const results = $('home-media-online-results');
      clearPlaylistArtwork(results);
      results.replaceChildren();
      const onlinePlaylists = Array.isArray(browser?.onlinePlaylists) ? browser.onlinePlaylists : [];
      if (!source) { const empty = documentRef.createElement('span'); empty.className = 'music-online-empty'; empty.textContent = '请先在设置中添加 go-music-dl 音乐源'; results.append(empty); return; }
      if (!onlinePlaylists.length) { const empty = documentRef.createElement('span'); empty.className = 'music-online-empty'; empty.textContent = '选择平台、分类或搜索歌单'; results.append(empty); return; }
      onlinePlaylists.forEach((playlist, index) => {
        const button = documentRef.createElement('button'); button.type = 'button'; button.className = 'home-media-online-result'; button.dataset.sourceId = source.id; button.dataset.playlistId = playlist.remoteId || playlist.id; button.dataset.platform = playlist.provider || browser.activePlatform || ''; button.dataset.title = playlist.title || ''; button.disabled = musicSelectionBusy;
        const copy = documentRef.createElement('span'); const title = documentRef.createElement('strong'); title.textContent = musicPlaylistLabel(playlist, source); const description = documentRef.createElement('small'); description.textContent = playlist.description || '在线歌单'; copy.append(title, description);
        const count = documentRef.createElement('em'); count.textContent = playlist.trackCount ? `${playlist.trackCount} 首` : '打开';
        button.append(createPlaylistArtwork(source, playlist, index < 12), copy, count); button.addEventListener('click', () => { homeMusicDiscoveryOpen = false; renderHomeMusicDiscovery(); void selectOnlineMusicPlaylist(button.dataset); }); results.append(button);
      });
    }

    async function ensureHomeMusicCategories() {
      const source = homeDiscoverySource(); const browser = source ? (source.id === musicLibrary.sourceId ? musicLibrary.browser : source.browser) : null;
      const platform = browser?.activePlatform || browser?.platformSources?.[0]?.id || '';
      const capability = browser?.platformSources?.find((item) => item.id === platform);
      if (!homeMusicDiscoveryOpen || musicSelectionBusy || !source || !platform || capability?.categories !== true || browser?.categories?.length) return;
      await browseMusicOnline('browseHomeMusicCategories', { sourceId: source.id, platform }, '已加载平台分类');
    }
    async function ensureMusicSettingsCategories() {
      const musicTab = documentRef.querySelector('[data-settings-category="music"][aria-selected="true"]');
      const source = activeMusicSource(); const browser = source?.type === 'music-dl' ? (musicLibrary.browser || {}) : null;
      const platform = browser?.activePlatform || browser?.platformSources?.[0]?.id || '';
      const capability = browser?.platformSources?.find((item) => item.id === platform);
      if (!musicTab || musicSelectionBusy || !source || !platform || capability?.categories !== true || browser?.categories?.length) return;
      await browseMusicOnline('browseHomeMusicCategories', { sourceId: source.id, platform }, '已加载平台分类');
    }

    function renderMusicNavigation() {
      const sourceSelect = $('music-source-select'); const activeSource = activeMusicSource();
      fillMusicSelect(sourceSelect, musicLibrary.sources, musicLibrary.sourceId);
      const settingsPlaylists = musicCatalogView === 'mine' && activeSource?.type === 'music-dl' && Array.isArray(activeSource.playlists) ? activeSource.playlists : musicLibrary.playlists;
      fillMusicSelect($('music-playlist-select'), settingsPlaylists, musicLibrary.playlistId, (playlist) => musicPlaylistLabel(playlist, activeSource));
      const source = activeMusicSource(); const playlist = activeMusicPlaylist();
      setText($('home-media-queue-label'), playlist ? musicPlaylistLabel(playlist, source) : '选择歌单');
      const browser = source?.type === 'music-dl' ? (musicLibrary.browser || {}) : {};
      const catalogPanel = documentRef.querySelector('.music-catalog-panel');
      if (catalogPanel) catalogPanel.dataset.catalogView = musicCatalogView;
      setText($('music-catalog-view-title'), musicCatalogView === 'discover' ? '在线发现' : '我的歌单');
      setText($('music-catalog-view-copy'), musicCatalogView === 'discover' ? '按平台、分类或关键词浏览，打开后只更新当前播放队列' : '当前聚合源的已收藏或已导入歌单');
      documentRef.querySelectorAll('[data-music-catalog-view]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.musicCatalogView === musicCatalogView)));
      const platformSelect = $('music-platform-select');
      if (platformSelect) { fillMusicSelect(platformSelect, Array.isArray(browser.platformSources) ? browser.platformSources : [], browser.activePlatform, (platform) => platform.name || platform.id); platformSelect.disabled = musicSelectionBusy || !platformSelect.options.length; }
      const categorySelect = $('music-category-select');
      if (categorySelect) {
        const categories = Array.isArray(browser.categories) ? browser.categories : [];
        categorySelect.replaceChildren();
        const all = documentRef.createElement('option'); all.value = ''; all.textContent = '全部分类'; categorySelect.append(all);
        const platformCapability = browser.platformSources?.find((platform) => platform.id === browser.activePlatform);
        if (platformCapability?.recommend) { const option = documentRef.createElement('option'); option.value = '__recommend__'; option.textContent = '每日推荐'; categorySelect.append(option); }
        if (platformCapability?.userPlaylists) { const option = documentRef.createElement('option'); option.value = '__user__'; option.textContent = '我的收藏夹'; categorySelect.append(option); }
        categories.forEach((category) => { const option = documentRef.createElement('option'); option.value = category.id; option.textContent = category.group ? `${category.group} · ${category.name}` : category.name; categorySelect.append(option); });
        categorySelect.disabled = musicSelectionBusy || !platformSelect?.value || categorySelect.options.length <= 1;
      }
      const onlineResults = $('music-online-results');
      if (onlineResults) {
        onlineResults.replaceChildren();
        const results = Array.isArray(browser.onlinePlaylists) ? browser.onlinePlaylists : [];
        if (!results.length) { const empty = documentRef.createElement('span'); empty.className = 'music-online-empty'; empty.textContent = source?.type === 'music-dl' ? '选择平台、分类或搜索歌单' : '请先在上方选择聚合音乐库'; onlineResults.append(empty); }
        results.forEach((playlist) => {
          const button = documentRef.createElement('button'); button.type = 'button'; button.className = 'music-online-result'; button.dataset.playlistId = playlist.remoteId || playlist.id; button.dataset.platform = playlist.provider || browser.activePlatform || ''; button.dataset.title = playlist.title || ''; button.disabled = musicSelectionBusy;
          const title = documentRef.createElement('strong'); title.textContent = musicPlaylistLabel(playlist, source); const detail = documentRef.createElement('small'); detail.textContent = playlist.trackCount ? `${playlist.trackCount} 首${playlist.description ? ` · ${playlist.description}` : ''}` : (playlist.description || '在线歌单'); button.append(title, detail); button.addEventListener('click', () => void selectOnlineMusicPlaylist(button.dataset)); onlineResults.append(button);
        });
      }
      setText($('home-media-source-label'), source?.name || '我的音乐'); setText($('music-catalog-name'), source?.name || '聚合音乐'); setText($('music-catalog-endpoint'), source?.detail || '');
      $('music-source-refresh').disabled = musicSelectionBusy || musicCatalogView === 'discover'; $('music-catalog-refresh').disabled = musicSelectionBusy || source?.type !== 'music-dl'; $('music-catalog-remove').disabled = musicSelectionBusy || source?.type !== 'music-dl';
      documentRef.querySelectorAll('[data-music-source-panel]').forEach((panel) => { const panelName = musicCatalogView === 'discover' ? 'catalog' : source?.type === 'music-dl' ? 'catalog' : playlist?.id === 'network' ? 'network' : 'local'; panel.hidden = panel.dataset.musicSourcePanel !== panelName; });
      renderHomeMusicDiscovery();
    }

    function renderMusicProgress() {
      const duration = Number.isFinite(musicAudio.duration) ? musicAudio.duration : 0; const position = Number.isFinite(musicAudio.currentTime) ? musicAudio.currentTime : 0; const percentage = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
      $('home-media-progress').hidden = !activeMusicTrack(); $('home-media-progress-track').firstElementChild.style.width = `${percentage}%`; $('home-media-progress-track').setAttribute('aria-valuenow', String(Math.round(percentage))); $('home-media-progress-track').setAttribute('aria-valuetext', `${musicTime(position)} / ${musicTime(duration)}`); setText($('home-media-position'), musicTime(position)); setText($('home-media-duration'), musicTime(duration));
    }
    function clearMusicCover() {
      if (musicCoverObjectUrl) URL.revokeObjectURL(musicCoverObjectUrl);
      musicCoverObjectUrl = ''; musicCover.removeAttribute('src'); musicCover.hidden = true; documentRef.querySelector('.home-media').dataset.mediaCover = 'false';
    }
    async function loadMusicCover(track) {
      const epoch = ++musicCoverEpoch; let result = null;
      try { result = await getApi()?.loadHomeMusicCover?.(track.id); } catch {}
      if (epoch !== musicCoverEpoch || musicCoverTrackId !== track.id || !result?.ok) return;
      const raw = result.bytes?.data || result.bytes; const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw || []); if (!bytes.length) return;
      clearMusicCover(); musicCoverObjectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'image/jpeg' })); musicCover.src = musicCoverObjectUrl; musicCover.alt = `${track.title}封面`; musicCover.hidden = false; documentRef.querySelector('.home-media').dataset.mediaCover = 'true';
    }
    function renderMusicCard() {
      const card = documentRef.querySelector('.home-media'); const track = activeMusicTrack(); const queue = musicQueue(); const coverTrackId = track?.id || '';
      if (musicCoverTrackId !== coverTrackId) { musicCoverTrackId = coverTrackId; clearMusicCover(); if (track?.hasCover) void loadMusicCover(track); }
      if (track && track.id !== activeMusicId) rememberActiveMusic(track);
      const queueIndex = track ? queue.findIndex((item) => item.id === track.id) : -1; const playing = Boolean(track && loadedMusicId === track.id && !musicAudio.paused && !musicAudio.ended);
      card.dataset.mediaState = musicLoading ? 'loading' : track ? 'ready' : 'empty'; card.dataset.mediaPlaying = String(playing); card.dataset.mediaSource = track?.kind || 'local'; setText($('home-media-queue'), queueIndex >= 0 ? `${queueIndex + 1} / ${queue.length}` : `${queue.length} 首`);
      const title = track?.title || '还没有音乐'; setText($('home-media-title'), title); $('home-media-title').title = title; const fallback = activeMusicSource()?.type === 'music-dl' ? '当前歌单没有可播放歌曲' : '在设置中添加本地或网络音频'; setText($('home-media-artist'), track ? (track.artist || (track.kind === 'local' ? '本地音频' : track.kind === 'network' ? '网络音频' : track.provider || '聚合音乐')) : fallback); const detail = track?.album || track?.detail || ''; setText($('home-media-album'), detail); $('home-media-album').hidden = !detail;
      const toggle = documentRef.querySelector('[data-home-media="toggle"]'); const toggleLabel = playing ? '暂停' : '播放'; toggle.setAttribute('aria-label', toggleLabel); toggle.title = toggleLabel; toggle.disabled = !track || musicLoading; documentRef.querySelector('[data-home-media="previous"]').disabled = queue.length < 2 || musicLoading; documentRef.querySelector('[data-home-media="next"]').disabled = queue.length < 2 || musicLoading;
      const shuffle = documentRef.querySelector('[data-home-media="shuffle"]'); shuffle.disabled = queue.length < 2 || musicLoading; shuffle.setAttribute('aria-pressed', String(musicShuffle)); shuffle.setAttribute('aria-label', musicShuffle ? '关闭随机播放' : '开启随机播放'); shuffle.title = musicShuffle ? '关闭随机播放' : '开启随机播放'; shuffle.classList.toggle('is-active', musicShuffle); $('home-music-configure').hidden = Boolean(track || musicLibrary.sources.length > 1);
      if (musicLoading) setText($('home-media-status'), track?.kind === 'local' ? '正在读取本地音频…' : '正在获取音频…'); else if (!track) setText($('home-media-status'), '当前歌单为空'); else setText($('home-media-status'), playing ? '播放中' : loadedMusicId === track.id ? (musicAudio.ended ? '播放完毕' : '已暂停') : '准备播放'); renderMusicProgress();
    }
    function renderMusicSettings() {
      const queue = musicQueue(); const playlist = activeMusicPlaylist(); setText($('music-library-heading-label'), musicCatalogView === 'discover' ? '当前队列' : '我的歌单'); setText($('music-library-title'), playlist?.title || '当前歌单'); setText($('music-library-count'), `${queue.length} 首`);
      const list = $('music-library-list'); list.replaceChildren(); if (!queue.length) { const empty = documentRef.createElement('p'); empty.className = 'music-library-empty'; empty.textContent = '当前歌单没有歌曲'; list.append(empty); return; }
      queue.forEach((track) => { const row = documentRef.createElement('div'); row.className = `music-library-row${track.kind === 'catalog' ? ' is-readonly' : ''}`; row.dataset.trackId = track.id; const select = documentRef.createElement('button'); select.type = 'button'; select.className = 'music-library-select'; select.title = `播放 ${track.title}`; const copy = documentRef.createElement('span'); const title = documentRef.createElement('strong'); title.textContent = track.title; const detail = documentRef.createElement('small'); detail.textContent = track.detail || track.artist || track.provider || ''; copy.append(title, detail); select.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>'; select.append(copy); select.addEventListener('click', () => void loadMusicTrack(track, true)); row.append(select); if (track.kind !== 'catalog') { const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'music-library-remove'; remove.dataset.removeMusicTrack = track.id; remove.setAttribute('aria-label', `删除 ${track.title}`); remove.title = '从音乐库删除'; remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>'; row.append(remove); } list.append(row); });
    }
    function applyMusicLibrary(result) { const normalized = normalizeMusicResult(result); if (!normalized) return false; musicLibrary = normalized; if (loadedMusicId && !musicLibrary.tracks.some((track) => track.id === loadedMusicId)) releaseMusicSource(); const track = activeMusicTrack(); rememberActiveMusic(track); renderMusicNavigation(); renderMusicCard(); renderMusicSettings(); return true; }
    function musicError(result, fallback) { const errors = { invalid_catalog_url: '仅支持本机 go-music-dl HTTP 地址', catalog_unavailable: '无法连接 go-music-dl 服务', invalid_catalog_response: '音乐源返回的数据无效', catalog_response_too_large: '音乐源返回的数据超过限制', playlist_unavailable: '当前歌单读取失败', playlist_search_unavailable: '在线歌单搜索失败', categories_unavailable: '平台分类读取失败', category_playlists_unavailable: '分类歌单读取失败', recommended_playlists_unavailable: '每日推荐读取失败', user_playlists_unavailable: '在线收藏夹读取失败，请检查平台登录状态', source_not_found: '音乐源不存在', invalid_playlist: '在线歌单参数无效', source_limit: '最多添加 8 个聚合音乐源' }; return errors[result?.error] || fallback; }
    function setMusicSelectionBusy(busy) { musicSelectionBusy = busy; [$('music-source-select'), $('music-playlist-select'), $('music-source-refresh'), $('music-catalog-refresh'), $('music-platform-select'), $('music-category-select'), $('music-playlist-search'), $('music-playlist-search-form'), $('home-media-source-select'), $('home-media-platform-select'), $('home-media-category-select'), $('home-media-playlist-search'), $('home-media-playlist-search-form'), ...documentRef.querySelectorAll('[data-music-catalog-view]')].filter(Boolean).forEach((control) => { control.disabled = busy; }); }
    async function loadMusicTrack(track, autoplay) {
      if (!track || musicLoading) return;
      rememberActiveMusic(track); const epoch = ++musicLoadEpoch; musicLoading = true; renderMusicCard(); const result = await getApi()?.loadHomeMusicTrack?.(track.id).catch(() => null); if (epoch !== musicLoadEpoch) return;
      if (!result?.ok) { releaseMusicSource(); renderMusicCard(); setText($('home-media-status'), result?.error === 'audio_too_large' ? '音频超过 128 MB 限制' : result?.error === 'unsupported_audio' ? '服务器返回的不是音频文件' : '音频读取失败，播放已停止'); return; }
      const raw = result.bytes?.data || result.bytes; const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw || []); if (!bytes.length) { releaseMusicSource(); renderMusicCard(); setText($('home-media-status'), '音频内容为空，播放已停止'); return; }
      releaseMusicSource(); const sourceEpoch = ++musicLoadEpoch; musicLoading = true; musicObjectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || track.mimeType || 'application/octet-stream' })); loadedMusicId = track.id; musicAudio.src = musicObjectUrl; musicAudio.load(); musicLoading = false; renderMusicCard();
      if (autoplay && sourceEpoch === musicLoadEpoch) { try { await musicAudio.play(); } catch { releaseMusicSource(); setText($('home-media-status'), '无法播放该音频格式，播放已停止'); } renderMusicCard(); }
    }
    async function switchMusicPlaylist(sourceId, playlistId) { if (musicSelectionBusy || !sourceId || !playlistId || (sourceId === musicLibrary.sourceId && playlistId === musicLibrary.playlistId)) return; setMusicSelectionBusy(true); setText($('music-settings-status'), '正在切换歌单…'); const result = await getApi()?.selectHomeMusicPlaylist?.({ sourceId, playlistId }).catch(() => null); setMusicSelectionBusy(false); if (!applyMusicLibrary(result)) { releaseMusicSource(); renderMusicNavigation(); setText($('music-settings-status'), musicError(result, '歌单切换失败')); return; } void ensureMusicSettingsCategories(); setText($('music-settings-status'), `已切换到 ${musicPlaylistLabel(activeMusicPlaylist(), activeMusicSource())}`); if (activeMusicTrack()) await loadMusicTrack(activeMusicTrack(), true); }
    async function browseMusicOnline(action, payload, successMessage) { if (musicSelectionBusy || !payload?.sourceId || !payload?.platform) return; setMusicSelectionBusy(true); setText($('music-settings-status'), '正在读取在线歌单…'); const result = await getApi()?.[action]?.(payload).catch(() => null); setMusicSelectionBusy(false); if (!applyMusicLibrary(result)) { renderMusicNavigation(); setText($('music-settings-status'), musicError(result, '在线歌单读取失败')); return; } setText($('music-settings-status'), successMessage); }
    async function selectOnlineMusicPlaylist(dataset) { if (musicSelectionBusy || !dataset?.platform || !dataset?.playlistId) return; setMusicSelectionBusy(true); setText($('music-settings-status'), '正在读取在线歌单…'); const result = await getApi()?.selectHomeMusicOnlinePlaylist?.({ sourceId: dataset.sourceId || musicLibrary.sourceId, platform: dataset.platform, playlistId: dataset.playlistId, title: dataset.title || '在线歌单' }).catch(() => null); setMusicSelectionBusy(false); musicCatalogView = 'discover'; if (!applyMusicLibrary(result)) { releaseMusicSource(); renderMusicNavigation(); setText($('music-settings-status'), musicError(result, '在线歌单读取失败')); return; } setText($('music-settings-status'), `已打开在线歌单 ${activeMusicPlaylist()?.title || ''}`); if (activeMusicTrack()) await loadMusicTrack(activeMusicTrack(), true); }
    async function refreshMusicLibrary(initial = false, sourceId = musicLibrary.sourceId) { if (musicSelectionBusy) return; setMusicSelectionBusy(true); const apiRef = getApi(); const request = initial || typeof apiRef?.refreshHomeMusicSource !== 'function' ? apiRef?.getHomeMusicLibrary : () => getApi()?.refreshHomeMusicSource(sourceId); const result = typeof request === 'function' ? await request().catch(() => null) : null; setMusicSelectionBusy(false); if (!applyMusicLibrary(result)) { if (!initial) releaseMusicSource(); renderMusicNavigation(); setText($('home-media-status'), musicError(result, '音乐库读取失败')); } else if (!initial) setText($('music-settings-status'), activeMusicSource()?.type === 'music-dl' ? '歌单已刷新' : '音乐库已刷新'); }
    function moveMusic(direction, autoplay = musicPlaybackIntent || !musicAudio.paused) { const track = activeMusicTrack(); const queue = musicQueue(); if (!track || queue.length < 2) return; const index = queue.findIndex((item) => item.id === track.id); const next = musicShuffle ? shuffledMusicTrack(track, queue) : queue[(index + direction + queue.length) % queue.length]; if (autoplay) void loadMusicTrack(next, true); else { releaseMusicSource(); rememberActiveMusic(next); renderMusicCard(); } }
    async function openMusicSettings() { await navigate({ tab: 'settings' }); windowRef.NotchSettings?.select('music'); }

    const storedMusicVolumeValue = storage.getItem('notch-home-music-volume-v1'); const storedMusicVolume = storedMusicVolumeValue === null ? Number.NaN : Number(storedMusicVolumeValue); const initialMusicVolume = Number.isFinite(storedMusicVolume) ? Math.max(0, Math.min(100, storedMusicVolume)) : 80; musicAudio.volume = initialMusicVolume / 100; $('music-volume').value = String(initialMusicVolume); setText($('music-volume-value'), `${Math.round(initialMusicVolume)}%`);
    musicCover.addEventListener('error', () => clearMusicCover());
    $('music-volume').addEventListener('input', (event) => { const volume = Math.max(0, Math.min(100, Number(event.target.value) || 0)); musicAudio.volume = volume / 100; storage.setItem('notch-home-music-volume-v1', String(volume)); setText($('music-volume-value'), `${Math.round(volume)}%`); });
    $('home-media-refresh').addEventListener('click', () => void refreshMusicLibrary());
    $('home-media-discover').addEventListener('click', () => { if (!homeDiscoverySource()) { void openMusicSettings(); return; } homeMusicDiscoveryOpen = true; renderHomeMusicDiscovery(); void ensureHomeMusicCategories(); });
    $('home-media-discovery-close').addEventListener('click', () => { homeMusicDiscoveryOpen = false; renderHomeMusicDiscovery(); });
    $('home-media-library').addEventListener('click', openMusicSettings); $('home-music-configure').addEventListener('click', openMusicSettings);
    documentRef.querySelector('[data-home-media="toggle"]').addEventListener('click', async () => { const track = activeMusicTrack(); if (!track || musicLoading) return; if (loadedMusicId !== track.id || !musicAudio.src) { await loadMusicTrack(track, true); return; } if (musicAudio.paused) { try { await musicAudio.play(); } catch { setText($('home-media-status'), '无法继续播放'); } } else musicAudio.pause(); renderMusicCard(); });
    documentRef.querySelector('[data-home-media="previous"]').addEventListener('click', () => moveMusic(-1)); documentRef.querySelector('[data-home-media="next"]').addEventListener('click', () => moveMusic(1));
    documentRef.querySelector('[data-home-media="shuffle"]').addEventListener('click', () => { musicShuffle = !musicShuffle; storage.setItem(MUSIC_SHUFFLE_KEY, String(musicShuffle)); resetMusicShuffle(); renderMusicCard(); });
    musicAudio.addEventListener('play', () => { musicPlaybackIntent = true; renderMusicCard(); }); musicAudio.addEventListener('pause', () => { if (!musicResumeAfterTabChange) musicPlaybackIntent = false; renderMusicCard(); }); musicAudio.addEventListener('loadedmetadata', () => { renderMusicProgress(); renderMusicCard(); }); musicAudio.addEventListener('timeupdate', renderMusicProgress);
    musicAudio.addEventListener('ended', () => { musicPlaybackIntent = false; if (activeMusicTrack() && musicQueue().length > 1) moveMusic(1, true); else renderMusicCard(); }); musicAudio.addEventListener('error', () => { if (musicAudio.src) { releaseMusicSource(); renderMusicCard(); setText($('home-media-status'), '无法解码该音频格式，播放已停止'); } });
    documentRef.addEventListener('notch:tabchange', (event) => { if (event.detail?.tab === 'home' || musicAudio.paused || musicAudio.ended || !loadedMusicId) return; musicResumeAfterTabChange = true; const epoch = musicLoadEpoch; setTimeout(async () => { if (!musicResumeAfterTabChange || epoch !== musicLoadEpoch || musicAudio.ended) { musicResumeAfterTabChange = false; return; } if (!musicAudio.paused) { musicResumeAfterTabChange = false; return; } try { await musicAudio.play(); } catch {} musicResumeAfterTabChange = false; renderMusicCard(); }, 0); });
    $('home-media-source-select').addEventListener('change', (event) => { saveMusicDiscoveryFilter(event.target.value, ''); renderHomeMusicDiscovery(); void ensureHomeMusicCategories(); });
    windowRef.addEventListener('notch:settings-category-change', (event) => { if (event.detail?.id === 'music') void ensureMusicSettingsCategories(); });
    $('home-media-platform-select').addEventListener('change', (event) => { saveMusicDiscoveryFilter(homeDiscoverySource()?.id || '', ''); void browseMusicOnline('browseHomeMusicCategories', { sourceId: homeDiscoverySource()?.id, platform: event.target.value }, '已加载平台分类'); });
    $('home-media-category-select').addEventListener('change', (event) => { const sourceId = homeDiscoverySource()?.id; const platform = $('home-media-platform-select').value; const categoryId = event.target.value; saveMusicDiscoveryFilter(sourceId || '', categoryId); if (categoryId === '__recommend__') void browseMusicOnline('browseHomeMusicRecommend', { sourceId, platform }, '已加载每日推荐'); else if (categoryId === '__user__') void browseMusicOnline('browseHomeMusicUserPlaylists', { sourceId, platform }, '已加载我的收藏夹'); else if (categoryId) void browseMusicOnline('browseHomeMusicCategory', { sourceId, platform, categoryId }, '已加载分类歌单'); else void browseMusicOnline('browseHomeMusicCategories', { sourceId, platform }, '已加载平台分类'); });
    $('home-media-playlist-search-form').addEventListener('submit', (event) => { event.preventDefault(); const sourceId = homeDiscoverySource()?.id; const platform = $('home-media-platform-select').value; const keyword = $('home-media-playlist-search').value.trim(); if (!sourceId || !platform || !keyword) { $('home-media-playlist-search').focus(); return; } void browseMusicOnline('searchHomeMusicPlaylists', { sourceId, platform, keyword }, '已加载在线歌单搜索结果'); });
    $('music-source-select').addEventListener('change', (event) => { const source = musicLibrary.sources.find((candidate) => candidate.id === event.target.value); const playlist = source?.playlists?.[0]; if (playlist) void switchMusicPlaylist(source.id, playlist.id); else if (source) void refreshMusicLibrary(false, source.id); }); $('music-playlist-select').addEventListener('change', (event) => void switchMusicPlaylist(musicLibrary.sourceId, event.target.value)); $('music-source-refresh').addEventListener('click', () => void refreshMusicLibrary()); $('music-catalog-refresh').addEventListener('click', () => void refreshMusicLibrary());
    documentRef.querySelectorAll('[data-music-catalog-view]').forEach((button) => button.addEventListener('click', () => { musicCatalogView = button.dataset.musicCatalogView === 'discover' ? 'discover' : 'mine'; renderMusicNavigation(); renderMusicSettings(); }));
    $('music-platform-select')?.addEventListener('change', (event) => void browseMusicOnline('browseHomeMusicCategories', { sourceId: musicLibrary.sourceId, platform: event.target.value }, '已加载平台分类'));
    $('music-category-select')?.addEventListener('change', (event) => { const platform = $('music-platform-select')?.value; const categoryId = event.target.value; if (categoryId === '__recommend__') void browseMusicOnline('browseHomeMusicRecommend', { sourceId: musicLibrary.sourceId, platform }, '已加载每日推荐'); else if (categoryId === '__user__') void browseMusicOnline('browseHomeMusicUserPlaylists', { sourceId: musicLibrary.sourceId, platform }, '已加载我的收藏夹'); else if (categoryId) void browseMusicOnline('browseHomeMusicCategory', { sourceId: musicLibrary.sourceId, platform, categoryId }, '已加载分类歌单'); else void browseMusicOnline('browseHomeMusicCategories', { sourceId: musicLibrary.sourceId, platform }, '已加载平台分类'); });
    $('music-playlist-search-form')?.addEventListener('submit', (event) => { event.preventDefault(); const platform = $('music-platform-select')?.value; const keyword = $('music-playlist-search')?.value.trim(); if (!keyword) { $('music-playlist-search')?.focus(); return; } void browseMusicOnline('searchHomeMusicPlaylists', { sourceId: musicLibrary.sourceId, platform, keyword }, '已加载在线歌单搜索结果'); });

    async function importLocalMusic(kind) { if (musicImporting) return; musicImporting = true; const buttons = [$('music-local-add'), $('music-local-add-folder')]; buttons.forEach((button) => { button.disabled = true; }); setText($('music-settings-status'), kind === 'folder' ? '正在扫描文件夹…' : '正在读取所选文件…'); const apiRef = getApi(); const request = kind === 'folder' ? apiRef?.chooseHomeMusicFolder : apiRef?.chooseHomeMusicFiles; const result = typeof request === 'function' ? await request().catch(() => null) : null; musicImporting = false; buttons.forEach((button) => { button.disabled = false; }); if (result?.error === 'cancelled') { setText($('music-settings-status'), ''); return; } if (!applyMusicLibrary(result)) { const errors = { track_limit: '音乐库最多保存 200 首', invalid_folder: '无法读取所选文件夹' }; setText($('music-settings-status'), errors[result?.error] || '没有添加音频，请检查格式或文件大小'); return; } if (!(result.added > 0)) { setText($('music-settings-status'), kind === 'folder' ? '文件夹中没有新的受支持音频' : '所选文件已存在或不符合大小限制'); return; } const suffix = result.limitReached ? '，音乐库已达到 200 首' : result.truncated ? '，已达到 10,000 项扫描上限' : ''; setText($('music-settings-status'), `已添加 ${result.added} 首本地音乐${suffix}`); }
    $('music-local-add').addEventListener('click', () => void importLocalMusic('files')); $('music-local-add-folder').addEventListener('click', () => void importLocalMusic('folder'));
    $('music-network-form').addEventListener('submit', async (event) => { event.preventDefault(); const url = $('music-network-url').value.trim(); if (!url) { $('music-network-url').focus(); return; } const result = await getApi()?.addHomeMusicUrl?.({ url, title: $('music-network-title').value.trim() }).catch(() => null); if (!applyMusicLibrary(result)) { const errors = { invalid_audio_url: '请输入公开 HTTPS 音频直链，并使用支持的音频扩展名', track_limit: '音乐库最多保存 200 首' }; setText($('music-settings-status'), errors[result?.error] || '网络音乐添加失败'); return; } $('music-network-url').value = ''; $('music-network-title').value = ''; setText($('music-settings-status'), result.added === false ? '该网络音乐已在库中' : '网络音乐已添加'); });
    $('music-source-form').addEventListener('submit', async (event) => { event.preventDefault(); if (musicSelectionBusy) return; const baseUrl = $('music-source-url').value.trim(); if (!baseUrl) { $('music-source-url').focus(); return; } setMusicSelectionBusy(true); setText($('music-settings-status'), '正在连接 go-music-dl…'); const result = await getApi()?.addHomeMusicSource?.({ baseUrl, name: $('music-source-name').value.trim() }).catch(() => null); setMusicSelectionBusy(false); if (!applyMusicLibrary(result)) { renderMusicNavigation(); setText($('music-settings-status'), musicError(result, '音乐源添加失败')); return; } $('music-source-name').value = ''; $('music-source-form').closest('details').open = false; setText($('music-settings-status'), result.added === false ? '音乐源已更新' : '音乐源已添加'); });
    $('music-catalog-remove').addEventListener('click', async () => { const source = activeMusicSource(); if (!source?.removable || !windowRef.confirm(`移除音乐源“${source.name}”？`)) return; const result = await getApi()?.removeHomeMusicSource?.(source.id).catch(() => null); if (!applyMusicLibrary(result)) setText($('music-settings-status'), '音乐源移除失败'); else setText($('music-settings-status'), '音乐源已移除'); });
    $('music-library-list').addEventListener('click', async (event) => { const remove = event.target.closest('[data-remove-music-track]'); if (!remove) return; const removingCurrent = remove.dataset.removeMusicTrack === activeMusicId; const result = await getApi()?.removeHomeMusicTrack?.(remove.dataset.removeMusicTrack).catch(() => null); if (result?.ok && removingCurrent) releaseMusicSource(); if (!applyMusicLibrary(result)) setText($('music-settings-status'), '音乐删除失败'); else setText($('music-settings-status'), '已从音乐库移除'); });
    void refreshMusicLibrary(true);

    function dispose() { musicArtworkObserver.disconnect(); musicArtworkUrls.forEach((url) => URL.revokeObjectURL(url)); musicArtworkUrls.clear(); clearMusicCover(); releaseMusicSource(); }
    return Object.freeze({ dispose, refresh: refreshMusicLibrary });
  }

  window.NotchHomeMusic = Object.freeze({ createController });
})();
