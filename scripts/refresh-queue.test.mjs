// Keep messenger state regressions in the existing CI test entry point.
import "./message-receipts.test.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createRefreshQueue } from "../apps/web/features/messenger/refresh-queue.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("online during markRead performs a new sync and fails closed", async () => {
  const request = createRefreshQueue();
  const readReceipt = deferred();
  let transportAvailable = true;
  let blocked = true;
  let syncs = 0;
  const refresh = async () => {
    syncs += 1;
    if (!transportAvailable) { blocked = true; return; }
    blocked = false;
    await readReceipt.promise;
  };
  const first = request(refresh);
  await nextTurn();
  assert.equal(blocked, false, "history is already visible while markRead is pending");
  transportAvailable = false;
  const online = request(refresh);
  readReceipt.resolve();
  await Promise.all([first, online]);
  assert.equal(syncs, 2, "the online notification must not reuse the stale sync");
  assert.equal(blocked, true, "authoring must fail closed after the new sync fails");
});

test("a burst coalesces to the latest callback and callers await its completion", async () => {
  const request = createRefreshQueue();
  const firstGate = deferred();
  const followUpGate = deferred();
  const calls = [];
  const first = request(async () => { calls.push("first"); await firstGate.promise; });
  await nextTurn();
  request(async () => { calls.push("obsolete"); });
  const last = request(async () => { calls.push("latest"); await followUpGate.promise; });
  assert.equal(first, last);
  let settled = false;
  void last.then(() => { settled = true; });
  assert.deepEqual(calls, ["first"]);
  firstGate.resolve();
  await nextTurn();
  assert.deepEqual(calls, ["first", "latest"]);
  assert.equal(settled, false);
  followUpGate.resolve();
  await last;
  assert.equal(settled, true);
});

test("an event during the follow-up schedules another serialized pass", async () => {
  const request = createRefreshQueue();
  const gates = [deferred(), deferred(), deferred()];
  let started = 0;
  let active = 0;
  let maximum = 0;
  const work = async () => {
    const index = started++;
    maximum = Math.max(maximum, ++active);
    await gates[index].promise;
    active -= 1;
  };
  const completion = request(work);
  await nextTurn();
  request(work);
  gates[0].resolve();
  await nextTurn();
  assert.equal(started, 2);
  request(work);
  gates[1].resolve();
  await nextTurn();
  assert.equal(started, 3);
  gates[2].resolve();
  await completion;
  assert.equal(maximum, 1);
});

test("idle calls execute again after the previous drain finishes", async () => {
  const request = createRefreshQueue();
  let count = 0;
  await request(async () => { count += 1; });
  await request(async () => { count += 1; });
  assert.equal(count, 2);
});

test("a rejected task releases the queue and preserves its rejection", async () => {
  const request = createRefreshQueue();
  const failure = new Error("unexpected failure");
  await assert.rejects(request(async () => { throw failure; }), (error) => error === failure);
  let retried = false;
  await request(async () => { retried = true; });
  assert.equal(retried, true);
});

test("synchronous task failure rejects the promise and still permits recovery", async () => {
  const request = createRefreshQueue();
  const failure = new Error("synchronous failure");
  await assert.rejects(request(() => { throw failure; }), (error) => error === failure);
  await request(async () => undefined);
});

test("independent queues do not block each other", async () => {
  const first = createRefreshQueue();
  const second = createRefreshQueue();
  const gate = deferred();
  const pending = first(() => gate.promise);
  let done = false;
  await second(async () => { done = true; });
  assert.equal(done, true);
  gate.resolve();
  await pending;
});
