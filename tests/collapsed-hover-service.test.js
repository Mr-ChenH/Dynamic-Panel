'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollapsedHoverService } = require('../main/collapsed-hover-service');

function createHarness() {
  let mode = 'collapsed';
  let visible = true;
  let destroyed = false;
  let cursor = { x: 600, y: 10 };
  let intervalId = 0;
  const intervals = new Map();
  const geometry = [];
  const window = { isDestroyed: () => destroyed, isVisible: () => visible };
  const service = createCollapsedHoverService({
    platform: 'win32',
    screen: { getCursorScreenPoint: () => cursor },
    getMainWindow: () => window,
    getMode: () => mode,
    getDisplay: () => ({ id: 1 }),
    getNotchHeight: () => 8,
    getLayout: () => ({
      bounds: { x: 0, y: 0, width: 1200, height: 616 },
      shape: [{ x: 508, y: 0, width: 184, height: 30 }],
    }),
    applyCollapsedGeometry: () => geometry.push('apply'),
    shapeWatchdogIntervalMs: 1000,
    setIntervalFn: (callback, delay) => {
      const id = ++intervalId;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearIntervalFn: (id) => intervals.delete(id),
  });
  return {
    service,
    geometry,
    intervals,
    setCursor: (value) => { cursor = value; },
    setMode: (value) => { mode = value; },
    setVisible: (value) => { visible = value; },
    setDestroyed: (value) => { destroyed = value; },
    tick: (delay) => [...intervals.values()]
      .filter((entry) => delay === undefined || entry.delay === delay)
      .forEach(({ callback }) => callback()),
  };
}

test('collapsed hover self-heals when Chromium misses mouseleave and watchdog repairs its shape', () => {
  const harness = createHarness();
  assert.equal(harness.service.setHovering(true), true);
  assert.equal(harness.service.isHovering(), true);
  assert.equal(harness.intervals.size, 2);
  assert.deepEqual([...harness.intervals.values()].map((entry) => entry.delay).sort((a, b) => a - b), [120, 1000]);

  harness.tick(120);
  assert.equal(harness.service.isHovering(), true);

  harness.setCursor({ x: 800, y: 40 });
  harness.tick(120);
  assert.equal(harness.service.isHovering(), false);
  assert.equal(harness.intervals.size, 1);
  assert.deepEqual(harness.geometry, ['apply', 'apply']);

  harness.tick(1000);
  assert.deepEqual(harness.geometry, ['apply', 'apply', 'apply']);
});

test('collapsed hover resets without resizing after mode or visibility changes', () => {
  const harness = createHarness();
  harness.service.setHovering(true);
  harness.setMode('expanded');
  harness.tick(120);
  harness.tick(1000);
  assert.equal(harness.service.isHovering(), false);
  assert.equal(harness.intervals.size, 0);
  assert.deepEqual(harness.geometry, ['apply']);

  harness.setMode('collapsed');
  harness.service.setHovering(true);
  harness.setVisible(false);
  harness.tick(120);
  harness.tick(1000);
  assert.equal(harness.service.isHovering(), false);
  assert.deepEqual(harness.geometry, ['apply', 'apply']);
});

test('collapsed shape watchdog repairs a compact notch without hover state', () => {
  const harness = createHarness();
  harness.service.start();
  assert.equal(harness.intervals.size, 1);
  harness.tick(1000);
  assert.deepEqual(harness.geometry, ['apply']);
  harness.service.stop();
  assert.equal(harness.intervals.size, 0);
});

test('collapsed hover ignores unsupported or unavailable windows', () => {
  const hidden = createHarness();
  hidden.setVisible(false);
  assert.equal(hidden.service.setHovering(true), false);
  assert.equal(hidden.service.isHovering(), false);
  assert.equal(hidden.intervals.size, 0);

  hidden.service.start();
  assert.equal(hidden.service.isHovering(), false);
  assert.equal(hidden.intervals.size, 0);

  const expanded = createHarness();
  expanded.setMode('expanded');
  expanded.service.start();
  assert.equal(expanded.intervals.size, 0);

  const destroyed = createHarness();
  destroyed.setDestroyed(true);
  assert.equal(destroyed.service.setHovering(true), false);
  assert.equal(destroyed.service.isHovering(), false);
});
