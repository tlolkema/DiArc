(() => {
  if (globalThis.StillPalette) return;
  const symbols = {
    submit: '<path d="M12 19V5m-7 7 7-7 7 7"/>',
    address: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a17 17 0 0 1 0 16 17 17 0 0 1 0-16Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    tab: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/>',
    bookmark: '<path d="M6 4h12v17l-6-4-6 4Z"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>'
  };
  function icon(name, document = globalThis.document) {
    const span = document.createElement('span');
    span.className = 'still-icon';
    // Icon markup is constant. Browser data only enters the DOM through textContent.
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name] || symbols.address}</svg>`;
    return span;
  }
  function resultIcon(item, symbol, document = globalThis.document) {
    const fallback = icon(symbol, document);
    if (typeof item.favicon !== 'string' || item.favicon.length > 45000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.favicon)) return fallback;
    const image = document.createElement('img');
    image.className = 'still-favicon'; image.alt = ''; image.width = 20; image.height = 20;
    image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => { if (image.naturalWidth) fallback.replaceChildren(image); });
    // Keep the existing vector icon unless the cached favicon actually loads.
    image.src = item.favicon;
    return fallback;
  }
  function friendlyUrl(value) {
    try {
      const url = new URL(value);
      return (url.host + (url.pathname === '/' ? '' : url.pathname) + url.search + url.hash) || value;
    } catch { return value; }
  }
  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result) throw new Error('The extension did not respond. Reload this tab and try again.');
    if (result.error) throw new Error(result.error);
    return result;
  }

  function mount({ root, css, onClose = () => {}, onAppearance = () => {} }) {
    const document = root.ownerDocument || root;
    if (css) {
      const sheet = new document.defaultView.CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    }
    const layer = document.createElement('dialog');
    layer.className = 'still-layer is-overlay';
    layer.setAttribute('aria-label', 'DiArc command bar');
    layer.setAttribute('aria-modal', 'true');
    layer.innerHTML = `
      <section class="still-panel" data-theme="system">
        <div class="still-bar">
          <span class="still-search-icon" aria-hidden="true"></span>
          <input class="still-input" type="text" role="combobox" aria-label="Search or enter an address" aria-autocomplete="list" aria-expanded="false" aria-controls="still-results" autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="2048">
          <button class="still-submit" type="button" aria-label="Open in a new tab" disabled></button>
        </div>
        <div class="still-body" hidden>
          <div class="still-results" id="still-results" role="listbox" aria-label="Suggestions"></div>
          <div class="still-footer"><span>↑ ↓ <span class="still-footer-label">to explore</span></span><span>↵ <span class="still-footer-label still-enter-label">to open in a new tab</span></span></div>
        </div>
        <div class="still-status" role="status" aria-live="polite" hidden></div>
      </section>`;
    root.append(layer);
    const panel = layer.querySelector('.still-panel');
    const input = layer.querySelector('input');
    const list = layer.querySelector('.still-results');
    const body = layer.querySelector('.still-body');
    const status = layer.querySelector('.still-status');
    const submitButton = layer.querySelector('.still-submit');
    submitButton.append(icon('submit', document));
    layer.querySelector('.still-search-icon').append(icon('search', document));
    let items = [], selected = -1, mode = 'new', sequence = 0, timer, busy = false, generation = 0, pendingSearch = false;
    let previousFocus;

    function updateSubmit() {
      submitButton.disabled = busy || input.disabled || !input.value.trim();
    }
    function updateActionHint() {
      const opensNew = mode !== 'address' || (!pendingSearch && Boolean(items[selected]?.actionId));
      submitButton.setAttribute('aria-label', opensNew ? 'Open in a new tab' : 'Navigate in this tab');
      layer.querySelector('.still-enter-label').textContent = opensNew ? 'to open in a new tab' : 'to navigate in this tab';
    }
    function updateModeLabels() {
      input.placeholder = mode === 'address' ? 'Enter an address…' : 'Search or enter a URL…';
      input.setAttribute('aria-label', mode === 'address' ? 'Edit current address' : 'Search or enter an address');
      layer.setAttribute('aria-label', mode === 'address' ? 'DiArc — edit current address' : 'DiArc — open a new tab');
      updateActionHint();
    }
    function announce(text = '') {
      status.textContent = text;
      status.hidden = !text;
    }
    function clear() {
      pendingSearch = false;
      list.removeAttribute('aria-busy');
      items = [];
      selected = -1;
      list.replaceChildren();
      body.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      updateActionHint();
    }
    function select(index) {
      if (pendingSearch || !items.length) return;
      selected = (index + items.length) % items.length;
      [...list.children].forEach((row, position) => row.setAttribute('aria-selected', String(position === selected)));
      input.setAttribute('aria-activedescendant', `still-option-${selected}`);
      updateActionHint();
      list.children[selected]?.scrollIntoView({ block: 'nearest' });
    }
    function render(nextItems) {
      clear();
      items = nextItems;
      if (!items.length) return;
      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'still-result';
        row.id = `still-option-${index}`;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        const symbol = item.source === 'input' ? (item.kind === 'search' ? 'search' : 'arrow') : (item.source === 'action' ? 'arrow' : item.source);
        row.append(resultIcon(item, symbol, document));
        const text = document.createElement('span');
        text.className = 'still-result-text';
        const title = document.createElement('span');
        title.className = 'still-result-title';
        title.textContent = item.title || friendlyUrl(item.url);
        const subtitle = document.createElement('span');
        subtitle.className = 'still-result-url';
        subtitle.textContent = friendlyUrl(item.url);
        text.append(title, subtitle);
        const source = document.createElement('span');
        source.className = 'still-source';
        source.textContent = item.source === 'input' ? (item.kind === 'search' ? 'Search' : 'Go to') : (item.source === 'action' ? 'Action' : { tab: 'Open tab', bookmark: 'Bookmark', history: 'History' }[item.source]);
        row.append(text, source);
        row.addEventListener('pointermove', event => { if (event.movementX || event.movementY) select(index); });
        row.addEventListener('mousedown', event => event.preventDefault());
        row.addEventListener('click', () => { if (!pendingSearch) { select(index); void activate(); } });
        list.append(row);
      });
      body.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      select(0);
    }
    async function activate() {
      if (busy || !input.value.trim()) return;
      busy = true;
      updateSubmit();
      input.setAttribute('aria-busy', 'true');
      try {
        await request({ type: 'still:navigate', mode, query: input.value, url: pendingSearch ? undefined : items[selected]?.url, actionId: pendingSearch ? undefined : items[selected]?.actionId });
        close();
      } catch (error) { announce(error.message); }
      finally { busy = false; updateSubmit(); input.removeAttribute('aria-busy'); }
    }
    function close() {
      if (!layer.open) return;
      sequence++;
      generation++;
      clearTimeout(timer);
      layer.close();
      layer.hidden = true;
      previousFocus?.focus?.({ preventScroll: true });
      onClose();
    }
    function dismiss() {
      if (!busy) close();
    }
    input.addEventListener('input', () => {
      updateSubmit();
      clearTimeout(timer);
      announce();
      const current = ++sequence;
      const query = input.value;
      if (!query.trim()) { clear(); return; }
      // Keep the existing layout while the next query loads. Invalidate its selection,
      // not its rows, so Enter always submits current text and old rows cannot open.
      pendingSearch = true;
      selected = -1;
      updateActionHint();
      input.removeAttribute('aria-activedescendant');
      list.setAttribute('aria-busy', 'true');
      [...list.children].forEach(row => row.setAttribute('aria-selected', 'false'));
      timer = setTimeout(async () => {
        try {
          const response = await request({ type: 'still:search', query, mode });
          if (current !== sequence) return;
          render(response.items);
          announce(response.warning);
        } catch (error) {
          if (current === sequence) { clear(); announce(error.message); }
        }
      }, 120);
    });
    layer.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void dismiss(); }
      if (event.target === input && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        select(selected + (event.key === 'ArrowDown' ? 1 : -1));
      }
      if (event.target === input && event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation(); void activate();
      }
      if (event.key === 'Tab') {
        const focusable = [input, submitButton].filter(element => !element.disabled);
        const index = focusable.indexOf(root.activeElement || document.activeElement);
        event.preventDefault();
        focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
      }
    });
    layer.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    layer.querySelector('.still-bar').addEventListener('pointerdown', event => {
      if (event.target !== input && !submitButton.contains(event.target)) {
        event.preventDefault();
        input.focus({ preventScroll: true });
      }
    });
    layer.addEventListener('keyup', event => event.stopPropagation());
    layer.addEventListener('keypress', event => event.stopPropagation());
    layer.addEventListener('pointerdown', event => { if (event.target === layer) void dismiss(); });
    submitButton.addEventListener('click', () => void activate());

    async function open(requestedMode) {
      const current = ++generation;
      if (!layer.open) previousFocus = root.activeElement || document.activeElement;
      mode = requestedMode === 'address' ? 'address' : 'new';
      const initialSequence = ++sequence;
      clearTimeout(timer);
      clear();
      announce();
      input.value = mode === 'address' ? location.href : '';
      input.disabled = false;
      updateModeLabels();
      updateSubmit();
      layer.hidden = false;
      // A native modal makes the underlying page inert, so site autofocus cannot
      // take input away from the command bar while it is open.
      if (!layer.open) layer.showModal();
      input.focus({ preventScroll: true });
      if (mode === 'address') input.select();
      try {
        const context = await request({ type: 'still:init', mode: requestedMode });
        if (current !== generation) return;
        mode = context.mode;
        // Older worker responses can omit new preferences during an extension update.
        const settings = context.settings || {};
        const width = typeof settings.overlayWidth === 'string' ? settings.overlayWidth : '75vh';
        const height = typeof settings.overlayHeight === 'string' ? settings.overlayHeight : '75vh';
        const blurEnabled = typeof settings.backgroundBlur === 'boolean' ? settings.backgroundBlur
          : (typeof settings.backgroundBlur === 'number' && Number.isFinite(settings.backgroundBlur) ? settings.backgroundBlur > 0 : true);
        const blur = blurEnabled ? 5 : 0;
        panel.dataset.theme = ['light', 'dark', 'system'].includes(settings.theme) ? settings.theme : 'system';
        layer.style.setProperty('--still-overlay-width', width.replace(/%$/, 'vw'));
        layer.style.setProperty('--still-overlay-height', height.replace(/%$/, 'vh'));
        layer.style.setProperty('--still-background-blur', `${blur}px`);
        onAppearance({ backgroundBlur: blurEnabled });
        // Do not overwrite text entered while the worker was loading settings.
        if (sequence === initialSequence) {
          input.value = mode === 'address' ? (context.currentUrl || location.href) : '';
          if (mode === 'address' && (root.activeElement || document.activeElement) === input) input.select();
        }
        updateModeLabels();
      } catch (error) { if (current === generation) announce(error.message); }
      finally {
        if (current === generation) {
          updateSubmit();
        }
      }
    }
    return { open, close, destroy() { close(); layer.remove(); } };
  }
  globalThis.StillPalette = { mount };
})();
