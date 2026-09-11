'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
// Interactive local file/folder opening only. Executables/scripts must use
// application discovery or an explicitly installed process extension.
async function resolveLaunchPath(value, platform = process.platform) {
  if (typeof value !== 'string' || value.length > 4096 || /[\0\r\n]/.test(value)) return null;
  const input = value.trim();
  const parser = platform === 'win32' ? path.win32 : path.posix;
  if (!parser.isAbsolute(input) || (platform === 'win32' && (!/^[a-z]:[\\/]/i.test(input) || input.slice(2).includes(':')))) return null;
  try {
    const resolved = await fs.realpath(input);
    if (platform === 'win32' && (!/^[a-z]:[\\/]/i.test(resolved) || resolved.slice(2).includes(':'))) return null;
    const stat = await fs.stat(resolved);
    if (!stat.isFile() && !stat.isDirectory()) return null;
    if (stat.isFile() && !/\.(txt|md|markdown|pdf|png|jpg|jpeg|gif|webp|bmp|tiff|mp3|wav|m4a|ogg|flac|mp4|mov|mkv|webm|csv|json|log)$/i.test(resolved)) return null;
    if (stat.isFile() && (/\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|lnk|url|sh|command|desktop|hta|reg|msc|py|pyw|pl|rb|jar|appref-ms|application|workflow|scpt|scptd)$/i.test(resolved) || (platform !== 'win32' && (stat.mode & 0o111)))) return null;
    if (/\.app(?:[\\/]|$)/i.test(resolved)) return null;
    return { path: resolved, directory: stat.isDirectory(), name: parser.basename(resolved) || resolved };
  } catch { return null; }
}
module.exports = { resolveLaunchPath };
