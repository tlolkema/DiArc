export const SOURCES = Object.freeze(['tab', 'bookmark', 'history']);
export const QUICK_ACTIONS = Object.freeze(['new-tab', 'chatgpt', 'claude']);
export const DEFAULTS = Object.freeze({
  maxResults: 3,
  searchEngine: 'google',
  theme: 'system',
  enabledSources: SOURCES,
  sourceOrder: SOURCES,
  overlayWidth: '75vh',
  overlayHeight: '75vh',
  backgroundBlur: true,
  enabledQuickActions: Object.freeze([]),
  customActions: Object.freeze([])
});
export const ENGINES = Object.freeze({
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q='
});

export function validOverlayLength(value, axis) {
  if (typeof value !== 'string') return false;
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d{1,2})?)(px|vw|vh|%)$/);
  if (!match) return false;
  const amount = Number(match[1]), unit = match[2];
  if (unit === 'px') return amount >= (axis === 'width' ? 280 : 160) && amount <= (axis === 'width' ? 1600 : 1200);
  return (unit === '%' || unit === 'vh' || (axis === 'width' && unit === 'vw')) && amount >= 20 && amount <= 100;
}

export function validActionTemplate(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\u0000-\u001f]/.test(value)) return false;
  try {
    const url = new URL(value.trim().replaceAll('{query}', 'diarc-query-placeholder'));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hostname.includes('diarc-query-placeholder');
  } catch { return false; }
}

export function normalizeCustomAction(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[\w-]{1,64}$/.test(value.id)) return null;
  if (typeof value.label !== 'string' || !value.label.trim() || value.label.trim().length > 48 || !validActionTemplate(value.urlTemplate)) return null;
  return { id: value.id, label: value.label.trim(), urlTemplate: value.urlTemplate.trim(), enabled: value.enabled !== false };
}

export function settingsFrom(value = {}) {
  const count = Number(value.maxResults);
  const validSources = list => [...new Set(list.filter(source => SOURCES.includes(source)))];
  const enabledSources = Array.isArray(value.enabledSources) ? validSources(value.enabledSources) : [...SOURCES];
  const ordered = Array.isArray(value.sourceOrder) ? validSources(value.sourceOrder) : [];
  const sourceOrder = [...ordered, ...SOURCES.filter(source => !ordered.includes(source))];
  const backgroundBlur = typeof value.backgroundBlur === 'boolean' ? value.backgroundBlur
    : (typeof value.backgroundBlur === 'number' && Number.isFinite(value.backgroundBlur) ? value.backgroundBlur > 0 : DEFAULTS.backgroundBlur);
  const enabledQuickActions = Array.isArray(value.enabledQuickActions)
    ? [...new Set(value.enabledQuickActions.filter(action => QUICK_ACTIONS.includes(action)))] : [...DEFAULTS.enabledQuickActions];
  const seenActions = new Set();
  const customActions = (Array.isArray(value.customActions) ? value.customActions : [])
    .map(normalizeCustomAction).filter(action => {
      if (!action || seenActions.has(action.id)) return false;
      seenActions.add(action.id);
      return true;
    }).slice(0, 12);
  return {
    maxResults: Number.isFinite(count) ? Math.max(1, Math.min(20, Math.round(count))) : DEFAULTS.maxResults,
    searchEngine: Object.hasOwn(ENGINES, value.searchEngine) ? value.searchEngine : DEFAULTS.searchEngine,
    theme: ['light', 'dark', 'system'].includes(value.theme) ? value.theme : DEFAULTS.theme,
    enabledSources,
    sourceOrder,
    overlayWidth: validOverlayLength(value.overlayWidth, 'width') ? value.overlayWidth.trim().toLowerCase() : DEFAULTS.overlayWidth,
    overlayHeight: validOverlayLength(value.overlayHeight, 'height') ? value.overlayHeight.trim().toLowerCase() : DEFAULTS.overlayHeight,
    backgroundBlur,
    enabledQuickActions,
    customActions
  };
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (['http:', 'https:', 'file:', 'chrome:', 'edge:', 'brave:', 'dia:', 'about:'].includes(url.protocol)) return url.href;
  } catch { /* Not a complete URL. */ }
  return null;
}

export function resolveInput(input, engine = 'google') {
  const text = String(input).trim();
  if (!text) return null;
  const explicit = safeUrl(text);
  if (explicit) return { url: explicit, kind: 'navigate', title: text };
  // Never execute schemes supplied by history, bookmarks, or pasted input.
  const hostLike = /^(?:localhost|(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+|\[[\da-f:]+\])(?::\d{1,5})?(?:[/?#][^\s]*)?$/iu;
  const localPort = /^(?:localhost|[\w.-]+):\d{1,5}(?:[/?#][^\s]*)?$/i;
  if (!/\s/.test(text) && (hostLike.test(text) || localPort.test(text))) {
    const local = /^(?:localhost|127\.|\[::1\]|[\w-]+:\d)/i.test(text);
    const url = safeUrl(`${local ? 'http' : 'https'}://${text}`);
    if (url) return { url, kind: 'navigate', title: text };
  }
  const prefix = Object.hasOwn(ENGINES, engine) ? ENGINES[engine] : ENGINES.google;
  return { url: prefix + encodeURIComponent(text), kind: 'search', title: `Search for “${text}”` };
}

export function quickActionRows(query, preferences = DEFAULTS, mode = 'new') {
  const text = String(query).trim();
  if (!text) return [];
  const settings = settingsFrom(preferences);
  const actions = [];
  if (mode === 'address' && settings.enabledQuickActions.includes('new-tab')) {
    actions.push({ actionId: 'new-tab', title: 'Open in a new tab', url: resolveInput(text, settings.searchEngine).url });
  }
  const builtins = [
    ['chatgpt', 'Ask ChatGPT', 'https://chatgpt.com/?q={query}'],
    ['claude', 'Ask Claude', 'https://claude.ai/new?q={query}']
  ];
  const expand = template => new URL(template.replaceAll('{query}', encodeURIComponent(text))).href;
  for (const [id, title, template] of builtins) {
    if (settings.enabledQuickActions.includes(id)) actions.push({ actionId: id, title, url: expand(template) });
  }
  for (const action of settings.customActions) {
    if (action.enabled) actions.push({ actionId: `custom:${action.id}`, title: action.label, url: expand(action.urlTemplate) });
  }
  return actions.map(action => ({ ...action, source: 'action' }));
}

function relevance(item, query, now) {
  const title = (item.title || '').toLowerCase();
  const url = item.url.toLowerCase();
  const terms = query.toLowerCase().trim().split(/\s+/);
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* Already filtered. */ }
  if (!terms.every(term => title.includes(term) || url.includes(term))) return -1;
  let score = 0;
  for (const term of terms) {
    if (host === term) score += 160;
    else if (host.startsWith(term)) score += 95;
    else if (host.includes(term)) score += 50;
    if (title === term) score += 110;
    else if (title.startsWith(term)) score += 65;
    else if (title.includes(term)) score += 35;
    if (url.includes(term)) score += 10;
  }
  if (item.lastVisitTime || item.lastAccessed) {
    const ageDays = Math.max(0, (now - (item.lastVisitTime || item.lastAccessed)) / 86400000);
    score += 20 / (1 + ageDays / 7);
  }
  score += Math.min(12, Math.log2(1 + (item.visitCount || 0)) * 2);
  return score;
}

export function rankResults(query, candidates, limit = DEFAULTS.maxResults, now = Date.now(), preferences = DEFAULTS) {
  if (!query.trim()) return [];
  const { enabledSources, sourceOrder } = settingsFrom(preferences);
  const lastVisit = item => Number.isFinite(item.lastVisitTime) ? item.lastVisitTime : 0;
  const compare = (a, b) => sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source)
    // History is chronological. Match quality only breaks equal visit times.
    || (a.source === 'history' && b.source === 'history' ? lastVisit(b) - lastVisit(a) : 0)
    || b.score - a.score || a.url.localeCompare(b.url);
  const unique = new Map();
  for (const candidate of candidates) {
    if (!enabledSources.includes(candidate.source)) continue;
    const url = safeUrl(candidate.url);
    if (!url) continue;
    const item = { ...candidate, url };
    const score = relevance(item, query, now);
    if (score < 0) continue;
    const ranked = { ...item, score };
    const previous = unique.get(url);
    if (!previous || compare(ranked, previous) < 0) unique.set(url, ranked);
  }
  return [...unique.values()]
    .sort(compare)
    .slice(0, Math.max(0, limit));
}
