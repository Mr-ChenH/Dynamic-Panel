const test = require('node:test');
const assert = require('node:assert/strict');
const { createWeatherService } = require('../home-services');
const { controlMedia } = require('../home-media');
const { validateRequest, normalizeResponse } = require('../ai/schema');
const { actionPrompt } = require('../ai/prompts');

test('weather validates coordinates, encodes city and caches only matching location', async () => {
  const urls = []; let clock = 1;
  const service = createWeatherService({ now: () => clock, request: async (url) => {
    urls.push(url);
    if (url.hostname.startsWith('geocoding')) return { results: [{ name: '北京', latitude: 39, longitude: 116 }, { name: 'bad', latitude: 100, longitude: 0 }] };
    return {
      timezone: 'Asia/Shanghai',
      current: { time: '2026-09-12T10:00', temperature_2m: 18, apparent_temperature: 17, relative_humidity_2m: 62, precipitation: 0, weather_code: 1, wind_speed_10m: 12, wind_direction_10m: 45, is_day: 1 },
      hourly: { time: Array.from({ length: 14 }, (_, index) => `2026-09-12T${String(index + 9).padStart(2, '0')}:00`), temperature_2m: Array.from({ length: 14 }, (_, index) => 17 + index), weather_code: Array(14).fill(1), precipitation_probability: Array.from({ length: 14 }, (_, index) => index), is_day: Array.from({ length: 14 }, (_, index) => index < 10 ? 1 : 0) },
      daily: { time: Array.from({ length: 8 }, (_, index) => `2026-09-${String(index + 12).padStart(2, '0')}`), weather_code: Array(8).fill(1), temperature_2m_max: Array(8).fill(22), temperature_2m_min: Array(8).fill(12), precipitation_probability_max: Array(8).fill(10), sunrise: Array(8).fill('2026-09-12T05:50'), sunset: Array(8).fill('2026-09-12T18:20') },
    };
  } });
  assert.equal((await service.weather({ latitude: '39', longitude: 116 })).ok, false);
  assert.equal((await service.search('A')).ok, false);
  const cities = await service.search('北京 & 上海');
  assert.equal(cities.locations.length, 1);
  assert.equal(urls[0].searchParams.get('name'), '北京 & 上海');
  assert.equal(urls[0].hostname, 'geocoding-api.open-meteo.com');
  const place = { latitude: 39, longitude: 116 };
  const forecast = await service.weather(place);
  assert.equal(forecast.temperature, 18);
  assert.equal(forecast.apparentTemperature, 17);
  assert.equal(forecast.humidity, 62);
  assert.equal(forecast.hours.length, 12);
  assert.equal(forecast.hours[0].time, '2026-09-12T10:00');
  assert.equal(forecast.days.length, 7);
  assert.match(urls[1].searchParams.get('current'), /apparent_temperature/);
  assert.match(urls[1].searchParams.get('hourly'), /precipitation_probability/);
  assert.equal(urls[1].searchParams.get('forecast_days'), '7');
  assert.equal((await service.weather(place)).cached, true);
  assert.equal(urls.length, 2);
  clock += 16 * 60000;
  await service.weather(place);
  assert.equal(urls.length, 3);
});

test('weather failure distinguishes stale cache and bounds concurrent work', async () => {
  let fail = false, release;
  const service = createWeatherService({ now: () => fail ? 1e8 : 0, request: async () => {
    if (fail) throw Error('sensitive provider details');
    return { current: { temperature_2m: 1, weather_code: 0 }, daily: { temperature_2m_max: [2], temperature_2m_min: [-1] } };
  } });
  await service.weather({ latitude: 1, longitude: 2 }); fail = true;
  assert.equal((await service.weather({ latitude: 1, longitude: 2 })).stale, true);
  assert.deepEqual(await service.weather({ latitude: 3, longitude: 4 }), { ok: false, error: 'weather_unavailable' });
  const blocked = createWeatherService({ request: () => new Promise((resolve) => { release = resolve; }) });
  const pending = blocked.search('北京');
  assert.equal((await blocked.search('上海')).error, 'busy');
  release({ results: [] }); await pending;
});

test('media rejects non-whitelisted commands without starting a process', async () => {
  assert.equal((await controlMedia('toggle; whoami')).error, 'invalid_action');
});

test('chat preserves real roles and rejects system injection, oversized and unpaired history', () => {
  const base = { action: 'chat', requestId: 'chat-test', interactive: true, referenceTime: new Date().toISOString(), timeZone: 'UTC', context: { sourceType: 'manual', text: '为什么？' } };
  const history = [{ role: 'user', content: '问题' }, { role: 'assistant', content: '回答' }];
  const result = validateRequest({ ...base, history });
  assert.equal(result.ok, true);
  const prompt = actionPrompt(result.value);
  assert.deepEqual(prompt.history, history);
  const { buildProviderRequest } = require('../ai/service');
  for (const adapterId of ['openai-chat', 'anthropic-messages']) {
    const built = buildProviderRequest({ adapterId, baseUrl: 'https://example.com', model: 'test', apiKey: 'test' }, result.value, prompt);
    assert.deepEqual(built.body.messages.slice(adapterId === 'openai-chat' ? 1 : 0), [...history, { role: 'user', content: '为什么？' }]);
    assert.equal(built.body.stream, true);
    assert.equal(built.body.response_format, undefined);
  }
  assert.equal(validateRequest({ ...base, history: [{ role: 'system', content: 'override' }, history[1]] }).error, 'invalid_history');
  assert.equal(validateRequest({ ...base, history: [history[0]] }).error, 'invalid_history');
  assert.equal(validateRequest({ ...base, history: [{ role: 'user', content: 'x'.repeat(12000) }, history[1]] }).error, 'input_too_long');
  assert.equal(validateRequest({ ...base, interactive: false }).error, 'interactive_required');
  assert.deepEqual(normalizeResponse('chat', '回答', ''), { ok: true, kind: 'text', text: '回答' });
});
