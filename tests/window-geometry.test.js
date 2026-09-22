const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowGeometry } = require('../main/window-geometry');

function createGeometry(platform = 'darwin') {
  const display = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 } };
  return createWindowGeometry({
    screen: {
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => display,
      getDisplayMatching: () => display,
      getPrimaryDisplay: () => display,
    },
    platformPolicy: { panelBounds: () => ({ x: 0, y: 0, width: 200, height: 38 }), windowsPanelLayout: () => ({ bounds: {}, shape: [] }) },
    platform,
    collapsedWidth: 200,
    collapsedMinHeight: 38,
    expandedChromeY: 76,
    screenMargin: 24,
    tabSizes: { home: { width: 1240, panelHeight: 540 } },
    getCurrentTab: () => 'home',
    getMainWindow: () => null,
    isCollapsedHovering: () => false,
  });
}

test('window geometry projects layout metrics from the injected display policy', () => {
  const geometry = createGeometry();
  assert.equal(typeof geometry.getNotchHeight, 'function');
  assert.deepEqual(geometry.getLayoutMetrics(), {
    stripHeight: 24,
    notchHeight: 24,
    menuBarHeight: 24,
    chromeY: 76,
    tabSizes: { home: { width: 1240, panelHeight: 540 } },
  });
});

test('window geometry keeps Windows collapsed height independent of work area menu offset', () => {
  const geometry = createGeometry('win32');
  assert.equal(geometry.getLayoutMetrics().stripHeight, 38);
});
