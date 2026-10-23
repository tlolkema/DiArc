(() => {
  if (globalThis.__stillContentLoaded) return;
  globalThis.__stillContentLoaded = true;
  let palette, host;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'still:open') return;
    try {
      if (!host?.isConnected) {
        host = document.createElement('div');
        host.id = 'still-command-bar';
        // Important styles keep ordinary website styles from moving the overlay.
        for (const [name, value] of Object.entries({ all: 'initial', position: 'fixed', inset: '0', width: '100%', height: '100%', 'z-index': '2147483647', display: 'block' })) {
          host.style.setProperty(name, value, 'important');
        }
        document.documentElement.append(host);
        const shadow = host.attachShadow({ mode: 'closed' });
        palette = globalThis.StillPalette.mount({
          root: shadow,
          css: message.css,
          onClose: () => { host.style.setProperty('display', 'none', 'important'); }
        });
      }
      host.style.setProperty('display', 'block', 'important');
      void palette.open(message.mode);
      respond({ ok: true });
    } catch (error) { respond({ error: error.message }); }
  });
})();
