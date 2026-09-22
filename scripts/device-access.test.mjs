import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { acceptUnlock, accessEpoch, currentUnlockToken, forgetUnlock, lockDevice, privateFetch, rememberEmail, savedEmail, requireDevicePin, DEVICE_LOCK_EVENT, UNLOCK_HEADER } from '../apps/web/features/messenger/device-access.ts';

const originalFetch = globalThis.fetch;
const ticket = 'a'.repeat(43);
let calls;
beforeEach(() => {
  forgetUnlock(); calls = [];
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  globalThis.window = new EventTarget();
  globalThis.fetch = async (input, init) => { calls.push([input, init]); return new Response('{}'); };
});
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.window; delete globalThis.localStorage; forgetUnlock(); });

test('only a valid current-generation ticket is accepted; PIN is never accepted as a ticket', () => {
  assert.equal(acceptUnlock('0123', accessEpoch()), false);
  assert.equal(acceptUnlock(ticket, accessEpoch()), true);
  const old = accessEpoch(); forgetUnlock();
  assert.equal(acceptUnlock(ticket, old), false);
  assert.equal(currentUnlockToken(), null);
});
test('remember and forget email; blocked storage does not throw or save credentials', () => {
  assert.equal(rememberEmail('admin@example.com', true), true);
  assert.equal(savedEmail(), 'admin@example.com');
  assert.equal(rememberEmail('0123', true), false);
  assert.equal(rememberEmail('', false), true);
  assert.equal(savedEmail(), '');
  globalThis.localStorage = { getItem(){ throw Error('blocked'); }, setItem(){ throw Error('blocked'); }, removeItem(){ throw Error('blocked'); } };
  assert.equal(savedEmail(), ''); assert.equal(rememberEmail('user@example.com', true), false);
});
test('cookie requests carry the ticket only for same-origin private paths', async () => {
  acceptUnlock(ticket, accessEpoch());
  await privateFetch('/v1/me', { credentials: 'include' });
  assert.equal(new Headers(calls[0][1].headers).get(UNLOCK_HEADER), ticket);
  assert.equal(calls[0][1].redirect, 'error');
  await privateFetch('https://assets.example.com/file', { credentials: 'omit' });
  assert.equal(new Headers(calls[1][1].headers).get(UNLOCK_HEADER), null);
});
test('locked response is retryable without 4xx status so outbox clients cannot discard messages', async () => {
  let locks = 0; window.addEventListener(DEVICE_LOCK_EVENT, () => locks++);
  globalThis.fetch = async () => new Response('', { status: 423 });
  await assert.rejects(privateFetch('/v1/conversations'), (e) => e.name === 'AbortError' && e.status === undefined);
  assert.equal(locks, 1); assert.equal(currentUnlockToken(), null);
});
test('a response completing after hide is discarded', async () => {
  let finish;
  globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  const request = privateFetch('/v1/me');
  forgetUnlock(); finish(new Response('{}'));
  await assert.rejects(request, { name: 'AbortError' });
});
test('lock forgets immediately and only sends the old capability for server invalidation', async () => {
  acceptUnlock(ticket, accessEpoch());
  lockDevice();
  assert.equal(currentUnlockToken(), null);
  assert.equal(calls[0][0], '/v1/auth/device-access/lock');
  assert.equal(calls[0][1].headers[UNLOCK_HEADER], ticket);
  requireDevicePin(); assert.equal(currentUnlockToken(), null);
});
test('asset redirect is resolved as JSON; capability and cookies never reach object storage', async () => {
  acceptUnlock(ticket, accessEpoch());
  globalThis.fetch = async (input, init) => {
    calls.push([input, init]);
    return input.endsWith('/download-url') ? Response.json({url: 'https://assets.example.com/signed'}) : new Response('encrypted');
  };
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal(await (await privateFetch(`/v1/assets/${id}/content`)).text(), 'encrypted');
  assert.equal(calls[0][0], `/v1/assets/${id}/download-url`);
  assert.equal(new Headers(calls[0][1].headers).get(UNLOCK_HEADER), ticket);
  assert.equal(calls[1][0], 'https://assets.example.com/signed');
  assert.equal(calls[1][1].credentials, 'omit');
  assert.equal(calls[1][1].redirect, 'error');
  assert.equal(new Headers(calls[1][1].headers).get(UNLOCK_HEADER), null);
});

test('a stale rejected ticket cannot clear a newer successful unlock', async () => {
  acceptUnlock(ticket, accessEpoch());
  let finish; let locks = 0;
  window.addEventListener(DEVICE_LOCK_EVENT, () => locks++);
  globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  const request = privateFetch('/v1/me');
  const newer = 'b'.repeat(43);
  acceptUnlock(newer, accessEpoch());
  finish(new Response('', { status: 423 }));
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(currentUnlockToken(), newer); assert.equal(locks, 0);
});
