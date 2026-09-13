'use strict';
const https = require('node:https');

function requestJson(url) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const request = https.get(url, { headers: { Accept: 'application/json' } }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(Error('weather_unavailable')); return; }
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) { request.destroy(Error('response_too_large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(Error('invalid_response')); }
      });
    });
    const timer = setTimeout(() => request.destroy(Error('timeout')), 10000);
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}

function validLocation(location) {
  return location && typeof location.latitude === 'number' && Number.isFinite(location.latitude)
    && Math.abs(location.latitude) <= 90 && typeof location.longitude === 'number'
    && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeForecast(data, now) {
  const current = data?.current;
  const daily = data?.daily;
  const required = [current?.temperature_2m, current?.weather_code, daily?.temperature_2m_max?.[0], daily?.temperature_2m_min?.[0]];
  if (!required.every(finite)) throw Error('invalid_response');
  const hourlyTimes = Array.isArray(data?.hourly?.time) ? data.hourly.time : [];
  const currentTime = String(current.time || '');
  const hours = hourlyTimes.map((time, index) => ({
    time: String(time || '').slice(0, 32),
    temperature: data.hourly?.temperature_2m?.[index],
    code: data.hourly?.weather_code?.[index],
    precipitationProbability: data.hourly?.precipitation_probability?.[index],
    isDay: data.hourly?.is_day?.[index] === 1,
  })).filter((item) => item.time && item.time >= currentTime && [item.temperature, item.code, item.precipitationProbability].every(finite)).slice(0, 12);
  const dailyTimes = Array.isArray(daily.time) ? daily.time : [];
  const days = dailyTimes.map((date, index) => ({
    date: String(date || '').slice(0, 16),
    code: daily.weather_code?.[index],
    high: daily.temperature_2m_max?.[index],
    low: daily.temperature_2m_min?.[index],
    precipitationProbability: daily.precipitation_probability_max?.[index],
    sunrise: String(daily.sunrise?.[index] || '').slice(0, 32),
    sunset: String(daily.sunset?.[index] || '').slice(0, 32),
  })).filter((item) => item.date && [item.code, item.high, item.low, item.precipitationProbability].every(finite)).slice(0, 7);
  return {
    ok: true,
    temperature: current.temperature_2m,
    apparentTemperature: finite(current.apparent_temperature) ? current.apparent_temperature : current.temperature_2m,
    humidity: finite(current.relative_humidity_2m) ? current.relative_humidity_2m : null,
    precipitation: finite(current.precipitation) ? current.precipitation : null,
    windSpeed: finite(current.wind_speed_10m) ? current.wind_speed_10m : null,
    windDirection: finite(current.wind_direction_10m) ? current.wind_direction_10m : null,
    isDay: current.is_day === 1,
    code: current.weather_code,
    high: daily.temperature_2m_max[0],
    low: daily.temperature_2m_min[0],
    sunrise: String(daily.sunrise?.[0] || '').slice(0, 32),
    sunset: String(daily.sunset?.[0] || '').slice(0, 32),
    hours,
    days,
    timezone: String(data.timezone || '').slice(0, 80),
    updatedAt: now(),
  };
}

function createWeatherService({ request = requestJson, now = Date.now } = {}) {
  let cache = null, busy = false;
  async function run(operation) {
    if (busy) return { ok: false, error: 'busy' };
    busy = true;
    try { return await operation(); }
    catch { return { ok: false, error: 'weather_unavailable' }; }
    finally { busy = false; }
  }
  return {
    async search(query) {
      if (typeof query !== 'string' || query.trim().length < 2 || query.length > 80) return { ok: false, error: 'invalid_city' };
      return run(async () => {
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.search = new URLSearchParams({ name: query.trim(), count: '5', language: 'zh', format: 'json' }).toString();
        const data = await request(url);
        return { ok: true, locations: (Array.isArray(data.results) ? data.results : []).filter(validLocation).slice(0, 5).map((item) => ({
          name: String(item.name || '').slice(0, 80), country: String(item.country || '').slice(0, 80), admin1: String(item.admin1 || '').slice(0, 80), latitude: item.latitude, longitude: item.longitude,
        })) };
      });
    },
    async weather(location) {
      if (!validLocation(location)) return { ok: false, error: 'invalid_location' };
      const key = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
      if (cache?.key === key && now() - cache.time < 15 * 60 * 1000) return { ...cache.value, cached: true };
      const result = await run(async () => {
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.search = new URLSearchParams({
          latitude: String(location.latitude), longitude: String(location.longitude),
          current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day',
          hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
          daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
          timezone: 'auto', forecast_days: '7',
        }).toString();
        const data = await request(url);
        const value = normalizeForecast(data, now);
        cache = { key, time: now(), value };
        return value;
      });
      if (!result.ok && cache?.key === key) return { ...cache.value, stale: true };
      return result;
    },
  };
}
module.exports = { createWeatherService, validLocation, normalizeForecast };
