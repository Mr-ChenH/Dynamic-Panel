const NOTCH_HEIGHT_MODES = Object.freeze(['small', 'medium', 'large', 'custom']);
const NOTCH_HEIGHT_LIMITS = Object.freeze({
  darwin: Object.freeze({ min: 24, max: 64 }),
  win32: Object.freeze({ min: 8, max: 38 }),
  default: Object.freeze({ min: 24, max: 64 }),
});

function notchHeightLimits(platform = 'darwin') {
  return NOTCH_HEIGHT_LIMITS[platform] || NOTCH_HEIGHT_LIMITS.default;
}

function integerHeight(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isInteger(numeric) ? numeric : null;
}

function clampHeight(value, limits) {
  return Math.min(limits.max, Math.max(limits.min, value));
}

function normalizeNotchHeightPreference(value, platform = 'darwin') {
  const limits = notchHeightLimits(platform);
  const source = typeof value === 'string' ? { mode: value } : value;
  const mode = NOTCH_HEIGHT_MODES.includes(source?.mode) ? source.mode : 'small';
  const custom = integerHeight(source?.custom);
  return {
    mode,
    custom: clampHeight(custom === null ? limits.min : custom, limits),
  };
}

function validateNotchHeightPreference(value, platform = 'darwin') {
  const limits = notchHeightLimits(platform);
  if (typeof value === 'string') {
    return NOTCH_HEIGHT_MODES.includes(value) ? normalizeNotchHeightPreference(value, platform) : null;
  }
  if (!value || typeof value !== 'object' || !NOTCH_HEIGHT_MODES.includes(value.mode)) return null;
  if (value.mode !== 'custom') return normalizeNotchHeightPreference(value, platform);
  const custom = integerHeight(value.custom);
  if (custom === null || custom < limits.min || custom > limits.max) return null;
  return { mode: 'custom', custom };
}

function resolveNotchHeight(value, options = {}) {
  const platform = options.platform || 'darwin';
  const limits = notchHeightLimits(platform);
  const preference = normalizeNotchHeightPreference(value, platform);
  const base = integerHeight(options.baseHeight);
  const small = clampHeight(base === null ? limits.min : base, limits);
  if (preference.mode === 'custom') return preference.custom;
  if (preference.mode === 'medium') return clampHeight(small + 8, limits);
  if (preference.mode === 'large') return clampHeight(small + 16, limits);
  return small;
}

module.exports = {
  NOTCH_HEIGHT_MODES,
  NOTCH_HEIGHT_LIMITS,
  notchHeightLimits,
  normalizeNotchHeightPreference,
  validateNotchHeightPreference,
  resolveNotchHeight,
};
