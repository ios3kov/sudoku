import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../apps/web/features/messenger/uploads.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} });

function harness(outcomes) {
  const requests = [];
  const puts = [];
  class FakeXHR {
    upload = {};
    headers = {};
    timeout = 0;
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    abort() { this.aborted = true; this.onabort(); }
    send(blob) {
      puts.push(this);
      assert.equal(this.method, "PUT");
      assert.ok(blob.size > 0);
      assert.ok(this.timeout > 0 && this.timeout <= 300000, "PUT must have a finite deadline");
      const outcome = outcomes.shift();
      queueMicrotask(() => {
        if (typeof outcome === "function") { outcome(this); return; }
        this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 });
        if (typeof outcome === "number") { this.status = outcome; this.onload(); }
        else this[`on${outcome}`]?.();
      });
    }
  }
  const privateFetch = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => url.endsWith("/complete")
      ? { id: "asset", e2ee_ciphertext: true }
      : { asset_id: "asset", upload_url: "https://storage.invalid/object", headers: { "If-None-Match": "*" } } };
  };
  const context = { exports: {}, crypto: webcrypto, XMLHttpRequest: FakeXHR,
    Uint8Array, ArrayBuffer, Blob, btoa, atob, DOMException,
    require(name) {
      if (name === "./device-access") return { privateFetch };
      if (name === "./bounded-download") return {};
      throw new Error(`Unexpected import ${name}`);
    } };
  vm.runInNewContext(outputText, context);
  return { api: context.exports, requests, puts };
}

test("already cancelled encrypted upload never reads the file or starts requests", async () => {
  const { api, requests, puts } = harness([]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.uploadEncryptedAsset({ arrayBuffer() { throw new Error("must not read"); } }, () => {}, controller.signal), { name: "AbortError" });
  assert.equal(requests.length, 0);
  assert.equal(puts.length, 0);
});

test("cancellation during file preparation prevents upload intent", async () => {
  const { api, requests } = harness([]);
  const controller = new AbortController();
  const file = { size: 4, async arrayBuffer() { controller.abort(); return new ArrayBuffer(4); } };
  await assert.rejects(api.uploadEncryptedAsset(file, () => {}, controller.signal), { name: "AbortError" });
  assert.equal(requests.length, 0);
});

test("cancellation aborts active encrypted PUT and prevents completion", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const { api, requests, puts } = harness([() => controller.abort()]);
  await assert.rejects(api.uploadEncryptedAsset(new File(["bytes"], "file"), () => {}, controller.signal), { name: "AbortError" });
  assert.equal(puts[0].aborted, true);
  assert.equal(requests.length, 1);
});

test("cancel after PUT success still prevents completion", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const { api, requests, puts } = harness([(xhr) => { xhr.status = 200; xhr.onload(); controller.abort(); }]);
  await assert.rejects(api.uploadEncryptedAsset(new File(["bytes"], "file"), () => {}, controller.signal), { name: "AbortError" });
  assert.equal(requests.length, 1);
  assert.equal(puts[0].aborted, undefined, "settled PUT removes its abort listener");
});

for (const name of ["uploadAsset", "uploadEncryptedAsset"]) {
  for (const [outcome, message] of [["timeout", /timed out/], ["abort", /interrupted/], ["error", /network/], [412, /412/]]) {
    test(`${name}: ${outcome} settles without completion and permits a fresh retry`, { timeout: 2000 }, async () => {
      const { api, requests, puts } = harness([outcome, 200]);
      const file = new File(["test bytes"], "note.txt", { type: "text/plain" });
      const progress = [];
      await assert.rejects(api[name](file, (value) => progress.push(value)), message);
      assert.equal(requests.filter((url) => url.endsWith("/complete")).length, 0);
      await api[name](file, (value) => progress.push(value));
      assert.equal(requests.filter((url) => url.endsWith("/complete")).length, 1);
      assert.equal(requests.filter((url) => url.endsWith("upload-intents")).length, 2);
      assert.equal(puts.length, 2);
      assert.equal(puts[0].headers["If-None-Match"], "*");
      assert.equal(progress.at(-1), 100);
    });
  }
}
