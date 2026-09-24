import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import ts from "typescript";

const source = readFileSync(new URL("../apps/web/features/messenger/bounded-download.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} });
const context = { exports: {}, Uint8Array };
vm.runInNewContext(outputText, context);
const { readBoundedDownload } = context.exports;

test("reads exact ciphertext across chunks", async () => {
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(10).fill(1));
    controller.enqueue(new Uint8Array(10).fill(2));
    controller.close();
  } });
  const bytes = await readBoundedDownload(new Response(stream), 20);
  assert.equal(bytes.length, 20);
  assert.equal(bytes[0], 1);
  assert.equal(bytes[19], 2);
  assert.equal(stream.locked, false);
});

test("cancels oversized response before retaining further chunks", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(21));
  }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedDownload(new Response(stream), 20), /exceeds/);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test("rejects truncated response", async () => {
  await assert.rejects(readBoundedDownload(new Response(new Uint8Array(19)), 20), /truncated/);
});

test("invalid metadata cancels response", async () => {
  for (const size of [NaN, Infinity, -1, 16, 20.5, 25 * 1024 * 1024 + 17]) {
    let cancelled = false;
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    await assert.rejects(readBoundedDownload(new Response(stream), size), /Invalid/);
    assert.equal(cancelled, true);
  }
});

test("read errors release the response lock", async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error("network")); } });
  await assert.rejects(readBoundedDownload(new Response(stream), 20), /network/);
  assert.equal(stream.locked, false);
});

test("aborting a real fetch interrupts a pending stream and permits retry", async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    if (request.url === "/retry") response.end(Buffer.alloc(20, 7));
    else response.write(Buffer.alloc(1));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const controller = new AbortController();
    const response = await fetch(url, { signal: controller.signal });
    const pending = readBoundedDownload(response, 20);
    const rejected = assert.rejects(pending, { name: "AbortError" });
    controller.abort();
    await rejected;
    assert.equal(response.body.locked, false);
    const retry = await readBoundedDownload(await fetch(`${url}/retry`), 20);
    assert.deepEqual(retry, new Uint8Array(20).fill(7));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
