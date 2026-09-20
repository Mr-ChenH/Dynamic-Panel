'use strict';

const INTERNAL_OPERATION_SIGNAL = Symbol('finance-operation-signal');

function createFinanceRequestCache({ now = () => Date.now(), financeError, cancelledError, maxCacheEntries = 64 } = {}) {
  if (typeof financeError !== 'function' || typeof cancelledError !== 'function') {
    throw new TypeError('financeError and cancelledError are required');
  }
  const cache = new Map();
  const pending = new Map();
  const rateLimitedUntil = new Map();
  const operations = new Map();

  function clear(options = {}) {
    const includeQuotaProtected = options?.includeQuotaProtected === true;
    for (const key of cache.keys()) {
      if (includeQuotaProtected || !key.startsWith('quota:')) cache.delete(key);
    }
    for (const key of rateLimitedUntil.keys()) {
      if (includeQuotaProtected || !key.startsWith('quota:')) rateLimitedUntil.delete(key);
    }
  }

  function withOperation(payload, work) {
    const inheritedSignal = payload?.[INTERNAL_OPERATION_SIGNAL];
    if (inheritedSignal) return Promise.resolve().then(() => work(inheritedSignal));
    const requestId = String(payload?.requestId || '').trim().slice(0, 160);
    if (!requestId) return Promise.resolve().then(() => work(null));
    const controller = new AbortController();
    const controllers = operations.get(requestId) || new Set();
    controllers.add(controller);
    operations.set(requestId, controllers);
    return Promise.resolve()
      .then(() => work(controller.signal))
      .finally(() => {
        controllers.delete(controller);
        if (!controllers.size) operations.delete(requestId);
      });
  }

  function cancel(requestId) {
    const id = String(requestId || '').trim().slice(0, 160);
    const controllers = operations.get(id);
    if (!controllers) return { ok: true, cancelled: false };
    controllers.forEach((controller) => controller.abort());
    return { ok: true, cancelled: true };
  }

  function waitForPending(entry, signal) {
    entry.consumers += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        entry.consumers = Math.max(0, entry.consumers - 1);
        if (!entry.settled && entry.consumers === 0) entry.controller.abort();
      };
      const onAbort = () => {
        if (settled) return;
        release();
        reject(cancelledError());
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.promise.then((value) => {
        if (signal?.aborted) reject(cancelledError());
        else resolve(value);
      }, reject).finally(release);
    });
  }

  async function cached(key, ttlMs, loader, signal = null, force = false) {
    const currentTime = now();
    const existing = cache.get(key);
    if (!force && existing && currentTime - existing.storedAt <= ttlMs) {
      return { value: existing.value, stale: false, storedAt: existing.storedAt };
    }
    if (rateLimitedUntil.get(key) > currentTime) {
      if (existing && currentTime - existing.storedAt <= 30 * 60 * 1000) {
        return { value: existing.value, stale: true, error: 'rate_limited', storedAt: existing.storedAt };
      }
      throw Object.assign(new Error('http_429'), { code: 'http_429' });
    }
    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const promise = (async () => {
        try {
          const value = await loader(controller.signal);
          const storedAt = now();
          cache.set(key, { value, storedAt });
          while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
          return { value, stale: false, storedAt };
        } catch (error) {
          const errorCode = financeError(error);
          if (errorCode === 'cancelled') throw error;
          if (errorCode === 'rate_limited') {
            const retryAfterMs = Math.max(30_000, Math.min(5 * 60_000, Number(error?.retryAfterMs) || 0));
            rateLimitedUntil.set(key, now() + retryAfterMs);
          }
          if (existing && currentTime - existing.storedAt <= 30 * 60 * 1000) {
            return { value: existing.value, stale: true, error: errorCode, storedAt: existing.storedAt };
          }
          throw error;
        } finally {
          entry.settled = true;
          if (pending.get(key) === entry) pending.delete(key);
        }
      })();
      entry = { controller, promise, consumers: 0, settled: false };
      pending.set(key, entry);
    }
    return waitForPending(entry, signal);
  }

  return { clear, cached, cancel, withOperation, operationSignal: INTERNAL_OPERATION_SIGNAL };
}

module.exports = { createFinanceRequestCache, INTERNAL_OPERATION_SIGNAL };
