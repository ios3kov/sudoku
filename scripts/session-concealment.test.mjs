import assert from "node:assert/strict";
import test from "node:test";
import { concealRevokedSession } from "../apps/web/features/messenger/conceal-revoked-session.ts";

test("revocation conceals before stalled storage cleanup", async () => {
  const events = []; let release;
  const gate = new Promise(resolve=>{release=resolve;});
  const done = concealRevokedSession({conceal:()=>events.push("hidden"),clearProtocol:async()=>{events.push("protocol");await gate;},clearOutbox:async()=>{events.push("outbox");}});
  assert.deepEqual(events,["hidden"]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,["hidden","protocol","outbox"]);
  release(); await done;
});
test("failed cleanup cannot prevent concealment or the other cleanup", async () => {
  const events=[];
  await concealRevokedSession({conceal:()=>events.push("hidden"),clearProtocol:()=>{throw new Error("storage failure");},clearOutbox:async()=>{events.push("outbox");}});
  assert.deepEqual(events,["hidden","outbox"]);
});
