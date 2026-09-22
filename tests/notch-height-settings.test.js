const test = require('node:test');
const assert = require('node:assert/strict');
const {
  notchHeightLimits,
  normalizeNotchHeightPreference,
  validateNotchHeightPreference,
  resolveNotchHeight,
} = require('../main/notch-height-settings');

test('notch height presets derive from the platform default and stay bounded', () => {
  assert.deepEqual(notchHeightLimits('darwin'), { min: 24, max: 64 });
  assert.equal(resolveNotchHeight({ mode: 'small' }, { platform: 'darwin', baseHeight: 37 }), 37);
  assert.equal(resolveNotchHeight({ mode: 'medium' }, { platform: 'darwin', baseHeight: 37 }), 45);
  assert.equal(resolveNotchHeight({ mode: 'large' }, { platform: 'darwin', baseHeight: 55 }), 64);
  assert.equal(resolveNotchHeight({ mode: 'medium' }, { platform: 'win32', baseHeight: 8 }), 16);
});

test('custom notch height accepts only integer values inside the platform range', () => {
  assert.deepEqual(validateNotchHeightPreference({ mode: 'custom', custom: 48 }, 'darwin'), { mode: 'custom', custom: 48 });
  assert.equal(validateNotchHeightPreference({ mode: 'custom', custom: 23 }, 'darwin'), null);
  assert.equal(validateNotchHeightPreference({ mode: 'custom', custom: 64.5 }, 'darwin'), null);
  assert.equal(validateNotchHeightPreference({ mode: 'custom', custom: 39 }, 'win32'), null);
  assert.deepEqual(normalizeNotchHeightPreference({ mode: 'custom', custom: 1000 }, 'darwin'), { mode: 'custom', custom: 64 });
});
