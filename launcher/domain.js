function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
}

const pinyinCache = new Map();
function pinyinSearchText(value) {
  const text = String(value || '');
  if (!text) return { full: '', initials: '' };
  const cached = pinyinCache.get(text);
  if (cached) return cached;
  let full = '', initials = '';
  try {
    const converter = typeof globalThis !== 'undefined' && globalThis.pinyinPro?.pinyin;
    const nodeConverter = typeof module !== 'undefined' ? require('pinyin-pro').pinyin : null;
    const pinyin = converter || nodeConverter;
    if (pinyin) {
      full = normalizeText(pinyin(text, { toneType: 'none' })).replace(/\s+/g, '');
      initials = normalizeText(pinyin(text, { pattern: 'first', toneType: 'none' })).replace(/\s+/g, '');
    }
  } catch {}
  const result = { full, initials };
  if (pinyinCache.size > 20000) pinyinCache.delete(pinyinCache.keys().next().value);
  pinyinCache.set(text, result);
  return result;
}

function searchFields(value) {
  const text = normalizeText(value);
  const pinyin = pinyinSearchText(value);
  return [text, pinyin.full, pinyin.initials].filter(Boolean);
}

function scoreResult(result, query, aliases = {}) {
  const q = normalizeText(query);
  if (!q) return (result.favorite ? 1000000 : 0) + Math.min(999999, Math.max(0, Number(result.usage?.lastUsedAt || 0) / 1e7)) + Math.min(100, Number(result.usage?.count || 0));
  const compactQuery = q.replace(/\s+/g, '');
  const alias = result.persistable === false ? '' : normalizeText(aliases[result.id]);
  const title = normalizeText(result.title);
  const subtitle = normalizeText(result.subtitle);
  const keywords = (result.keywords || []).map(normalizeText);
  const directFields = [alias, title, subtitle, ...keywords].filter(Boolean);
  const expandedFields = [alias, title, subtitle, ...keywords].flatMap(searchFields);
  const exactPinyin = (value) => {
    const fields = searchFields(value);
    return fields.includes(compactQuery) || fields.some((field) => field.startsWith(compactQuery));
  };
  if (alias === q || (alias && exactPinyin(alias))) return 10000;
  if (alias.startsWith(q) || (alias && searchFields(alias).some((field) => field.startsWith(compactQuery)))) return 8000 - alias.length;
  if (title === q || exactPinyin(result.title)) return 7000;
  if (title.startsWith(q) || searchFields(result.title).some((field) => field.startsWith(compactQuery))) return 6000 - Math.min(1000, title.length);
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.every((token) => expandedFields.some((field) => field.includes(token) || field.includes(token.replace(/\s+/g, ''))))) {
    let cursor = 0;
    for (const char of title) if (char === q[cursor]) cursor++;
    if (cursor !== q.length && !expandedFields.some((field) => {
      let index = 0;
      for (const char of compactQuery) { index = field.indexOf(char, index) + 1; if (!index) return false; }
      return true;
    })) return -1;
  }
  let score = 1000 - Math.min(600, directFields.join(' ').indexOf(q) < 0 ? 100 : directFields.join(' ').indexOf(q));
  if (expandedFields.some((field) => field.includes(compactQuery))) score += 180;
  if (result.favorite) score += 300;
  score += Math.min(200, Number(result.usage?.count || 0) * 4);
  return score;
}

function searchLauncherResults(results, query, aliases = {}, limit = 50) {
  return (Array.isArray(results) ? results : [])
    .map((result, index) => ({ result, score: scoreResult(result, query, aliases), index }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((entry) => entry.result);
}

function describeLauncherResult(result) {
  const prefix = result.id.split(':')[0];
  const labels = { app: '应用', note: '笔记', todo: '待办', link: '链接', command: '常用指令', clip: '剪贴板', builtin: '快捷操作', path: '文件与目录' };
  const actions = [
    { id: 'primary', title: result.kind === 'app' ? '打开应用' : result.kind === 'copy' ? '复制' : result.kind === 'navigate' ? '打开来源' : '打开 / 执行', confirmation: result.confirmation || 'none', risk: result.risk || 'safe' },
    { id: 'favorite', title: '收藏', confirmation: 'none', risk: 'safe' },
    { id: 'copy-title', title: '复制名称', confirmation: 'none', risk: 'safe' },
    { id: 'alias', title: '别名', confirmation: 'none', risk: 'safe' },
  ];
  if(result.kind==='app') {
    const modifier=result.platform==='darwin'?'⌘':'Ctrl';
    for(const mode of result.appModes||[]) {
      const spec={admin:['以管理员身份运行','Ctrl+Shift+Enter'],new:['新开窗口',`${modifier}+Enter`],focus:['切换到已打开窗口',result.platform==='darwin'?'⌥+Enter':'Alt+Enter']}[mode];
      if(spec)actions.push({id:`app-${mode}`,mode,title:spec[0],shortcut:spec[1],confirmation:mode==='admin'?'system':'none',risk:mode==='admin'?'elevated':'safe'});
    }
  }
  if (result.copyTarget || result.target?.url || result.target?.text) actions.push({ id: 'copy-content', title: '复制内容', confirmation: 'none', risk: 'safe' });
  if (result.kind === 'url' && result.target?.id) actions.push({ id: 'source', title: '打开来源', confirmation: 'none', risk: 'safe' });
  const persistent = result.persistable !== false && result.kind !== 'path' && result.id !== 'builtin:url' && !result.id.startsWith('url:');
  return { ...result, persistable: persistent, source: result.source || { id: prefix, label: labels[prefix] || '扩展' }, risk: result.risk || 'safe', actions: persistent ? actions : actions.filter(a => !['favorite', 'alias'].includes(a.id)) };
}

function mergeLauncherResults(groups) {
  const seen = new Set();
  return groups.flatMap((group) => Array.isArray(group) ? group : []).filter((result) => {
    if (!result || !result.id || seen.has(result.id)) return false;
    seen.add(result.id);
    return true;
  });
}

if (typeof module !== 'undefined') module.exports = { normalizeText, scoreResult, searchLauncherResults, mergeLauncherResults, describeLauncherResult };
else window.LauncherDomain = { normalizeText, scoreResult, searchLauncherResults, mergeLauncherResults, describeLauncherResult };
