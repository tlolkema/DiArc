import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteAccessController, SITE_ORIGINS } from '../site-access.js';

function fixture(initial = false) {
  const states = [], calls = [];
  let granted = initial;
  const permissions = {
    contains: async request => { calls.push(['contains', request]); return granted; },
    request: async request => { calls.push(['request', request]); granted = true; return true; }
  };
  const controller = createSiteAccessController({ permissions, onChange: state => states.push(state) });
  return { controller, permissions, states, calls, last: () => states.at(-1), grant: value => { granted = value; } };
}

test('startup checks granted access without showing a permission prompt', async () => {
  const f = fixture(true);
  assert.equal(await f.controller.refresh(), true);
  assert.equal(f.last().status, 'granted');
  assert.deepEqual(f.calls, [['contains', { origins: [...SITE_ORIGINS] }]]);
});

test('missing access presents a request action but never prompts automatically', async () => {
  const f = fixture();
  assert.equal(await f.controller.refresh(), false);
  assert.equal(f.last().status, 'missing');
  assert.equal(f.last().canRequest, true);
  assert.equal(f.calls.filter(([name]) => name === 'request').length, 0);
});

test('a user request calls the native API immediately and verifies the actual grant', async () => {
  const f = fixture();
  const result = f.controller.requestAccess();
  assert.equal(f.calls[0][0], 'request', 'The permission request must run before yielding the user gesture.');
  assert.deepEqual(f.calls[0][1], { origins: [...SITE_ORIGINS] });
  assert.equal(await result, true);
  assert.equal(f.last().status, 'granted');
});

test('declining access leaves a retry action and manual site-access guidance', async () => {
  const f = fixture();
  f.permissions.request = async () => false;
  assert.equal(await f.controller.requestAccess(), false);
  assert.equal(f.last().status, 'missing');
  assert.match(f.last().message, /not granted.*On All Sites/);
});

test('a failed native prompt is reported and a later click can retry', async () => {
  const f = fixture();
  f.permissions.request = async () => { throw new Error('Blocked by browser policy'); };
  assert.equal(await f.controller.requestAccess(), false);
  assert.match(f.last().message, /Blocked by browser policy/);
  f.permissions.request = async () => { f.grant(true); return true; };
  assert.equal(await f.controller.requestAccess(), true);
  assert.equal(f.last().status, 'granted');
});

test('a stale access check cannot overwrite a newly approved grant', async () => {
  const f = fixture();
  let resolveOld;
  f.permissions.contains = () => new Promise(resolve => { resolveOld = resolve; });
  const old = f.controller.refresh();
  f.permissions.contains = async () => true;
  assert.equal(await f.controller.requestAccess(), true);
  resolveOld(false);
  await old;
  assert.equal(f.last().status, 'granted');
});

test('repeated clicks do not open concurrent permission prompts', async () => {
  const f = fixture();
  let release, prompts = 0;
  f.permissions.request = () => { prompts++; return new Promise(resolve => { release = resolve; }); };
  const first = f.controller.requestAccess();
  assert.equal(await f.controller.requestAccess(), false);
  assert.equal(prompts, 1);
  f.grant(true); release(true);
  assert.equal(await first, true);
});

test('unsupported or failing permission checks offer manual recovery without throwing', async () => {
  const states = [];
  const unsupported = createSiteAccessController({ permissions: undefined, onChange: state => states.push(state) });
  assert.equal(await unsupported.refresh(), false);
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).canRequest, false);
  assert.equal(await unsupported.requestAccess(), false);
  const f = fixture();
  f.permissions.contains = async () => { throw new Error('Unavailable'); };
  await f.controller.refresh();
  assert.equal(f.last().status, 'error');
  assert.match(f.last().message, /Manage site access/);
});
