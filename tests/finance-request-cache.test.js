'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinanceRequestCache } = require('../main/finance-request-cache');

function createHarness({ now = () => 1_000 } = {}) {
  return createFinanceRequestCache({
    now,
    maxCacheEntries: 4,
    financeError: (error) => error?.code === 'http_429' ? 'rate_limited' : error?.code === 'cancelled' ? 'cancelled' : 'network_error',
    cancelledError: () => Object.assign(new Error('cancelled'), { code: 'cancelled' }),
  });
}

test('finance request cache coalesces concurrent provider loads', async () => {
  const cache = createHarness();
  let loads = 0;
  let resolveLoad;
  const loader = () => {
    loads += 1;
    return new Promise((resolve) => { resolveLoad = resolve; });
  };
  const first = cache.cached('provider:key', 30_000, loader);
  const second = cache.cached('provider:key', 30_000, loader);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
  resolveLoad({ value: 42 });
  assert.deepEqual(await first, { value: { value: 42 }, stale: false, storedAt: 1_000 });
  assert.deepEqual(await second, { value: { value: 42 }, stale: false, storedAt: 1_000 });
});

test('finance request cache keeps recent data as an explicit stale fallback', async () => {
  let currentTime = 1_000;
  const cache = createHarness({ now: () => currentTime });
  await cache.cached('provider:key', 100, async () => 'fresh');
  currentTime = 1_500;
  const result = await cache.cached('provider:key', 100, async () => {
    throw Object.assign(new Error('offline'), { code: 'network_error' });
  }, null, true);
  assert.deepEqual(result, { value: 'fresh', stale: true, error: 'network_error', storedAt: 1_000 });
});

test('finance request cancellation aborts every operation with the same request id', async () => {
  const cache = createHarness();
  const signals = [];
  const start = () => cache.withOperation({ requestId: 'request-1' }, (signal) => new Promise((resolve) => {
    signals.push(signal);
    signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  }));
  const first = start();
  const second = start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cache.cancel('request-1'), { ok: true, cancelled: true });
  assert.deepEqual(await Promise.all([first, second]), ['aborted', 'aborted']);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.deepEqual(cache.cancel('request-1'), { ok: true, cancelled: false });
});

test('finance request cache observes a loader rejection when the consumer is already cancelled', async () => {
  const cache = createHarness();
  const controller = new AbortController();
  controller.abort();
  const pending = cache.cached('provider:cancelled', 30_000, (signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })), { once: true });
  }), controller.signal);
  await assert.rejects(pending, (error) => error?.code === 'cancelled');
  await new Promise((resolve) => setImmediate(resolve));
});

test('nested finance operations reuse the inherited abort signal', async () => {
  const cache = createHarness();
  let outerSignal;
  const result = await cache.withOperation({ requestId: 'outer' }, async (signal) => {
    outerSignal = signal;
    return cache.withOperation({ [cache.operationSignal]: signal }, (nestedSignal) => nestedSignal === signal);
  });
  assert.equal(result, true);
  assert.equal(outerSignal.aborted, false);
});
