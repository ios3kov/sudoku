import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type {} from "./support/state-store-fixture";

const directory = path.resolve(__dirname, "support");
const importCompiler = new Function("url", "return import(url)") as (url: string) => Promise<{
  default: (options: { entry: string }) => Promise<string>;
}>;
let bundle: string;
test.beforeAll(async () => {
  const compiler = await importCompiler(pathToFileURL(path.join(directory, "build-ux-fixture.mjs")).href);
  bundle = await compiler.default({ entry: "state-store-fixture.ts" });
});
test.beforeEach(async ({ page }) => {
  // Only a synthetic page, served by Playwright. Native IndexedDB and WebCrypto
  // require a non-opaque secure origin; no backend, credentials or test seam.
  await page.route("http://127.0.0.1:3000/__state-fixture", (route) => route.fulfill({
    contentType: "text/html", body: '<!doctype html><title>Storage test</title>',
  }));
  await page.goto("http://127.0.0.1:3000/__state-fixture");
  await page.addScriptTag({ content: bundle });
});

test("native IndexedDB concurrent first writes share one persisted nonextractable key", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const store = window.__stateStore;
    await Promise.all(Array.from({ length: 16 }, (_, i) => store.put(`entry-${i}`, new Uint8Array([i, 201]))));
    const values = await Promise.all(Array.from({ length: 16 }, async (_, i) => [...(await store.get(`entry-${i}`))!]));
    const key = await new Promise<CryptoKey>((resolve, reject) => {
      const open = indexedDB.open("sudoku-private-crypto", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("keys", "readonly");
        const read = tx.objectStore("keys").get("protocol-state-wrapping-key");
        tx.oncomplete = () => { db.close(); resolve(read.result); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    return { values, extractable: key.extractable, algorithm: key.algorithm.name };
  });
  expect(result.values).toEqual(Array.from({ length: 16 }, (_, i) => [i, 201]));
  expect(result.extractable).toBe(false);
  expect(result.algorithm).toBe("AES-GCM");
});

test("put does not acknowledge a request that succeeds before its transaction aborts", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const store = window.__stateStore;
    await store.put("target", new Uint8Array([7]));
    const native = IDBObjectStore.prototype.put;
    let successfulRequest = false;
    IDBObjectStore.prototype.put = function(value, key) {
      const request = native.call(this, value, key);
      if (this.name === "state") request.addEventListener("success", () => {
        successfulRequest = true;
        request.transaction!.abort();
      });
      return request;
    };
    let accepted = false;
    try { await store.put("target", new Uint8Array([8])); accepted = true; }
    catch { /* Expected: a successful request is not a successful transaction. */ }
    finally { IDBObjectStore.prototype.put = native; }
    return { accepted, successfulRequest, stored: [...(await store.get("target"))!] };
  });
  expect(result.successfulRequest).toBe(true);
  expect(result.accepted).toBe(false);
  expect(result.stored).toEqual([7]);
});

test("delete does not report success when its transaction rolls back", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const store = window.__stateStore;
    await store.put("target", new Uint8Array([9]));
    const native = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(key) {
      const request = native.call(this, key);
      request.addEventListener("success", () => request.transaction!.abort());
      return request;
    };
    let accepted = false;
    try { await store.delete("target"); accepted = true; }
    catch { /* Expected rollback. */ }
    finally { IDBObjectStore.prototype.delete = native; }
    return { accepted, stored: [...(await store.get("target"))!] };
  });
  expect(result.accepted).toBe(false);
  expect(result.stored).toEqual([9]);
});

test("an aborted wrapping-key insertion cannot orphan encrypted state", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const store = window.__stateStore;
    const native = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value, key) {
      const request = native.call(this, value, key);
      if (this.name === "keys") request.addEventListener("success", () => request.transaction!.abort());
      return request;
    };
    let accepted = false;
    try { await store.put("target", new Uint8Array([2])); accepted = true; }
    catch { /* Expected rollback before publishing any ciphertext. */ }
    finally { IDBObjectStore.prototype.add = native; }
    let orphan = false;
    try { orphan = (await store.get("target")) !== null; } catch { orphan = true; }
    await store.put("recovery", new Uint8Array([3]));
    return { accepted, orphan, recovery: [...(await store.get("recovery"))!] };
  });
  expect(result.accepted).toBe(false);
  expect(result.orphan).toBe(false);
  expect(result.recovery).toEqual([3]);
});

test("put and delete promises settle only after transaction complete", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const store = window.__stateStore;
    const put = IDBObjectStore.prototype.put;
    const remove = IDBObjectStore.prototype.delete;
    let complete = false;
    IDBObjectStore.prototype.put = function(value, key) {
      const request = put.call(this, value, key);
      if (this.name === "state") this.transaction.addEventListener("complete", () => { complete = true; });
      return request;
    };
    IDBObjectStore.prototype.delete = function(key) {
      const request = remove.call(this, key);
      this.transaction.addEventListener("complete", () => { complete = true; });
      return request;
    };
    try {
      await store.put("target", new Uint8Array([5]));
      const putCommitted = complete;
      complete = false;
      await store.delete("target");
      return { putCommitted, deleteCommitted: complete, remaining: await store.get("target") };
    } finally {
      IDBObjectStore.prototype.put = put;
      IDBObjectStore.prototype.delete = remove;
    }
  });
  expect(result).toEqual({ putCommitted: true, deleteCommitted: true, remaining: null });
});
