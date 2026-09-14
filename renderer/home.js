(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const root = $('home-dashboard');
  if (!root) return;
  const api = window.notchAPI;
  const LOCATION_KEY = 'notch-home-weather-v1';
  const DRAFT_KEY = 'notch-home-capture-v1';
  const MUSIC_DISCOVERY_FILTER_KEY = 'notch-home-music-discovery-filter-v1';
  const MUSIC_SHUFFLE_KEY = 'notch-home-music-shuffle-v1';
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  let signature = '', location = read(LOCATION_KEY, null), weatherEpoch = 0, weatherData = null;
  let lastWeather = 0;
  let musicLibrary = { sourceId: 'built-in', playlistId: 'local', sources: [], playlists: [], tracks: [] }, activeMusicId = localStorage.getItem('notch-home-music-track-v1') || '';
  let loadedMusicId = '', musicObjectUrl = '', musicLoadEpoch = 0, musicLoading = false, musicImporting = false, musicSelectionBusy = false;
  let musicShuffle = localStorage.getItem(MUSIC_SHUFFLE_KEY) === 'true', musicShuffleKey = '', musicShuffleRemaining = [];
  let musicPlaybackIntent = false, musicResumeAfterTabChange = false;
  let musicCatalogView = 'mine', homeMusicDiscoveryOpen = false, homeMusicDiscoverySourceId = '', homeMusicDiscoveryCategoryId = '', musicCoverTrackId = '', musicCoverObjectUrl = '', musicCoverEpoch = 0;
  const savedMusicDiscoveryFilter = read(MUSIC_DISCOVERY_FILTER_KEY, {});
  if (savedMusicDiscoveryFilter && typeof savedMusicDiscoveryFilter === 'object') {
    homeMusicDiscoverySourceId = String(savedMusicDiscoveryFilter.sourceId || '');
    homeMusicDiscoveryCategoryId = String(savedMusicDiscoveryFilter.categoryId || '');
  }
  function saveMusicDiscoveryFilter(sourceId, categoryId = homeMusicDiscoveryCategoryId) {
    homeMusicDiscoverySourceId = sourceId || homeMusicDiscoverySourceId;
    homeMusicDiscoveryCategoryId = categoryId || '';
    localStorage.setItem(MUSIC_DISCOVERY_FILTER_KEY, JSON.stringify({ sourceId: homeMusicDiscoverySourceId, categoryId: homeMusicDiscoveryCategoryId }));
  }
  const musicArtworkUrls = new Map(); const musicArtworkRefs = new WeakMap();
  const musicArtworkObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    musicArtworkObserver.unobserve(entry.target); void loadPlaylistArtwork(entry.target, musicArtworkRefs.get(entry.target));
  }), { rootMargin: '60px' });
  const visible = () => !document.hidden && $('app').classList.contains('expanded') && $('tab-home').classList.contains('active') && !root.hidden;
  function changeView(view) {
    root.hidden = view !== 'dashboard';
    $('home-chat').hidden = view !== 'chat';
    $('home-weather-detail').hidden = view !== 'weather';
    document.dispatchEvent(new CustomEvent('notch:home-view-changed', { detail: { view } }));
    if (view === 'dashboard') { refreshLists(); tick(); }
  }
  document.querySelectorAll('[data-home-nav]').forEach((button) => button.addEventListener('click', () => navigate({ tab: button.dataset.homeNav })));
  async function navigate(target) {
    try { await window.NotchPanel.navigate(target); }
    catch { setText($('home-capture-status'), '该功能不可用，请在设置中启用'); }
  }
  function row(title, detail, callback) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'home-row';
    const strong = document.createElement('strong'); strong.textContent = title;
    const small = document.createElement('small'); small.textContent = detail;
    button.append(strong, small); button.addEventListener('click', callback); return button;
  }
  function notePreview(content) {
    const preview = String(content || '')
      .replace(/```[\s\S]*?```/g, '代码片段')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_~`-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return preview ? preview.slice(0, 96) : '暂无正文内容';
  }
  function noteRow(note, category, tag) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'home-row home-note-row';
    const head = document.createElement('span'); head.className = 'home-note-row-head';
    const mark = document.createElement('span'); mark.className = 'home-note-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '文';
    const strong = document.createElement('strong'); strong.textContent = note.title || note.content?.split('\n')[0] || '未命名笔记';
    const time = document.createElement('time');
    const updatedAt = Number(note.updatedAt) || 0;
    time.dateTime = updatedAt ? new Date(updatedAt).toISOString() : '';
    time.textContent = updatedAt ? new Date(updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '刚刚';
    head.append(mark, strong, time);
    const preview = document.createElement('span'); preview.className = 'home-note-row-preview'; preview.textContent = notePreview(note.content);
    const meta = document.createElement('span'); meta.className = 'home-note-row-meta';
    const categoryLabel = document.createElement('span'); categoryLabel.className = 'home-note-category'; categoryLabel.textContent = category || '未分类';
    meta.append(categoryLabel);
    if (tag) {
      const tagLabel = document.createElement('span'); tagLabel.className = 'home-note-tag'; tagLabel.textContent = tag;
      meta.append(tagLabel);
    }
    button.append(head, preview, meta);
    button.addEventListener('click', () => navigate({ tab: 'notes', id: note.id }));
    return button;
  }
  function empty(target, text) { const p = document.createElement('p'); p.className = 'home-hint'; p.textContent = text; target.append(p); }
  function refreshLists() {
    const notes = window.NotchNotes?.list?.() || [];
    const todos = read('notch-todo-data', {}), names = read('notch-todo-category-names-v1', {}), categories = read('notch-note-categories-v1', []);
    const next = JSON.stringify([notes, todos, names, categories, new Date().toDateString()]);
    if (next === signature) return;
    signature = next;
    const recent = $('home-recent-list'); recent.replaceChildren();
    setText($('home-recent-summary'), notes.length
      ? notes.length > 5 ? `最近编辑 ${Math.min(notes.length, 5)} 篇 · 共 ${notes.length} 篇` : `最近编辑 ${notes.length} 篇`
      : '还没有笔记');
    notes.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).forEach((note) => {
      const category = Array.isArray(categories) ? categories.find((item) => item.id === note.categoryId) : null;
      const tag = Array.isArray(category?.tags) ? category.tags.find((item) => item.id === note.tagId)?.name : '';
      recent.append(noteRow(note, category?.name, tag));
    });
    if (!recent.children.length) empty(recent, '保存第一篇笔记，稍后从这里继续');
    const today = $('home-today-list'); today.replaceChildren();
    const items = ['P0', 'P1', 'P2', 'P3'].flatMap((priority) => window.NotchDomain.filterTodosByTimeScope(Array.isArray(todos[priority]) ? todos[priority] : [], 'today').filter((item) => !item.done).map((item) => ({ ...item, priority })));
    items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline)).slice(0, 3).forEach((item) => {
      const date = new Date(item.deadline), overdue = date.getTime() < Date.now();
      today.append(row(item.text, `${overdue ? '逾期 · ' : ''}${names[item.priority] || item.priority} · ${date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, () => navigate({ tab: 'todo', id: item.id })));
    });
    if (!items.length) empty(today, '今天没有到期事项，可以安排下一步');
    else if (items.length > 3) empty(today, `还有 ${items.length - 3} 项，进入全部待办查看`);
  }
  const capture = $('home-capture-input'); capture.value = localStorage.getItem(DRAFT_KEY) || '';
  capture.addEventListener('input', () => { try { localStorage.setItem(DRAFT_KEY, capture.value); } catch { setText($('home-capture-status'), '草稿保存失败，请复制内容'); } });
  $('home-capture-save').addEventListener('click', async () => {
    const content = capture.value.trim(); if (!content) { capture.focus(); return; }
    $('home-capture-save').disabled = true; capture.readOnly = true;
    try {
      const result = await window.NotchNotes.saveCaptured(content);
      if (!result.ok) { setText($('home-capture-status'), result.error === 'capacity' ? '笔记已满，请先整理笔记库' : '保存失败，内容已保留'); return; }
      capture.value = ''; localStorage.removeItem(DRAFT_KEY);
      setText($('home-capture-status'), result.workspaceSynced === false ? '已存本机，工作区同步失败' : '已保存到笔记库'); refreshLists();
    } catch { setText($('home-capture-status'), '保存未完成，请检查笔记库，内容已保留'); }
    finally { $('home-capture-save').disabled = false; capture.readOnly = false; }
  });
  function weatherCondition(code) {
    if (code === 0) return '晴';
    if (code === 1) return '晴间多云';
    if (code === 2) return '局部多云';
    if (code === 3) return '阴';
    if ([45, 48].includes(code)) return '雾';
    if ([51, 53, 55].includes(code)) return '毛毛雨';
    if ([56, 57, 66, 67].includes(code)) return '冻雨';
    if ([61, 63, 65].includes(code)) return '降雨';
    if ([71, 73, 75, 77].includes(code)) return '降雪';
    if ([80, 81, 82].includes(code)) return '阵雨';
    if ([85, 86].includes(code)) return '阵雪';
    if ([96, 99].includes(code)) return '雷雨伴冰雹';
    if (code === 95) return '雷雨';
    return '天气变化';
  }
  function weatherTone(code, isDay = true) {
    if (!isDay && code <= 3) return 'night';
    if (code === 0) return 'clear';
    if (code <= 3) return 'cloud';
    if ([45, 48].includes(code)) return 'fog';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
    if (code >= 95) return 'storm';
    return 'rain';
  }
  function weatherIconMarkup(code, isDay = true) {
    const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>';
    const moon = '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>';
    const cloud = '<path d="M17.5 19H8a6 6 0 1 1 5.8-7.5A4.5 4.5 0 1 1 17.5 19Z"/>';
    const cloudSun = '<path d="M8 5V3M4.2 6.2 2.8 4.8M3 10H1M17.5 19H8a5 5 0 1 1 4.8-6.4A4.5 4.5 0 1 1 17.5 19Z"/><path d="M8 9a4 4 0 0 1 7.5 2"/>';
    const rain = `${cloud}<path d="m9 22 1-2M13 22l1-2M17 22l1-2"/>`;
    const snow = `${cloud}<path d="M10 21h.01M14 22h.01M18 21h.01"/>`;
    const storm = `${cloud}<path d="m13 19-2 4h4l-2 4"/>`;
    const fog = '<path d="M4 9h16M3 13h18M6 17h12"/>';
    const paths = code === 0 ? (isDay ? sun : moon) : code <= 2 ? cloudSun : code === 3 ? cloud : [45, 48].includes(code) ? fog : [71, 73, 75, 77, 85, 86].includes(code) ? snow : code >= 95 ? storm : rain;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }
  function setWeatherIcon(target, code, isDay = true) {
    target.innerHTML = weatherIconMarkup(code, isDay);
  }
  function windDirection(degrees) {
    if (!Number.isFinite(degrees)) return '';
    return ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(degrees / 45) % 8];
  }
  function weatherMetric(label, value) {
    const item = document.createElement('div');
    const small = document.createElement('small'); small.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    item.append(small, strong); return item;
  }
  function hourLabel(value) { return String(value || '').slice(11, 16) || '--:--'; }
  function dayLabel(value, index) {
    if (index === 0) return '今天';
    if (index === 1) return '明天';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN', { weekday: 'short' });
  }
  function smoothWeatherPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
    return points.slice(1).reduce((path, point, index) => {
      const previous = points[index];
      const middle = [(previous[0] + point[0]) / 2, (previous[1] + point[1]) / 2];
      return `${path} Q ${previous[0]} ${previous[1]} ${middle[0]} ${middle[1]}`;
    }, `M ${points[0][0]} ${points[0][1]}`) + ` T ${points.at(-1)[0]} ${points.at(-1)[1]}`;
  }
  function renderHours(target, hours, limit) {
    target.replaceChildren();
    const forecast = hours.slice(0, limit);
    if (!forecast.length) return;
    const width = 720, height = 72, left = 30, right = 20, top = 15, temperatureBottom = 43, rainBottom = 68;
    const temperatures = forecast.map((hour) => hour.temperature);
    const minimum = Math.min(...temperatures), maximum = Math.max(...temperatures), span = Math.max(2, maximum - minimum);
    const xAt = (index) => left + index * ((width - left - right) / Math.max(1, forecast.length - 1));
    const yAt = (temperature) => top + ((maximum - temperature) / span) * (temperatureBottom - top);
    const points = forecast.map((hour, index) => [xAt(index), yAt(hour.temperature)]);
    const viewport = document.createElement('div'); viewport.className = 'weather-hourly-viewport';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('aria-hidden', 'true');
    const makeSvg = (tag, attributes = {}) => { const node = document.createElementNS(svg.namespaceURI, tag); Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value)); return node; };
    svg.append(makeSvg('line', { x1: left, y1: rainBottom, x2: width - right, y2: rainBottom, class: 'weather-chart-baseline' }));
    forecast.forEach((hour, index) => {
      const probability = Math.max(0, Math.min(100, hour.precipitationProbability));
      if (probability) svg.append(makeSvg('rect', { x: xAt(index) - 4, y: rainBottom - probability * .14, width: 8, height: probability * .14, rx: 3, class: 'weather-chart-rain' }));
    });
    const path = smoothWeatherPath(points);
    svg.append(makeSvg('path', { d: `${path} L ${points.at(-1)[0]} ${rainBottom} L ${points[0][0]} ${rainBottom} Z`, class: 'weather-chart-area' }));
    svg.append(makeSvg('path', { d: path, class: 'weather-chart-line' }));
    points.forEach(([x, y], index) => {
      svg.append(makeSvg('circle', { cx: x, cy: y, r: index === 0 ? 4 : 3, class: index === 0 ? 'weather-chart-point is-now' : 'weather-chart-point' }));
      const label = makeSvg('text', { x, y: Math.max(11, y - 8), class: 'weather-chart-temperature' }); label.textContent = `${Math.round(forecast[index].temperature)}°`; svg.append(label);
    });
    const strip = document.createElement('div'); strip.className = 'weather-hour-strip';
    forecast.forEach((hour, index) => {
      const item = document.createElement('div'); item.className = `weather-hour${index === 0 ? ' is-now' : ''}`;
      const time = document.createElement('time'); time.textContent = index === 0 ? '现在' : hourLabel(hour.time);
      const icon = document.createElement('span'); icon.className = 'weather-condition-icon'; icon.innerHTML = weatherIconMarkup(hour.code, hour.isDay); icon.setAttribute('aria-label', weatherCondition(hour.code));
      const rain = document.createElement('small'); rain.textContent = hour.precipitationProbability ? `${Math.round(hour.precipitationProbability)}%` : '—';
      item.append(time, icon, rain); strip.append(item);
    });
    viewport.append(svg, strip); target.append(viewport);
  }
  function renderWeather(result) {
    weatherData = result;
    const tone = weatherTone(result.code, result.isDay);
    document.querySelector('.home-weather').dataset.weatherState = 'ready';
    document.querySelector('.home-weather').dataset.weatherTone = tone;
    $('home-weather-detail').dataset.weatherTone = tone;
    $('home-weather-form').hidden = true; $('home-weather-results').replaceChildren(); $('home-weather-empty').hidden = true; $('home-weather-overview').hidden = false;
    const place = [location.name, location.admin1].filter(Boolean).join(' · ');
    const update = result.stale ? '当前显示离线缓存' : `更新于 ${new Date(result.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    setText($('home-weather-location'), place); setText($('home-weather-updated'), update);
    setWeatherIcon($('home-weather-icon'), result.code, result.isDay);
    setText($('home-weather-temperature'), `${Math.round(result.temperature)}°`);
    setText($('home-weather-condition'), weatherCondition(result.code));
    setText($('home-weather-range'), `最高 ${Math.round(result.high)}° · 最低 ${Math.round(result.low)}°`);
    const nextRain = Math.max(0, ...(result.hours || []).slice(0, 6).map((hour) => hour.precipitationProbability));
    const metrics = $('home-weather-metrics'); metrics.replaceChildren(
      weatherMetric('体感', `${Math.round(result.apparentTemperature)}°`),
      weatherMetric('6h 降雨', `${Math.round(nextRain)}%`),
      weatherMetric('湿度', Number.isFinite(result.humidity) ? `${Math.round(result.humidity)}%` : '—'),
      weatherMetric('风', Number.isFinite(result.windSpeed) ? `${windDirection(result.windDirection)} ${Math.round(result.windSpeed)} km/h`.trim() : '—')
    );
    const condition = weatherCondition(result.code);
    const insight = nextRain >= 60
      ? `未来 6 小时降雨概率较高，外出记得带伞。`
      : nextRain >= 30
        ? `未来 6 小时可能有雨，出门前再看一眼。`
        : `未来 6 小时天气以${condition}为主，降雨概率较低。`;
    setText($('home-weather-insight'), insight);
    setText($('home-weather-detail-location'), place); setText($('home-weather-detail-updated'), update);
    setWeatherIcon($('home-weather-detail-icon'), result.code, result.isDay);
    setText($('home-weather-detail-temperature'), `${Math.round(result.temperature)}°`);
    setText($('home-weather-detail-condition'), weatherCondition(result.code));
    setText($('home-weather-detail-summary'), `体感 ${Math.round(result.apparentTemperature)}° · ${Math.round(result.high)}° / ${Math.round(result.low)}°`);
    const detailMetrics = $('home-weather-detail-metrics'); detailMetrics.replaceChildren(
      weatherMetric('降水量', Number.isFinite(result.precipitation) ? `${result.precipitation.toFixed(1)} mm` : '—'),
      weatherMetric('湿度', Number.isFinite(result.humidity) ? `${Math.round(result.humidity)}%` : '—'),
      weatherMetric(`风速 · ${windDirection(result.windDirection)}`, Number.isFinite(result.windSpeed) ? `${Math.round(result.windSpeed)} km/h` : '—'),
      weatherMetric('日落', hourLabel(result.sunset))
    );
    renderHours($('home-weather-detail-hours'), result.hours || [], 12);
    const maxRain = Math.max(0, ...(result.hours || []).slice(0, 12).map((hour) => hour.precipitationProbability));
    setText($('home-weather-hourly-summary'), maxRain ? `最高降雨概率 ${Math.round(maxRain)}%` : '降雨概率较低');
    const days = $('home-weather-detail-days'); days.replaceChildren();
    const forecastDays = result.days || [];
    const temperatureMin = forecastDays.length ? Math.min(...forecastDays.map((day) => day.low)) : result.low;
    const temperatureMax = forecastDays.length ? Math.max(...forecastDays.map((day) => day.high)) : result.high;
    const temperatureSpan = Math.max(1, temperatureMax - temperatureMin);
    setText($('home-weather-weekly-summary'), forecastDays.length ? `${Math.round(temperatureMin)}° 至 ${Math.round(temperatureMax)}°` : '预报暂不可用');
    forecastDays.forEach((day, index) => {
      const item = document.createElement('div'); item.className = `weather-day${index === 0 ? ' is-today' : ''}`;
      const date = document.createElement('strong'); date.className = 'weather-day-date'; date.textContent = dayLabel(day.date, index);
      const conditionRow = document.createElement('div'); conditionRow.className = 'weather-day-condition';
      const icon = document.createElement('span'); icon.className = 'weather-condition-icon'; icon.innerHTML = weatherIconMarkup(day.code, true); icon.setAttribute('aria-label', weatherCondition(day.code));
      const condition = document.createElement('span'); condition.textContent = weatherCondition(day.code); conditionRow.append(icon, condition);
      const rain = document.createElement('small'); rain.textContent = day.precipitationProbability ? `降雨 ${Math.round(day.precipitationProbability)}%` : '降雨概率低';
      const low = document.createElement('b'); low.textContent = `${Math.round(day.low)}°`;
      const track = document.createElement('span'); track.className = 'weather-temperature-track';
      const fill = document.createElement('i');
      const rangeLeft = Math.max(0, Math.min(100, ((day.low - temperatureMin) / temperatureSpan) * 100));
      const rangeWidth = Math.min(100 - rangeLeft, Math.max(12, ((day.high - day.low) / temperatureSpan) * 100));
      fill.style.left = `${rangeLeft}%`; fill.style.width = `${rangeWidth}%`; track.append(fill);
      track.setAttribute('aria-label', `${dayLabel(day.date, index)}最低 ${Math.round(day.low)} 度，最高 ${Math.round(day.high)} 度`);
      if (index === 0) {
        const rawNowPosition = ((result.temperature - temperatureMin) / temperatureSpan) * 100;
        const nowPosition = Math.max(rangeLeft, Math.min(rangeLeft + rangeWidth, rawNowPosition));
        const nowMarker = document.createElement('em'); nowMarker.className = 'weather-temperature-now'; nowMarker.style.left = `${nowPosition}%`; nowMarker.title = `当前 ${Math.round(result.temperature)}°`; nowMarker.setAttribute('aria-hidden', 'true'); track.append(nowMarker);
      }
      const high = document.createElement('b'); high.textContent = `${Math.round(day.high)}°`;
      const range = document.createElement('div'); range.className = 'weather-day-range'; range.append(low, track, high);
      item.append(date, conditionRow, rain, range); days.append(item);
    });
  }
  function showWeatherSearch(focus = true) {
    document.querySelector('.home-weather').dataset.weatherState = 'search';
    $('home-weather-form').hidden = false; $('home-weather-overview').hidden = true; $('home-weather-results').replaceChildren(); $('home-weather-empty').hidden = false;
    setText($('home-weather-empty'), location ? '搜索并选择另一个城市。' : '选择城市后查看当前天气和未来趋势，不获取定位。');
    if (focus) $('home-weather-city').focus();
  }
  async function refreshWeather() {
    if (!location || !api?.getHomeWeather) return;
    const epoch = ++weatherEpoch; lastWeather = Date.now();
    document.querySelector('.home-weather').dataset.weatherState = 'loading';
    setText($('home-weather-updated'), '正在更新…'); setText($('home-weather-detail-updated'), '正在更新…');
    const result = await api.getHomeWeather(location).catch(() => null);
    if (epoch !== weatherEpoch) return;
    if (result?.ok) renderWeather(result);
    else {
      document.querySelector('.home-weather').dataset.weatherState = 'error';
      if (!weatherData) { $('home-weather-overview').hidden = true; $('home-weather-empty').hidden = false; }
      setText($('home-weather-empty'), '天气暂时不可用，请稍后刷新。'); setText($('home-weather-updated'), '更新失败'); setText($('home-weather-detail-updated'), '更新失败，保留上次预报');
    }
  }
  $('home-weather-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const query = $('home-weather-city').value.trim(); if (query.length < 2) { setText($('home-weather-empty'), '请输入至少两个字的城市名'); return; }
    lastWeather = Date.now();
    const epoch = ++weatherEpoch; const results = $('home-weather-results'); results.replaceChildren();
    setText($('home-weather-empty'), '正在查找城市…');
    const result = await api?.searchWeatherCities?.(query).catch(() => null);
    if (epoch !== weatherEpoch) return;
    setText($('home-weather-empty'), result?.ok ? (result.locations.length ? '选择正确的城市' : '没有找到城市，可尝试拼音或英文名') : '城市查询失败，请稍后再试');
    for (const city of result?.locations || []) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = [city.name, city.admin1, city.country].filter(Boolean).join(' · ');
      button.addEventListener('click', () => { try { localStorage.setItem(LOCATION_KEY, JSON.stringify(city)); location = city; results.replaceChildren(); refreshWeather(); } catch { setText($('home-weather-empty'), '城市保存失败'); } }); results.append(button);
    }
  });
  $('home-weather-change').addEventListener('click', showWeatherSearch);
  $('home-weather-clear').addEventListener('click', () => {
    ++weatherEpoch; location = null; weatherData = null; localStorage.removeItem(LOCATION_KEY);
    $('home-weather-city').value = ''; setText($('home-weather-location'), '天气'); setText($('home-weather-updated'), '手动选择城市'); showWeatherSearch();
  });
  $('home-weather-refresh').addEventListener('click', refreshWeather);
  $('home-weather-details').addEventListener('click', () => { if (weatherData) changeView('weather'); else showWeatherSearch(); });
  $('home-weather-detail-close').addEventListener('click', () => changeView('dashboard'));
  $('home-weather-detail-refresh').addEventListener('click', refreshWeather);
  const openWeatherSource = () => { void api?.openExternal?.('https://open-meteo.com/').catch(() => {}); };
  $('home-weather-detail-source').addEventListener('click', openWeatherSource);
  if (location) refreshWeather(); else showWeatherSearch(false);
  const musicAudio = $('home-music-audio');
  const storedMusicVolumeValue = localStorage.getItem('notch-home-music-volume-v1');
  const storedMusicVolume = storedMusicVolumeValue === null ? Number.NaN : Number(storedMusicVolumeValue);
  const initialMusicVolume = Number.isFinite(storedMusicVolume) ? Math.max(0, Math.min(100, storedMusicVolume)) : 80;
  musicAudio.volume = initialMusicVolume / 100; $('music-volume').value = String(initialMusicVolume); setText($('music-volume-value'), `${Math.round(initialMusicVolume)}%`);
  $('home-media-cover').addEventListener('error', () => { clearMusicCover(); });
  $('music-volume').addEventListener('input', (event) => {
    const volume = Math.max(0, Math.min(100, Number(event.target.value) || 0));
    musicAudio.volume = volume / 100; localStorage.setItem('notch-home-music-volume-v1', String(volume)); setText($('music-volume-value'), `${Math.round(volume)}%`);
  });
  function musicTime(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }
  function normalizeMusicResult(result) {
    if (!result?.ok) return null;
    if (Array.isArray(result.sources)) {
      return {
        sourceId: String(result.sourceId || 'built-in'), playlistId: String(result.playlistId || 'local'),
        sources: result.sources, playlists: Array.isArray(result.playlists) ? result.playlists : [], tracks: Array.isArray(result.tracks) ? result.tracks : [],
        browser: result.browser && typeof result.browser === 'object' ? result.browser : null,
      };
    }
    const mode = result.mode === 'network' ? 'network' : 'local';
    const allTracks = Array.isArray(result.tracks) ? result.tracks : [];
    const playlists = ['local', 'network'].map((id) => ({ id, title: id === 'local' ? '本地音乐' : '网络音乐', trackCount: allTracks.filter((track) => track.kind === id).length }));
    return { sourceId: 'built-in', playlistId: mode, sources: [{ id: 'built-in', type: 'library', name: '我的音乐', playlists }], playlists, tracks: allTracks.filter((track) => track.kind === mode) };
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
    const key = musicArtworkKey(reference); const cached = musicArtworkUrls.get(key);
    if (cached) { image.src = cached; image.hidden = false; return; }
    const result = await Promise.resolve(api?.loadHomeMusicCover?.(reference)).catch(() => null);
    if (!image.isConnected || musicArtworkRefs.get(image) !== reference || !result?.ok) return;
    const raw = result.bytes?.data || result.bytes; const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw || []);
    if (!bytes.length) return;
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'image/jpeg' }));
    musicArtworkUrls.set(key, objectUrl);
    if (musicArtworkUrls.size > 64) { const oldest = musicArtworkUrls.entries().next().value; URL.revokeObjectURL(oldest[1]); musicArtworkUrls.delete(oldest[0]); }
    image.src = objectUrl; image.hidden = false;
  }
  function clearPlaylistArtwork(container) {
    container?.querySelectorAll('.home-media-playlist-art img').forEach((image) => musicArtworkObserver.unobserve(image));
  }
  function createPlaylistArtwork(source, playlist, eager = false) {
    const artwork = document.createElement('span'); artwork.className = 'home-media-playlist-art';
    if (playlist?.hasCover && source?.type === 'music-dl') {
      const image = document.createElement('img'); image.alt = ''; image.hidden = true;
      const reference = { sourceId: source.id, playlistId: playlist.id }; musicArtworkRefs.set(image, reference); artwork.append(image);
      if (eager) queueMicrotask(() => void loadPlaylistArtwork(image, reference)); else musicArtworkObserver.observe(image);
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
    if (activeMusicId) localStorage.setItem('notch-home-music-track-v1', activeMusicId);
    else localStorage.removeItem('notch-home-music-track-v1');
  }
  function releaseMusicSource() {
    ++musicLoadEpoch; musicLoading = false; musicResumeAfterTabChange = false; musicPlaybackIntent = false; musicAudio.pause(); musicAudio.removeAttribute('src'); musicAudio.load(); loadedMusicId = '';
    if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl); musicObjectUrl = '';
  }
  function fillMusicSelect(select, entries, selectedId, label = (entry) => entry.title || entry.name) {
    select.replaceChildren();
    entries.forEach((entry) => { const option = document.createElement('option'); option.value = entry.id; option.textContent = label(entry); select.append(option); });
    select.value = selectedId;
  }
  function homeDiscoverySource() {
    const selected = musicLibrary.sources.find((source) => source.id === homeMusicDiscoverySourceId && source.type === 'music-dl');
    return selected || (activeMusicSource()?.type === 'music-dl' ? activeMusicSource() : musicLibrary.sources.find((source) => source.type === 'music-dl')) || null;
  }
  function renderHomeMusicDiscovery() {
    const panel = $('home-media-discovery'); if (!panel) return;
    const source = homeDiscoverySource(); const browser = source ? (source.id === musicLibrary.sourceId ? musicLibrary.browser : source.browser) : null;
    panel.hidden = !homeMusicDiscoveryOpen;
    const sourceSelect = $('home-media-source-select');
    fillMusicSelect(sourceSelect, musicLibrary.sources.filter((item) => item.type === 'music-dl'), source?.id, (item) => item.name);
    const platformSelect = $('home-media-platform-select');
    fillMusicSelect(platformSelect, Array.isArray(browser?.platformSources) ? browser.platformSources : [], browser?.activePlatform, (item) => item.name || item.id);
    const categorySelect = $('home-media-category-select'); categorySelect.replaceChildren();
    const all = document.createElement('option'); all.value = ''; all.textContent = '全部分类'; categorySelect.append(all);
    const platformCapability = browser?.platformSources?.find((item) => item.id === browser.activePlatform);
    if (platformCapability?.recommend) { const option = document.createElement('option'); option.value = '__recommend__'; option.textContent = '每日推荐'; categorySelect.append(option); }
    if (platformCapability?.userPlaylists) { const option = document.createElement('option'); option.value = '__user__'; option.textContent = '我的收藏夹'; categorySelect.append(option); }
    (browser?.categories || []).forEach((category) => { const option = document.createElement('option'); option.value = category.id; option.textContent = category.group ? `${category.group} · ${category.name}` : category.name; categorySelect.append(option); });
    if ([...categorySelect.options].some((option) => option.value === homeMusicDiscoveryCategoryId)) categorySelect.value = homeMusicDiscoveryCategoryId;
    else if (homeMusicDiscoveryCategoryId) saveMusicDiscoveryFilter(source?.id || '', '');
    [sourceSelect, platformSelect, categorySelect, $('home-media-playlist-search'), $('home-media-playlist-search-form')].forEach((control) => { if (control) control.disabled = musicSelectionBusy; });
    const results = $('home-media-online-results'); clearPlaylistArtwork(results); results.replaceChildren();
    const onlinePlaylists = Array.isArray(browser?.onlinePlaylists) ? browser.onlinePlaylists : [];
    if (!source) { const empty = document.createElement('span'); empty.className = 'music-online-empty'; empty.textContent = '请先在设置中添加 go-music-dl 音乐源'; results.append(empty); return; }
    if (!onlinePlaylists.length) { const empty = document.createElement('span'); empty.className = 'music-online-empty'; empty.textContent = '选择平台、分类或搜索歌单'; results.append(empty); return; }
    onlinePlaylists.forEach((playlist, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'home-media-online-result'; button.dataset.sourceId = source.id; button.dataset.playlistId = playlist.remoteId || playlist.id; button.dataset.platform = playlist.provider || browser.activePlatform || ''; button.dataset.title = playlist.title || ''; button.disabled = musicSelectionBusy;
      const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = musicPlaylistLabel(playlist, source); const description = document.createElement('small'); description.textContent = playlist.description || '在线歌单'; copy.append(title, description);
      const count = document.createElement('em'); count.textContent = playlist.trackCount ? `${playlist.trackCount} 首` : '打开';
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
    const musicTab = document.querySelector('[data-settings-category="music"][aria-selected="true"]');
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
    const catalogPanel = document.querySelector('.music-catalog-panel');
    if (catalogPanel) catalogPanel.dataset.catalogView = musicCatalogView;
    setText($('music-catalog-view-title'), musicCatalogView === 'discover' ? '在线发现' : '我的歌单');
    setText($('music-catalog-view-copy'), musicCatalogView === 'discover' ? '按平台、分类或关键词浏览，打开后只更新当前播放队列' : '当前聚合源的已收藏或已导入歌单');
    document.querySelectorAll('[data-music-catalog-view]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.musicCatalogView === musicCatalogView));
    });
    const platformSelect = $('music-platform-select');
    if (platformSelect) {
      fillMusicSelect(platformSelect, Array.isArray(browser.platformSources) ? browser.platformSources : [], browser.activePlatform, (platform) => platform.name || platform.id);
      platformSelect.disabled = musicSelectionBusy || !platformSelect.options.length;
    }
    const categorySelect = $('music-category-select');
    if (categorySelect) {
      const categories = Array.isArray(browser.categories) ? browser.categories : [];
      categorySelect.replaceChildren();
      const all = document.createElement('option'); all.value = ''; all.textContent = '全部分类'; categorySelect.append(all);
      const platformCapability = browser.platformSources?.find((platform) => platform.id === browser.activePlatform);
      if (platformCapability?.recommend) { const option = document.createElement('option'); option.value = '__recommend__'; option.textContent = '每日推荐'; categorySelect.append(option); }
      if (platformCapability?.userPlaylists) { const option = document.createElement('option'); option.value = '__user__'; option.textContent = '我的收藏夹'; categorySelect.append(option); }
      categories.forEach((category) => { const option = document.createElement('option'); option.value = category.id; option.textContent = category.group ? `${category.group} · ${category.name}` : category.name; categorySelect.append(option); });
      categorySelect.disabled = musicSelectionBusy || !platformSelect?.value || categorySelect.options.length <= 1;
    }
    const onlineResults = $('music-online-results');
    if (onlineResults) {
      onlineResults.replaceChildren();
      const results = Array.isArray(browser.onlinePlaylists) ? browser.onlinePlaylists : [];
      if (!results.length) { const empty = document.createElement('span'); empty.className = 'music-online-empty'; empty.textContent = source?.type === 'music-dl' ? '选择平台、分类或搜索歌单' : '请先在上方选择聚合音乐库'; onlineResults.append(empty); }
      results.forEach((playlist) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'music-online-result'; button.dataset.playlistId = playlist.remoteId || playlist.id; button.dataset.platform = playlist.provider || browser.activePlatform || ''; button.dataset.title = playlist.title || ''; button.disabled = musicSelectionBusy;
        const title = document.createElement('strong'); title.textContent = musicPlaylistLabel(playlist, source); const detail = document.createElement('small'); detail.textContent = playlist.trackCount ? `${playlist.trackCount} 首${playlist.description ? ` · ${playlist.description}` : ''}` : (playlist.description || '在线歌单'); button.append(title, detail); button.addEventListener('click', () => void selectOnlineMusicPlaylist(button.dataset)); onlineResults.append(button);
      });
    }
    setText($('home-media-source-label'), source?.name || '我的音乐');
    setText($('music-catalog-name'), source?.name || '聚合音乐'); setText($('music-catalog-endpoint'), source?.detail || '');
    $('music-source-refresh').disabled = musicSelectionBusy || musicCatalogView === 'discover'; $('music-catalog-refresh').disabled = musicSelectionBusy || source?.type !== 'music-dl'; $('music-catalog-remove').disabled = musicSelectionBusy || source?.type !== 'music-dl';
    document.querySelectorAll('[data-music-source-panel]').forEach((panel) => {
      const panelName = musicCatalogView === 'discover' ? 'catalog' : source?.type === 'music-dl' ? 'catalog' : playlist?.id === 'network' ? 'network' : 'local';
      panel.hidden = panel.dataset.musicSourcePanel !== panelName;
    });
    renderHomeMusicDiscovery();
  }
  function renderMusicProgress() {
    const duration = Number.isFinite(musicAudio.duration) ? musicAudio.duration : 0;
    const position = Number.isFinite(musicAudio.currentTime) ? musicAudio.currentTime : 0;
    const percentage = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
    $('home-media-progress').hidden = !activeMusicTrack();
    $('home-media-progress-track').firstElementChild.style.width = `${percentage}%`;
    $('home-media-progress-track').setAttribute('aria-valuenow', String(Math.round(percentage)));
    $('home-media-progress-track').setAttribute('aria-valuetext', `${musicTime(position)} / ${musicTime(duration)}`);
    setText($('home-media-position'), musicTime(position)); setText($('home-media-duration'), musicTime(duration));
  }
  function clearMusicCover() {
    if (musicCoverObjectUrl) URL.revokeObjectURL(musicCoverObjectUrl);
    musicCoverObjectUrl = ''; const image = $('home-media-cover'); image.removeAttribute('src'); image.hidden = true; document.querySelector('.home-media').dataset.mediaCover = 'false';
  }
  async function loadMusicCover(track) {
    const epoch = ++musicCoverEpoch; let result = null;
    try { result = await api?.loadHomeMusicCover?.(track.id); } catch {}
    if (epoch !== musicCoverEpoch || musicCoverTrackId !== track.id || !result?.ok) return;
    const raw = result.bytes?.data || result.bytes; const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw || []);
    if (!bytes.length) return;
    clearMusicCover(); musicCoverObjectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'image/jpeg' }));
    const image = $('home-media-cover'); image.src = musicCoverObjectUrl; image.alt = `${track.title}封面`; image.hidden = false; document.querySelector('.home-media').dataset.mediaCover = 'true';
  }
  function renderMusicCard() {
    const card = document.querySelector('.home-media'); const track = activeMusicTrack(); const queue = musicQueue();
    const coverTrackId = track?.id || '';
    if (musicCoverTrackId !== coverTrackId) {
      musicCoverTrackId = coverTrackId; clearMusicCover();
      if (track?.hasCover) void loadMusicCover(track);
    }
    if (track && track.id !== activeMusicId) rememberActiveMusic(track);
    const queueIndex = track ? queue.findIndex((item) => item.id === track.id) : -1;
    const playing = Boolean(track && loadedMusicId === track.id && !musicAudio.paused && !musicAudio.ended);
    card.dataset.mediaState = musicLoading ? 'loading' : track ? 'ready' : 'empty'; card.dataset.mediaPlaying = String(playing); card.dataset.mediaSource = track?.kind || 'local';
    setText($('home-media-queue'), queueIndex >= 0 ? `${queueIndex + 1} / ${queue.length}` : `${queue.length} 首`);
    const title = track?.title || '还没有音乐'; setText($('home-media-title'), title); $('home-media-title').title = title;
    const fallback = activeMusicSource()?.type === 'music-dl' ? '当前歌单没有可播放歌曲' : '在设置中添加本地或网络音频';
    setText($('home-media-artist'), track ? (track.artist || (track.kind === 'local' ? '本地音频' : track.kind === 'network' ? '网络音频' : track.provider || '聚合音乐')) : fallback);
    const detail = track?.album || track?.detail || ''; setText($('home-media-album'), detail); $('home-media-album').hidden = !detail;
    const toggle = document.querySelector('[data-home-media="toggle"]');
    const toggleLabel = playing ? '暂停' : '播放'; toggle.setAttribute('aria-label', toggleLabel); toggle.title = toggleLabel; toggle.disabled = !track || musicLoading;
    document.querySelector('[data-home-media="previous"]').disabled = queue.length < 2 || musicLoading;
    document.querySelector('[data-home-media="next"]').disabled = queue.length < 2 || musicLoading;
    const shuffle = document.querySelector('[data-home-media="shuffle"]');
    shuffle.disabled = queue.length < 2 || musicLoading;
    shuffle.setAttribute('aria-pressed', String(musicShuffle));
    shuffle.setAttribute('aria-label', musicShuffle ? '关闭随机播放' : '开启随机播放');
    shuffle.title = musicShuffle ? '关闭随机播放' : '开启随机播放';
    shuffle.classList.toggle('is-active', musicShuffle);
    $('home-music-configure').hidden = Boolean(track || musicLibrary.sources.length > 1);
    if (musicLoading) setText($('home-media-status'), track?.kind === 'local' ? '正在读取本地音频…' : '正在获取音频…');
    else if (!track) setText($('home-media-status'), '当前歌单为空');
    else setText($('home-media-status'), playing ? '播放中' : loadedMusicId === track.id ? (musicAudio.ended ? '播放完毕' : '已暂停') : '准备播放');
    renderMusicProgress();
  }
  function renderMusicSettings() {
    const queue = musicQueue(); const playlist = activeMusicPlaylist();
    setText($('music-library-heading-label'), musicCatalogView === 'discover' ? '当前队列' : '我的歌单');
    setText($('music-library-title'), playlist?.title || '当前歌单'); setText($('music-library-count'), `${queue.length} 首`);
    const list = $('music-library-list'); list.replaceChildren();
    if (!queue.length) { const empty = document.createElement('p'); empty.className = 'music-library-empty'; empty.textContent = '当前歌单没有歌曲'; list.append(empty); return; }
    queue.forEach((track) => {
      const row = document.createElement('div'); row.className = `music-library-row${track.kind === 'catalog' ? ' is-readonly' : ''}`; row.dataset.trackId = track.id;
      const select = document.createElement('button'); select.type = 'button'; select.className = 'music-library-select'; select.title = `播放 ${track.title}`;
      const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = track.title; const detail = document.createElement('small'); detail.textContent = track.detail || track.artist || track.provider || ''; copy.append(title, detail);
      select.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>'; select.append(copy); select.addEventListener('click', () => void loadMusicTrack(track, true)); row.append(select);
      if (track.kind !== 'catalog') {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'music-library-remove'; remove.dataset.removeMusicTrack = track.id; remove.setAttribute('aria-label', `删除 ${track.title}`); remove.title = '从音乐库删除'; remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>'; row.append(remove);
      }
      list.append(row);
    });
  }
  function applyMusicLibrary(result) {
    const normalized = normalizeMusicResult(result); if (!normalized) return false;
    musicLibrary = normalized;
    if (loadedMusicId && !musicLibrary.tracks.some((track) => track.id === loadedMusicId)) releaseMusicSource();
    const track = activeMusicTrack(); rememberActiveMusic(track); renderMusicNavigation(); renderMusicCard(); renderMusicSettings(); return true;
  }
  function musicError(result, fallback) {
    const errors = { invalid_catalog_url: '仅支持本机 go-music-dl HTTP 地址', catalog_unavailable: '无法连接 go-music-dl 服务', invalid_catalog_response: '音乐源返回的数据无效', catalog_response_too_large: '音乐源返回的数据超过限制', playlist_unavailable: '当前歌单读取失败', playlist_search_unavailable: '在线歌单搜索失败', categories_unavailable: '平台分类读取失败', category_playlists_unavailable: '分类歌单读取失败', recommended_playlists_unavailable: '每日推荐读取失败', user_playlists_unavailable: '在线收藏夹读取失败，请检查平台登录状态', source_not_found: '音乐源不存在', invalid_playlist: '在线歌单参数无效', source_limit: '最多添加 8 个聚合音乐源' };
    return errors[result?.error] || fallback;
  }
  function setMusicSelectionBusy(busy) {
    musicSelectionBusy = busy;
    [$('music-source-select'), $('music-playlist-select'), $('music-source-refresh'), $('music-catalog-refresh'), $('music-platform-select'), $('music-category-select'), $('music-playlist-search'), $('music-playlist-search-form'), $('home-media-source-select'), $('home-media-platform-select'), $('home-media-category-select'), $('home-media-playlist-search'), $('home-media-playlist-search-form'), ...document.querySelectorAll('[data-music-catalog-view]')].filter(Boolean).forEach((control) => { control.disabled = busy; });
  }
  async function loadMusicTrack(track, autoplay) {
    if (!track || musicLoading) return;
    rememberActiveMusic(track); const epoch = ++musicLoadEpoch; musicLoading = true; renderMusicCard();
    const result = await api?.loadHomeMusicTrack?.(track.id).catch(() => null);
    if (epoch !== musicLoadEpoch) return;
    if (!result?.ok) { releaseMusicSource(); renderMusicCard(); setText($('home-media-status'), result?.error === 'audio_too_large' ? '音频超过 128 MB 限制' : result?.error === 'unsupported_audio' ? '服务器返回的不是音频文件' : '音频读取失败，播放已停止'); return; }
    const raw = result.bytes?.data || result.bytes; const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw || []);
    if (!bytes.length) { releaseMusicSource(); renderMusicCard(); setText($('home-media-status'), '音频内容为空，播放已停止'); return; }
    releaseMusicSource(); const sourceEpoch = ++musicLoadEpoch; musicLoading = true;
    musicObjectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || track.mimeType || 'application/octet-stream' }));
    loadedMusicId = track.id; musicAudio.src = musicObjectUrl; musicAudio.load(); musicLoading = false; renderMusicCard();
    if (autoplay && sourceEpoch === musicLoadEpoch) {
      try { await musicAudio.play(); } catch { releaseMusicSource(); setText($('home-media-status'), '无法播放该音频格式，播放已停止'); }
      renderMusicCard();
    }
  }
  async function switchMusicPlaylist(sourceId, playlistId) {
    if (musicSelectionBusy || !sourceId || !playlistId || (sourceId === musicLibrary.sourceId && playlistId === musicLibrary.playlistId)) return;
    setMusicSelectionBusy(true); setText($('music-settings-status'), '正在切换歌单…');
    const result = await api?.selectHomeMusicPlaylist?.({ sourceId, playlistId }).catch(() => null);
    setMusicSelectionBusy(false);
    if (!applyMusicLibrary(result)) { releaseMusicSource(); renderMusicNavigation(); setText($('music-settings-status'), musicError(result, '歌单切换失败')); return; }
    void ensureMusicSettingsCategories();
    setText($('music-settings-status'), `已切换到 ${musicPlaylistLabel(activeMusicPlaylist(), activeMusicSource())}`);
    if (activeMusicTrack()) await loadMusicTrack(activeMusicTrack(), true);
  }
  async function browseMusicOnline(action, payload, successMessage) {
    if (musicSelectionBusy || !payload?.sourceId || !payload?.platform) return;
    setMusicSelectionBusy(true); setText($('music-settings-status'), '正在读取在线歌单…');
    const result = await api?.[action]?.(payload).catch(() => null);
    setMusicSelectionBusy(false);
    if (!applyMusicLibrary(result)) { renderMusicNavigation(); setText($('music-settings-status'), musicError(result, '在线歌单读取失败')); return; }
    setText($('music-settings-status'), successMessage);
  }
  async function selectOnlineMusicPlaylist(dataset) {
    if (musicSelectionBusy || !dataset?.platform || !dataset?.playlistId) return;
    setMusicSelectionBusy(true); setText($('music-settings-status'), '正在读取在线歌单…');
    const result = await api?.selectHomeMusicOnlinePlaylist?.({ sourceId: dataset.sourceId || musicLibrary.sourceId, platform: dataset.platform, playlistId: dataset.playlistId, title: dataset.title || '在线歌单' }).catch(() => null);
    setMusicSelectionBusy(false); musicCatalogView = 'discover';
    if (!applyMusicLibrary(result)) { releaseMusicSource(); renderMusicNavigation(); setText($('music-settings-status'), musicError(result, '在线歌单读取失败')); return; }
    setText($('music-settings-status'), `已打开在线歌单 ${activeMusicPlaylist()?.title || ''}`);
    if (activeMusicTrack()) await loadMusicTrack(activeMusicTrack(), true);
  }
  async function refreshMusicLibrary(initial = false, sourceId = musicLibrary.sourceId) {
    if (musicSelectionBusy) return;
    setMusicSelectionBusy(true);
    const request = initial || typeof api?.refreshHomeMusicSource !== 'function' ? api?.getHomeMusicLibrary : () => api.refreshHomeMusicSource(sourceId);
    const result = typeof request === 'function' ? await request().catch(() => null) : null;
    setMusicSelectionBusy(false);
    if (!applyMusicLibrary(result)) { if (!initial) releaseMusicSource(); renderMusicNavigation(); setText($('home-media-status'), musicError(result, '音乐库读取失败')); }
    else if (!initial) setText($('music-settings-status'), activeMusicSource()?.type === 'music-dl' ? '歌单已刷新' : '音乐库已刷新');
  }
  function moveMusic(direction, autoplay = musicPlaybackIntent || !musicAudio.paused) {
    const track = activeMusicTrack(); const queue = musicQueue(); if (!track || queue.length < 2) return;
    const index = queue.findIndex((item) => item.id === track.id);
    const next = musicShuffle ? shuffledMusicTrack(track, queue) : queue[(index + direction + queue.length) % queue.length];
    if (autoplay) void loadMusicTrack(next, true); else { releaseMusicSource(); rememberActiveMusic(next); renderMusicCard(); }
  }
  async function openMusicSettings() { await navigate({ tab: 'settings' }); window.NotchSettings?.select('music'); }
  $('home-media-refresh').addEventListener('click', () => void refreshMusicLibrary());
  $('home-media-discover').addEventListener('click', () => {
    if (!homeDiscoverySource()) { void openMusicSettings(); return; }
    homeMusicDiscoveryOpen = true; renderHomeMusicDiscovery(); void ensureHomeMusicCategories();
  });
  $('home-media-discovery-close').addEventListener('click', () => { homeMusicDiscoveryOpen = false; renderHomeMusicDiscovery(); });
  window.addEventListener('beforeunload', () => { musicArtworkObserver.disconnect(); musicArtworkUrls.forEach((url) => URL.revokeObjectURL(url)); musicArtworkUrls.clear(); });
  $('home-media-library').addEventListener('click', openMusicSettings);
  $('home-music-configure').addEventListener('click', openMusicSettings);
  document.querySelector('[data-home-media="toggle"]').addEventListener('click', async () => {
    const track = activeMusicTrack(); if (!track || musicLoading) return;
    if (loadedMusicId !== track.id || !musicAudio.src) { await loadMusicTrack(track, true); return; }
    if (musicAudio.paused) { try { await musicAudio.play(); } catch { setText($('home-media-status'), '无法继续播放'); } } else musicAudio.pause(); renderMusicCard();
  });
  document.querySelector('[data-home-media="previous"]').addEventListener('click', () => moveMusic(-1));
  document.querySelector('[data-home-media="next"]').addEventListener('click', () => moveMusic(1));
  document.querySelector('[data-home-media="shuffle"]').addEventListener('click', () => {
    musicShuffle = !musicShuffle;
    localStorage.setItem(MUSIC_SHUFFLE_KEY, String(musicShuffle));
    resetMusicShuffle();
    renderMusicCard();
  });
  musicAudio.addEventListener('play', () => { musicPlaybackIntent = true; renderMusicCard(); });
  musicAudio.addEventListener('pause', () => {
    if (!musicResumeAfterTabChange) musicPlaybackIntent = false;
    renderMusicCard();
  });
  musicAudio.addEventListener('loadedmetadata', () => { renderMusicProgress(); renderMusicCard(); }); musicAudio.addEventListener('timeupdate', renderMusicProgress);
  musicAudio.addEventListener('ended', () => { musicPlaybackIntent = false; if (activeMusicTrack() && musicQueue().length > 1) moveMusic(1, true); else renderMusicCard(); });
  musicAudio.addEventListener('error', () => { if (musicAudio.src) { releaseMusicSource(); renderMusicCard(); setText($('home-media-status'), '无法解码该音频格式，播放已停止'); } });
  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab === 'home' || musicAudio.paused || musicAudio.ended || !loadedMusicId) return;
    musicResumeAfterTabChange = true;
    const epoch = musicLoadEpoch;
    setTimeout(async () => {
      if (!musicResumeAfterTabChange || epoch !== musicLoadEpoch || musicAudio.ended) {
        musicResumeAfterTabChange = false;
        return;
      }
      if (!musicAudio.paused) {
        musicResumeAfterTabChange = false;
        return;
      }
      try { await musicAudio.play(); } catch {}
      musicResumeAfterTabChange = false;
      renderMusicCard();
    }, 0);
  });
  $('home-media-source-select').addEventListener('change', (event) => { saveMusicDiscoveryFilter(event.target.value, ''); renderHomeMusicDiscovery(); void ensureHomeMusicCategories(); });
  window.addEventListener('notch:settings-category-change', (event) => { if (event.detail?.id === 'music') void ensureMusicSettingsCategories(); });
  $('home-media-platform-select').addEventListener('change', (event) => { saveMusicDiscoveryFilter(homeDiscoverySource()?.id || '', ''); void browseMusicOnline('browseHomeMusicCategories', { sourceId: homeDiscoverySource()?.id, platform: event.target.value }, '已加载平台分类'); });
  $('home-media-category-select').addEventListener('change', (event) => {
    const sourceId = homeDiscoverySource()?.id; const platform = $('home-media-platform-select').value; const categoryId = event.target.value; saveMusicDiscoveryFilter(sourceId || '', categoryId);
    if (categoryId === '__recommend__') void browseMusicOnline('browseHomeMusicRecommend', { sourceId, platform }, '已加载每日推荐');
    else if (categoryId === '__user__') void browseMusicOnline('browseHomeMusicUserPlaylists', { sourceId, platform }, '已加载我的收藏夹');
    else if (categoryId) void browseMusicOnline('browseHomeMusicCategory', { sourceId, platform, categoryId }, '已加载分类歌单');
    else void browseMusicOnline('browseHomeMusicCategories', { sourceId, platform }, '已加载平台分类');
  });
  $('home-media-playlist-search-form').addEventListener('submit', (event) => {
    event.preventDefault(); const sourceId = homeDiscoverySource()?.id; const platform = $('home-media-platform-select').value; const keyword = $('home-media-playlist-search').value.trim();
    if (!sourceId || !platform || !keyword) { $('home-media-playlist-search').focus(); return; }
    void browseMusicOnline('searchHomeMusicPlaylists', { sourceId, platform, keyword }, '已加载在线歌单搜索结果');
  });
  $('music-source-select').addEventListener('change', (event) => {
    const source = musicLibrary.sources.find((candidate) => candidate.id === event.target.value); const playlist = source?.playlists?.[0];
    if (playlist) void switchMusicPlaylist(source.id, playlist.id); else if (source) void refreshMusicLibrary(false, source.id);
  });
  $('music-playlist-select').addEventListener('change', (event) => void switchMusicPlaylist(musicLibrary.sourceId, event.target.value));
  $('music-source-refresh').addEventListener('click', () => void refreshMusicLibrary());
  $('music-catalog-refresh').addEventListener('click', () => void refreshMusicLibrary());
  document.querySelectorAll('[data-music-catalog-view]').forEach((button) => button.addEventListener('click', () => {
    musicCatalogView = button.dataset.musicCatalogView === 'discover' ? 'discover' : 'mine'; renderMusicNavigation(); renderMusicSettings();
  }));
  $('music-platform-select')?.addEventListener('change', (event) => void browseMusicOnline('browseHomeMusicCategories', { sourceId: musicLibrary.sourceId, platform: event.target.value }, '已加载平台分类'));
  $('music-category-select')?.addEventListener('change', (event) => {
    const platform = $('music-platform-select')?.value; const categoryId = event.target.value;
    if (categoryId === '__recommend__') void browseMusicOnline('browseHomeMusicRecommend', { sourceId: musicLibrary.sourceId, platform }, '已加载每日推荐');
    else if (categoryId === '__user__') void browseMusicOnline('browseHomeMusicUserPlaylists', { sourceId: musicLibrary.sourceId, platform }, '已加载我的收藏夹');
    else if (categoryId) void browseMusicOnline('browseHomeMusicCategory', { sourceId: musicLibrary.sourceId, platform, categoryId }, '已加载分类歌单');
    else void browseMusicOnline('browseHomeMusicCategories', { sourceId: musicLibrary.sourceId, platform }, '已加载平台分类');
  });
  $('music-playlist-search-form')?.addEventListener('submit', (event) => {
    event.preventDefault(); const platform = $('music-platform-select')?.value; const keyword = $('music-playlist-search')?.value.trim();
    if (!keyword) { $('music-playlist-search')?.focus(); return; }
    void browseMusicOnline('searchHomeMusicPlaylists', { sourceId: musicLibrary.sourceId, platform, keyword }, '已加载在线歌单搜索结果');
  });
  async function importLocalMusic(kind) {
    if (musicImporting) return;
    musicImporting = true;
    const buttons = [$('music-local-add'), $('music-local-add-folder')]; buttons.forEach((button) => { button.disabled = true; });
    setText($('music-settings-status'), kind === 'folder' ? '正在扫描文件夹…' : '正在读取所选文件…');
    const request = kind === 'folder' ? api?.chooseHomeMusicFolder : api?.chooseHomeMusicFiles;
    const result = typeof request === 'function' ? await request().catch(() => null) : null;
    musicImporting = false; buttons.forEach((button) => { button.disabled = false; });
    if (result?.error === 'cancelled') { setText($('music-settings-status'), ''); return; }
    if (!applyMusicLibrary(result)) {
      const errors = { track_limit: '音乐库最多保存 200 首', invalid_folder: '无法读取所选文件夹' };
      setText($('music-settings-status'), errors[result?.error] || '没有添加音频，请检查格式或文件大小'); return;
    }
    if (!(result.added > 0)) { setText($('music-settings-status'), kind === 'folder' ? '文件夹中没有新的受支持音频' : '所选文件已存在或不符合大小限制'); return; }
    const suffix = result.limitReached ? '，音乐库已达到 200 首' : result.truncated ? '，已达到 10,000 项扫描上限' : '';
    setText($('music-settings-status'), `已添加 ${result.added} 首本地音乐${suffix}`);
  }
  $('music-local-add').addEventListener('click', () => void importLocalMusic('files'));
  $('music-local-add-folder').addEventListener('click', () => void importLocalMusic('folder'));
  $('music-network-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const url = $('music-network-url').value.trim(); if (!url) { $('music-network-url').focus(); return; }
    const result = await api?.addHomeMusicUrl?.({ url, title: $('music-network-title').value.trim() }).catch(() => null);
    if (!applyMusicLibrary(result)) { const errors = { invalid_audio_url: '请输入公开 HTTPS 音频直链，并使用支持的音频扩展名', track_limit: '音乐库最多保存 200 首' }; setText($('music-settings-status'), errors[result?.error] || '网络音乐添加失败'); return; }
    $('music-network-url').value = ''; $('music-network-title').value = ''; setText($('music-settings-status'), result.added === false ? '该网络音乐已在库中' : '网络音乐已添加');
  });
  $('music-source-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (musicSelectionBusy) return;
    const baseUrl = $('music-source-url').value.trim(); if (!baseUrl) { $('music-source-url').focus(); return; }
    setMusicSelectionBusy(true); setText($('music-settings-status'), '正在连接 go-music-dl…');
    const result = await api?.addHomeMusicSource?.({ baseUrl, name: $('music-source-name').value.trim() }).catch(() => null);
    setMusicSelectionBusy(false);
    if (!applyMusicLibrary(result)) { renderMusicNavigation(); setText($('music-settings-status'), musicError(result, '音乐源添加失败')); return; }
    $('music-source-name').value = ''; $('music-source-form').closest('details').open = false; setText($('music-settings-status'), result.added === false ? '音乐源已更新' : '音乐源已添加');
  });
  $('music-catalog-remove').addEventListener('click', async () => {
    const source = activeMusicSource(); if (!source?.removable || !confirm(`移除音乐源“${source.name}”？`)) return;
    const result = await api?.removeHomeMusicSource?.(source.id).catch(() => null);
    if (!applyMusicLibrary(result)) setText($('music-settings-status'), '音乐源移除失败'); else setText($('music-settings-status'), '音乐源已移除');
  });
  $('music-library-list').addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove-music-track]'); if (!remove) return;
    const removingCurrent = remove.dataset.removeMusicTrack === activeMusicId;
    const result = await api?.removeHomeMusicTrack?.(remove.dataset.removeMusicTrack).catch(() => null);
    if (result?.ok && removingCurrent) releaseMusicSource();
    if (!applyMusicLibrary(result)) setText($('music-settings-status'), '音乐删除失败'); else setText($('music-settings-status'), '已从音乐库移除');
  });
  void refreshMusicLibrary(true);
  const ChatContext = window.NotchChatContext;
  const ChatSessions = window.NotchChatSessions;
  const ChatReader = window.NotchChatReader;
  let history = [], requestId = '', sequence = 0, pendingTurn = null, selectedSources = [], contextCatalog = [], contextType = 'all';
  let conversationRecords = [], savedSessions = ChatSessions.parseSessions(localStorage.getItem(ChatSessions.STORAGE_KEY));
  let currentSessionId = '', currentSessionTitle = '', currentSessionCreatedAt = 0, sessionDirty = false, editingSessionId = '', confirmDeleteSessionId = '';
  const messages = $('home-chat-messages'), chatInput = $('home-chat-input'), chatEmpty = $('home-chat-empty'), chatForm = $('home-chat-form');
  const contextPicker = $('home-chat-context-picker'), contextSearch = $('home-chat-context-search'), contextList = $('home-chat-context-list'), contextChips = $('home-chat-context-chips');
  const sessionPanel = $('home-chat-session-panel'), sessionSearch = $('home-chat-session-search'), sessionList = $('home-chat-session-list');
  const reader = $('home-chat-reader'), readerContent = $('home-chat-reader-content'), readerOutline = $('home-chat-reader-outline');
  let readerTurn = null, readerScrollTop = 0, readerInertState = [];
  const chatIcons = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66L20 8"/><path d="M20 3v5h-5"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h8V5M8 20v-6h8v6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 7-5 5 5 5"/><path d="M20 17a7 7 0 0 0-7-7H4"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    reader: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  };
  const chatErrors = {
    not_configured: '尚未配置内容模型，请先完成 AI 设置。', service_busy: 'AI 正在处理其他请求，请稍后重试。', authentication_failed: '模型凭据验证失败，请检查设置。',
    cancelled: '请求已停止。', context_changed: 'AI 配置已变更，请重新生成。', timeout: '模型响应超时，请重试。', rate_limited: '请求过于频繁，请稍后重试。',
    model_not_found: '当前模型不可用，请检查模型名称。', invalid_endpoint: '服务地址不安全或不可用。', network_error: '无法连接内容模型。',
    invalid_response: '服务返回了无法使用的内容。', response_too_large: '回复超过大小限制，未保留为成功结果。', stream_incomplete: '连接提前中断，回复不完整。',
    invalid_stream: '服务返回的数据流损坏。', output_truncated: '回复达到模型输出上限，内容不完整。', content_filtered: '回复被服务过滤。', unsupported_finish_reason: '模型未正常结束生成。',
    invalid_chat_sources: '所选参考资料无效，请重新选择。', input_too_long: '问题与参考资料超过 12000 字符，请移除资料或缩短问题。',
  };
  function settledRecords() { return conversationRecords.filter((record) => ['complete', 'stopped', 'error'].includes(record.state)); }
  function defaultSessionTitle() {
    return String(settledRecords()[0]?.prompt || '已保存对话').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 48) || '已保存对话';
  }
  function sessionSnapshot(id, title, createdAt, updatedAt) {
    return {
      id,
      title,
      createdAt,
      updatedAt,
      records: settledRecords().map((record) => ({
        id: record.id,
        groupId: record.groupId,
        prompt: record.prompt,
        sources: record.sources,
        context: record.context,
        answer: record.answer,
        state: record.state,
        detail: record.detail || '',
        createdAt: record.createdAt,
      })),
      history,
    };
  }
  function sessionError(error) {
    return error === 'record_limit' ? '此对话已达到 30 个回复上限'
      : error === 'session_limit' ? '当前工作区已达到 30 个会话上限'
        : error === 'session_too_large' ? '此对话超过 512000 字符，未保存新更改'
          : error === 'storage_limit' ? '对话历史超过 2000000 字符，请删除旧会话后重试'
            : '对话保存失败';
  }
  function updateSessionHeader() {
    setText($('home-chat-title'), currentSessionId ? currentSessionTitle : '临时对话');
    const state = $('home-chat-session-state');
    const dot = document.createElement('i'); dot.setAttribute('aria-hidden', 'true');
    state.replaceChildren(dot, document.createTextNode(currentSessionId ? (sessionDirty ? '未保存更改' : '已保存到当前工作区') : '仅本次会话'));
    state.dataset.saved = String(Boolean(currentSessionId) && !sessionDirty);
    const save = $('home-chat-session-save');
    save.dataset.saved = String(Boolean(currentSessionId) && !sessionDirty);
    save.disabled = Boolean(requestId) || !settledRecords().length || (Boolean(currentSessionId) && !sessionDirty);
    save.title = currentSessionId ? (sessionDirty ? '保存未同步的更改' : '对话已保存') : '保存到当前工作区';
    save.setAttribute('aria-label', save.title);
  }
  function commitSessionStorage(result) {
    if (!result?.ok) return result;
    try {
      if (result.next.length) localStorage.setItem(ChatSessions.STORAGE_KEY, result.serialized);
      else localStorage.removeItem(ChatSessions.STORAGE_KEY);
    } catch { return { ok: false, error: 'write_failed' }; }
    savedSessions = result.next;
    if (!sessionPanel.hidden) renderSessionPanel();
    return result;
  }
  function syncSessionWorkspace(sessionId) {
    if (typeof syncWorkspaceSnapshot !== 'function') return;
    void syncWorkspaceSnapshot().then((synced) => {
      if (!synced && currentSessionId === sessionId) setText($('home-chat-status'), '已保存在本机，当前工作区同步失败');
    });
  }
  function persistCurrentSession({ create = false } = {}) {
    const records = settledRecords();
    if (!records.length) return { ok: false, error: 'empty_session' };
    const now = Date.now();
    const proposedId = currentSessionId || (create ? `chat-${now}-${++sequence}` : '');
    if (!proposedId) return { ok: false, error: 'temporary_session' };
    const proposedTitle = currentSessionTitle || defaultSessionTitle();
    const result = commitSessionStorage(ChatSessions.upsertSession(savedSessions, sessionSnapshot(proposedId, proposedTitle, currentSessionCreatedAt || now, now)));
    if (!result.ok) { sessionDirty = Boolean(currentSessionId); updateSessionHeader(); return result; }
    currentSessionId = proposedId; currentSessionTitle = proposedTitle; currentSessionCreatedAt ||= now; sessionDirty = false;
    updateSessionHeader(); syncSessionWorkspace(proposedId); return result;
  }
  function formatSessionTime(timestamp) {
    const date = new Date(timestamp); const now = new Date();
    return date.toDateString() === now.toDateString() ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }
  function closeSessionPanel({ focus = false } = {}) {
    sessionPanel.hidden = true; $('home-chat-sessions').setAttribute('aria-expanded', 'false'); editingSessionId = ''; confirmDeleteSessionId = ''; if (focus) chatInput.focus();
  }
  function applySessionRename(sessionId, title) {
    const result = commitSessionStorage(ChatSessions.renameSession(savedSessions, sessionId, title, Date.now()));
    if (!result.ok) { setText($('home-chat-status'), result.error === 'invalid_title' ? '会话标题不能为空' : '无法重命名会话'); return; }
    if (currentSessionId === sessionId) { currentSessionTitle = result.next.find((session) => session.id === sessionId)?.title || currentSessionTitle; updateSessionHeader(); }
    editingSessionId = ''; renderSessionPanel(); syncSessionWorkspace(sessionId); setText($('home-chat-status'), '会话已重命名');
  }
  function deleteSavedSession(sessionId) {
    if (currentSessionId === sessionId && requestId) cancelChat();
    const result = commitSessionStorage(ChatSessions.removeSession(savedSessions, sessionId));
    if (!result.ok) { setText($('home-chat-status'), '无法删除会话'); return; }
    if (currentSessionId === sessionId) resetChat({ keepSessionPanel: true, status: '已删除会话，并开始新的临时对话', force: true });
    confirmDeleteSessionId = ''; renderSessionPanel(); syncSessionWorkspace(sessionId);
  }
  function renderSessionPanel() {
    const rows = ChatSessions.searchSessions(savedSessions, sessionSearch.value);
    sessionList.replaceChildren();
    rows.forEach((session) => {
      const row = document.createElement('div'); row.className = 'home-chat-session-row'; row.dataset.active = String(session.id === currentSessionId);
      if (editingSessionId === session.id) {
        const edit = document.createElement('form'); edit.className = 'home-chat-session-edit';
        const input = document.createElement('input'); input.maxLength = 48; input.value = session.title; input.setAttribute('aria-label', '会话标题');
        const confirm = actionButton('check', '确认重命名', () => {}); confirm.type = 'submit';
        const cancel = actionButton('close', '取消重命名', () => { editingSessionId = ''; renderSessionPanel(); });
        edit.addEventListener('submit', (event) => { event.preventDefault(); applySessionRename(session.id, input.value); }); edit.append(input, confirm, cancel); row.append(edit); sessionList.append(row); requestAnimationFrame(() => { input.focus(); input.select(); }); return;
      }
      const open = document.createElement('button'); open.type = 'button'; open.className = 'home-chat-session-open';
      const title = document.createElement('strong'); title.textContent = session.title;
      const detail = document.createElement('span'); detail.textContent = `${session.records.length} 个回复 · ${formatSessionTime(session.updatedAt)}`;
      open.append(title, detail); open.addEventListener('click', () => openSavedSession(session.id));
      const actions = document.createElement('div'); actions.className = 'home-chat-session-actions';
      if (confirmDeleteSessionId === session.id) {
        const cancel = actionButton('close', '取消删除', () => { confirmDeleteSessionId = ''; renderSessionPanel(); });
        const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.confirm = 'true'; remove.textContent = '确认删除'; remove.addEventListener('click', () => deleteSavedSession(session.id)); actions.append(cancel, remove);
      } else {
        actions.append(actionButton('edit', '重命名会话', () => { editingSessionId = session.id; confirmDeleteSessionId = ''; renderSessionPanel(); }), actionButton('trash', '删除会话', () => { confirmDeleteSessionId = session.id; editingSessionId = ''; renderSessionPanel(); }));
      }
      row.append(open, actions); sessionList.append(row);
    });
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'home-chat-session-empty'; empty.textContent = sessionSearch.value ? '没有匹配的对话' : '当前工作区还没有保存的对话'; sessionList.append(empty); }
    setText($('home-chat-session-count'), `${savedSessions.length} / ${ChatSessions.MAX_SESSIONS} 个会话`);
    $('home-chat-session-confirm-save').hidden = Boolean(currentSessionId) || !settledRecords().length || Boolean(requestId);
  }
  function openSessionPanel() {
    closeContextPicker(); sessionSearch.value = ''; renderSessionPanel(); sessionPanel.hidden = false; $('home-chat-sessions').setAttribute('aria-expanded', 'true'); sessionSearch.focus();
  }
  function openSavedSession(sessionId) {
    if (sessionId === currentSessionId) { closeSessionPanel({ focus: true }); return; }
    if (requestId) cancelChat();
    closeReader({ focus: false });
    if (sessionDirty) { setText($('home-chat-status'), '当前会话有未保存更改，请先处理容量或存储问题'); return; }
    const session = savedSessions.find((item) => item.id === sessionId); if (!session) return;
    currentSessionId = session.id; currentSessionTitle = session.title; currentSessionCreatedAt = session.createdAt; sessionDirty = false;
    history = session.history; conversationRecords = []; selectedSources = []; closeContextPicker(); closeSessionPanel(); messages.replaceChildren(chatEmpty); chatEmpty.hidden = true; chatInput.value = ''; renderContextChips();
    const users = new Map();
    session.records.forEach((saved) => {
      let user = users.get(saved.groupId);
      if (!user) { user = message('user', saved.prompt, 'complete', saved.sources); users.set(saved.groupId, user); }
      const reply = message('assistant', saved.answer, saved.state);
      const turn = { ...saved, user, reply, savedNote: null, isVersion: session.records.filter((item) => item.groupId === saved.groupId).length > 1 };
      setTurnState(turn, saved.state, saved.detail); addTurnActions(turn, saved.state === 'complete'); conversationRecords.push(turn);
    });
    for (const groupId of users.keys()) {
      const versions = conversationRecords.filter((record) => record.groupId === groupId && record.state === 'complete');
      if (versions.length > 1) versions.forEach((record, index) => { const label = record.reply.querySelector('.home-chat-message-head span'); if (label) label.textContent = index === versions.length - 1 ? 'AI 助手 · 新版本' : 'AI 助手 · 上一版本'; record.reply.dataset.version = index === versions.length - 1 ? 'current' : 'previous'; });
    }
    updateSessionHeader(); resizeChatInput(); messages.scrollTop = messages.scrollHeight; setText($('home-chat-status'), `已打开“${session.title}”`); chatInput.focus();
  }
  function selectedSource(key) { return selectedSources.find((source) => ChatContext.sourceKey(source) === key); }
  function collectChatSources() {
    return ChatContext.catalog([
      ...(window.NotchNotes?.chatContexts?.() || []),
      ...(window.NotchWorkspace?.chatContexts?.() || []),
      ...(window.NotchTodo?.chatContexts?.() || []),
      ...(window.NotchClipboard?.chatContexts?.() || []),
    ]);
  }
  function chatInputLength(sources = selectedSources, text = chatInput.value) { return ChatContext.messageContent(text, sources).length; }
  function chatControls(busy) {
    chatForm.dataset.busy = String(busy); $('home-chat-send').hidden = busy; $('home-chat-stop').hidden = !busy; resizeChatInput(); updateSessionHeader();
  }
  function resizeChatInput() {
    chatInput.style.height = 'auto'; chatInput.style.height = `${Math.min(132, Math.max(40, chatInput.scrollHeight))}px`;
    const length = chatInputLength(), wasOverLimit = chatForm.dataset.overLimit === 'true', overLimit = length > 12000;
    setText($('home-chat-count'), `${length} / 12000${selectedSources.length ? ` · ${selectedSources.length} 份资料` : ''}`);
    $('home-chat-send').disabled = !chatInput.value.trim() || overLimit;
    chatForm.dataset.overLimit = String(overLimit);
    if (!requestId && overLimit) setText($('home-chat-status'), '问题与参考资料超过 12000 字符，请移除资料或缩短问题');
    else if (!requestId && wasOverLimit && !overLimit) setText($('home-chat-status'), selectedSources.length ? `将随本条消息发送 ${selectedSources.length} 份资料` : '不读取工作区 · Enter 发送，Shift + Enter 换行');
  }
  function renderContextChips() {
    contextChips.replaceChildren();
    selectedSources.forEach((source) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.removeChatSource = ChatContext.sourceKey(source); button.title = `移除${ChatContext.SOURCE_LABELS[source.sourceType]}：${source.sourceTitle}`;
      const label = document.createElement('span'); label.textContent = `${ChatContext.SOURCE_LABELS[source.sourceType]} · ${source.sourceTitle}`;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '2'); icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'm7 7 10 10M17 7 7 17'); icon.append(path); button.append(label, icon); contextChips.append(button);
    });
    contextChips.hidden = selectedSources.length === 0; resizeChatInput();
  }
  function renderContextPicker() {
    const rows = ChatContext.catalog(contextCatalog, contextSearch.value, contextType);
    contextList.replaceChildren();
    rows.slice(0, 100).forEach((source) => {
      const key = ChatContext.sourceKey(source), active = Boolean(selectedSource(key));
      const candidate = active ? selectedSources.filter((item) => ChatContext.sourceKey(item) !== key) : [...selectedSources, source];
      const fits = source.text.length <= 12000 && chatInputLength(candidate) <= 12000;
      const atLimit = !active && selectedSources.length >= ChatContext.MAX_SOURCES;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'home-chat-context-row'; button.dataset.chatSource = key; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(active));
      button.disabled = atLimit || (!active && !fits);
      const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = source.sourceTitle;
      const detail = document.createElement('small'); detail.textContent = source.detail || source.text.replace(/\s+/g, ' ').slice(0, 90); copy.append(title, detail);
      const kind = document.createElement('i'); kind.textContent = atLimit ? '已达上限' : !active && !fits ? '超过上限' : ChatContext.SOURCE_LABELS[source.sourceType]; button.append(copy, kind); contextList.append(button);
    });
    if (!rows.length) { const emptyState = document.createElement('p'); emptyState.className = 'home-chat-context-empty'; emptyState.textContent = contextSearch.value ? '没有匹配的文字资料' : '当前没有可添加的文字资料'; contextList.append(emptyState); }
    setText($('home-chat-context-result'), `${rows.length} 项资料${rows.length > 100 ? ' · 显示前 100 项' : ''}`);
    setText($('home-chat-context-selected'), `已选择 ${selectedSources.length} / ${ChatContext.MAX_SOURCES}`);
  }
  function closeContextPicker({ focus = false } = {}) {
    contextPicker.hidden = true; $('home-chat-context-add').setAttribute('aria-expanded', 'false'); if (focus) chatInput.focus();
  }
  function openContextPicker() {
    contextCatalog = collectChatSources(); contextType = 'all'; contextSearch.value = ''; document.querySelectorAll('[data-chat-context-type]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.chatContextType === 'all')));
    renderContextPicker(); contextPicker.hidden = false; $('home-chat-context-add').setAttribute('aria-expanded', 'true'); contextSearch.focus();
  }
  function actionButton(icon, label, handler) {
    const button = document.createElement('button'); button.type = 'button'; button.innerHTML = chatIcons[icon]; button.setAttribute('aria-label', label); button.title = label; button.addEventListener('click', handler); return button;
  }
  function renderChatText(container, text) {
    if (window.NotchMarkdown?.render) window.NotchMarkdown.render(container, text); else container.textContent = text;
  }
  function message(role, text, state = 'complete', sources = []) {
    chatEmpty.hidden = true;
    const article = document.createElement('article'); article.className = 'home-chat-message'; article.dataset.role = role; article.dataset.state = state;
    const body = document.createElement('div'); body.className = 'home-chat-message-body';
    if (role === 'assistant') {
      const head = document.createElement('div'); head.className = 'home-chat-message-head';
      const mark = document.createElement('i'); mark.textContent = 'AI'; const label = document.createElement('span'); label.textContent = state === 'streaming' ? '正在回复' : 'AI 助手'; head.append(mark, label);
      renderChatText(body, text); article.append(head, body);
    } else {
      body.textContent = text; article.append(body);
      if (sources.length) {
        const badges = document.createElement('div'); badges.className = 'home-chat-message-sources';
        sources.forEach((source) => { const badge = document.createElement('span'); badge.textContent = `${ChatContext.SOURCE_LABELS[source.sourceType]} · ${source.sourceTitle}`; badge.title = badge.textContent; badges.append(badge); });
        article.append(badges);
      }
    }
    messages.append(article); return article;
  }
  function setTurnState(turn, state, detail) {
    turn.state = state; turn.detail = detail || ''; turn.reply.dataset.state = state;
    const label = turn.reply.querySelector('.home-chat-message-head span'); if (label) label.textContent = state === 'streaming' ? '正在回复' : state === 'complete' ? (turn.isVersion ? 'AI 助手 · 新版本' : 'AI 助手') : state === 'stopped' ? '已停止' : '生成失败';
    turn.reply.querySelector('.home-chat-message-state')?.remove();
    if (detail) { const note = document.createElement('p'); note.className = 'home-chat-message-state'; note.textContent = detail; turn.reply.append(note); }
  }
  function noteTitle(answer) { return ChatReader.title(answer) || 'AI 对话回复'; }
  function setReaderStatus(text, error = false) {
    setText($('home-chat-reader-status'), text); $('home-chat-reader-status').dataset.error = String(error);
  }
  function reportTurnStatus(turn, text, error = false) {
    setText($('home-chat-status'), text);
    if (!reader.hidden && readerTurn === turn) setReaderStatus(text, error);
  }
  function updateReaderSaveAction() {
    const button = $('home-chat-reader-save'); if (!readerTurn) return;
    button.disabled = Boolean(readerTurn.noteMutating);
    button.dataset.saved = String(Boolean(readerTurn.savedNote));
    button.innerHTML = readerTurn.savedNote ? chatIcons.undo : chatIcons.save;
    button.setAttribute('aria-label', readerTurn.savedNote ? '撤销保存笔记' : '保存为笔记'); button.title = button.getAttribute('aria-label');
  }
  async function toggleTurnNote(turn) {
    if (!turn || turn.noteMutating) return;
    turn.noteMutating = true; addTurnActions(turn, true); if (readerTurn === turn) updateReaderSaveAction();
    if (turn.savedNote) {
      const undone = await window.NotchNotes?.undoGenerated?.(turn.savedNote).catch(() => null);
      if (undone?.ok) { turn.savedNote = null; reportTurnStatus(turn, undone.workspaceSynced === false ? '已在本机撤销，工作区同步失败' : '已撤销保存笔记', undone.workspaceSynced === false); }
      else reportTurnStatus(turn, '笔记已变化，无法撤销', true);
    } else {
      const result = await window.NotchNotes?.saveGenerated?.(noteTitle(turn.answer), turn.answer, 'model').catch(() => null);
      if (result?.ok) { turn.savedNote = result.note; reportTurnStatus(turn, result.workspaceSynced === false ? '已保存到本机，工作区同步失败' : '已保存为笔记', result.workspaceSynced === false); }
      else reportTurnStatus(turn, result?.error === 'capacity' ? '笔记库已达到 200 篇上限' : '保存笔记失败', true);
    }
    turn.noteMutating = false; addTurnActions(turn, true); if (readerTurn === turn) updateReaderSaveAction();
  }
  function readerSelectionText() {
    if (reader.hidden) return '';
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !readerContent.contains(selection.anchorNode) || !readerContent.contains(selection.focusNode)) return '';
    return selection.toString().trim();
  }
  function updateReaderSelectionActions() {
    if (reader.hidden || !readerTurn) return;
    const selected = readerSelectionText();
    $('home-chat-reader-copy-selection').disabled = !selected;
    const source = ChatReader.todoSource(readerTurn.answer, selected);
    const todos = $('home-chat-reader-todos'); todos.disabled = false; todos.setAttribute('aria-disabled', String(!source.ok));
    todos.title = source.ok ? (source.scope === 'selection' ? `从选中的 ${source.length} 个字符提取待办` : '从全文提取待办')
      : source.error === 'source_too_long' ? '请先选择不超过 12000 字符的内容' : '没有可提取的内容';
  }
  function closeReader({ focus = true } = {}) {
    if (reader.hidden) return;
    const turn = readerTurn; reader.hidden = true; readerTurn = null; window.getSelection()?.removeAllRanges(); messages.scrollTop = readerScrollTop;
    readerInertState.forEach(([node, inert]) => { node.inert = inert; }); readerInertState = [];
    if (focus) (turn?.readerButton?.isConnected ? turn.readerButton : chatInput).focus({ preventScroll: true });
  }
  function openReader(turn) {
    if (!turn || turn.state !== 'complete' || !ChatReader.analyze(turn.answer).eligible) return;
    if (requestId) { setText($('home-chat-status'), '请先停止当前生成，再打开长回答'); return; }
    closeContextPicker(); closeSessionPanel(); readerTurn = turn; readerScrollTop = messages.scrollTop;
    readerInertState = [...reader.parentElement.children].filter((node) => node !== reader).map((node) => [node, node.inert]); readerInertState.forEach(([node]) => { node.inert = true; });
    const analysis = ChatReader.analyze(turn.answer); setText($('home-chat-reader-title'), ChatReader.title(turn.answer));
    setText($('home-chat-reader-meta'), `${analysis.charCount} 字符 · ${analysis.headings.length || 1} 个章节 · ${currentSessionId ? currentSessionTitle : '临时对话'}`);
    renderChatText(readerContent, turn.answer); readerOutline.replaceChildren();
    const headingNodes = [...readerContent.querySelectorAll('h2, h3, h4, h5')];
    headingNodes.forEach((heading, index) => {
      heading.id = `chat-reader-section-${index + 1}`;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.level = String(Math.max(1, Number(heading.tagName.slice(1)) - 1)); button.textContent = heading.textContent || `第 ${index + 1} 节`; button.title = button.textContent;
      button.addEventListener('click', () => heading.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })); readerOutline.append(button);
    });
    if (!headingNodes.length) { const empty = document.createElement('p'); empty.className = 'home-chat-reader-outline-empty'; empty.textContent = '全文'; readerOutline.append(empty); }
    reader.hidden = false; readerContent.scrollTop = 0; updateReaderSaveAction(); updateReaderSelectionActions(); setReaderStatus('阅读视图不会自动保存内容'); requestAnimationFrame(() => $('home-chat-reader-close').focus({ preventScroll: true }));
  }
  function addTurnActions(turn, complete) {
    turn.reply.querySelector('.home-chat-message-actions')?.remove();
    const actions = document.createElement('div'); actions.className = 'home-chat-message-actions';
    if (turn.answer) actions.append(actionButton('copy', '复制回复', async () => {
      try { await api?.writeClipboard?.({ text: turn.answer }); reportTurnStatus(turn, '回复已复制'); } catch { reportTurnStatus(turn, '复制失败', true); }
    }));
    if (complete && ChatReader.analyze(turn.answer).eligible) { turn.readerButton = actionButton('reader', '打开长回答工作台', () => openReader(turn)); actions.append(turn.readerButton); }
    actions.append(actionButton('retry', complete ? '重新生成' : '重试', () => void submitChat(turn.prompt, { user: turn.user, context: turn.context, sources: turn.sources, versionOf: turn })));
    if (complete) {
      const save = actionButton(turn.savedNote ? 'undo' : 'save', turn.savedNote ? '撤销保存' : '保存为笔记', () => void toggleTurnNote(turn));
      save.dataset.saved = String(Boolean(turn.savedNote)); save.disabled = Boolean(turn.noteMutating); actions.append(save);
    }
    turn.reply.append(actions);
  }
  function contextFor(currentContent, source = history) {
    const context = source.slice(-12);
    while (context.length && context.reduce((sum, item) => sum + item.content.length, currentContent.length) > 12000) context.splice(0, 2);
    return context;
  }
  function cancelChat() {
    if (!requestId || !pendingTurn) return;
    const id = requestId, turn = pendingTurn; requestId = ''; pendingTurn = null; ++sequence; void api?.cancelAI?.(id).catch(() => {});
    if (!turn.answer) turn.reply.querySelector('.home-chat-message-body').replaceChildren();
    else renderChatText(turn.reply.querySelector('.home-chat-message-body'), turn.answer);
    setTurnState(turn, 'stopped', turn.answer ? '生成已停止，以上内容不计入后续上下文。' : '生成已停止，本轮未计入后续上下文。');
    addTurnActions(turn, false); chatControls(false);
    const saved = currentSessionId ? persistCurrentSession() : { ok: true };
    setText($('home-chat-status'), saved.ok ? '已停止，可重试本轮' : sessionError(saved.error)); chatInput.focus();
  }
  function resetChat({ keepSessionPanel = false, status = '已开始新的临时对话', force = false } = {}) {
    cancelChat();
    if (sessionDirty && !force) { setText($('home-chat-status'), '当前会话有未保存更改，请先处理容量或存储问题'); return false; }
    closeReader({ focus: false }); history = []; conversationRecords = []; currentSessionId = ''; currentSessionTitle = ''; currentSessionCreatedAt = 0; sessionDirty = false; selectedSources = []; closeContextPicker(); if (!keepSessionPanel) closeSessionPanel(); messages.replaceChildren(chatEmpty); chatEmpty.hidden = false; chatInput.value = ''; renderContextChips(); updateSessionHeader(); setText($('home-chat-status'), status); chatInput.focus(); return true;
  }
  async function refreshChatModel() {
    const config = await api?.getTranscriptionConfig?.().catch(() => null);
    const provider = config?.llmConfigured ? (config.llmProviderLabel || config.llmProviderId || '内容模型') : '内容模型未配置';
    const model = config?.llmConfigured ? (config.llmModel || '默认模型') : '前往设置';
    setText($('home-chat-provider'), provider); setText($('home-chat-model-name'), model); setText($('home-ai-model'), config?.llmConfigured ? `${provider} · ${model}` : '尚未配置');
  }
  async function openAISettings() { await navigate({ tab: 'settings' }); window.NotchSettings?.select('api'); }
  async function submitChat(rawText, options = {}) {
    if (requestId) return;
    const text = String(rawText || '').trim(); if (!text) return;
    if (conversationRecords.length >= ChatSessions.MAX_RECORDS) { setText($('home-chat-status'), '此对话已达到 30 个回复上限，请新建对话'); return; }
    const sources = ChatContext.normalizeSources(options.sources === undefined ? selectedSources : options.sources);
    const historyContent = ChatContext.messageContent(text, sources);
    if (historyContent.length > 12000) { setText($('home-chat-status'), '问题与参考资料超过 12000 字符，请移除资料或缩短问题'); return; }
    const context = contextFor(historyContent, options.context || history);
    const user = options.user || message('user', text, 'complete', sources);
    const reply = message('assistant', '正在思考…', 'streaming');
    if (options.versionOf) { options.versionOf.reply.dataset.version = 'previous'; const oldLabel = options.versionOf.reply.querySelector('.home-chat-message-head span'); if (oldLabel) oldLabel.textContent = 'AI 助手 · 上一版本'; reply.querySelector('.home-chat-message-head span').textContent = 'AI 助手 · 新版本'; }
    const createdAt = Date.now();
    const turn = { id: `reply-${createdAt}-${++sequence}`, groupId: options.versionOf?.groupId || `turn-${createdAt}-${sequence}`, prompt: text, context, sources, historyContent, user, reply, answer: '', state: 'streaming', detail: '', createdAt, savedNote: null, isVersion: Boolean(options.versionOf) };
    conversationRecords.push(turn); pendingTurn = turn; messages.scrollTop = messages.scrollHeight;
    if (!options.user) { chatInput.value = ''; selectedSources = []; closeContextPicker(); renderContextChips(); }
    const seq = ++sequence, id = `home-chat-${Date.now()}-${seq}`; requestId = id; chatControls(true);
    setText($('home-chat-status'), context.length ? `使用最近 ${context.length / 2} 轮${sources.length ? `及 ${sources.length} 份资料` : ''}生成` : sources.length ? `使用 ${sources.length} 份所选资料生成` : '正在生成，可随时停止');
    const result = await api?.runAI?.({ requestId: id, action: 'chat', interactive: true, context: { sourceType: 'manual', text, sources }, history: context, referenceTime: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }).catch(() => null);
    if (seq !== sequence || id !== requestId) return;
    requestId = ''; pendingTurn = null; chatControls(false);
    if (!result?.ok) {
      if (turn.answer) renderChatText(reply.querySelector('.home-chat-message-body'), turn.answer); else reply.querySelector('.home-chat-message-body').replaceChildren();
      const detail = chatErrors[result?.error] || '生成失败，请重试。'; setTurnState(turn, 'error', detail); addTurnActions(turn, false);
      const saved = currentSessionId ? persistCurrentSession() : { ok: true }; setText($('home-chat-status'), saved.ok ? '本轮未计入上下文，可重试' : sessionError(saved.error)); chatInput.focus(); return;
    }
    turn.answer = String(result.text || ''); renderChatText(reply.querySelector('.home-chat-message-body'), turn.answer); setTurnState(turn, 'complete', ''); addTurnActions(turn, true);
    history = [...context, { role: 'user', content: historyContent }, { role: 'assistant', content: turn.answer }].slice(-12);
    const reusableTurns = contextFor('', history).length / 2;
    const saved = currentSessionId ? persistCurrentSession() : { ok: true };
    setText($('home-chat-status'), !saved.ok ? sessionError(saved.error) : reusableTurns ? `回复完成 · 后续将使用最近 ${reusableTurns} 轮` : '回复完成 · 本轮内容过长，不加入下一轮上下文'); chatInput.focus();
  }
  $('home-chat-open').addEventListener('click', () => { changeView('chat'); void refreshChatModel(); chatInput.focus(); });
  $('home-chat-close').addEventListener('click', () => { cancelChat(); closeReader({ focus: false }); closeContextPicker(); closeSessionPanel(); changeView('dashboard'); $('home-chat-open').focus(); });
  $('home-chat-stop').addEventListener('click', cancelChat); $('home-chat-new').addEventListener('click', () => resetChat()); $('home-chat-model').addEventListener('click', openAISettings);
  $('home-chat-session-save').addEventListener('click', () => {
    if (!currentSessionId) { openSessionPanel(); setText($('home-chat-status'), '确认保存范围后，将对话写入当前工作区'); $('home-chat-session-confirm-save').focus(); return; }
    const result = persistCurrentSession(); setText($('home-chat-status'), result.ok ? '对话更改已保存' : sessionError(result.error));
  });
  $('home-chat-sessions').addEventListener('click', () => { if (sessionPanel.hidden) openSessionPanel(); else closeSessionPanel({ focus: true }); });
  $('home-chat-session-close').addEventListener('click', () => closeSessionPanel({ focus: true }));
  $('home-chat-session-confirm-save').addEventListener('click', () => { const result = persistCurrentSession({ create: true }); if (result.ok) { renderSessionPanel(); setText($('home-chat-status'), '对话及资料文字快照已保存到当前工作区'); } else setText($('home-chat-status'), sessionError(result.error)); });
  $('home-chat-session-new').addEventListener('click', () => resetChat({ status: '已开始新的临时对话' }));
  sessionSearch.addEventListener('input', renderSessionPanel);
  sessionPanel.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); closeSessionPanel({ focus: true }); } });
  $('home-chat-context-add').addEventListener('click', () => { if (contextPicker.hidden) { closeSessionPanel(); openContextPicker(); } else closeContextPicker({ focus: true }); });
  $('home-chat-context-close').addEventListener('click', () => closeContextPicker({ focus: true }));
  contextSearch.addEventListener('input', renderContextPicker);
  document.querySelectorAll('[data-chat-context-type]').forEach((button) => button.addEventListener('click', () => {
    contextType = button.dataset.chatContextType; document.querySelectorAll('[data-chat-context-type]').forEach((item) => item.setAttribute('aria-selected', String(item === button))); renderContextPicker();
  }));
  contextList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chat-source]'); if (!button || button.disabled) return;
    const key = button.dataset.chatSource, active = selectedSource(key);
    if (active) selectedSources = selectedSources.filter((source) => ChatContext.sourceKey(source) !== key);
    else {
      const source = contextCatalog.find((item) => ChatContext.sourceKey(item) === key); if (!source) return;
      const candidate = ChatContext.normalizeSources([...selectedSources, source]);
      if (candidate.length === selectedSources.length || chatInputLength(candidate) > 12000) { setText($('home-chat-status'), '最多选择 3 份资料，且资料与问题合计不能超过 12000 字符'); return; }
      selectedSources = candidate;
    }
    renderContextChips(); renderContextPicker(); if (!requestId) setText($('home-chat-status'), selectedSources.length ? `将随本条消息发送 ${selectedSources.length} 份资料` : '未选择参考资料'); requestAnimationFrame(() => contextList.querySelector(`[data-chat-source="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }));
  });
  const contextTabs = [...document.querySelectorAll('[data-chat-context-type]')];
  contextTabs.forEach((button, index) => button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? contextTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + contextTabs.length) % contextTabs.length;
    contextTabs[targetIndex].focus(); contextTabs[targetIndex].click();
  }));
  contextChips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-chat-source]'); if (!button) return;
    selectedSources = selectedSources.filter((source) => ChatContext.sourceKey(source) !== button.dataset.removeChatSource); renderContextChips(); if (!contextPicker.hidden) renderContextPicker(); if (!requestId) setText($('home-chat-status'), selectedSources.length ? `将随本条消息发送 ${selectedSources.length} 份资料` : '未选择参考资料'); chatInput.focus();
  });
  contextPicker.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); closeContextPicker({ focus: true }); } });
  document.addEventListener('pointerdown', (event) => { if (!contextPicker.hidden && !contextPicker.contains(event.target) && !$('home-chat-context-add').contains(event.target)) closeContextPicker(); });
  document.querySelectorAll('[data-home-chat-prompt]').forEach((button) => button.addEventListener('click', () => { chatInput.value = button.dataset.homeChatPrompt || ''; resizeChatInput(); chatInput.focus(); chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length); }));
  chatForm.addEventListener('submit', (event) => { event.preventDefault(); void submitChat(chatInput.value); });
  chatInput.addEventListener('input', () => { resizeChatInput(); if (!contextPicker.hidden) renderContextPicker(); });
  chatInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); chatForm.requestSubmit(); } });
  messages.addEventListener('click', async (event) => {
    const codeCopy = event.target.closest('[data-markdown-copy]');
    if (codeCopy) { const code = codeCopy.closest('.markdown-code')?.querySelector('code')?.textContent || ''; try { await api?.writeClipboard?.({ text: code }); setText($('home-chat-status'), '代码已复制'); } catch { setText($('home-chat-status'), '复制失败'); } return; }
    const link = event.target.closest('[data-external-url]'); if (link) { event.preventDefault(); await api?.openExternal?.(link.dataset.externalUrl).catch(() => {}); }
  });
  $('home-chat-reader-close').addEventListener('click', () => closeReader());
  $('home-chat-reader-copy').addEventListener('click', async () => {
    if (!readerTurn) return;
    try { await api?.writeClipboard?.({ text: readerTurn.answer }); setReaderStatus('全文已复制'); } catch { setReaderStatus('复制全文失败', true); }
  });
  $('home-chat-reader-copy-selection').addEventListener('click', async () => {
    const text = readerSelectionText(); if (!text) { setReaderStatus('请先在正文中选择内容', true); return; }
    try { await api?.writeClipboard?.({ text }); setReaderStatus(`已复制 ${text.length} 个字符`); } catch { setReaderStatus('复制选区失败', true); }
  });
  $('home-chat-reader-save').addEventListener('click', () => { if (readerTurn) void toggleTurnNote(readerTurn); });
  $('home-chat-reader-todos').addEventListener('click', () => {
    if (!readerTurn) return;
    const source = ChatReader.todoSource(readerTurn.answer, readerSelectionText());
    if (!source.ok) { setReaderStatus(source.error === 'source_too_long' ? '内容超过 12000 字符，请先缩小选区' : '没有可提取的内容', true); return; }
    setReaderStatus(source.scope === 'selection' ? `使用选中的 ${source.length} 个字符提取待办` : '使用全文提取待办');
    window.NotchAI?.open?.({ action: 'extractTodos', sourceType: 'manual', sourceTitle: noteTitle(readerTurn.answer), text: source.text, returnFocus: $('home-chat-reader-todos') });
  });
  readerContent.addEventListener('click', async (event) => {
    const codeCopy = event.target.closest('[data-markdown-copy]');
    if (codeCopy) { const code = codeCopy.closest('.markdown-code')?.querySelector('code')?.textContent || ''; try { await api?.writeClipboard?.({ text: code }); setReaderStatus('代码已复制'); } catch { setReaderStatus('复制代码失败', true); } return; }
    const link = event.target.closest('[data-external-url]'); if (link) { event.preventDefault(); await api?.openExternal?.(link.dataset.externalUrl).catch(() => {}); }
  });
  reader.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); closeReader(); } });
  document.addEventListener('selectionchange', updateReaderSelectionActions);
  document.addEventListener('notch:modechange', (event) => { if (event.detail?.expanded === false) closeReader({ focus: false }); });
  window.NotchChatReaderView = Object.freeze({
    isOpen: () => !reader.hidden,
    close(options) { if (reader.hidden) return false; closeReader(options); return true; },
    handleEscape() { if (reader.hidden) return false; closeReader(); return true; },
  });
  api?.onAIEvent?.((event) => {
    if (event?.requestId !== requestId || event.type !== 'textDelta' || !pendingTurn) return;
    const follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    const delta = String(event.text || ''); pendingTurn.answer = (pendingTurn.answer + delta).slice(0, 65536);
    pendingTurn.reply.querySelector('.home-chat-message-body').textContent = pendingTurn.answer;
    if (follow) messages.scrollTop = messages.scrollHeight;
  });
  resizeChatInput(); updateSessionHeader(); void refreshChatModel();
  window.addEventListener('notch:ai-settings-changed', refreshChatModel);
  api?.onWorkspaceChanged?.(() => { cancelChat(); closeReader({ focus: false }); history = []; conversationRecords = []; savedSessions = []; currentSessionId = ''; currentSessionTitle = ''; currentSessionCreatedAt = 0; sessionDirty = false; selectedSources = []; closeContextPicker(); closeSessionPanel(); messages.replaceChildren(chatEmpty); chatEmpty.hidden = false; chatInput.value = ''; renderContextChips(); updateSessionHeader(); ++weatherEpoch; });
  function tick() {
    if (!visible()) return;
    refreshLists();
    if (Date.now() - lastWeather > 15 * 60 * 1000) void refreshWeather();
  }
  const timer = setInterval(tick, 2000);
  window.addEventListener('pagehide', () => { clearInterval(timer); cancelChat(); closeReader({ focus: false }); releaseMusicSource(); ++weatherEpoch; }, { once: true });
  changeView('dashboard');
})();
