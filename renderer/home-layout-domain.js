(function exposeHomeLayoutDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchHomeLayoutDomain = api;
})(typeof window !== 'undefined' ? window : globalThis, function createHomeLayoutDomain() {
  function normalizeHomeLayout(layout, defaults) {
    const fallback = defaults && typeof defaults === 'object' ? { ...defaults } : {};
    const keys = Object.keys(fallback);
    if (!layout || typeof layout !== 'object') return fallback;
    const slots = keys.map((key) => layout[key]);
    const validSlots = new Set(Object.values(fallback));
    if (slots.length !== validSlots.size || new Set(slots).size !== validSlots.size || slots.some((slot) => !validSlots.has(slot))) {
      return fallback;
    }
    return Object.fromEntries(keys.map((key) => [key, layout[key]]));
  }

  function swapHomeLayoutSlots(layout, sourceId, targetId) {
    if (!layout || typeof layout !== 'object' || sourceId === targetId) return { ...(layout || {}) };
    if (!Object.prototype.hasOwnProperty.call(layout, sourceId) || !Object.prototype.hasOwnProperty.call(layout, targetId)) return { ...layout };
    return { ...layout, [sourceId]: layout[targetId], [targetId]: layout[sourceId] };
  }

  function normalizeTodoCategoryNames(value, defaults) {
    const fallback = defaults && typeof defaults === 'object' ? { ...defaults } : {};
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.entries(fallback).map(([key, defaultName]) => {
      const candidate = String(source[key] || '').replace(/\s+/g, ' ').trim();
      return [key, candidate ? candidate.slice(0, 24) : defaultName];
    }));
  }

  function migrateTodoCategoryNames(value, defaults, legacyDefaults) {
    const fallback = defaults && typeof defaults === 'object' ? { ...defaults } : {};
    const legacy = legacyDefaults && typeof legacyDefaults === 'object' ? legacyDefaults : {};
    const source = value && typeof value === 'object' ? value : {};
    const migrated = Object.fromEntries(Object.keys(fallback).map((key) => {
      const saved = String(source[key] || '').replace(/\s+/g, ' ').trim();
      return [key, saved && saved !== legacy[key] ? saved : fallback[key]];
    }));
    return normalizeTodoCategoryNames(migrated, fallback);
  }

  function normalizeHomeWidgetSizes(value, defaults, preferredId, capacity = Infinity) {
    const fallback = defaults && typeof defaults === 'object' ? { ...defaults } : {};
    const allowed = new Set(['mini', 'small', 'medium', 'large']);
    const source = value && typeof value === 'object' ? value : {};
    if (Object.keys(source).some((key) => key in fallback && !allowed.has(source[key]))) return fallback;
    const sizes = Object.fromEntries(Object.entries(fallback).map(([key, defaultSize]) => [key, allowed.has(source[key]) ? source[key] : defaultSize]));
    const area = { mini: 2, small: 4, medium: 8, large: 16 };
    const totalArea = () => Object.values(sizes).reduce((total, size) => total + area[size], 0);
    const siblings = Object.keys(sizes).filter((key) => key !== preferredId);
    while (totalArea() > capacity) {
      const excess = totalArea() - capacity;
      const candidate = siblings
        .map((key) => ({ key, reduction: sizes[key] === 'large' ? 8 : sizes[key] === 'medium' ? 4 : sizes[key] === 'small' ? 2 : 0 }))
        .filter((item) => item.reduction > 0 && item.reduction <= excess)
        .sort((a, b) => b.reduction - a.reduction)[0];
      if (!candidate) break;
      sizes[candidate.key] = sizes[candidate.key] === 'large' ? 'medium' : sizes[candidate.key] === 'medium' ? 'small' : 'mini';
    }
    while (Number.isFinite(capacity) && totalArea() < capacity) {
      const remaining = capacity - totalArea();
      const candidate = siblings
        .map((key) => ({ key, increase: sizes[key] === 'mini' ? 2 : sizes[key] === 'small' ? 4 : sizes[key] === 'medium' ? 8 : 0 }))
        .filter((item) => item.increase > 0 && item.increase <= remaining)
        .sort((a, b) => b.increase - a.increase)[0];
      if (!candidate) break;
      sizes[candidate.key] = sizes[candidate.key] === 'mini' ? 'small' : sizes[candidate.key] === 'small' ? 'medium' : 'large';
    }
    return sizes;
  }

  function packHomeWidgetLayout(order, sizes, columns = 12, rows = 4) {
    const ids = Array.isArray(order) ? order.filter((id) => Object.prototype.hasOwnProperty.call(sizes || {}, id)) : [];
    if (!ids.length || columns < 1 || rows < 1) return null;
    const dimensions = { mini: { width: 2, height: 1 }, small: { width: 2, height: 2 }, medium: { width: 4, height: 2 }, large: { width: 4, height: 4 } };
    const occupied = Array.from({ length: rows }, () => Array(columns).fill(false));
    const placements = {};
    function fits(column, row, width, height) {
      if (column + width > columns || row + height > rows) return false;
      for (let y = row; y < row + height; y += 1) for (let x = column; x < column + width; x += 1) if (occupied[y][x]) return false;
      return true;
    }
    function mark(column, row, width, height, value) {
      for (let y = row; y < row + height; y += 1) for (let x = column; x < column + width; x += 1) occupied[y][x] = value;
    }
    function place(index) {
      if (index >= ids.length) return occupied.every((row) => row.every(Boolean));
      const id = ids[index];
      const dimension = dimensions[sizes[id]] || dimensions.small;
      for (let row = 0; row <= rows - dimension.height; row += 1) {
        for (let column = 0; column <= columns - dimension.width; column += 1) {
          if (!fits(column, row, dimension.width, dimension.height)) continue;
          mark(column, row, dimension.width, dimension.height, true);
          placements[id] = { column, row, ...dimension };
          if (place(index + 1)) return true;
          delete placements[id];
          mark(column, row, dimension.width, dimension.height, false);
        }
      }
      return false;
    }
    return place(0) ? placements : null;
  }

  const HOME_GAPLESS_TEMPLATES = {
    1: [{ column: 0, row: 0, width: 12, height: 4 }],
    2: [{ column: 0, row: 0, width: 6, height: 4 }, { column: 6, row: 0, width: 6, height: 4 }],
    3: [{ column: 0, row: 0, width: 4, height: 4 }, { column: 4, row: 0, width: 4, height: 4 }, { column: 8, row: 0, width: 4, height: 4 }],
    4: [{ column: 0, row: 0, width: 6, height: 2 }, { column: 6, row: 0, width: 6, height: 2 }, { column: 0, row: 2, width: 6, height: 2 }, { column: 6, row: 2, width: 6, height: 2 }],
    5: [{ column: 0, row: 0, width: 4, height: 4 }, { column: 4, row: 0, width: 4, height: 2 }, { column: 8, row: 0, width: 4, height: 2 }, { column: 4, row: 2, width: 4, height: 2 }, { column: 8, row: 2, width: 4, height: 2 }],
    6: [{ column: 0, row: 0, width: 4, height: 2 }, { column: 4, row: 0, width: 4, height: 2 }, { column: 8, row: 0, width: 4, height: 2 }, { column: 0, row: 2, width: 4, height: 2 }, { column: 4, row: 2, width: 4, height: 2 }, { column: 8, row: 2, width: 4, height: 2 }],
  };

  function normalizeHiddenHomeModules(value, moduleIds) {
    const ids = Array.isArray(moduleIds) ? [...new Set(moduleIds.map((id) => String(id)))] : [];
    if (!ids.length || !Array.isArray(value)) return [];
    const requested = new Set(value.map((id) => String(id)));
    const hiddenIds = ids.filter((id) => requested.has(id));
    return hiddenIds.length === ids.length ? [] : hiddenIds;
  }

  function updateHomeModuleVisibility(hiddenIds, moduleIds, moduleId, visible) {
    const ids = Array.isArray(moduleIds) ? [...new Set(moduleIds.map((id) => String(id)))] : [];
    const current = normalizeHiddenHomeModules(hiddenIds, ids);
    const id = String(moduleId || '');
    if (!ids.includes(id) || typeof visible !== 'boolean') return { ok: false, error: 'invalid_module', hiddenIds: current };
    const next = new Set(current);
    if (visible) next.delete(id); else next.add(id);
    if (next.size >= ids.length) return { ok: false, error: 'at_least_one_required', hiddenIds: current };
    return { ok: true, hiddenIds: ids.filter((candidate) => next.has(candidate)) };
  }

  function layoutVariantForPlacement(placement) {
    const width = Number(placement?.width) || 0;
    const height = Number(placement?.height) || 0;
    if (width <= 2 && height <= 1) return 'mini';
    if (width <= 2 && height <= 2) return 'compact';
    if (height <= 2) return 'wide';
    if (width >= 6 && height >= 4) return 'full';
    return 'tall';
  }

  function validateHomeWidgetLayout(layout, visibleIds, columns = 12, rows = 4) {
    if (!layout || !layout.placements || columns < 1 || rows < 1) return false;
    const expected = [...new Set(Array.isArray(visibleIds) ? visibleIds.map(String) : [])].sort();
    const entries = Object.entries(layout.placements);
    if (!expected.length || entries.length !== expected.length) return false;
    if (JSON.stringify(entries.map(([id]) => id).sort()) !== JSON.stringify(expected)) return false;
    const cells = Array(columns * rows).fill(0);
    for (const [, item] of entries) {
      const values = [item?.column, item?.row, item?.width, item?.height];
      if (!values.every(Number.isInteger) || item.width < 1 || item.height < 1) return false;
      if (item.column < 0 || item.row < 0 || item.column + item.width > columns || item.row + item.height > rows) return false;
      for (let row = item.row; row < item.row + item.height; row += 1) for (let column = item.column; column < item.column + item.width; column += 1) {
        const index = row * columns + column;
        cells[index] += 1;
        if (cells[index] > 1) return false;
      }
    }
    return cells.every((count) => count === 1);
  }

  function resolveHomeWidgetLayout(order, sizes, hiddenIds, columns = 12, rows = 4) {
    if (columns !== 12 || rows !== 4 || !sizes || typeof sizes !== 'object') return null;
    const ids = Array.isArray(order) ? [...new Set(order.map(String))].filter((id) => Object.prototype.hasOwnProperty.call(sizes, id)) : [];
    if (!ids.length) return null;
    const hidden = new Set(normalizeHiddenHomeModules(hiddenIds, ids));
    const visibleOrder = ids.filter((id) => !hidden.has(id));
    if (!visibleOrder.length) return null;
    let placements;
    if (visibleOrder.length === 7) placements = packHomeWidgetLayout(visibleOrder, sizes, columns, rows);
    else {
      const template = HOME_GAPLESS_TEMPLATES[visibleOrder.length];
      if (!template) return null;
      let slotOrder = [...visibleOrder];
      if (visibleOrder.length === 5) {
        const rank = { mini: 0, small: 1, medium: 2, large: 3 };
        const primary = [...visibleOrder].sort((left, right) => ((rank[sizes[right]] ?? 0) - (rank[sizes[left]] ?? 0) || visibleOrder.indexOf(left) - visibleOrder.indexOf(right)))[0];
        slotOrder = [primary, ...visibleOrder.filter((id) => id !== primary)];
      }
      placements = Object.fromEntries(slotOrder.map((id, index) => [id, { ...template[index] }]));
    }
    if (!placements) return null;
    const result = {
      visibleOrder: [...visibleOrder],
      placements: Object.fromEntries(Object.entries(placements).map(([id, item]) => [id, { ...item }])),
      variants: Object.fromEntries(Object.entries(placements).map(([id, item]) => [id, layoutVariantForPlacement(item)])),
    };
    return validateHomeWidgetLayout(result, visibleOrder, columns, rows) ? result : null;
  }

  return {
    normalizeHomeLayout,
    swapHomeLayoutSlots,
    normalizeTodoCategoryNames,
    migrateTodoCategoryNames,
    normalizeHomeWidgetSizes,
    packHomeWidgetLayout,
    normalizeHiddenHomeModules,
    updateHomeModuleVisibility,
    resolveHomeWidgetLayout,
    validateHomeWidgetLayout,
    layoutVariantForPlacement,
  };
});
