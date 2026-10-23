import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, settingsFrom, safeUrl, resolveInput, rankResults, validOverlayLength, validActionTemplate, normalizeCustomAction, quickActionRows } from '../core.js';

test('settings have defaults and bounded result limits', () => {
  assert.deepEqual(settingsFrom(), DEFAULTS);
  assert.equal(DEFAULTS.overlayWidth, '75vh');
  assert.equal(DEFAULTS.overlayHeight, '75vh');
  assert.deepEqual(DEFAULTS.enabledQuickActions, []);
  assert.equal(settingsFrom({ maxResults: 90 }).maxResults, 20);
  assert.equal(settingsFrom({ maxResults: -2 }).maxResults, 1);
  assert.equal(settingsFrom({ maxResults: '6' }).maxResults, 6);
  assert.equal(settingsFrom({ maxResults: 'bad' }).maxResults, 8);
  assert.equal(settingsFrom({ searchEngine: '__proto__', theme: 'pink' }).searchEngine, 'google');
});

test('source settings migrate old preferences and preserve all-disabled state', () => {
  assert.deepEqual(settingsFrom({ theme: 'dark' }).enabledSources, ['tab', 'bookmark', 'history']);
  assert.deepEqual(settingsFrom({ enabledSources: [] }).enabledSources, []);
  const normalized = settingsFrom({ enabledSources: ['history', 'history', 'unknown'], sourceOrder: ['history', 'history', 'unknown'] });
  assert.deepEqual(normalized.enabledSources, ['history']);
  assert.deepEqual(normalized.sourceOrder, ['history', 'tab', 'bookmark']);
  assert.deepEqual(settingsFrom({ sourceOrder: null, enabledSources: false }).sourceOrder, DEFAULTS.sourceOrder);
  const copy = settingsFrom();
  copy.sourceOrder.reverse();
  copy.enabledSources.pop();
  assert.deepEqual(DEFAULTS.sourceOrder, ['tab', 'bookmark', 'history']);
  assert.equal(DEFAULTS.enabledSources.length, 3);
});

test('overlay dimensions accept bounded CSS lengths, not arbitrary CSS', () => {
  for (const value of ['680px', '50vw', '75vh', '85%', ' 750PX ']) assert.equal(validOverlayLength(value, 'width'), true);
  for (const value of ['75vh', '600px', '80%']) assert.equal(validOverlayLength(value, 'height'), true);
  for (const value of ['10px', '2000px', '10vw', '110%', 'calc(100vw)', 'url(https://evil.example)', '50vw; color:red']) assert.equal(validOverlayLength(value, 'width'), false);
  const values = settingsFrom({ overlayWidth: 'bad', overlayHeight: '50vh', backgroundBlur: 90 });
  assert.equal(values.overlayWidth, '75vh');
  assert.equal(values.overlayHeight, '50vh');
  assert.equal(values.backgroundBlur, true);
  assert.equal(settingsFrom({ backgroundBlur: 0 }).backgroundBlur, false);
  assert.equal(settingsFrom({ backgroundBlur: false }).backgroundBlur, false);
  assert.equal(settingsFrom({ backgroundBlur: true }).backgroundBlur, true);
  assert.equal(settingsFrom({ backgroundBlur: 5 }).backgroundBlur, true);
});

test('custom action templates allow only HTTP(S) with a fixed host', () => {
  for (const template of ['https://example.com/search?q={query}', 'http://localhost:3000/{query}', 'https://example.com/']) assert.equal(validActionTemplate(template), true);
  for (const template of ['javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'https://{query}.example.com/', 'https://example.com@{query}/', 'https://user:password@example.com/', 'https://example.com/\n{query}', 'example.com/{query}']) assert.equal(validActionTemplate(template), false);
});

test('custom action settings normalize, deduplicate IDs, and cap at twelve', () => {
  const action = { id: 'github', label: ' GitHub ', urlTemplate: 'https://github.com/search?q={query}', enabled: false };
  assert.equal(normalizeCustomAction(action).label, 'GitHub');
  assert.equal(normalizeCustomAction({ ...action, label: '' }), null);
  const values = settingsFrom({ customActions: [action, action, { ...action, id: 'bad', urlTemplate: 'javascript:alert(1)' }] });
  assert.equal(values.customActions.length, 1);
  assert.equal(values.customActions[0].enabled, false);
  assert.equal(settingsFrom({ customActions: Array.from({ length: 20 }, (_, i) => ({ ...action, id: `a-${i}` })) }).customActions.length, 12);
});

test('quick actions are optional, exclude Perplexity, and stay hidden before typing', () => {
  assert.deepEqual(quickActionRows('hello'), []);
  const preferences = { enabledQuickActions: ['chatgpt', 'claude', 'perplexity'] };
  assert.deepEqual(quickActionRows('', preferences), []);
  assert.deepEqual(quickActionRows('hello', preferences).map(action => action.actionId), ['chatgpt', 'claude']);
});

test('new-tab quick action appears only as an extra in address mode', () => {
  assert.deepEqual(quickActionRows('example.com', DEFAULTS, 'new'), []);
  assert.deepEqual(quickActionRows('example.com', DEFAULTS, 'address'), []);
  const actions = quickActionRows('example.com', { enabledQuickActions: ['new-tab'] }, 'address');
  assert.equal(actions[0].actionId, 'new-tab');
  assert.equal(actions[0].url, 'https://example.com/');
  assert.deepEqual(quickActionRows('example.com', { enabledQuickActions: [] }, 'address'), []);
});

test('custom quick actions encode query text without changing the destination', () => {
  const customActions = [
    { id: 'github', label: 'Search GitHub', urlTemplate: 'https://github.com/search?q={query}' },
    { id: 'off', label: 'Disabled', urlTemplate: 'https://example.com/{query}', enabled: false }
  ];
  const actions = quickActionRows('C++ & cats?', { customActions });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].actionId, 'custom:github');
  assert.equal(actions[0].url, 'https://github.com/search?q=C%2B%2B%20%26%20cats%3F');
  assert.equal(actions[0].source, 'action');
});

test('resolves URLs, local development hosts, and search text', () => {
  assert.equal(resolveInput('  example.com/path?q=1  ').url, 'https://example.com/path?q=1');
  assert.equal(resolveInput('https://example.com').url, 'https://example.com/');
  assert.equal(resolveInput('localhost:3000').url, 'http://localhost:3000/');
  assert.equal(resolveInput('127.0.0.1:8080/a').url, 'http://127.0.0.1:8080/a');
  assert.equal(resolveInput('[::1]:8080').url, 'http://[::1]:8080/');
  assert.equal(resolveInput('docs:3000').url, 'http://docs:3000/');
  assert.equal(resolveInput('example.com:3000').url, 'https://example.com:3000/');
  assert.equal(resolveInput('chrome://settings').url, 'chrome://settings');
  assert.equal(resolveInput('find good coffee', 'duckduckgo').url, 'https://duckduckgo.com/?q=find%20good%20coffee');
  assert.equal(resolveInput('coffee', 'bing').url, 'https://www.bing.com/search?q=coffee');
  assert.equal(resolveInput('coffee', '__proto__').kind, 'search');
  assert.equal(resolveInput('   '), null);
});

test('never executes unsafe or unsupported URL schemes', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'vbscript:msgbox(1)', 'ftp://example.com', 'chrome-extension://other/page.html']) {
    assert.equal(safeUrl(url), null);
    assert.equal(resolveInput(url).kind, 'search');
  }
});

const candidate = (source, url, title = 'Design resources', extras = {}) => ({ source, url, title, ...extras });
test('no results until typing, even when candidates exist', () => {
  assert.deepEqual(rankResults(' ', [candidate('tab', 'https://design.example')]), []);
});
test('comparable results favor tabs, then bookmarks, then history', () => {
  const items = rankResults('design', [candidate('history', 'https://design.example/c'), candidate('bookmark', 'https://design.example/b'), candidate('tab', 'https://design.example/a')]);
  assert.deepEqual(items.map(item => item.source), ['tab', 'bookmark', 'history']);
});
test('deduplicates exact URLs and keeps the highest-ranked source', () => {
  const items = rankResults('design', ['history', 'bookmark', 'tab'].map(source => candidate(source, 'https://design.example')));
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'tab');
});
test('requires all query words, caps results, and filters unsafe entries', () => {
  const items = [candidate('tab', 'https://design.example', 'Design systems'), candidate('history', 'https://example.com', 'Design blog'), candidate('bookmark', 'javascript:design', 'Design systems')];
  assert.equal(rankResults('design systems', items).length, 1);
  assert.equal(rankResults('design', items, 1).length, 1);
  assert.equal(rankResults('design', items, 0).length, 0);
});
test('custom source order takes priority over match strength', () => {
  const items = rankResults('design', [
    candidate('tab', 'https://design.example/tab', 'design'),
    candidate('bookmark', 'https://design.example/bookmark'),
    candidate('history', 'https://other.example/design', 'Old page')
  ], 8, Date.now(), { sourceOrder: ['history', 'bookmark', 'tab'] });
  assert.deepEqual(items.map(item => item.source), ['history', 'bookmark', 'tab']);
});
test('disabled sources and unknown sources never appear', () => {
  const candidates = ['tab', 'bookmark', 'history', 'unknown'].map(source => candidate(source, `https://design.example/${source}`));
  assert.deepEqual(rankResults('design', candidates, 8, Date.now(), { enabledSources: ['bookmark'] }).map(item => item.source), ['bookmark']);
  assert.deepEqual(rankResults('design', candidates, 8, Date.now(), { enabledSources: [] }), []);
});
test('duplicate URLs retain the highest-priority enabled source', () => {
  const candidates = ['tab', 'history', 'bookmark'].map(source => candidate(source, 'https://design.example'));
  assert.equal(rankResults('design', candidates, 8, Date.now(), { sourceOrder: ['history', 'bookmark', 'tab'] })[0].source, 'history');
  assert.equal(rankResults('design', candidates, 8, Date.now(), { enabledSources: ['bookmark'] })[0].source, 'bookmark');
});
test('recency and frequency break otherwise equal history matches', () => {
  const now = Date.now();
  const items = rankResults('design', [candidate('history', 'https://design.example/old', '', { lastVisitTime: now - 86400000 * 90 }), candidate('history', 'https://design.example/recent', '', { lastVisitTime: now, visitCount: 10 })], 8, now);
  assert.equal(items[0].url, 'https://design.example/recent');
});
