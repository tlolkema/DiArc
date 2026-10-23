const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const sameBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

export function createFaviconLoader({ getURL, fetcher = fetch, timeout = 400 }) {
  const cache = new Map();
  let defaultIcon;

  async function read(pageUrl) {
    try {
      const endpoint = new URL(getURL('_favicon/'));
      endpoint.searchParams.set('pageUrl', pageUrl);
      endpoint.searchParams.set('size', '32');
      const response = await fetcher(endpoint.href, { signal: AbortSignal.timeout(timeout) });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 32768 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null;
      return bytes;
    } catch { return null; }
  }

  return async function favicon(pageUrl) {
    let url;
    try {
      url = new URL(pageUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
    } catch { return null; }
    const key = url.href;
    if (cache.has(key)) return cache.get(key);
    defaultIcon ||= read('https://diarc-no-favicon.invalid/');
    const pending = Promise.all([read(key), defaultIcon]).then(([bytes, fallback]) => {
      if (!bytes || (fallback && sameBytes(bytes, fallback))) {
        if (cache.get(key) === pending) cache.delete(key);
        return null;
      }
      // Send only a local PNG data URL. Websites never fetch the favicon themselves,
      // and no web-accessible extension resources are required.
      return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    });
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, pending);
    return pending;
  };
}
