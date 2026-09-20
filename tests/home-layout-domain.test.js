const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeHomeWidgetSizes,
  packHomeWidgetLayout,
  normalizeHiddenHomeModules,
  updateHomeModuleVisibility,
  resolveHomeWidgetLayout,
  validateHomeWidgetLayout,
  layoutVariantForPlacement,
  normalizeHomeLayout,
  swapHomeLayoutSlots,
} = require('../renderer/domain');

const homeLayoutDomain = require('../renderer/home-layout-domain');
const HOME_MODULES = ['music', 'pomodoro', 'recorder', 'windows', 'note', 'commands'];


test('NotchDomain keeps the extracted home layout domain as its compatibility facade', () => {
  const domain = require('../renderer/domain');
  for (const name of ['normalizeHomeLayout', 'swapHomeLayoutSlots', 'normalizeTodoCategoryNames', 'migrateTodoCategoryNames', 'normalizeHomeWidgetSizes', 'packHomeWidgetLayout', 'normalizeHiddenHomeModules', 'updateHomeModuleVisibility', 'resolveHomeWidgetLayout', 'validateHomeWidgetLayout', 'layoutVariantForPlacement']) {
    assert.equal(domain[name], homeLayoutDomain[name], `${name} must be delegated by NotchDomain`);
  }
});

function assertExactHomeCover(layout, expectedIds) {
  assert.ok(layout);
  assert.equal(validateHomeWidgetLayout(layout, expectedIds, 12, 4), true);
  assert.deepEqual(Object.keys(layout.placements).sort(), [...expectedIds].sort());
  const cells = Array(48).fill(0);
  Object.entries(layout.placements).forEach(([id, item]) => {
    assert.ok(Number.isInteger(item.column) && item.column >= 0, `${id} has an invalid column`);
    assert.ok(Number.isInteger(item.row) && item.row >= 0, `${id} has an invalid row`);
    assert.ok(Number.isInteger(item.width) && item.width > 0, `${id} has an invalid width`);
    assert.ok(Number.isInteger(item.height) && item.height > 0, `${id} has an invalid height`);
    assert.ok(item.column + item.width <= 12, `${id} exceeds the grid width`);
    assert.ok(item.row + item.height <= 4, `${id} exceeds the grid height`);
    for (let row = item.row; row < item.row + item.height; row += 1) {
      for (let column = item.column; column < item.column + item.width; column += 1) {
        cells[row * 12 + column] += 1;
      }
    }
  });
  assert.deepEqual(cells, Array(48).fill(1));
}

test('home layout swaps complete slot assignments without duplicates', () => {
  const defaults = {
    windows: 'tall-left',
    clock: 'small-top',
    recorder: 'medium-top',
    mirror: 'square-top',
    commands: 'tall-right',
    note: 'wide-bottom',
  };
  assert.deepEqual(normalizeHomeLayout({ windows: 'wide-bottom' }, defaults), defaults);
  assert.deepEqual(swapHomeLayoutSlots(defaults, 'mirror', 'clock'), {
    windows: 'tall-left',
    clock: 'square-top',
    recorder: 'medium-top',
    mirror: 'small-top',
    commands: 'tall-right',
    note: 'wide-bottom',
  });
});

test('home widget sizes keep the requested tile large and adapt siblings to the grid budget', () => {
  const defaults = {
    character: 'small',
    windows: 'large',
    recorder: 'medium',
    mirror: 'medium',
    note: 'large',
    commands: 'medium',
  };
  assert.deepEqual(normalizeHomeWidgetSizes({ windows: 'huge' }, defaults, 'windows', 22), defaults);
  const fitted = normalizeHomeWidgetSizes({
    character: 'large',
    windows: 'large',
    recorder: 'large',
    mirror: 'large',
    note: 'large',
    commands: 'large',
  }, defaults, 'mirror', 22);
  assert.equal(fitted.mirror, 'large');
  assert.ok(Object.values(fitted).some((size) => size !== 'large'));
});

test('home widget sizes fill the complete bento capacity without blank cells', () => {
  const defaults = {
    music: 'medium',
    windows: 'large',
    recorder: 'small',
    mirror: 'medium',
    note: 'medium',
    commands: 'mini',
    pomodoro: 'mini',
  };
  const area = { mini: 2, small: 4, medium: 8, large: 16 };
  const fitted = normalizeHomeWidgetSizes({ ...defaults, mirror: 'large' }, defaults, 'mirror', 48);
  assert.equal(fitted.mirror, 'large');
  assert.equal(Object.values(fitted).reduce((total, size) => total + area[size], 0), 48);
});

test('home widget packing fills all four rows even when logical order would fragment the grid', () => {
  const order = ['recorder', 'windows', 'commands', 'music', 'note', 'pomodoro'];
  const sizes = {
    recorder: 'medium',
    windows: 'large',
    commands: 'small',
    music: 'medium',
    note: 'medium',
    pomodoro: 'small',
  };
  const layout = packHomeWidgetLayout(order, sizes, 12, 4);
  assert.ok(layout);
  const occupied = new Set();
  Object.entries(layout).forEach(([id, item]) => {
    for (let row = item.row; row < item.row + item.height; row += 1) {
      for (let column = item.column; column < item.column + item.width; column += 1) {
        const cell = `${row}:${column}`;
        assert.equal(occupied.has(cell), false, `${id} overlaps ${cell}`);
        occupied.add(cell);
      }
    }
  });
  assert.equal(occupied.size, 48);
});

test('hidden homepage modules are deduplicated and normalized to module order', () => {
  assert.deepEqual(normalizeHiddenHomeModules(['mirror', 'unknown', 'mirror', 'music'], HOME_MODULES), ['music']);
  assert.deepEqual(normalizeHiddenHomeModules('mirror', HOME_MODULES), []);
  assert.deepEqual(normalizeHiddenHomeModules([...HOME_MODULES], HOME_MODULES), []);
});

test('homepage visibility refuses to hide the final visible module', () => {
  const fiveHidden = HOME_MODULES.slice(0, 5);
  assert.deepEqual(
    updateHomeModuleVisibility(fiveHidden, HOME_MODULES, 'commands', false),
    { ok: false, error: 'at_least_one_required', hiddenIds: fiveHidden }
  );
  assert.deepEqual(updateHomeModuleVisibility(['note'], HOME_MODULES, 'note', true), { ok: true, hiddenIds: [] });
  assert.deepEqual(updateHomeModuleVisibility([], HOME_MODULES, 'unknown', false), { ok: false, error: 'invalid_module', hiddenIds: [] });
});

test('every non-empty homepage widget subset exactly covers the bento grid', () => {
  const order = ['music', 'pomodoro', 'windows', 'recorder', 'note', 'commands'];
  const sizes = {
    music: 'medium', pomodoro: 'mini', windows: 'large', recorder: 'small',
    mirror: 'medium', note: 'medium', commands: 'mini',
  };
  for (let visibleMask = 1; visibleMask < 2 ** order.length; visibleMask += 1) {
    const hiddenIds = order.filter((id, index) => (visibleMask & (1 << index)) === 0);
    const expectedIds = order.filter((id) => !hiddenIds.includes(id));
    const before = JSON.stringify({ order, sizes, hiddenIds });
    const layout = resolveHomeWidgetLayout(order, sizes, hiddenIds, 12, 4);
    assertExactHomeCover(layout, expectedIds);
    assert.equal(JSON.stringify({ order, sizes, hiddenIds }), before, 'resolver mutated its inputs');
  }
});

test('five-widget layout chooses the largest preference and breaks ties by saved order', () => {
  const order = ['music', 'pomodoro', 'windows', 'recorder', 'note', 'commands'];
  const sizes = {
    music: 'medium', pomodoro: 'mini', windows: 'large', recorder: 'small',
    mirror: 'large', note: 'medium', commands: 'mini',
  };
  const layout = resolveHomeWidgetLayout(order, sizes, ['commands'], 12, 4);
  assert.deepEqual(layout.placements.windows, { column: 0, row: 0, width: 4, height: 4 });
  assert.equal(layout.variants.windows, 'tall');
});

test('layout variants reflect actual rectangles instead of saved preferences', () => {
  assert.equal(layoutVariantForPlacement({ width: 2, height: 1 }), 'mini');
  assert.equal(layoutVariantForPlacement({ width: 2, height: 2 }), 'compact');
  assert.equal(layoutVariantForPlacement({ width: 6, height: 2 }), 'wide');
  assert.equal(layoutVariantForPlacement({ width: 4, height: 4 }), 'tall');
  assert.equal(layoutVariantForPlacement({ width: 12, height: 4 }), 'full');
});

test('home layout validation rejects every incomplete or unsafe shape', () => {
  const valid = resolveHomeWidgetLayout(['music', 'windows'], { music: 'large', windows: 'large' }, [], 12, 4);
  assert.equal(validateHomeWidgetLayout(valid, ['music', 'windows'], 12, 4), true);
  assert.equal(validateHomeWidgetLayout(null, ['music'], 12, 4), false);
  assert.equal(validateHomeWidgetLayout({ placements: {} }, ['music'], 12, 4), false);
  assert.equal(validateHomeWidgetLayout({ placements: { music: { column: 0, row: 0, width: 12, height: 3 } } }, ['music'], 12, 4), false);
  assert.equal(validateHomeWidgetLayout({ placements: { music: { column: 0, row: 0, width: 12.5, height: 4 } } }, ['music'], 12, 4), false);
  assert.equal(validateHomeWidgetLayout({ placements: {
    music: { column: 0, row: 0, width: 8, height: 4 },
    windows: { column: 6, row: 0, width: 6, height: 4 },
  } }, ['music', 'windows'], 12, 4), false);
});
