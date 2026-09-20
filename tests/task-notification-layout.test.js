const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskNotificationLayout } = require('../main/task-notification-layout');

test('task notification layout centers a bounded notification on the target display', () => {
  const display = { bounds: { x: 100, y: 20, width: 500, height: 800 } };
  const layout = createTaskNotificationLayout({
    getTargetDisplay: () => display,
    getCenteredBounds: (width, height, target) => ({ width, height, display: target }),
    width: 400,
    height: 96,
    screenMargin: 16,
  });
  assert.deepEqual(layout.getBounds(), { width: 400, height: 96, display });
});

test('task notification layout keeps the minimum width on narrow displays', () => {
  const display = { bounds: { x: 0, y: 0, width: 300, height: 600 } };
  const layout = createTaskNotificationLayout({
    getTargetDisplay: () => display,
    getCenteredBounds: (width, height) => ({ width, height }),
    width: 400,
    height: 96,
    screenMargin: 24,
  });
  assert.deepEqual(layout.getBounds(display), { width: 280, height: 96 });
});
