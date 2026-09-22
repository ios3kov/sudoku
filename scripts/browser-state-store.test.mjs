import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const {outputText} = ts.transpileModule(readFileSync(new URL("../apps/web/features/messenger/crypto/browser-state-store.ts", import.meta.url), "utf8"), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
});

// Deliberately models request success BEFORE transaction commit, serialized
// transactions and rollback. Native WebCrypto still encrypts/decrypts all data.
function harness({race = false} = {}) {
  const stores = {keys: new Map(), state: new Map()}, queue = [];
  let running = false, abortNextWrite = false, generated = 0, releaseGeneration;
  const gate = new Promise(resolve => { releaseGeneration = resolve; });
  function next() { if (!running && queue.length) { running = true; queue.shift()(); } }
  const db = {close() {}, transaction(name, mode) {
    const jobs = []; let snapshot, active = false, ended = false;
    const tx = {error: null, abort() { tx.error = new Error("Aborted transaction"); finish(false); }, objectStore() {
      const request = (operation, key, value) => {
        const req = {transaction: tx};
        jobs.push(() => {
          if (operation === "put") { snapshot.set(key, value); req.result = key; }
          else if (operation === "delete") { snapshot.delete(key); req.result = undefined; }
          else req.result = snapshot.get(key);
          try { req.onsuccess?.(); } catch (error) { tx.error = error; finish(false); }
        });
        return req;
      };
      return {get: key => request("get",key), put: (value,key) => request("put",key,value), delete: key => request("delete",key)};
    }};
    function finish(commit) {
      if (ended) return; ended = true;
      if (commit && mode === "readwrite") stores[name] = snapshot;
      if (commit) tx.oncomplete?.(); else tx.onabort?.();
      if (active) {running = false; next();}
    }
    function process() {
      if (ended) return;
      if (jobs.length) { jobs.shift()(); setImmediate(process); }
      else if (name === "state" && mode === "readwrite" && abortNextWrite) {
        abortNextWrite = false; tx.error = new Error("Commit rejected after request success"); finish(false);
      } else finish(true);
    }
    queue.push(() => {active = true; snapshot = new Map(stores[name]); setImmediate(process);});
    next(); return tx;
  }};
  const exports = {};
  vm.runInNewContext(outputText, {exports, Uint8Array, ArrayBuffer, CryptoKey: globalThis.CryptoKey,
    require: () => ({assertBrowserCryptoCapabilities() {}}),
    indexedDB: {open() {const req = {result: db}; setImmediate(() => req.onsuccess()); return req;}},
    crypto: {getRandomValues: value => webcrypto.getRandomValues(value), subtle: {
      async generateKey(...args) {
        const key = await webcrypto.subtle.generateKey(...args); generated += 1;
        if (race) { if (generated === 2) releaseGeneration(); await gate; }
        return key;
      }, encrypt: (...args) => webcrypto.subtle.encrypt(...args), decrypt: (...args) => webcrypto.subtle.decrypt(...args),
    }},
  });
  return {Store: exports.BrowserProtocolStateStore, abort() {abortNextWrite = true;}, stores};
}

test("concurrent first writers share one wrapping key without corrupting either state", async () => {
  const {Store} = harness({race:true});
  const a = new Store(), b = new Store();
  await Promise.all([a.put("a",new Uint8Array([1,2])), b.put("b",new Uint8Array([3,4]))]);
  assert.deepEqual(await a.get("a"), new Uint8Array([1,2]));
  assert.deepEqual(await b.get("b"), new Uint8Array([3,4]));
});
test("a successful put request is not acknowledged when its transaction aborts", async () => {
  const h = harness(); const store = new h.Store(); h.abort();
  await assert.rejects(store.put("a",new Uint8Array([5])), /Commit rejected/);
  assert.equal(await store.get("a"),null);
});
test("delete waits for commit and does not report success after rollback", async () => {
  const h = harness(); const store = new h.Store(); await store.put("a",new Uint8Array([6])); h.abort();
  await assert.rejects(store.delete("a"), /Commit rejected/);
  assert.deepEqual(await store.get("a"),new Uint8Array([6]));
});
test("committed state round-trips, deletes and keeps nonextractable wrapping keys", async () => {
  const h = harness(); const store = new h.Store();
  await store.put("a",new Uint8Array([7])); assert.deepEqual(await store.get("a"),new Uint8Array([7]));
  assert.equal(h.stores.keys.get("protocol-state-wrapping-key").extractable,false);
  await store.delete("a"); assert.equal(await store.get("a"),null);
});

test("stale state loaded by a second adapter cannot overwrite a newer commit", async () => {
  const {Store} = harness(); const a = new Store(), b = new Store();
  await a.put("same", new Uint8Array([1])); await b.get("same");
  await a.put("same", new Uint8Array([2]));
  await assert.rejects(b.put("same", new Uint8Array([3])), /changed|reload/i);
  assert.deepEqual(await a.get("same"), new Uint8Array([2]));
});
test("revocation deletion prevents a stale adapter from resurrecting state", async () => {
  const {Store} = harness(); const a = new Store(), b = new Store();
  await a.put("same", new Uint8Array([1])); await b.get("same");
  await a.delete("same");
  await assert.rejects(b.put("same", new Uint8Array([3])), /changed|reload/i);
  await assert.rejects(a.put("same", new Uint8Array([4])), /closed|reload/i);
  assert.equal(await new Store().get("same"),null);
});
