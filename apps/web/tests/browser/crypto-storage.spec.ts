import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {} from "./support/storage-fixture";
const importFixture = new Function("url", "return import(url)") as (url: string) => Promise<{default: (entry: string) => Promise<string>}>;
let bundle: string;
test.beforeAll(async () => {
  const {default: build} = await importFixture(pathToFileURL(path.resolve(__dirname,"support/build-ux-fixture.mjs")).href);
  bundle = await build("storage-fixture.ts");
});
test.beforeEach(async ({page}) => {
  // Native origin-bound IndexedDB: this gate runs against the actual CI server,
  // not the controlled transaction scheduler used by the Node unit tests.
  await page.goto("/");
  await page.addScriptTag({content:bundle});
});
test("native IndexedDB preserves concurrent first keys and rejects stale same-state writes", async ({page}) => {
  const result = await page.evaluate(async () => {
    const Store = window.__storageAudit;
    const a = new Store(), b = new Store();
    await Promise.all([a.put("a",new Uint8Array([1])),b.put("b",new Uint8Array([2]))]);
    const first = [Array.from((await a.get("a"))!),Array.from((await b.get("b"))!)];
    await b.get("a");await a.put("a",new Uint8Array([3]));
    let conflict = false;try { await b.put("a",new Uint8Array([4])); } catch { conflict=true; }
    return {first,conflict,current:Array.from((await a.get("a"))!)};
  });
  expect(result).toEqual({first:[[1],[2]],conflict:true,current:[3]});
});
test("native request success followed by transaction abort never acknowledges durable state", async ({page}) => {
  const result = await page.evaluate(async () => {
    const store = new window.__storageAudit();
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      const request = original.apply(this,args);
      if (this.name === "state") request.addEventListener("success",()=>request.transaction!.abort());
      return request;
    };
    let rejected=false;
    try { await store.put("abort",new Uint8Array([8])); } catch { rejected=true; }
    finally {IDBObjectStore.prototype.put=original;}
    return {rejected,stored:await store.get("abort")};
  });
  expect(result).toEqual({rejected:true,stored:null});
});
