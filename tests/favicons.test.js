import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFaviconLoader } from '../favicons.js';

const cached = await readFile(new URL('../icons/diarc-swoosh-16.png', import.meta.url));
const fallback = await readFile(new URL('../icons/diarc-swoosh-32.png', import.meta.url));
function fixture() {
  const calls = [];
  let current = cached;
  const loader = createFaviconLoader({
    getURL: path => `chrome-extension://test/${path}`,
    fetcher: async endpoint => {
      calls.push(endpoint);
      const url = new URL(endpoint);
      const bytes = url.searchParams.get('pageUrl').includes('diarc-no-favicon.invalid') ? fallback : current;
      if (bytes instanceof Error) throw bytes;
      return { ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
    }
  });
  return { loader, calls, set: bytes => { current = bytes; } };
}

test('favicons come from the extension cache endpoint and return local PNG data', async () => {
  const f = fixture();
  assert.equal(await f.loader('https://example.com/a'), `data:image/png;base64,${cached.toString('base64')}`);
  assert.ok(f.calls.every(endpoint => endpoint.startsWith('chrome-extension://test/_favicon/?')));
  assert.ok(f.calls.some(endpoint => new URL(endpoint).searchParams.get('pageUrl') === 'https://example.com/a'));
  await f.loader('https://example.com/a');
  assert.equal(f.calls.length, 2, 'The fallback and cached site icon should each be fetched once.');
});

test('missing icons retain the vector fallback and can be retried after a visit', async () => {
  const f = fixture();
  f.set(fallback);
  assert.equal(await f.loader('https://example.com'), null);
  f.set(cached);
  assert.ok((await f.loader('https://example.com')).startsWith('data:image/png;base64,'));
  assert.equal(f.calls.length, 3);
});

test('non-web URLs never trigger favicon requests', async () => {
  const f = fixture();
  for (const url of ['javascript:alert(1)', 'data:text/plain,hi', 'chrome://settings', 'file:///tmp/a', 'invalid']) assert.equal(await f.loader(url), null);
  assert.deepEqual(f.calls, []);
});

test('unavailable, malformed, and oversized icons fail without breaking results', async () => {
  const f = fixture();
  for (const bytes of [new Error('Cache unavailable'), new Uint8Array([1, 2, 3]), new Uint8Array(40000)]) {
    f.set(bytes);
    assert.equal(await f.loader('https://example.com'), null);
  }
});

test('favicon memory stays bounded rather than retaining every searched URL', async () => {
  const f = fixture();
  for (let i = 0; i < 130; i++) await f.loader(`https://example.com/${i}`);
  const before = f.calls.length;
  await f.loader('https://example.com/0');
  assert.equal(f.calls.length, before + 1, 'The oldest favicon should leave the bounded cache.');
});
