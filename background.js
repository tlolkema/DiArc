import { DEFAULTS, settingsFrom, resolveInput, rankResults, safeUrl, quickActionRows } from './core.js';
import { createFaviconLoader } from './favicons.js';

let stylesheet;
const getFavicon = createFaviconLoader({ getURL: path => chrome.runtime.getURL(path) });

async function readSettings() {
  return settingsFrom(await chrome.storage.local.get(DEFAULTS));
}

function contextFor(sender, requestedMode) {
  if (!sender.tab?.id) throw new Error('Open the command bar in a browser tab.');
  return { mode: requestedMode === 'address' ? 'address' : 'new', tabId: sender.tab.id };
}

async function search(query, sender, mode = 'new') {
  const settings = await readSettings();
  if (typeof query !== 'string' || !query.trim()) return { items: [], settings };
  if (query.length > 2048) throw new Error('Use a query shorter than 2,049 characters.');
  const text = query.trim();
  const action = resolveInput(text, settings.searchEngine);
  const quickActions = quickActionRows(text, settings, mode).slice(0, settings.maxResults - 1);
  const sourceLimit = settings.maxResults - 1 - quickActions.length;
  const lookups = {
    tab: () => chrome.tabs.query({ windowId: sender.tab.windowId }),
    bookmark: () => chrome.bookmarks.search(text),
    history: () => chrome.history.search({ text, startTime: 0, maxResults: 500 })
  };
  const sources = sourceLimit > 0 ? settings.sourceOrder.filter(source => settings.enabledSources.includes(source)) : [];
  // Do not query a source the user disabled.
  const results = await Promise.allSettled(sources.map(source => Promise.resolve().then(lookups[source])));
  const candidates = results.flatMap((result, index) => result.status === 'fulfilled'
    ? result.value.filter(item => item.url).map(item => ({ ...item, source: sources[index] })) : []);
  // The typed action counts toward the user's maximum.
  const matches = rankResults(text, candidates, sourceLimit, Date.now(), settings);
  const items = [{ ...action, source: 'input' }, ...quickActions, ...matches.filter(item => item.url !== action.url)];
  await Promise.all(items.map(async item => {
    if (item.source === 'input' && item.kind === 'search') return;
    const favicon = await getFavicon(item.url);
    if (favicon) item.favicon = favicon;
  }));
  return {
    items,
    settings,
    warning: results.some(result => result.status === 'rejected') ? 'Some browser sources are unavailable.' : ''
  };
}

async function navigate(message, sender) {
  const context = contextFor(sender, message.mode);
  const settings = await readSettings();
  const query = typeof message.query === 'string' ? message.query : '';
  if (query.length > 2048) throw new Error('Use a query shorter than 2,049 characters.');
  let url;
  if (message.actionId) {
    // Resolve actions from current preferences, not a URL supplied by an old result.
    const action = quickActionRows(query, settings, context.mode).find(item => item.actionId === message.actionId);
    if (!action) throw new Error('This action is unavailable. Reopen DiArc and try again.');
    url = action.url;
  } else {
    url = message.url ? safeUrl(message.url) : resolveInput(query, settings.searchEngine)?.url;
  }
  if (!url) throw new Error('Enter a website address or a search.');
  if (context.mode === 'address' && !message.actionId) {
    await chrome.tabs.update(context.tabId, { url, active: true });
  } else {
    await chrome.tabs.create({ url, windowId: sender.tab.windowId, openerTabId: context.tabId });
  }
  return { ok: true };
}

async function indicateAvailability(tabId, available) {
  try {
    await Promise.all([
      chrome.action.setBadgeText({ tabId, text: available ? '' : '!' }),
      chrome.action.setTitle({
        tabId,
        title: available ? 'DiArc · Open command bar' : 'DiArc cannot display an overlay here. Open a normal website and try again.'
      }),
      ...(available ? [] : [chrome.action.setBadgeBackgroundColor({ tabId, color: '#9a463d' })])
    ]);
  } catch { /* A tab can close while its toolbar state updates. */ }
}

async function openPalette(tab, mode) {
  if (!tab?.id) return;
  try {
    // Host permissions cover normal websites. activeTab also supports user-invoked access.
    // The command bar is only an overlay. Never create a launcher or fallback tab.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['palette.js', 'content.js'] });
    stylesheet ||= fetch(chrome.runtime.getURL('palette.css')).then(response => response.text());
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'still:open', mode, css: await stylesheet });
    if (!response?.ok) throw new Error(response?.error || 'The page could not display the overlay.');
    await indicateAvailability(tab.id, true);
  } catch {
    // Chromium forbids overlays on internal pages, extension stores, and some viewers.
    await indicateAvailability(tab.id, false);
  }
}

chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason !== 'install') return;
  try {
    await chrome.runtime.openOptionsPage();
  } catch (error) {
    console.warn('DiArc could not open Settings after installation.', error);
  }
});

chrome.commands.onCommand.addListener(async command => {
  if (!['new-tab', 'edit-address'].includes(command)) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await openPalette(tab, command === 'edit-address' ? 'address' : 'new');
});
chrome.action.onClicked.addListener(tab => { void openPalette(tab, 'new'); });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('still:')) return;
  const handle = async () => {
    if (message.type === 'still:settings') return { settings: await readSettings(), commands: await chrome.commands.getAll() };
    if (!sender.tab) throw new Error('A browser tab is required.');
    if (message.type === 'still:init') {
      const context = contextFor(sender, message.mode);
      const tab = await chrome.tabs.get(context.tabId);
      return { ...context, currentUrl: tab.url || '', settings: await readSettings() };
    }
    if (message.type === 'still:search') return search(message.query, sender, message.mode);
    if (message.type === 'still:navigate') return navigate(message, sender);
    throw new Error('Unknown command. Reload the extension and try again.');
  };
  handle().then(respond, error => respond({ error: error.message || 'The browser could not complete this action.' }));
  return true;
});
