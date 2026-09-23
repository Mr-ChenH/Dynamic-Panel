export const MINIMUM_RETENTION = Object.freeze({ daily: 7, weekly: 4, monthly: 12 });

export function validateRetention(policy, { production = false } = {}) {
  return Object.fromEntries(Object.entries(MINIMUM_RETENTION).map(([name, minimum]) => {
    const value = policy?.[name] ?? minimum;
    if (!Number.isInteger(value) || value < 0 || (production && value < minimum)) {
      throw Object.assign(new Error(`Invalid ${name} retention`), { code: 'INVALID_RETENTION' });
    }
    return [name, value];
  }));
}

function localDate(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function selectRetention(points, policy = MINIMUM_RETENTION, { timeZone = 'UTC' } = {}) {
  const limits = validateRetention(policy);
  const verified = points.filter((point) => point.status === 'verified').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const keep = new Set();
  const seen = { daily: new Set(), weekly: new Set(), monthly: new Set() };
  for (const point of verified) {
    const dateKey = localDate(point.createdAt, timeZone);
    const date = new Date(`${dateKey}T00:00:00Z`);
    const monday = new Date(date); monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const keys = { daily: dateKey, weekly: monday.toISOString().slice(0, 10), monthly: dateKey.slice(0, 7) };
    for (const tier of Object.keys(keys)) {
      if (seen[tier].size < limits[tier] && !seen[tier].has(keys[tier])) { seen[tier].add(keys[tier]); keep.add(point.manifestId ?? point.id); }
    }
  }
  return { keep: verified.filter((point) => keep.has(point.manifestId ?? point.id)), prune: verified.filter((point) => !keep.has(point.manifestId ?? point.id)) };
}
