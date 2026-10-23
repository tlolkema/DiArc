// Optional browser regression suite. Requires agent-browser on PATH.
// It uses a disposable session and never attaches to a user's test window.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const exec = promisify(execFile);
const directory = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, AGENT_BROWSER_SESSION: `diarc-smoke-${process.pid}` };
async function browser(...args) {
  const { stdout } = await exec('agent-browser', args, { env, timeout: 30000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}
async function evaluate(fn, ...args) { return browser('eval', `(${fn.toString()})(${args.map(value => JSON.stringify(value)).join(',')})`); }

const fixtureIcon = await readFile(new URL('../icons/diarc-swoosh-16.png', import.meta.url));
const fixture = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(fixtureIcon); return; }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'none'; img-src 'self' data:; frame-src 'none'"
  });
  response.end(`<!doctype html><html lang="en"><head><title>DiArc site-access test</title><link rel="icon" href="/favicon.ico"></head>
    <body><h1>Autofocusing test page</h1><input id="site-input" autofocus placeholder="Site composer">
    <script>const composer = document.querySelector('#site-input'); globalThis.focusAttempts = 0;
    function stealFocus() { focusAttempts++; composer.focus(); }
    setInterval(stealFocus, 15); document.addEventListener('focusin', stealFocus, true);
    globalThis.interceptedEvents = 0;
    for (const type of ['pointerdown', 'keydown', 'keypress', 'keyup', 'beforeinput', 'paste']) window.addEventListener(type, event => {
      if (event.target === composer) return;
      interceptedEvents++; event.preventDefault(); event.stopImmediatePropagation(); stealFocus();
    }, true);</script>
    </body></html>`);
});
await new Promise((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve); });
const fixtureURL = `http://127.0.0.1:${fixture.address().port}/`;

try {
  await browser('--extension', directory, 'open', 'chrome://extensions');
  const id = JSON.parse(await evaluate(() => {
    // First installation can open Settings while the browser starts.
    if (location.protocol === 'chrome-extension:' && chrome.runtime.getManifest().name === 'DiArc') return chrome.runtime.id;
    const manager = document.querySelector('extensions-manager').shadowRoot;
    const list = manager.querySelector('extensions-item-list').shadowRoot;
    return [...list.querySelectorAll('extensions-item')].find(item => item.data?.name === 'DiArc')?.id;
  }));
  assert.ok(id, 'The unpacked extension must load.');
  const page = `chrome-extension://${id}`;
  await browser('open', `${page}/options.html`);
  console.log(await evaluate(async () => {
    const currentTab = await chrome.tabs.getCurrent();
    await chrome.tabs.update(currentTab.id, { active: true });
    await new Promise(resolve => requestAnimationFrame(resolve));
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => {
      for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
      throw new Error('Timed out waiting for settings.');
    };
    await wait(() => document.querySelector('#maxResults')?.value === '3' && document.querySelectorAll('.source-item').length === 3);
    const brand = document.querySelector('.brand');
    const logo = brand.querySelector('.brand-mark');
    await wait(() => logo?.complete && logo.naturalWidth === 256);
    check(brand.textContent.trim() === 'DiArc' && logo.nextElementSibling.textContent === 'DiArc', 'The supplied logo must appear before the DiArc wordmark.');
    check(parseFloat(getComputedStyle(document.querySelector('.brand-subline')).fontSize) >= 14, 'The settings subtitle must be larger and readable.');
    const logoRect = logo.getBoundingClientRect(), nameRect = brand.querySelector('span').getBoundingClientRect();
    check(Math.abs(logoRect.y + logoRect.height / 2 - nameRect.y - nameRect.height / 2) < .5, 'The logo and wordmark must be vertically aligned.');
    check(logoRect.width === 80 && logoRect.height === 80 && parseFloat(getComputedStyle(brand).fontSize) === 56, 'The settings logo and wordmark must be doubled in size.');
    check(document.querySelector('main section').id === 'keyboard' && document.querySelector('.local-nav a').hash === '#keyboard', 'Keyboard must appear first in settings and navigation.');
    check(document.querySelector('#shortcut-settings-link').href === 'chrome://extensions/shortcuts', 'The shortcut configuration URL must be clickable.');
    const mac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
    check(document.querySelector('#recommended-new-shortcut').textContent === (mac ? '⌘T' : 'Ctrl+T') && document.querySelector('#recommended-address-shortcut').textContent === (mac ? '⌘L' : 'Ctrl+L'), 'Recommended bindings must match the platform.');
    check(document.querySelector('.shortcut-recommendation').textContent.includes('If your browser supports native shortcut remapping'), 'Recommendations must explain browser limitations.');
    check(document.querySelectorAll('.local-nav a').length === 4, 'Settings navigation must expose all sections.');
    check(document.querySelector('#overlayWidth').value === '75vh' && document.querySelector('#overlayHeight').value === '75vh', 'Both default dimensions must use vh.');
    check(document.querySelectorAll('[name="enabledQuickActions"]:checked').length === 0, 'All built-in actions must start disabled.');
    const accessCard = document.querySelector('#site-access-card');
    const grantAccess = document.querySelector('#grant-site-access');
    const accessStatus = document.querySelector('#site-access-status');
    await wait(() => accessCard.dataset.state === 'granted');
    check(grantAccess.hidden, 'Already-granted access must not ask for another permission prompt.');
    const originalContains = chrome.permissions.contains.bind(chrome.permissions);
    const originalRequest = chrome.permissions.request.bind(chrome.permissions);
    let allowed = false, approve = false, fail = false, permissionRequests = 0;
    chrome.permissions.contains = async () => allowed;
    chrome.permissions.request = async request => {
      permissionRequests++;
      check(JSON.stringify(request.origins) === '["http://*/*","https://*/*"]', 'Only declared website permissions should be requested.');
      if (fail) throw new Error('Blocked by browser policy');
      allowed = approve;
      return approve;
    };
    window.dispatchEvent(new Event('focus'));
    await wait(() => accessCard.dataset.state === 'missing');
    check(permissionRequests === 0 && !grantAccess.hidden && !grantAccess.disabled, 'Missing access must show an action without automatically prompting.');
    grantAccess.click();
    await wait(() => accessStatus.textContent.includes('Access was not granted'));
    check(!grantAccess.disabled && !document.querySelector('#manage-site-access').hidden, 'Denied access must offer retry and manual management.');
    fail = true;
    grantAccess.click();
    await wait(() => accessStatus.textContent.includes('Blocked by browser policy'));
    fail = false; approve = true;
    grantAccess.click();
    await wait(() => accessCard.dataset.state === 'granted');
    check(permissionRequests === 3 && grantAccess.hidden, 'Approval must recheck access and hide the request action.');
    chrome.permissions.contains = originalContains;
    chrome.permissions.request = originalRequest;
    window.dispatchEvent(new Event('focus'));
    await wait(() => accessCard.dataset.state === 'granted');
    for (const field of document.querySelectorAll('.select-field')) {
      const select = field.querySelector('select').getBoundingClientRect();
      const chevron = field.querySelector('.select-chevron').getBoundingClientRect();
      check(Math.abs(select.y + select.height / 2 - chevron.y - chevron.height / 2) < .5, 'Dropdown chevrons must be vertically centered.');
      check(Math.abs(select.right - chevron.right - 12) < .5, 'Dropdown chevrons must have a consistent 12px inset.');
      check(getComputedStyle(field.querySelector('.select-chevron')).pointerEvents === 'none', 'Dropdown chevrons must not block clicks.');
    }
    document.querySelector('[aria-label="Move History up"]').click();
    document.querySelector('[aria-label="Move History up"]').click();
    check(document.activeElement.getAttribute('aria-label') === 'Move History down', 'Keyboard focus must follow a moved source.');
    const toggle = (source, enabled) => {
      const checkbox = document.querySelector(`input[value="${source}"]`);
      checkbox.checked = enabled;
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    };
    check(!document.querySelector('#settings [type="submit"],.save-button'), 'Auto-saving settings must not have a save button.');
    const saved = () => document.querySelector('#save-status').textContent.includes('Saved automatically.');
    await wait(saved);
    check(JSON.stringify((await chrome.storage.local.get('sourceOrder')).sourceOrder) === '["history","tab","bookmark"]', 'Reordering must save without another control changing.');
    toggle('tab', false);
    await wait(saved);
    const values = await chrome.storage.local.get(['sourceOrder', 'enabledSources']);
    check(JSON.stringify(values.sourceOrder) === '["history","tab","bookmark"]', 'Source order must save automatically.');
    check(JSON.stringify(values.enabledSources) === '["history","bookmark"]', 'Source toggles must save automatically.');
    check(document.querySelector('.source-item button[data-direction="-1"]').disabled, 'First source cannot move up.');
    check(document.querySelector('.source-item:last-child button[data-direction="1"]').disabled, 'Last source cannot move down.');
    for (const source of ['tab', 'bookmark', 'history']) toggle(source, false);
    await wait(saved);
    check((await chrome.storage.local.get('enabledSources')).enabledSources.length === 0, 'All-disabled must persist.');
    const disabled = await chrome.runtime.sendMessage({ type: 'still:search', query: 'design' });
    check(disabled.items.length === 1 && disabled.items[0].source === 'input', 'All-disabled must retain the typed action.');
    toggle('history', true);
    toggle('bookmark', true);
    await wait(saved);
    const setField = (name, value) => {
      const field = document.querySelector(`[name="${name}"]`);
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setField('maxResults', '12');
    await wait(saved);
    check((await chrome.storage.local.get('maxResults')).maxResults === 12, 'Result limit must save automatically.');
    setField('maxResults', '');
    check(document.querySelector('#maxResults').getAttribute('aria-invalid') === 'true', 'Empty limits must be marked invalid.');
    setField('searchEngine', 'bing');
    await wait(async () => (await chrome.storage.local.get('searchEngine')).searchEngine === 'bing');
    check((await chrome.storage.local.get('maxResults')).maxResults === 12, 'An invalid limit must not block saving another setting or replace its valid value.');
    setField('maxResults', '21');
    setField('searchEngine', 'duckduckgo');
    await wait(async () => (await chrome.storage.local.get('searchEngine')).searchEngine === 'duckduckgo');
    check((await chrome.storage.local.get('maxResults')).maxResults === 12, 'Out-of-range limits must not be saved.');
    setField('maxResults', '1.5');
    setField('theme', 'dark');
    await wait(async () => (await chrome.storage.local.get('theme')).theme === 'dark');
    check((await chrome.storage.local.get('maxResults')).maxResults === 12, 'Fractional limits must not be saved.');
    setField('maxResults', '8');
    setField('theme', 'system');
    setField('searchEngine', 'google');
    await wait(saved);
    check(!document.querySelector('#maxResults').hasAttribute('aria-invalid'), 'A valid limit must clear the error.');
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
    let releaseFirst, writes = 0;
    chrome.storage.local.set = async values => {
      writes++;
      if (writes === 1) await new Promise(resolve => { releaseFirst = resolve; });
      return originalSet(values);
    };
    setField('theme', 'dark');
    await wait(() => releaseFirst);
    setField('theme', 'light');
    setField('theme', 'system');
    await new Promise(resolve => setTimeout(resolve, 30));
    check(writes === 1, 'A later save must wait for the earlier save to finish.');
    releaseFirst();
    await wait(saved);
    check(writes === 3 && (await chrome.storage.local.get('theme')).theme === 'system', 'Rapid changes must persist the latest value.');
    chrome.storage.local.set = async () => { throw new Error('Simulated storage failure'); };
    setField('theme', 'light');
    await wait(() => document.querySelector('#save-status').textContent.startsWith('Could not save preferences:'));
    chrome.storage.local.set = originalSet;
    setField('theme', 'system');
    await wait(saved);
    await chrome.bookmarks.create({ title: 'Design bookmark', url: 'https://design.example/saved' });
    await chrome.history.addUrl({ url: 'https://design.example/history' });
    return 'PASS: permission checks and guided approval, automatic saving, source order, validation, serialized writes, storage failure recovery, persistence';
  }));
  console.log(await evaluate(async () => {
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => {
      for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
      throw new Error(`Timed out waiting for customization at ${location.href}.`);
    };
    const saved = () => document.querySelector('#save-status').textContent.includes('Saved automatically.');
    const edit = (field, value) => {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await wait(() => document.querySelector('#backgroundBlur') && document.querySelector('#settings-fields')?.disabled === false);
    const blurToggle = document.querySelector('#backgroundBlur');
    check(Boolean(blurToggle), `Customization fixture is unavailable at ${location.href}.`);
    check(blurToggle.type === 'checkbox' && blurToggle.checked, 'Background blur must be an on/off toggle, enabled by default.');
    edit(document.querySelector('#overlayWidth'), '50vw');
    edit(document.querySelector('#overlayHeight'), '65vh');
    blurToggle.checked = false; blurToggle.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(saved);
    let values = await chrome.storage.local.get(['overlayWidth', 'overlayHeight', 'backgroundBlur']);
    check(values.overlayWidth === '50vw' && values.overlayHeight === '65vh' && values.backgroundBlur === false, 'Dimensions and blur toggle must save automatically.');
    edit(document.querySelector('#overlayWidth'), 'calc(100vw)');
    blurToggle.checked = true; blurToggle.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(async () => (await chrome.storage.local.get('backgroundBlur')).backgroundBlur === true);
    check((await chrome.storage.local.get('overlayWidth')).overlayWidth === '50vw', 'Invalid dimensions must retain the previous value while other settings save.');
    edit(document.querySelector('#overlayWidth'), '50vw');
    document.querySelector('#add-custom-action').click();
    let row = document.querySelector('.custom-action');
    check(document.activeElement === row.querySelector('.action-label'), 'New custom action must receive keyboard focus.');
    edit(row.querySelector('.action-label'), 'Search GitHub');
    edit(row.querySelector('.action-url'), 'https://github.com/search?q={query}');
    await wait(saved);
    for (const id of ['chatgpt', 'claude']) {
      const checkbox = document.querySelector(`[name="enabledQuickActions"][value="${id}"]`);
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await wait(saved);
    values = await chrome.storage.local.get(['enabledQuickActions', 'customActions']);
    check(values.enabledQuickActions.includes('chatgpt') && values.enabledQuickActions.includes('claude') && !values.enabledQuickActions.includes('perplexity'), 'Built-in quick actions must be configurable without Perplexity.');
    check(values.customActions.length === 1 && values.customActions[0].label === 'Search GitHub', 'A complete custom action must save automatically.');
    const enabled = row.querySelector('.action-enabled input');
    enabled.checked = false; enabled.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(saved);
    let result = await chrome.runtime.sendMessage({ type: 'still:search', query: 'design', mode: 'new' });
    check(!result.items.some(item => item.actionId?.startsWith('custom:')), 'Disabled custom actions must not appear.');
    enabled.checked = true; enabled.dispatchEvent(new Event('input', { bubbles: true }));
    edit(row.querySelector('.action-url'), 'javascript:alert(1)');
    await wait(async () => (await chrome.storage.local.get('customActions')).customActions[0]?.enabled === true);
    check((await chrome.storage.local.get('customActions')).customActions[0].urlTemplate.startsWith('https://github.com/'), 'Invalid action URLs must retain the last valid template.');
    edit(row.querySelector('.action-url'), 'https://github.com/search?q={query}');
    await wait(saved);
    document.querySelector('#add-custom-action').click();
    document.querySelector('.custom-action:last-child .action-remove').click();
    await wait(saved);
    check((await chrome.storage.local.get('customActions')).customActions.length === 1, 'Removing a draft must not remove an existing action.');
    result = await chrome.runtime.sendMessage({ type: 'still:search', query: 'cats & dogs', mode: 'new' });
    check(result.items.find(item => item.actionId?.startsWith('custom:'))?.url === 'https://github.com/search?q=cats%20%26%20dogs', 'Custom action queries must be safely encoded.');
    return 'PASS: automatic customization, dimensions, blur, built-in actions, custom action editing, validation, enable/disable, removal';
  }));
  await browser('reload');
  await evaluate(async () => {
    for (let i = 0; i < 300 && document.querySelector('#maxResults').value !== '8'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const order = [...document.querySelectorAll('.source-item')].map(row => row.dataset.source);
    const enabled = [...document.querySelectorAll('input[name="enabledSources"]:checked')].map(input => input.value);
    if (JSON.stringify(order) !== '["history","tab","bookmark"]' || JSON.stringify(enabled) !== '["history","bookmark"]') throw new Error('Reload lost source preferences.');
    if (document.querySelector('#overlayWidth').value !== '50vw' || document.querySelector('#overlayHeight').value !== '65vh' || document.querySelector('#backgroundBlur').checked !== true || document.querySelector('.action-label')?.value !== 'Search GitHub') throw new Error('Reload lost customization preferences.');
    return true;
  });
  await browser('set', 'viewport', '390', '844');
  await evaluate(() => {
    if (document.documentElement.scrollWidth > innerWidth) throw new Error('Settings must not overflow a narrow viewport.');
    for (const field of document.querySelectorAll('.select-field')) {
      const select = field.querySelector('select').getBoundingClientRect();
      const chevron = field.querySelector('.select-chevron').getBoundingClientRect();
      if (Math.abs(select.y + select.height / 2 - chevron.y - chevron.height / 2) > .5 || Math.abs(select.right - chevron.right - 12) > .5) throw new Error('Dropdown chevrons must remain aligned on narrow screens.');
    }
    if (getComputedStyle(document.querySelector('.settings-layout')).gridTemplateColumns.split(' ').length !== 1) throw new Error('Narrow settings must use a single column.');
    return true;
  });
  await browser('set', 'media', 'dark');
  await evaluate(() => {
    if (!matchMedia('(prefers-color-scheme: dark)').matches || getComputedStyle(document.body).backgroundColor !== 'rgb(24, 24, 24)') throw new Error('Settings must support dark mode.');
    return true;
  });
  await browser('set', 'media', 'light');
  await browser('set', 'viewport', '1280', '900');
  console.log('PASS: supplied logo, larger subtitle, settings navigation, dropdown chevron alignment, responsive layout, dark mode');
  console.log(await evaluate(async () => {
    // Installation opens another Settings tab. Activate this fixture so entrance
    // animations render normally rather than remaining paused in a hidden tab.
    const currentTab = await chrome.tabs.getCurrent();
    await chrome.tabs.update(currentTab.id, { active: true });
    await new Promise(resolve => requestAnimationFrame(resolve));
    // Render the real overlay over the existing settings page, not a launcher page.
    await Promise.all([
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('palette.js');
        script.onload = resolve; script.onerror = reject;
        document.head.append(script);
      }),
      new Promise((resolve, reject) => {
        const style = document.createElement('link');
        style.rel = 'stylesheet'; style.href = chrome.runtime.getURL('palette.css');
        style.onload = resolve; style.onerror = reject;
        document.head.append(style);
      })
    ]);
    const previousFocus = document.querySelector('#maxResults');
    previousFocus.focus();
    const urlBefore = location.href;
    const tabCount = (await chrome.tabs.query({ currentWindow: true })).length;
    const palette = globalThis.StillPalette.mount({ root: document.body });
    await palette.open('new');
    const layer = document.querySelector('.still-layer');
    const check = (value, message) => { if (!value) throw new Error(message); };
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const wait = async predicate => {
      for (let i = 0; i < 300; i++) { if (predicate()) return; await pause(10); }
      throw new Error('Timed out waiting for results.');
    };
    const input = layer.querySelector('input');
    const body = document.querySelector('.still-body');
    const list = document.querySelector('.still-results');
    const type = text => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
    await wait(() => !input.disabled);
    check(list.children.length === 0 && body.hidden, 'Initial bar must have no results.');
    check(layer.classList.contains('is-overlay') && layer.matches(':modal') && location.href === urlBefore, 'The bar must be a native modal overlay on the existing page.');
    previousFocus.focus();
    check(document.activeElement === input, 'The page must not take focus while the overlay is modal.');
    layer.querySelector('.still-bar').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    check(document.activeElement === input, 'Clicking empty bar space must keep the input focused.');
    check((await chrome.tabs.query({ currentWindow: true })).length === tabCount, 'Opening the overlay must not create a tab.');
    check(!document.querySelector('.still-settings,.still-close,.still-mode'), 'The bar must not contain removed controls.');
    await pause(160);
    const panelRect = layer.querySelector('.still-panel').getBoundingClientRect();
    const barTop = layer.querySelector('.still-bar').getBoundingClientRect().top;
    const barRect = layer.querySelector('.still-bar').getBoundingClientRect();
    check(Math.abs(barRect.y + barRect.height / 2 - innerHeight / 3) < 1, 'The bar must be anchored one-third down the viewport.');
    check(Math.abs(panelRect.width - innerWidth * .5) < 1, `The overlay must use the configured viewport width (actual ${panelRect.width}, viewport ${innerWidth}, setting ${layer.style.getPropertyValue('--still-overlay-width')}, visibility ${document.visibilityState}).`);
    check(panelRect.height < 100 && getComputedStyle(layer).backdropFilter === 'blur(5px)', 'The empty bar must remain compact and apply the configured background blur.');
    check(Math.abs(parseFloat(getComputedStyle(layer.querySelector('.still-panel')).maxHeight) - innerHeight * .65) < 1, 'The overlay must apply its maximum configured height.');
    type('design');
    await wait(() => list.children.length === 6);
    const initialCount = list.children.length;
    check(Math.abs(layer.querySelector('.still-bar').getBoundingClientRect().top - barTop) < 1, 'Expanding results must not move the bar.');
    check(JSON.stringify([...document.querySelectorAll('.still-source')].map(element => element.textContent)) === '["Search","Action","Action","Action","History","Bookmark"]', 'Quick actions must precede ranked source matches.');
    check([...list.children].some(row => row.textContent.includes('Search GitHub')), 'Custom actions must appear in the overlay.');
    const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    const pending = [], navigations = [];
    chrome.runtime.sendMessage = message => {
      if (message.type === 'still:search') return new Promise(resolve => pending.push({ message, resolve }));
      if (message.type === 'still:navigate') { navigations.push(message); return Promise.resolve({ ok: true }); }
      return originalSend(message);
    };
    const height = body.getBoundingClientRect().height;
    const firstText = list.firstElementChild.textContent;
    type('designx');
    check(!body.hidden && list.children.length === initialCount, 'Typing must keep previous results visible.');
    check(Math.abs(body.getBoundingClientRect().height - height) < 1, 'Typing must not collapse the results area.');
    check(!input.hasAttribute('aria-activedescendant'), 'Typing must invalidate the previous selection.');
    list.children[1].click();
    check(navigations.length === 0, 'Stale rows must not navigate.');
    await wait(() => pending.length === 1);
    type('designxy');
    type('design'); // Backspace while an earlier query is still in flight.
    check(!body.hidden && list.firstElementChild.textContent === firstText, 'Backspace must keep previous rows visible.');
    await wait(() => pending.length === 2);
    check(pending[1].message.query === 'design', 'Rapid input must debounce to the latest query.');
    pending[0].resolve({ items: [{ title: 'STALE', url: 'https://stale.example', source: 'history' }] });
    await pause(0);
    check(list.firstElementChild.textContent === firstText, 'Out-of-order responses must not replace current results.');
    const png = new Uint8Array(await (await fetch(chrome.runtime.getURL('icons/diarc-swoosh-16.png'))).arrayBuffer());
    pending[1].resolve({ items: [
      { title: 'CURRENT', url: 'https://current.example', source: 'history', favicon: `data:image/png;base64,${btoa(String.fromCharCode(...png))}` },
      { title: 'Broken icon', url: 'https://broken.example', source: 'history', favicon: 'data:image/png;base64,AAAA' },
      { title: 'External icon', url: 'https://external.example', source: 'history', favicon: 'https://tracking.invalid/favicon.ico' }
    ] });
    await wait(() => list.firstElementChild?.textContent.includes('CURRENT'));
    check(!body.hidden && input.getAttribute('aria-activedescendant') === 'still-option-0', 'Fresh results must restore keyboard selection.');
    await wait(() => list.firstElementChild.querySelector('.still-favicon')?.naturalWidth > 0);
    check(list.children[1].querySelector('.still-icon svg') && list.children[2].querySelector('.still-icon svg'), 'Missing or disallowed favicons must keep the current vector fallback.');
    check(Math.abs(layer.querySelector('.still-bar').getBoundingClientRect().top - barTop) < 1, 'Updating results and favicons must not move the bar.');
    type('next');
    await wait(() => pending.length === 3);
    type('');
    check(body.hidden && list.children.length === 0 && document.querySelector('.still-submit').disabled, 'Clearing input must restore the empty bar.');
    pending[2].resolve({ items: [{ title: 'LATE', url: 'https://late.example', source: 'history' }] });
    await pause(0);
    check(body.hidden && list.children.length === 0, 'A late response must not reopen cleared results.');
    check(Math.abs(layer.querySelector('.still-bar').getBoundingClientRect().top - barTop) < 1, 'Clearing results must not move the bar.');
    type('submit now');
    await wait(() => pending.length === 4);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await pause(0);
    check(navigations[0]?.query === 'submit now' && !navigations[0]?.url, 'Enter during loading must submit current text, not a stale URL.');
    check(layer.hidden && document.activeElement === previousFocus, 'Submitting must dismiss the overlay and restore focus.');
    pending[3].resolve({ items: [] });
    await palette.open('address');
    check(input.value === urlBefore && input.selectionStart === 0 && input.selectionEnd === input.value.length, 'Address mode must select the current page URL.');
    check(body.hidden, 'Address mode must initially have no results.');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check(layer.hidden && document.activeElement === previousFocus, 'Escape must dismiss the overlay and restore page focus.');
    await palette.open('new');
    layer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    check(layer.hidden && location.href === urlBefore, 'Clicking outside must dismiss without navigating.');
    check((await chrome.tabs.query({ currentWindow: true })).length === tabCount, 'The overlay must never create a launcher tab.');
    for (const legacySettings of [{ theme: 'light' }, undefined, { backgroundBlur: false }, { backgroundBlur: 0 }, { backgroundBlur: 8 }]) {
      chrome.runtime.sendMessage = async message => {
        const result = await originalSend(message);
        return message.type === 'still:init' ? { ...result, settings: legacySettings } : result;
      };
      await palette.open('new');
      const expectedBlur = legacySettings?.backgroundBlur === false || legacySettings?.backgroundBlur === 0 ? '0px' : '5px';
      check(layer.style.getPropertyValue('--still-overlay-width') === '75vh' && layer.style.getPropertyValue('--still-overlay-height') === '75vh' && layer.style.getPropertyValue('--still-background-blur') === expectedBlur, 'Older settings responses must use safe layout defaults and preserve blur on/off.');
      check(getComputedStyle(layer).backdropFilter === `blur(${expectedBlur})`, 'The overlay must apply the blur toggle.');
      check(layer.querySelector('.still-status').hidden && !input.disabled && input.placeholder.length > 0, 'Missing new preferences must not break the overlay.');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    // Simulate a slow worker: typing and focus must work before init completes.
    let releaseInit;
    chrome.runtime.sendMessage = message => message.type === 'still:init'
      ? new Promise(resolve => { releaseInit = resolve; }) : originalSend(message);
    for (const mode of ['new', 'address']) {
      const opening = palette.open(mode);
      check(document.activeElement === input && !input.disabled, 'Focus must be available immediately, before settings load.');
      type(mode === 'new' ? 'typed immediately' : 'https://edited.example/');
      const expected = input.value;
      releaseInit(await originalSend({ type: 'still:init', mode }));
      await opening;
      check(input.value === expected, 'Late initialization must not erase or reselect text already entered.');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    chrome.runtime.sendMessage = originalSend;
    await palette.open('new');
    layer.dispatchEvent(new Event('cancel', { cancelable: true }));
    check(layer.hidden && document.activeElement === previousFocus, 'Native dialog cancellation must dismiss and restore focus.');
    return 'PASS: modal focus isolation, one-third anchor, stable results, favicon fallbacks, immediate typing, dismissal, and compatibility';
  }));
  await browser('set', 'viewport', '390', '844');
  console.log(await evaluate(async () => {
    const palette = globalThis.StillPalette.mount({ root: document.body });
    await palette.open('new');
    const layer = document.querySelector('.still-layer[open]');
    const bar = layer.querySelector('.still-bar');
    const top = bar.getBoundingClientRect().top;
    if (Math.abs(top + bar.getBoundingClientRect().height / 2 - innerHeight / 3) > 1) throw new Error('The mobile bar must also be anchored one-third down.');
    const input = layer.querySelector('input'); input.value = 'design'; input.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 300 && layer.querySelector('.still-body').hidden; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const panel = layer.querySelector('.still-panel').getBoundingClientRect();
    if (layer.querySelector('.still-body').hidden || Math.abs(bar.getBoundingClientRect().top - top) > 1 || panel.bottom > innerHeight - 13 || panel.right > innerWidth - 13) throw new Error('Mobile results must grow below the stationary bar and stay in the viewport.');
    palette.destroy();
    return 'PASS: mobile one-third anchor and downward expansion without moving the bar';
  }));
  await browser('set', 'viewport', '1280', '900');
  console.log(await evaluate(async () => {
    const before = new Set((await chrome.tabs.query({})).map(tab => tab.id));
    document.querySelector('#shortcut-settings-link').click();
    for (let i = 0; i < 150; i++) {
      const opened = (await chrome.tabs.query({})).find(tab => !before.has(tab.id) && tab.url?.replace(/\/$/, '') === 'chrome://extensions/shortcuts');
      if (opened) {
        await chrome.tabs.remove(opened.id);
        return 'PASS: clicking the prominent shortcut URL opens the actual browser shortcut settings';
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('The shortcut URL did not open the browser shortcut configuration page.');
  }));
  const website = JSON.parse(await evaluate(async fixtureURL => {
    const permissions = await chrome.permissions.getAll();
    if (!['http://*/*', 'https://*/*'].every(origin => permissions.origins.includes(origin))) throw new Error('All-site HTTP/HTTPS access must be granted in the test installation.');
    const tab = await chrome.tabs.create({ url: fixtureURL, active: true });
    for (let i = 0; i < 150 && (await chrome.tabs.get(tab.id)).status !== 'complete'; i++) await new Promise(resolve => setTimeout(resolve, 20));
    const before = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => Boolean(document.querySelector('#still-command-bar')) });
    if (before[0].result) throw new Error('Opening a website must not automatically inject the overlay.');
    let cachedIcon;
    for (let i = 0; i < 100; i++) {
      cachedIcon = (await chrome.runtime.sendMessage({ type: 'still:search', query: fixtureURL })).items[0]?.favicon;
      if (cachedIcon) break;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (!cachedIcon?.startsWith('data:image/png;base64,')) throw new Error('Visited website favicon must be available from the browser cache.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['palette.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      // Test-only capture in the isolated world; production still uses closed roots.
      const mount = globalThis.StillPalette.mount;
      globalThis.__diarcOriginalMount = mount;
      globalThis.StillPalette.mount = options => {
        globalThis.__diarcTestRoot = options.root;
        return mount(options);
      };
      const original = Element.prototype.attachShadow;
      globalThis.__diarcOriginalAttach = original;
      Element.prototype.attachShadow = function(options) {
        const shadow = original.call(this, options);
        if (this.id === 'still-command-bar') globalThis.__diarcTestShell = shadow;
        return shadow;
      };
    } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const css = await (await fetch(chrome.runtime.getURL('palette.css'))).text();
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'still:open', mode: 'new', css });
    if (!response?.ok) throw new Error('The website content-script bridge must open the overlay.');
    await new Promise(resolve => setTimeout(resolve, 160));
    const [inspection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      Element.prototype.attachShadow = globalThis.__diarcOriginalAttach;
      globalThis.StillPalette.mount = globalThis.__diarcOriginalMount;
      const shell = globalThis.__diarcTestShell.querySelector('dialog');
      const frame = shell.querySelector('iframe');
      if (!shell.matches(':modal') || frame.hasAttribute('src') || frame.sandbox.value !== 'allow-same-origin') throw new Error('The input must use a script-free frame inside the outer native modal.');
      if (getComputedStyle(shell, '::backdrop').backdropFilter !== 'blur(5px)') throw new Error('The parent backdrop must retain the configured blur.');
      const root = globalThis.__diarcTestRoot;
      const dialog = root?.querySelector('dialog');
      const input = root?.querySelector('input');
      document.querySelector('#site-input').focus();
      if (!dialog?.matches(':modal') || root.activeElement !== input) throw new Error('Website autofocus must not escape the native modal.');
      const bar = root.querySelector('.still-bar').getBoundingClientRect();
      if (Math.abs(bar.y + bar.height / 2 - innerHeight / 3) > 1) throw new Error('The framed bar must keep its one-third position.');
      const rect = input.getBoundingClientRect();
      return { x: rect.x + Math.min(100, rect.width / 2), y: rect.y + rect.height / 2 };
    } });
    return { id: tab.id, ...inspection.result };
  }, fixtureURL));
  const websiteRef = JSON.parse(await browser('--json', 'tab', 'list')).data.tabs.find(tab => tab.url === fixtureURL)?.tabId;
  assert.ok(websiteRef, 'The fixture must have an automation tab reference.');
  await browser('tab', websiteRef);
  await browser('mouse', 'move', String(Math.round(website.x)), String(Math.round(website.y)));
  await browser('mouse', 'down');
  await browser('mouse', 'up');
  await browser('keyboard', 'type', 'overlay focus test');
  assert.match(await browser('snapshot', '-i'), /overlay focus test/, 'Real keystrokes must reach the overlay after clicking it.');
  await evaluate(() => {
    if (document.querySelector('#site-input').value !== '' || document.activeElement.id === 'site-input') throw new Error('Typing leaked into the site composer.');
    if (globalThis.focusAttempts < 2) throw new Error('The fixture must repeatedly attempt to steal focus.');
    if (globalThis.interceptedEvents !== 0) throw new Error('The website must not receive overlay pointer, typing, or paste events.');
    return true;
  });
  await browser('press', 'Escape');
  await evaluate(() => {
    if (document.querySelector('#still-command-bar').style.display !== 'none' || document.activeElement.id !== 'site-input') throw new Error('Dismissing must restore the site composer.');
    return true;
  });
  // Reopen the same content-script instance in address mode after dismissal.
  await browser('tab', 'new', `${page}/options.html`);
  console.log(await evaluate(async tabId => {
    await chrome.storage.local.set({ backgroundBlur: false });
    await chrome.tabs.update(tabId, { active: true });
    const css = await (await fetch(chrome.runtime.getURL('palette.css'))).text();
    const response = await chrome.tabs.sendMessage(tabId, { type: 'still:open', mode: 'address', css });
    if (!response?.ok) throw new Error('The existing input frame must reopen.');
    await new Promise(resolve => setTimeout(resolve, 100));
    const [inspection] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const root = globalThis.__diarcTestRoot;
      const input = root.querySelector('input');
      const shell = globalThis.__diarcTestShell.querySelector('dialog');
      if (getComputedStyle(shell, '::backdrop').backdropFilter !== 'blur(0px)') throw new Error('Disabling blur must also update the parent backdrop.');
      if (root.activeElement !== input || input.value !== location.href || input.selectionStart !== 0 || input.selectionEnd !== input.value.length) throw new Error('Reopening address mode must focus and select the original page URL.');
      return true;
    } });
    if (!inspection.result) throw new Error('Address-mode inspection failed.');
    return 'PASS: the isolated frame reopens in address mode and selects the current page URL';
  }, website.id));
  await browser('tab', websiteRef);
  await browser('keyboard', 'type', 'reopened focus test');
  assert.match(await browser('snapshot', '-i'), /reopened focus test/, 'Typing after reopening must replace the selected address.');
  await evaluate(() => {
    if (document.querySelector('#site-input').value !== '' || globalThis.interceptedEvents !== 0) throw new Error('The site intercepted typing after reopening.');
    return true;
  });
  await browser('press', 'Escape');
  await evaluate(() => {
    if (document.querySelector('#still-command-bar').style.display !== 'none' || document.activeElement.id !== 'site-input') throw new Error('Closing the reopened frame must restore page focus.');
    return true;
  });
  await browser('tab', 'close');
  console.log('PASS: cached favicon, strict CSP, blocked page capture handlers, clicked typing, repeated opens, and focus restoration');
  assert.equal(await browser('errors'), '', 'The browser must not report page errors.');
} finally {
  await browser('close').catch(() => {});
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
}
