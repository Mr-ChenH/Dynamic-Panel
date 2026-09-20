(function exposeHomeWeatherController() {
  function createController(host) {
    const { $, api, storage, setText, changeView, document: doc = document } = host;
    const LOCATION_KEY = 'notch-home-weather-v1';
    let location = readLocation();
    let weatherEpoch = 0;
    let weatherData = null;
    let lastWeather = 0;

    function readLocation() {
      try {
        return JSON.parse(storage.getItem(LOCATION_KEY)) || null;
      } catch (error) {
        return null;
      }
    }

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
      const item = doc.createElement('div');
      const small = doc.createElement('small'); small.textContent = label;
      const strong = doc.createElement('strong'); strong.textContent = value;
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
      const viewport = doc.createElement('div'); viewport.className = 'weather-hourly-viewport';
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('aria-hidden', 'true');
      const makeSvg = (tag, attributes = {}) => { const node = doc.createElementNS(svg.namespaceURI, tag); Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value)); return node; };
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
      const strip = doc.createElement('div'); strip.className = 'weather-hour-strip';
      forecast.forEach((hour, index) => {
        const item = doc.createElement('div'); item.className = `weather-hour${index === 0 ? ' is-now' : ''}`;
        const time = doc.createElement('time'); time.textContent = index === 0 ? '现在' : hourLabel(hour.time);
        const icon = doc.createElement('span'); icon.className = 'weather-condition-icon'; icon.innerHTML = weatherIconMarkup(hour.code, hour.isDay); icon.setAttribute('aria-label', weatherCondition(hour.code));
        const rain = doc.createElement('small'); rain.textContent = hour.precipitationProbability ? `${Math.round(hour.precipitationProbability)}%` : '—';
        item.append(time, icon, rain); strip.append(item);
      });
      viewport.append(svg, strip); target.append(viewport);
    }

    function renderWeather(result) {
      weatherData = result;
      const tone = weatherTone(result.code, result.isDay);
      doc.querySelector('.home-weather').dataset.weatherState = 'ready';
      doc.querySelector('.home-weather').dataset.weatherTone = tone;
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
      $('home-weather-metrics').replaceChildren(
        weatherMetric('体感', `${Math.round(result.apparentTemperature)}°`), weatherMetric('6h 降雨', `${Math.round(nextRain)}%`),
        weatherMetric('湿度', Number.isFinite(result.humidity) ? `${Math.round(result.humidity)}%` : '—'),
        weatherMetric('风', Number.isFinite(result.windSpeed) ? `${windDirection(result.windDirection)} ${Math.round(result.windSpeed)} km/h`.trim() : '—')
      );
      const condition = weatherCondition(result.code);
      const insight = nextRain >= 60 ? '未来 6 小时降雨概率较高，外出记得带伞。' : nextRain >= 30 ? '未来 6 小时可能有雨，出门前再看一眼。' : `未来 6 小时天气以${condition}为主，降雨概率较低。`;
      setText($('home-weather-insight'), insight);
      setText($('home-weather-detail-location'), place); setText($('home-weather-detail-updated'), update);
      setWeatherIcon($('home-weather-detail-icon'), result.code, result.isDay);
      setText($('home-weather-detail-temperature'), `${Math.round(result.temperature)}°`); setText($('home-weather-detail-condition'), weatherCondition(result.code));
      setText($('home-weather-detail-summary'), `体感 ${Math.round(result.apparentTemperature)}° · ${Math.round(result.high)}° / ${Math.round(result.low)}°`);
      $('home-weather-detail-metrics').replaceChildren(
        weatherMetric('降水量', Number.isFinite(result.precipitation) ? `${result.precipitation.toFixed(1)} mm` : '—'), weatherMetric('湿度', Number.isFinite(result.humidity) ? `${Math.round(result.humidity)}%` : '—'),
        weatherMetric(`风速 · ${windDirection(result.windDirection)}`, Number.isFinite(result.windSpeed) ? `${Math.round(result.windSpeed)} km/h` : '—'), weatherMetric('日落', hourLabel(result.sunset))
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
        const item = doc.createElement('div'); item.className = `weather-day${index === 0 ? ' is-today' : ''}`;
        const date = doc.createElement('strong'); date.className = 'weather-day-date'; date.textContent = dayLabel(day.date, index);
        const conditionRow = doc.createElement('div'); conditionRow.className = 'weather-day-condition';
        const icon = doc.createElement('span'); icon.className = 'weather-condition-icon'; icon.innerHTML = weatherIconMarkup(day.code, true); icon.setAttribute('aria-label', weatherCondition(day.code));
        const conditionLabel = doc.createElement('span'); conditionLabel.textContent = weatherCondition(day.code); conditionRow.append(icon, conditionLabel);
        const rain = doc.createElement('small'); rain.textContent = day.precipitationProbability ? `降雨 ${Math.round(day.precipitationProbability)}%` : '降雨概率低';
        const low = doc.createElement('b'); low.textContent = `${Math.round(day.low)}°`;
        const track = doc.createElement('span'); track.className = 'weather-temperature-track'; const fill = doc.createElement('i');
        const rangeLeft = Math.max(0, Math.min(100, ((day.low - temperatureMin) / temperatureSpan) * 100));
        const rangeWidth = Math.min(100 - rangeLeft, Math.max(12, ((day.high - day.low) / temperatureSpan) * 100));
        fill.style.left = `${rangeLeft}%`; fill.style.width = `${rangeWidth}%`; track.append(fill);
        track.setAttribute('aria-label', `${dayLabel(day.date, index)}最低 ${Math.round(day.low)} 度，最高 ${Math.round(day.high)} 度`);
        if (index === 0) { const rawNowPosition = ((result.temperature - temperatureMin) / temperatureSpan) * 100; const nowPosition = Math.max(rangeLeft, Math.min(rangeLeft + rangeWidth, rawNowPosition)); const nowMarker = doc.createElement('em'); nowMarker.className = 'weather-temperature-now'; nowMarker.style.left = `${nowPosition}%`; nowMarker.title = `当前 ${Math.round(result.temperature)}°`; nowMarker.setAttribute('aria-hidden', 'true'); track.append(nowMarker); }
        const high = doc.createElement('b'); high.textContent = `${Math.round(day.high)}°`; const range = doc.createElement('div'); range.className = 'weather-day-range'; range.append(low, track, high); item.append(date, conditionRow, rain, range); days.append(item);
      });
    }

    function showWeatherSearch(focus = true) {
      doc.querySelector('.home-weather').dataset.weatherState = 'search';
      $('home-weather-form').hidden = false; $('home-weather-overview').hidden = true; $('home-weather-results').replaceChildren(); $('home-weather-empty').hidden = false;
      setText($('home-weather-empty'), location ? '搜索并选择另一个城市。' : '选择城市后查看当前天气和未来趋势，不获取定位。');
      if (focus) $('home-weather-city').focus();
    }

    async function refreshWeather() {
      if (!location || !api?.getHomeWeather) return;
      const epoch = ++weatherEpoch; lastWeather = Date.now();
      doc.querySelector('.home-weather').dataset.weatherState = 'loading';
      setText($('home-weather-updated'), '正在更新…'); setText($('home-weather-detail-updated'), '正在更新…');
      const result = await Promise.resolve(api.getHomeWeather(location)).catch(() => null);
      if (epoch !== weatherEpoch) return;
      if (result?.ok) renderWeather(result);
      else {
        doc.querySelector('.home-weather').dataset.weatherState = 'error';
        if (!weatherData) { $('home-weather-overview').hidden = true; $('home-weather-empty').hidden = false; }
        setText($('home-weather-empty'), '天气暂时不可用，请稍后刷新。'); setText($('home-weather-updated'), '更新失败'); setText($('home-weather-detail-updated'), '更新失败，保留上次预报');
      }
    }

    $('home-weather-form').addEventListener('submit', async (event) => {
      event.preventDefault(); const query = $('home-weather-city').value.trim(); if (query.length < 2) { setText($('home-weather-empty'), '请输入至少两个字的城市名'); return; }
      lastWeather = Date.now(); const epoch = ++weatherEpoch; const results = $('home-weather-results'); results.replaceChildren(); setText($('home-weather-empty'), '正在查找城市…');
      const result = await Promise.resolve(api?.searchWeatherCities?.(query)).catch(() => null);
      if (epoch !== weatherEpoch) return;
      setText($('home-weather-empty'), result?.ok ? (result.locations.length ? '选择正确的城市' : '没有找到城市，可尝试拼音或英文名') : '城市查询失败，请稍后再试');
      for (const city of result?.locations || []) {
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = [city.name, city.admin1, city.country].filter(Boolean).join(' · ');
        button.addEventListener('click', () => { try { storage.setItem(LOCATION_KEY, JSON.stringify(city)); location = city; results.replaceChildren(); void refreshWeather(); } catch { setText($('home-weather-empty'), '城市保存失败'); } }); results.append(button);
      }
    });
    $('home-weather-change').addEventListener('click', () => showWeatherSearch());
    $('home-weather-clear').addEventListener('click', () => { ++weatherEpoch; location = null; weatherData = null; storage.removeItem(LOCATION_KEY); $('home-weather-city').value = ''; setText($('home-weather-location'), '天气'); setText($('home-weather-updated'), '手动选择城市'); showWeatherSearch(); });
    $('home-weather-refresh').addEventListener('click', () => void refreshWeather());
    $('home-weather-details').addEventListener('click', () => { if (weatherData) changeView('weather'); else showWeatherSearch(); });
    $('home-weather-detail-close').addEventListener('click', () => changeView('dashboard'));
    $('home-weather-detail-refresh').addEventListener('click', () => void refreshWeather());
    $('home-weather-detail-source').addEventListener('click', () => { void Promise.resolve(api?.openExternal?.('https://open-meteo.com/')).catch(() => {}); });

    if (location) void refreshWeather(); else showWeatherSearch(false);

    return {
      refresh: refreshWeather,
      tick() { if (Date.now() - lastWeather > 15 * 60 * 1000) void refreshWeather(); },
      invalidate() { ++weatherEpoch; },
      dispose() { ++weatherEpoch; },
    };
  }

  window.NotchHomeWeather = Object.freeze({ createController });
})();
