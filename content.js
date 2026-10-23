(() => {
  if (globalThis.__stillContentLoaded) return;
  globalThis.__stillContentLoaded = true;
  let palette, host, shell, previousFocus;

  function closeShell() {
    if (shell?.open) shell.close();
    host?.style.setProperty('display', 'none', 'important');
    previousFocus?.focus?.({ preventScroll: true });
  }

  function createPalette(css) {
    palette?.destroy();
    host = document.createElement('div');
    host.id = 'still-command-bar';
    for (const [name, value] of Object.entries({ all: 'initial', position: 'fixed', inset: '0', width: '100%', height: '100%', 'z-index': '2147483647', display: 'block' })) {
      host.style.setProperty(name, value, 'important');
    }
    document.documentElement.append(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .still-shell { all: initial; display: block; position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; outline: none; overflow: hidden; background: transparent; }
      .still-shell:not([open]) { display: none; }
      .still-shell::backdrop { background: rgba(19,20,27,.09); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); }
    `);
    shadow.adoptedStyleSheets = [sheet];
    const backdrop = sheet.cssRules[2].style;
    shell = document.createElement('dialog');
    shell.className = 'still-shell';
    shell.setAttribute('aria-label', 'DiArc command bar');
    const frame = document.createElement('iframe');
    frame.title = 'DiArc command bar';
    // No URL, page scripts, or additional extension resources. The initial blank
    // document isolates keyboard/pointer events from the website's capture handlers.
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent;';
    shell.append(frame);
    shadow.append(shell);
    const frameDocument = frame.contentDocument;
    if (!frameDocument?.body) throw new Error('DiArc could not create its input frame. Refresh the website and try again.');
    frameDocument.documentElement.lang = 'en';
    frameDocument.body.style.cssText = 'margin:0;background:transparent;overflow:hidden;';
    const innerHost = frameDocument.createElement('div');
    frameDocument.body.append(innerHost);
    palette = globalThis.StillPalette.mount({
      root: innerHost.attachShadow({ mode: 'closed' }),
      css: `${css}\n.still-layer.is-overlay { background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }`,
      onAppearance: ({ backgroundBlur }) => {
        const blur = backgroundBlur ? 'blur(5px)' : 'blur(0px)';
        backdrop.setProperty('backdrop-filter', blur);
        backdrop.setProperty('-webkit-backdrop-filter', blur);
      },
      onClose: closeShell
    });
    shell.addEventListener('cancel', event => { event.preventDefault(); palette.close(); });
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'still:open') return;
    try {
      if (!host?.isConnected) createPalette(message.css);
      if (!shell.open) previousFocus = document.activeElement;
      host.style.setProperty('display', 'block', 'important');
      // The outer native modal blocks website autofocus. The frame also prevents
      // the website from cancelling keystrokes on their way to our input.
      if (!shell.open) shell.showModal();
      void palette.open(message.mode).then(
        () => respond({ ok: true }),
        error => { closeShell(); respond({ error: error.message || 'DiArc could not open its input frame.' }); }
      );
      return true;
    } catch (error) {
      closeShell();
      respond({ error: error.message });
    }
  });
})();
