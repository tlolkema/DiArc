import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let onMessage, onCommand, onAction, onInstalled, values, tabs, bookmarks, history, calls, injectionFails, historyFails, sourceCalls;
const event = setter => ({ addListener: setter });
globalThis.chrome = {
  runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onMessage: event(fn => { onMessage = fn; }), onInstalled: event(fn => { onInstalled = fn; }), openOptionsPage: async () => { calls.push(['options']); } },
  storage: { local: { get: async defaults => ({ ...defaults, ...values }) } },
  commands: { onCommand: event(fn => { onCommand = fn; }), getAll: async () => [] },
  action: {
    onClicked: event(fn => { onAction = fn; }),
    setBadgeText: async change => { calls.push(['badge', change]); },
    setTitle: async change => { calls.push(['title', change]); },
    setBadgeBackgroundColor: async change => { calls.push(['badgeColor', change]); }
  },
  scripting: { executeScript: async args => { calls.push(['inject', args]); if (injectionFails) throw new Error('Restricted'); } },
  bookmarks: { search: async () => { sourceCalls.push('bookmark'); return bookmarks; } },
  history: { search: async () => { sourceCalls.push('history'); if (historyFails) throw new Error('Unavailable'); return history; } },
  tabs: {
    query: async filter => { sourceCalls.push('tab'); return [...tabs.values()].filter(tab => (!filter.windowId || tab.windowId === filter.windowId) && (!filter.active || tab.active)); },
    get: async id => { if (!tabs.has(id)) throw new Error('Tab closed'); return tabs.get(id); },
    update: async (id, change) => { if (!tabs.has(id)) throw new Error('Tab closed'); calls.push(['update', id, change]); tabs.set(id, { ...tabs.get(id), ...change }); },
    create: async change => { calls.push(['create', change]); return { id: 99, ...change }; },
    remove: async id => { calls.push(['remove', id]); tabs.delete(id); },
    sendMessage: async (id, message) => { calls.push(['send', id, message]); return { ok: true }; }
  }
};
globalThis.fetch = async () => ({ text: async () => '.still-layer{}' });
await import('../background.js');

beforeEach(() => {
  values = {}; bookmarks = []; history = []; calls = []; sourceCalls = []; injectionFails = false; historyFails = false;
  tabs = new Map([[1, { id: 1, url: 'https://original.example/', windowId: 10, active: true }], [2, { id: 2, url: 'https://second.example/', windowId: 10 }]]);
});
const sender = (id = 1, url = tabs.get(id)?.url) => ({ id: 'test', url, tab: { ...tabs.get(id) } });
const message = (payload, from = sender()) => new Promise(resolve => onMessage(payload, from, resolve));

test('first installation opens Settings automatically', async () => {
  await onInstalled({ reason: 'install' });
  assert.deepEqual(calls, [['options']]);
});
test('updates and browser upgrades do not open Settings', async () => {
  for (const reason of ['update', 'chrome_update', 'shared_module_update']) await onInstalled({ reason });
  assert.deepEqual(calls, []);
});
test('initial address is the full URL, new mode has separate context', async () => {
  const context = await message({ type: 'still:init', mode: 'address' });
  assert.equal(context.currentUrl, 'https://original.example/');
  assert.equal(context.mode, 'address');
  assert.equal(context.tabId, 1);
});
test('new mode from website opens a fresh tab, leaving the source unchanged', async () => {
  assert.deepEqual(await message({ type: 'still:navigate', mode: 'new', query: 'example.com' }), { ok: true });
  assert.equal(calls[0][0], 'create');
  assert.equal(calls[0][1].url, 'https://example.com/');
  assert.equal(tabs.get(1).url, 'https://original.example/');
});
test('address mode navigates the same tab', async () => {
  await message({ type: 'still:navigate', mode: 'address', query: 'example.com' });
  assert.equal(tabs.get(1).url, 'https://example.com/');
  assert.equal(calls.some(call => call[0] === 'create'), false);
});
test('opening either overlay mode never opens or navigates a tab', async () => {
  await onCommand('new-tab');
  await onCommand('edit-address');
  assert.equal(calls.some(call => ['create', 'update', 'remove'].includes(call[0])), false);
  assert.equal(tabs.get(1).url, 'https://original.example/');
});
test('protected pages show a toolbar warning, never a fallback page', async () => {
  injectionFails = true;
  await onCommand('edit-address');
  assert.equal(calls.some(call => ['create', 'update', 'remove'].includes(call[0])), false);
  assert.equal(calls.find(call => call[0] === 'badge')[1].text, '!');
  assert.match(calls.find(call => call[0] === 'title')[1].title, /cannot display an overlay here/);
});
test('URL parameters cannot redirect address mode to another tab', async () => {
  await message({ type: 'still:navigate', mode: 'address', query: 'example.com' }, sender(2, 'https://second.example/?target=1&mode=new'));
  assert.equal(tabs.get(1).url, 'https://original.example/');
  assert.equal(tabs.get(2).url, 'https://example.com/');
});
test('search starts empty, combines sources, and respects total cap', async () => {
  assert.deepEqual((await message({ type: 'still:search', query: '' })).items, []);
  values.maxResults = 3;
  tabs.set(3, { id: 3, windowId: 10, title: 'Design work', url: 'https://design.example/tabs' });
  bookmarks = [{ title: 'Design work', url: 'https://design.example/bookmarks' }];
  history = [{ title: 'Design work', url: 'https://design.example/history' }];
  const result = await message({ type: 'still:search', query: 'design' });
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map(item => item.source), ['input', 'tab', 'bookmark']);
});
test('disabled sources are not queried and cannot produce failure warnings', async () => {
  values.enabledSources = ['bookmark'];
  historyFails = true;
  bookmarks = [{ title: 'Design', url: 'https://design.example/bookmark' }];
  const result = await message({ type: 'still:search', query: 'design' });
  assert.deepEqual(sourceCalls, ['bookmark']);
  assert.deepEqual(result.items.map(item => item.source), ['input', 'bookmark']);
  assert.equal(result.warning, '');
});
test('all sources disabled still allow typed searches without querying browser data', async () => {
  values.enabledSources = [];
  const result = await message({ type: 'still:search', query: 'design' });
  assert.deepEqual(sourceCalls, []);
  assert.deepEqual(result.items.map(item => item.source), ['input']);
  assert.equal(result.items[0].kind, 'search');
});
test('configured source priority applies before the total result cap', async () => {
  values.maxResults = 3;
  values.sourceOrder = ['history', 'bookmark', 'tab'];
  tabs.set(3, { id: 3, windowId: 10, title: 'design', url: 'https://design.example/tab' });
  bookmarks = [{ title: 'Design work', url: 'https://design.example/bookmark' }];
  history = [{ title: 'Old work', url: 'https://other.example/design' }];
  const result = await message({ type: 'still:search', query: 'design' });
  assert.deepEqual(sourceCalls, ['history', 'bookmark', 'tab']);
  assert.deepEqual(result.items.map(item => item.source), ['input', 'history', 'bookmark']);
});
test('enabled quick actions precede source matches and respect the total cap', async () => {
  values.enabledQuickActions = ['chatgpt', 'claude'];
  values.maxResults = 3;
  const result = await message({ type: 'still:search', query: 'design' });
  assert.deepEqual(result.items.map(item => item.actionId || item.source), ['input', 'chatgpt', 'claude']);
  assert.deepEqual(sourceCalls, []);
});
test('custom action navigation resolves the saved template and opens a new tab', async () => {
  values.customActions = [{ id: 'github', label: 'GitHub', urlTemplate: 'https://github.com/search?q={query}', enabled: true }];
  const result = await message({ type: 'still:navigate', mode: 'address', query: 'cats & dogs', actionId: 'custom:github', url: 'javascript:alert(1)' });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0][0], 'create');
  assert.equal(calls[0][1].url, 'https://github.com/search?q=cats%20%26%20dogs');
  assert.equal(tabs.get(1).url, 'https://original.example/');
});
test('disabled actions reject stale selections without opening or navigating a tab', async () => {
  values.enabledQuickActions = [];
  values.customActions = [{ id: 'github', label: 'GitHub', urlTemplate: 'https://github.com/search?q={query}', enabled: false }];
  for (const actionId of ['chatgpt', 'custom:github', 'custom:unknown']) {
    assert.ok((await message({ type: 'still:navigate', mode: 'new', query: 'cats', actionId })).error);
  }
  assert.equal(calls.length, 0);
});
test('explicit new-tab quick action leaves the address-mode source unchanged', async () => {
  values.enabledQuickActions = ['new-tab'];
  await message({ type: 'still:navigate', mode: 'address', query: 'example.com', actionId: 'new-tab' });
  assert.equal(calls[0][0], 'create');
  assert.equal(tabs.get(1).url, 'https://original.example/');
});
test('partial source failures do not disable all search', async () => {
  historyFails = true;
  bookmarks = [{ title: 'Design', url: 'https://design.example' }];
  const result = await message({ type: 'still:search', query: 'design' });
  assert.equal(result.items.length, 2);
  assert.ok(result.warning);
});
test('unsafe result URLs are rejected at navigation boundary', async () => {
  const result = await message({ type: 'still:navigate', mode: 'address', url: 'javascript:alert(1)' });
  assert.ok(result.error);
  assert.equal(calls.length, 0);
});
test('closed source tabs produce an error without opening another tab', async () => {
  const from = sender();
  tabs.delete(1);
  assert.ok((await message({ type: 'still:navigate', mode: 'address', query: 'example.com' }, from)).error);
  assert.equal(calls.some(call => call[0] === 'create'), false);
});
test('commands inject on demand and successful opens clear the toolbar warning', async () => {
  await onCommand('new-tab');
  assert.equal(calls[0][0], 'inject');
  assert.equal(calls[1][2].mode, 'new');
  assert.equal(calls.find(call => call[0] === 'badge')[1].text, '');
});
test('native browser new-tab pages never receive a replacement launcher', async () => {
  tabs.get(1).url = 'chrome://newtab/';
  injectionFails = true;
  await onCommand('new-tab');
  assert.equal(calls.some(call => call[0] === 'create'), false);
  assert.equal(calls.find(call => call[0] === 'badge')[1].text, '!');
});
test('toolbar opens new-tab mode', async () => {
  onAction(tabs.get(1));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.find(call => call[0] === 'send')[2].mode, 'new');
});
test('public branding is DiArc and package metadata matches the extension', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(manifest.name, 'DiArc');
  assert.equal(manifest.description, 'Bring back a beautiful Arc-like floating command bar in Dia. Customizable, fast, minimal.');
  assert.equal(metadata.name, 'diarc-command-bar');
  assert.equal(metadata.version, manifest.version);
  for (const file of ['README.md', 'options.html', 'options.js', 'palette.js']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(text, /DiArc/);
    assert.doesNotMatch(text, /\b(?:Still|Float)\b/);
  }
});
test('settings show the supplied logo before DiArc without a command-page link', async () => {
  const options = await readFile(new URL('../options.html', import.meta.url), 'utf8');
  assert.match(options, /class="brand"[^>]*><img class="brand-mark"[^>]*src="icons\/diarc-swoosh-256\.png"[^>]*><span>DiArc<\/span><\/a>/);
  assert.match(options, /class="brand-subline"/);
  assert.doesNotMatch(options, /wordmark-dot|privacy-dot|newtab\.html/);
});
test('extension logo assets are optimized square PNGs at the declared sizes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  for (const size of [16, 32, 48, 128]) {
    assert.equal(manifest.icons[size], `icons/diarc-swoosh-${size}.png`);
    if (size <= 32) assert.equal(manifest.action.default_icon[size], manifest.icons[size]);
    const png = await readFile(new URL(`../icons/diarc-swoosh-${size}.png`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.ok(png.length < 20000);
  }
  const settingsLogo = await readFile(new URL('../icons/diarc-swoosh-256.png', import.meta.url));
  assert.equal(settingsLogo.readUInt32BE(16), 256);
  assert.equal(settingsLogo.readUInt32BE(20), 256);
  assert.ok(settingsLogo.length < 64000);
});
test('keyboard setup is first in settings with a prominent clickable configuration URL', async () => {
  const options = await readFile(new URL('../options.html', import.meta.url), 'utf8');
  assert.ok(options.indexOf('<section id="keyboard"') < options.indexOf('<form id="settings"'));
  assert.match(options, /id="shortcut-settings-link"[^>]*href="chrome:\/\/extensions\/shortcuts"/);
  assert.match(options, /<code>chrome:\/\/extensions\/shortcuts<\/code>/);
  assert.match(options, /If your browser supports native shortcut remapping, first unassign/);
  assert.match(options, /id="recommended-new-shortcut"/);
  assert.match(options, /id="recommended-address-shortcut"/);
  assert.doesNotMatch(options, /shortcut-details|About native browser shortcuts/);
});
test('extension has no new-tab override or launcher files', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.equal(manifest.chrome_url_overrides, undefined);
  for (const file of ['newtab.html', 'newtab.css', 'newtab.js']) {
    await assert.rejects(readFile(new URL(`../${file}`, import.meta.url)), { code: 'ENOENT' });
  }
});
test('Customize exposes dimensions, blur, and optional actions without Perplexity', async () => {
  const options = await readFile(new URL('../options.html', import.meta.url), 'utf8');
  for (const name of ['overlayWidth', 'overlayHeight', 'backgroundBlur', 'enabledQuickActions']) assert.ok(options.includes(`name="${name}"`));
  assert.match(options, /id="add-custom-action"/);
  assert.match(options, /value="chatgpt"/);
  assert.match(options, /value="claude"/);
  assert.doesNotMatch(options, /perplexity/i);
});
test('settings autosave without a button and prevent edits before preferences load', async () => {
  const options = await readFile(new URL('../options.html', import.meta.url), 'utf8');
  assert.match(options, /<fieldset id="settings-fields" disabled\b/);
  assert.match(options, /Changes save automatically on this browser/);
  assert.doesNotMatch(options, /type="submit"|save-button|Save changes|Save preferences/);
});
test('all-site access covers web pages without automatic content scripts', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.ok(manifest.permissions.includes('activeTab'));
});
