(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const root = $('home-dashboard');
  if (!root) return;
  const api = window.notchAPI;
  const LOCATION_KEY = 'notch-home-weather-v1';
  const DRAFT_KEY = 'notch-home-capture-v1';
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  let signature = '', location = read(LOCATION_KEY, null), weatherEpoch = 0, weatherData = null;
  let lastWeather = 0;
  let musicLibrary = { mode: 'local', tracks: [] }, activeMusicId = localStorage.getItem('notch-home-music-track-v1') || '';
  let loadedMusicId = '', musicObjectUrl = '', musicLoadEpoch = 0, musicLoading = false, musicImporting = false, musicModeBusy = false;
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
  function empty(target, text) { const p = document.createElement('p'); p.className = 'home-hint'; p.textContent = text; target.append(p); }
  function refreshLists() {
    const notes = window.NotchNotes?.list?.() || [];
    const todos = read('notch-todo-data', {}), names = read('notch-todo-category-names-v1', {}), categories = read('notch-note-categories-v1', []);
    const next = JSON.stringify([notes, todos, names, categories, new Date().toDateString()]);
    if (next === signature) return;
    signature = next;
    const recent = $('home-recent-list'); recent.replaceChildren();
    notes.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).forEach((note) => {
      const category = Array.isArray(categories) ? categories.find((item) => item.id === note.categoryId)?.name : '';
      recent.append(row(note.title || note.content?.split('\n')[0] || '未命名笔记', `${category || '未分类'} · ${new Date(note.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, () => navigate({ tab: 'notes', id: note.id })));
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
  $('music-volume').addEventListener('input', (event) => {
    const volume = Math.max(0, Math.min(100, Number(event.target.value) || 0));
    musicAudio.volume = volume / 100; localStorage.setItem('notch-home-music-volume-v1', String(volume)); setText($('music-volume-value'), `${Math.round(volume)}%`);
  });
  function musicTime(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }
  function musicQueue(kind = musicLibrary.mode) { return musicLibrary.tracks.filter((track) => track.kind === kind); }
  function activeMusicTrack() {
    const loaded = musicLibrary.tracks.find((track) => track.id === loadedMusicId);
    if (loaded) return loaded;
    const queue = musicQueue();
    return queue.find((track) => track.id === activeMusicId) || queue[0] || null;
  }
  function rememberActiveMusic(track) {
    activeMusicId = track?.id || '';
    if (activeMusicId) localStorage.setItem('notch-home-music-track-v1', activeMusicId);
    else localStorage.removeItem('notch-home-music-track-v1');
  }
  function releaseMusicSource() {
    ++musicLoadEpoch; musicLoading = false; musicAudio.pause(); musicAudio.removeAttribute('src'); musicAudio.load(); loadedMusicId = '';
    if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl); musicObjectUrl = '';
  }
  function renderMusicProgress() {
    const duration = Number.isFinite(musicAudio.duration) ? musicAudio.duration : 0;
    const position = Number.isFinite(musicAudio.currentTime) ? musicAudio.currentTime : 0;
    const percentage = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
    $('home-media-progress').hidden = !duration;
    $('home-media-progress-track').firstElementChild.style.width = `${percentage}%`;
    $('home-media-progress-track').setAttribute('aria-valuenow', String(Math.round(percentage)));
    $('home-media-progress-track').setAttribute('aria-valuetext', `${musicTime(position)} / ${musicTime(duration)}`);
    setText($('home-media-position'), musicTime(position)); setText($('home-media-duration'), musicTime(duration));
  }
  function renderMusicCard() {
    const card = document.querySelector('.home-media');
    let track = activeMusicTrack();
    const source = track?.kind || musicLibrary.mode, queue = musicQueue(source);
    if (track && track.id !== activeMusicId) rememberActiveMusic(track);
    const queueIndex = track ? queue.findIndex((item) => item.id === track.id) : -1;
    const playing = Boolean(track && loadedMusicId === track.id && !musicAudio.paused && !musicAudio.ended);
    card.dataset.mediaState = musicLoading ? 'loading' : track ? 'ready' : 'empty'; card.dataset.mediaPlaying = String(playing); card.dataset.mediaSource = source;
    setText($('home-media-source-label'), source === 'local' ? '本地音乐' : '网络音乐');
    setText($('home-media-queue'), queueIndex >= 0 ? `${queueIndex + 1} / ${queue.length}` : `${queue.length} 首`);
    const title = track?.title || '还没有音乐'; setText($('home-media-title'), title); $('home-media-title').title = title;
    setText($('home-media-artist'), track ? (track.kind === 'local' ? '本地音频' : '网络音频') : '在设置中添加本地或网络音频');
    const detail = track?.detail || ''; setText($('home-media-album'), detail); $('home-media-album').hidden = !detail;
    const toggle = document.querySelector('[data-home-media="toggle"]');
    const toggleLabel = playing ? '暂停' : '播放'; toggle.setAttribute('aria-label', toggleLabel); toggle.title = toggleLabel;
    toggle.disabled = !track || musicLoading;
    document.querySelector('[data-home-media="previous"]').disabled = queue.length < 2 || musicLoading;
    document.querySelector('[data-home-media="next"]').disabled = queue.length < 2 || musicLoading;
    $('home-music-configure').hidden = Boolean(track);
    if (musicLoading) setText($('home-media-status'), track?.kind === 'network' ? '正在获取网络音频…' : '正在读取本地音频…');
    else if (!track) setText($('home-media-status'), '等待选择音乐源');
    else setText($('home-media-status'), playing ? '播放中' : loadedMusicId === track.id ? (musicAudio.ended ? '播放完毕' : '已暂停') : '准备播放');
    renderMusicProgress();
  }
  function renderMusicSettings() {
    document.querySelectorAll('[data-music-source]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.musicSource === musicLibrary.mode)));
    document.querySelectorAll('[data-music-source-panel]').forEach((panel) => { panel.hidden = panel.dataset.musicSourcePanel !== musicLibrary.mode; });
    const queue = musicQueue(); setText($('music-library-title'), musicLibrary.mode === 'local' ? '本地音乐' : '网络音乐'); setText($('music-library-count'), `${queue.length} 首`);
    const list = $('music-library-list'); list.replaceChildren();
    if (!queue.length) { const empty = document.createElement('p'); empty.className = 'music-library-empty'; empty.textContent = musicLibrary.mode === 'local' ? '尚未添加本地音频' : '尚未添加网络音频'; list.append(empty); return; }
    queue.forEach((track) => {
      const row = document.createElement('div'); row.className = 'music-library-row'; row.dataset.trackId = track.id;
      const select = document.createElement('button'); select.type = 'button'; select.className = 'music-library-select'; select.title = `播放 ${track.title}`;
      const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = track.title; const detail = document.createElement('small'); detail.textContent = track.detail; copy.append(title, detail);
      select.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>'; select.append(copy);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'music-library-remove'; remove.dataset.removeMusicTrack = track.id; remove.setAttribute('aria-label', `删除 ${track.title}`); remove.title = '从音乐库删除'; remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
      select.addEventListener('click', () => void loadMusicTrack(track, true)); row.append(select, remove); list.append(row);
    });
  }
  function applyMusicLibrary(result) {
    if (!result?.ok) return false;
    musicLibrary = { mode: result.mode === 'network' ? 'network' : 'local', tracks: Array.isArray(result.tracks) ? result.tracks : [] };
    if (loadedMusicId && !musicLibrary.tracks.some((track) => track.id === loadedMusicId)) releaseMusicSource();
    const track = activeMusicTrack(); rememberActiveMusic(track); renderMusicCard(); renderMusicSettings(); return true;
  }
  async function refreshMusicLibrary() {
    const result = await api?.getHomeMusicLibrary?.().catch(() => null);
    if (!applyMusicLibrary(result)) setText($('home-media-status'), '音乐库读取失败');
  }
  async function loadMusicTrack(track, autoplay) {
    if (!track || musicLoading) return;
    rememberActiveMusic(track); const epoch = ++musicLoadEpoch; musicLoading = true; renderMusicCard();
    const result = await api?.loadHomeMusicTrack?.(track.id).catch(() => null);
    if (epoch !== musicLoadEpoch) return;
    if (!result?.ok) { musicLoading = false; renderMusicCard(); setText($('home-media-status'), result?.error === 'audio_too_large' ? '音频超过 128 MB 限制' : result?.error === 'unsupported_audio' ? '服务器返回的不是音频文件' : '音频读取失败'); return; }
    const raw = result.bytes?.data || result.bytes; const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw || []);
    if (!bytes.length) { musicLoading = false; renderMusicCard(); setText($('home-media-status'), '音频内容为空'); return; }
    releaseMusicSource(); const sourceEpoch = ++musicLoadEpoch; musicLoading = true;
    musicObjectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || track.mimeType || 'application/octet-stream' }));
    loadedMusicId = track.id; musicAudio.src = musicObjectUrl; musicAudio.load(); musicLoading = false; renderMusicCard();
    if (autoplay && sourceEpoch === musicLoadEpoch) {
      try { await musicAudio.play(); } catch { setText($('home-media-status'), '无法播放该音频格式'); }
      renderMusicCard();
    }
  }
  function moveMusic(direction, autoplay = !musicAudio.paused) {
    const track = activeMusicTrack(); if (!track) return;
    const queue = musicQueue(track.kind); if (queue.length < 2) return;
    const index = queue.findIndex((item) => item.id === track.id); const next = queue[(index + direction + queue.length) % queue.length];
    if (autoplay) void loadMusicTrack(next, true); else { releaseMusicSource(); rememberActiveMusic(next); renderMusicCard(); }
  }
  async function openMusicSettings() { await navigate({ tab: 'settings' }); window.NotchSettings?.select('music'); }
  $('home-media-refresh').addEventListener('click', refreshMusicLibrary);
  $('home-media-library').addEventListener('click', openMusicSettings);
  $('home-music-configure').addEventListener('click', openMusicSettings);
  document.querySelector('[data-home-media="toggle"]').addEventListener('click', async () => {
    const track = activeMusicTrack(); if (!track || musicLoading) return;
    if (loadedMusicId !== track.id || !musicAudio.src) { await loadMusicTrack(track, true); return; }
    if (musicAudio.paused) { try { await musicAudio.play(); } catch { setText($('home-media-status'), '无法继续播放'); } } else musicAudio.pause(); renderMusicCard();
  });
  document.querySelector('[data-home-media="previous"]').addEventListener('click', () => moveMusic(-1));
  document.querySelector('[data-home-media="next"]').addEventListener('click', () => moveMusic(1));
  musicAudio.addEventListener('play', renderMusicCard); musicAudio.addEventListener('pause', renderMusicCard);
  musicAudio.addEventListener('loadedmetadata', () => { renderMusicProgress(); renderMusicCard(); }); musicAudio.addEventListener('timeupdate', renderMusicProgress);
  musicAudio.addEventListener('ended', () => { const track = activeMusicTrack(); if (track && musicQueue(track.kind).length > 1) moveMusic(1, true); else renderMusicCard(); });
  musicAudio.addEventListener('error', () => { if (musicAudio.src) { renderMusicCard(); setText($('home-media-status'), '无法解码该音频格式'); } });
  document.querySelectorAll('[data-music-source]').forEach((button) => button.addEventListener('click', async () => {
    const mode = button.dataset.musicSource;
    if (musicModeBusy || mode === musicLibrary.mode) return;
    musicModeBusy = true; const sourceButtons = [...document.querySelectorAll('[data-music-source]')]; sourceButtons.forEach((item) => { item.disabled = true; });
    const result = await api?.setHomeMusicMode?.(mode).catch(() => null);
    musicModeBusy = false; sourceButtons.forEach((item) => { item.disabled = false; });
    if (!applyMusicLibrary(result)) setText($('music-settings-status'), '音乐来源切换失败');
    else setText($('music-settings-status'), `已切换到${mode === 'local' ? '本地音乐' : '网络音乐'}，当前播放保持不变`);
  }));
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
  $('music-library-list').addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove-music-track]'); if (!remove) return;
    const removingCurrent = remove.dataset.removeMusicTrack === activeMusicId;
    const result = await api?.removeHomeMusicTrack?.(remove.dataset.removeMusicTrack).catch(() => null);
    if (result?.ok && removingCurrent) releaseMusicSource();
    if (!applyMusicLibrary(result)) setText($('music-settings-status'), '音乐删除失败'); else setText($('music-settings-status'), '已从音乐库移除');
  });
  void refreshMusicLibrary();
  let history = [], requestId = '', sequence = 0, pendingTurn = null;
  const messages = $('home-chat-messages'), chatInput = $('home-chat-input'), chatEmpty = $('home-chat-empty'), chatForm = $('home-chat-form');
  const chatIcons = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66L20 8"/><path d="M20 3v5h-5"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h8V5M8 20v-6h8v6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 7-5 5 5 5"/><path d="M20 17a7 7 0 0 0-7-7H4"/></svg>',
  };
  const chatErrors = {
    not_configured: '尚未配置内容模型，请先完成 AI 设置。', service_busy: 'AI 正在处理其他请求，请稍后重试。', authentication_failed: '模型凭据验证失败，请检查设置。',
    cancelled: '请求已停止。', context_changed: 'AI 配置已变更，请重新生成。', timeout: '模型响应超时，请重试。', rate_limited: '请求过于频繁，请稍后重试。',
    model_not_found: '当前模型不可用，请检查模型名称。', invalid_endpoint: '服务地址不安全或不可用。', network_error: '无法连接内容模型。',
    invalid_response: '服务返回了无法使用的内容。', response_too_large: '回复超过大小限制，未保留为成功结果。', stream_incomplete: '连接提前中断，回复不完整。',
    invalid_stream: '服务返回的数据流损坏。', output_truncated: '回复达到模型输出上限，内容不完整。', content_filtered: '回复被服务过滤。', unsupported_finish_reason: '模型未正常结束生成。',
  };
  function chatControls(busy) {
    chatForm.dataset.busy = String(busy); $('home-chat-send').hidden = busy; $('home-chat-stop').hidden = !busy;
  }
  function resizeChatInput() {
    chatInput.style.height = 'auto'; chatInput.style.height = `${Math.min(132, Math.max(40, chatInput.scrollHeight))}px`;
    setText($('home-chat-count'), `${chatInput.value.length} / 12000`);
  }
  function actionButton(icon, label, handler) {
    const button = document.createElement('button'); button.type = 'button'; button.innerHTML = chatIcons[icon]; button.setAttribute('aria-label', label); button.title = label; button.addEventListener('click', handler); return button;
  }
  function renderChatText(container, text) {
    if (window.NotchMarkdown?.render) window.NotchMarkdown.render(container, text); else container.textContent = text;
  }
  function message(role, text, state = 'complete') {
    chatEmpty.hidden = true;
    const article = document.createElement('article'); article.className = 'home-chat-message'; article.dataset.role = role; article.dataset.state = state;
    const body = document.createElement('div'); body.className = 'home-chat-message-body';
    if (role === 'assistant') {
      const head = document.createElement('div'); head.className = 'home-chat-message-head';
      const mark = document.createElement('i'); mark.textContent = 'AI'; const label = document.createElement('span'); label.textContent = state === 'streaming' ? '正在回复' : 'AI 助手'; head.append(mark, label);
      renderChatText(body, text); article.append(head, body);
    } else { body.textContent = text; article.append(body); }
    messages.append(article); return article;
  }
  function setTurnState(turn, state, detail) {
    turn.reply.dataset.state = state;
    const label = turn.reply.querySelector('.home-chat-message-head span'); if (label) label.textContent = state === 'streaming' ? '正在回复' : state === 'complete' ? (turn.isVersion ? 'AI 助手 · 新版本' : 'AI 助手') : state === 'stopped' ? '已停止' : '生成失败';
    turn.reply.querySelector('.home-chat-message-state')?.remove();
    if (detail) { const note = document.createElement('p'); note.className = 'home-chat-message-state'; note.textContent = detail; turn.reply.append(note); }
  }
  function noteTitle(answer) {
    return String(answer || '').split('\n').map((line) => line.replace(/^#{1,6}\s+/, '').replace(/[*_`]/g, '').trim()).find(Boolean)?.slice(0, 80) || 'AI 对话回复';
  }
  function addTurnActions(turn, complete) {
    turn.reply.querySelector('.home-chat-message-actions')?.remove();
    const actions = document.createElement('div'); actions.className = 'home-chat-message-actions';
    if (turn.answer) actions.append(actionButton('copy', '复制回复', async () => {
      try { await api?.writeClipboard?.({ text: turn.answer }); setText($('home-chat-status'), '回复已复制'); } catch { setText($('home-chat-status'), '复制失败'); }
    }));
    actions.append(actionButton('retry', complete ? '重新生成' : '重试', () => void submitChat(turn.prompt, { user: turn.user, context: turn.context, versionOf: turn })));
    if (complete) {
      const save = actionButton('save', '保存为笔记', async () => {
        save.disabled = true;
        if (turn.savedNote) {
          const undone = await window.NotchNotes?.undoGenerated?.(turn.savedNote).catch(() => null);
          if (undone?.ok) { turn.savedNote = null; save.dataset.saved = 'false'; save.innerHTML = chatIcons.save; save.setAttribute('aria-label', '保存为笔记'); save.title = '保存为笔记'; setText($('home-chat-status'), '已撤销保存'); }
          else setText($('home-chat-status'), '笔记已变化，无法撤销');
        } else {
          const result = await window.NotchNotes?.saveGenerated?.(noteTitle(turn.answer), turn.answer, 'model').catch(() => null);
          if (result?.ok) { turn.savedNote = result.note; save.dataset.saved = 'true'; save.innerHTML = chatIcons.undo; save.setAttribute('aria-label', '撤销保存'); save.title = '撤销保存'; setText($('home-chat-status'), result.workspaceSynced === false ? '已保存到本机，工作区同步失败' : '已保存为笔记'); }
          else setText($('home-chat-status'), result?.error === 'capacity' ? '笔记库已达到 200 篇上限' : '保存笔记失败');
        }
        save.disabled = false;
      });
      actions.append(save);
    }
    turn.reply.append(actions);
  }
  function contextFor(text, source = history) {
    const context = source.slice(-12);
    while (context.length && context.reduce((sum, item) => sum + item.content.length, text.length) > 12000) context.splice(0, 2);
    return context;
  }
  function cancelChat() {
    if (!requestId || !pendingTurn) return;
    const id = requestId, turn = pendingTurn; requestId = ''; pendingTurn = null; ++sequence; void api?.cancelAI?.(id).catch(() => {});
    if (!turn.answer) turn.reply.querySelector('.home-chat-message-body').replaceChildren();
    else renderChatText(turn.reply.querySelector('.home-chat-message-body'), turn.answer);
    setTurnState(turn, 'stopped', turn.answer ? '生成已停止，以上内容不计入后续上下文。' : '生成已停止，本轮未计入后续上下文。');
    addTurnActions(turn, false); chatControls(false); setText($('home-chat-status'), '已停止，可重试本轮'); chatInput.focus();
  }
  function resetChat() {
    cancelChat(); history = []; messages.replaceChildren(chatEmpty); chatEmpty.hidden = false; chatInput.value = ''; resizeChatInput(); setText($('home-chat-status'), '已开始新的临时对话'); chatInput.focus();
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
    if (text.length > 12000) { setText($('home-chat-status'), '单次输入最多 12000 字符'); return; }
    const context = contextFor(text, options.context || history);
    const user = options.user || message('user', text);
    const reply = message('assistant', '正在思考…', 'streaming');
    if (options.versionOf) { options.versionOf.reply.dataset.version = 'previous'; const oldLabel = options.versionOf.reply.querySelector('.home-chat-message-head span'); if (oldLabel) oldLabel.textContent = 'AI 助手 · 上一版本'; reply.querySelector('.home-chat-message-head span').textContent = 'AI 助手 · 新版本'; }
    const turn = { prompt: text, context, user, reply, answer: '', savedNote: null, isVersion: Boolean(options.versionOf) };
    pendingTurn = turn; messages.scrollTop = messages.scrollHeight;
    if (!options.user) { chatInput.value = ''; resizeChatInput(); }
    const seq = ++sequence, id = `home-chat-${Date.now()}-${seq}`; requestId = id; chatControls(true);
    setText($('home-chat-status'), context.length < history.length ? `使用最近 ${context.length / 2} 轮上下文生成` : context.length ? `使用最近 ${context.length / 2} 轮上下文生成` : '正在生成，可随时停止');
    const result = await api?.runAI?.({ requestId: id, action: 'chat', interactive: true, context: { sourceType: 'manual', text }, history: context, referenceTime: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }).catch(() => null);
    if (seq !== sequence || id !== requestId) return;
    requestId = ''; pendingTurn = null; chatControls(false);
    if (!result?.ok) {
      if (turn.answer) renderChatText(reply.querySelector('.home-chat-message-body'), turn.answer); else reply.querySelector('.home-chat-message-body').replaceChildren();
      const detail = chatErrors[result?.error] || '生成失败，请重试。'; setTurnState(turn, 'error', detail); addTurnActions(turn, false); setText($('home-chat-status'), '本轮未计入上下文，可重试'); chatInput.focus(); return;
    }
    turn.answer = String(result.text || ''); renderChatText(reply.querySelector('.home-chat-message-body'), turn.answer); setTurnState(turn, 'complete', ''); addTurnActions(turn, true);
    history = [...context, { role: 'user', content: text }, { role: 'assistant', content: turn.answer }].slice(-12);
    while (messages.querySelectorAll('.home-chat-message').length > 18) messages.querySelector('.home-chat-message')?.remove();
    setText($('home-chat-status'), `回复完成 · 后续将使用最近 ${history.length / 2} 轮`); chatInput.focus();
  }
  $('home-chat-open').addEventListener('click', () => { changeView('chat'); void refreshChatModel(); chatInput.focus(); });
  $('home-chat-close').addEventListener('click', () => { cancelChat(); changeView('dashboard'); $('home-chat-open').focus(); });
  $('home-chat-stop').addEventListener('click', cancelChat); $('home-chat-new').addEventListener('click', resetChat); $('home-chat-model').addEventListener('click', openAISettings);
  document.querySelectorAll('[data-home-chat-prompt]').forEach((button) => button.addEventListener('click', () => { chatInput.value = button.dataset.homeChatPrompt || ''; resizeChatInput(); chatInput.focus(); chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length); }));
  chatForm.addEventListener('submit', (event) => { event.preventDefault(); void submitChat(chatInput.value); });
  chatInput.addEventListener('input', resizeChatInput);
  chatInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); chatForm.requestSubmit(); } });
  messages.addEventListener('click', async (event) => {
    const codeCopy = event.target.closest('[data-markdown-copy]');
    if (codeCopy) { const code = codeCopy.closest('.markdown-code')?.querySelector('code')?.textContent || ''; try { await api?.writeClipboard?.({ text: code }); setText($('home-chat-status'), '代码已复制'); } catch { setText($('home-chat-status'), '复制失败'); } return; }
    const link = event.target.closest('[data-external-url]'); if (link) { event.preventDefault(); await api?.openExternal?.(link.dataset.externalUrl).catch(() => {}); }
  });
  api?.onAIEvent?.((event) => {
    if (event?.requestId !== requestId || event.type !== 'textDelta' || !pendingTurn) return;
    const follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    const delta = String(event.text || ''); pendingTurn.answer = (pendingTurn.answer + delta).slice(0, 65536);
    pendingTurn.reply.querySelector('.home-chat-message-body').textContent = pendingTurn.answer;
    if (follow) messages.scrollTop = messages.scrollHeight;
  });
  resizeChatInput(); void refreshChatModel();
  window.addEventListener('notch:ai-settings-changed', refreshChatModel);
  api?.onWorkspaceChanged?.(() => { cancelChat(); history = []; messages.replaceChildren(chatEmpty); chatEmpty.hidden = false; chatInput.value = ''; resizeChatInput(); ++weatherEpoch; });
  function tick() {
    if (!visible()) return;
    refreshLists();
    if (Date.now() - lastWeather > 15 * 60 * 1000) void refreshWeather();
  }
  const timer = setInterval(tick, 2000);
  window.addEventListener('pagehide', () => { clearInterval(timer); cancelChat(); releaseMusicSource(); ++weatherEpoch; }, { once: true });
  changeView('dashboard');
})();
