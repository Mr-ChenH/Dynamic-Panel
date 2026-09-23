'use strict';

const PURPOSE_PATTERNS = Object.freeze({
  'note-image': /^note-images\/[A-Za-z0-9_-]{1,240}\/[A-Za-z0-9._-]{1,240}\.png$/,
  'clipboard-image': /^clipboard-images\/[A-Za-z0-9._-]{1,240}\.png$/,
  screenshot: /^captures\/screenshots\/[0-9a-f-]{36}\.png$/i,
});

function normalizeRelativeMediaPath(value) {
  const result = String(value || '');
  if (!result || result.includes('\\') || result.startsWith('/') || result.includes('\0') || result.split('/').some((part) => !part || part === '.' || part === '..')) throw new TypeError('invalid_sync_media_path');
  return result;
}

function assertPurposePath(purpose, relativePath) {
  const normalized = normalizeRelativeMediaPath(relativePath);
  if (!Object.hasOwn(PURPOSE_PATTERNS, purpose) || !PURPOSE_PATTERNS[purpose].test(normalized)) throw new TypeError('sync_media_scope_rejected');
  return normalized;
}

function assertInside(pathModule, root, target) {
  const relative = pathModule.relative(root, target);
  if (!relative || relative.startsWith('..') || pathModule.isAbsolute(relative)) throw new TypeError('sync_media_scope_rejected');
}

async function ensureSafePath({ fsModule, pathModule, rootPath, relativePath, purpose, forWrite = false } = {}) {
  if (!fsModule?.promises || !pathModule || !rootPath) throw new TypeError('sync_media_dependencies_required');
  const normalized = assertPurposePath(purpose, relativePath);
  const root = pathModule.resolve(rootPath);
  const target = pathModule.resolve(root, ...normalized.split('/'));
  assertInside(pathModule, root, target);
  const parts = normalized.split('/');
  let current = root;
  const rootStat = await fsModule.promises.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new TypeError('unsafe_sync_media_root');
  for (let index = 0; index < parts.length; index += 1) {
    current = pathModule.join(current, parts[index]);
    const final = index === parts.length - 1;
    try {
      const stat = await fsModule.promises.lstat(current);
      if (stat.isSymbolicLink() || (final ? !stat.isFile() : !stat.isDirectory())) throw new TypeError('unsafe_sync_media_path');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!forWrite || final) {
        if (!forWrite) throw Object.assign(new Error('sync_media_missing'), { code: 'sync_media_missing' });
        continue;
      }
      await fsModule.promises.mkdir(current);
    }
  }
  return Object.freeze({ root, path: target, relativePath: normalized, purpose });
}

module.exports = { PURPOSE_PATTERNS, normalizeRelativeMediaPath, assertPurposePath, ensureSafePath };
