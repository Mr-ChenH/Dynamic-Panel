'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadController() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'finance-request-controller.js'), 'utf8'), { window });
  return window.NotchFinanceRequests;
}

test('finance request controller owns ids, generation and dynamic cancellation APIs', async () => {
  const requests = loadController();
  const cancelled = [];
  let api = {
    cancelFinanceRequest: (requestId) => {
      cancelled.push(['first', requestId]);
      return Promise.resolve();
    },
  };
  let clock = 1000;
  const controller = requests.createController({ getApi: () => api, now: () => clock });
  const first = controller.begin();
  clock = 1001;
  const second = controller.begin();
  assert.equal(first, 'finance-rs-1');
  assert.equal(second, 'finance-rt-2');
  assert.equal(controller.activeCount(), 2);
  controller.finish(first);
  assert.equal(controller.activeCount(), 1);

  api = {
    cancelFinanceRequest: (requestId) => {
      cancelled.push(['second', requestId]);
      return Promise.resolve();
    },
  };
  assert.equal(controller.generation(), 0);
  assert.equal(controller.cancelAll(), 1);
  assert.equal(controller.generation(), 1);
  assert.deepEqual(cancelled, [['second', second]]);
  assert.equal(controller.activeCount(), 0);
  assert.equal(controller.isCurrent(1), true);
  assert.equal(controller.isCurrent(0), false);
});

test('finance request controller recognizes only structured cancellation results', () => {
  const requests = loadController();
  const controller = requests.createController();
  assert.equal(controller.isCancelledResult({ ok: false, error: 'cancelled' }), true);
  assert.equal(controller.isCancelledResult({ ok: false, error: 'network_error' }), false);
  assert.equal(controller.isCancelledResult(new Error('cancelled')), false);
});
