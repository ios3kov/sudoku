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
    send(blob) {
      puts.push(this);
      assert.equal(this.method, "PUT");
      assert.ok(blob.size > 0);
      assert.ok(this.timeout > 0 && this.timeout <= 300000, "PUT must have a finite deadline");
      const outcome = outcomes.shift();
      queueMicrotask(() => {
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
    Uint8Array, ArrayBuffer, Blob, btoa, atob,
    require(name) {
      if (name === "./device-access") return { privateFetch };
      if (name === "./bounded-download") return {};
      throw new Error(`Unexpected import ${name}`);
    } };
  vm.runInNewContext(outputText, context);
  return { api: context.exports, requests, puts };
}

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
