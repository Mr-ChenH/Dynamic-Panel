import { z } from 'zod';

const text = (max) => z.string().max(max);
const id = z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const finite = z.number().finite();
const timestamp = z.number().finite().nonnegative();
const sortKey = text(80);
const nullableId = id.nullable();
const stringList = (maxItems, maxLength = 240) => z.array(text(maxLength)).max(maxItems);
const strict = (shape) => z.object(shape).strict();

const schemas = {
  todo: strict({ quadrant: z.enum(['P0', 'P1', 'P2', 'P3']), text: text(2000), done: z.boolean(), createdAt: timestamp, deadline: text(48), remindedAt: timestamp, sortKey }),
  todoCategory: strict({ displayName: text(80) }),
  note: strict({ title: text(80), titleSource: z.enum(['', 'model', 'user']), body: text(512000), categoryId: text(80), tagId: text(80), createdAt: timestamp, updatedAt: timestamp, imageObjectIds: z.array(id).max(1000) }),
  noteTaxon: strict({ kind: z.enum(['category', 'tag']), name: text(24), parentId: text(80) }),
  link: strict({ groupId: id, url: z.string().url().max(4096).refine((value) => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }), title: text(500), description: text(4000), tags: stringList(100), favorite: z.boolean(), read: z.boolean(), note: text(12000), createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp, sortKey }),
  linkGroup: strict({ name: text(120), sortKey }),
  preference: strict({ key: z.enum(['theme', 'features', 'defaultTab']), value: z.union([text(80), z.record(z.string().max(40), z.boolean())]) }),
  clipboardEntry: strict({ type: z.enum(['text', 'url', 'image']), text: text(12000).nullable(), imageObjectId: nullableId, timestamp }),
  clipboardFavorite: strict({ entryId: id }),
  screenshot: strict({ title: text(200), createdAt: timestamp, mimeType: z.literal('image/png'), bytes: timestamp, width: timestamp, height: timestamp, objectId: id }),
  aiSession: strict({ title: text(200), createdAt: timestamp, updatedAt: timestamp, records: z.array(strict({ id, groupId: text(240), prompt: text(12000), sources: z.array(strict({ sourceType: text(40), sourceId: text(240), sourceTitle: text(240), sourceRevision: text(120), text: text(12000), detail: text(12000), updatedAt: timestamp })).max(300), context: z.array(strict({ role: z.enum(['user', 'assistant']), content: text(12000) })).max(1000), answer: text(512000), state: z.enum(['complete', 'stopped', 'error']), detail: text(12000), createdAt: timestamp })).max(30), history: z.array(strict({ role: z.enum(['user', 'assistant']), content: text(12000) })).max(1000) }),
  financeWatchlist: strict({ lists: z.array(strict({ id: text(80), name: text(40), assetIds: stringList(1000) })).max(100), assets: z.record(z.string().max(240), strict({ id: text(240), provider: text(40), providerAssetId: text(160), market: text(20), type: text(20), symbol: text(32), name: text(120), exchange: text(40), currency: text(8), addedAt: text(48) })), preferences: strict({ defaultView: text(80).optional(), defaultMarket: text(80).optional(), defaultSource: text(80).optional(), defaultRanking: text(80).optional(), refreshSeconds: finite.optional() }) }),
  command: strict({ text: text(12000), createdAt: timestamp }),
  launcherFavorite: strict({ resultId: id }),
  launcherAlias: strict({ resultId: id, alias: text(240) }),
  weatherLocation: strict({ name: text(160), country: text(80), admin1: text(120), latitude: finite.min(-90).max(90), longitude: finite.min(-180).max(180), timezone: text(80) })
};

const policy = {
  todo: ['todo', 'field'], todoCategory: ['todo', 'field'], note: ['notes', 'copy'], noteTaxon: ['notes', 'field'],
  link: ['links', 'field'], linkGroup: ['links', 'field'], preference: ['preferences', 'lww'],
  clipboardEntry: ['clipboard', 'field'], clipboardFavorite: ['clipboard', 'field'], screenshot: ['screenshots', 'field'],
  aiSession: ['aiSessions', 'copy'], financeWatchlist: ['finance', 'field'], command: ['commands', 'copy'],
  launcherFavorite: ['launcher', 'field'], launcherAlias: ['launcher', 'field'], weatherLocation: ['location', 'lww']
};

export const ENTITY_REGISTRY = Object.freeze(Object.fromEntries(Object.entries(policy).map(([entityType, [category, merge]]) => [entityType, Object.freeze({ category, merge, versions: Object.freeze({ 1: schemas[entityType] }) })])));
export const ENTITY_TYPES = Object.freeze(Object.keys(ENTITY_REGISTRY));
export const CATEGORIES = Object.freeze([...new Set(Object.values(ENTITY_REGISTRY).map((entry) => entry.category))]);

const forbiddenKey = /(?:password|passphrase|secret|token|api.?key|credential|ciphertext|vault|workspace.?path|local.?path|file.?path|recording|transcript|video|music|shortcut|autolaunch|diagnostic|cache|draft|extension(?:code|permission|storage)?)/i;
const absolutePath = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|var|tmp|Volumes|private|mnt|opt|etc)(?:\/|$))/;

export function assertNoForbiddenData(value, path = '$', depth = 0) {
  if (depth > 12) throw new RecordValidationError('payload_too_deep', path);
  if (typeof value === 'string') {
    if (absolutePath.test(value) || value.includes('file://')) throw new RecordValidationError('forbidden_path', path);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) throw new RecordValidationError('forbidden_field', `${path}.${key}`);
    assertNoForbiddenData(child, `${path}.${key}`, depth + 1);
  }
}

export class RecordValidationError extends Error {
  constructor(code, path, issues) { super(code); this.name = 'RecordValidationError'; this.code = code; this.path = path; this.issues = issues; }
}

export function validateEntity({ entityType, category, schemaVersion, payload }) {
  const entry = ENTITY_REGISTRY[entityType];
  if (!entry) throw new RecordValidationError('unsupported_entity_type', 'entityType');
  if (entry.category !== category) throw new RecordValidationError('category_mismatch', 'category');
  const schema = entry.versions[schemaVersion];
  if (!schema) throw new RecordValidationError('unsupported_schema', 'schemaVersion');
  assertNoForbiddenData(payload);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new RecordValidationError('invalid_entity', 'payload', parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })));
  const bytes = Buffer.byteLength(JSON.stringify(parsed.data), 'utf8');
  if (bytes > 1_048_576) throw new RecordValidationError('technical_limit_exceeded', 'payload');
  return parsed.data;
}

export const operationSchema = strict({
  operationId: id,
  entityType: z.enum(ENTITY_TYPES),
  entityId: id,
  category: z.enum(CATEGORIES),
  schemaVersion: z.literal(1),
  baseRevision: z.number().int().nonnegative().nullable(),
  kind: z.enum(['upsert', 'delete', 'resolveConflict']),
  payload: z.unknown().optional(),
  conflictId: id.optional()
}).superRefine((value, context) => {
  if (value.kind === 'delete' && value.payload !== undefined) context.addIssue({ code: 'custom', message: 'delete_payload_forbidden', path: ['payload'] });
  if (value.kind !== 'delete' && value.payload === undefined) context.addIssue({ code: 'custom', message: 'payload_required', path: ['payload'] });
  if (value.kind === 'resolveConflict' && !value.conflictId) context.addIssue({ code: 'custom', message: 'conflict_id_required', path: ['conflictId'] });
});
