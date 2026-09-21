import assert from "node:assert/strict";
import test from "node:test";
import { applyReadReceipt } from "../apps/web/features/messenger/conversation-receipts.ts";
const base = { id: "chat", latest_sequence: 42, last_read_sequence: 4,
  members: [{id: "me", last_read_sequence: 4}, {id: "peer", last_read_sequence: 2}], title: "Current title" };

test("peer receipts change only the matching member and never roll backwards", () => {
  const next = applyReadReceipt(base, "me", "peer", 12);
  assert.equal(next.members[1].last_read_sequence, 12);
  assert.equal(next.last_read_sequence, 4);
  assert.equal(next.latest_sequence, 42);
  assert.equal(next.title, "Current title");
  assert.equal(base.members[1].last_read_sequence, 2);
  assert.equal(applyReadReceipt(next, "me", "peer", 6), next);
});
test("acknowledged current-user reads update the unread watermark and own member", () => {
  const next = applyReadReceipt(base, "me", "me", 30);
  assert.equal(next.last_read_sequence, 30);
  assert.equal(next.members[0].last_read_sequence, 30);
  assert.equal(next.members[1], base.members[1]);
});
test("unknown readers and invalid sequences cannot invent read receipts", () => {
  assert.equal(applyReadReceipt(base, "me", "missing", 99), base);
  for (const sequence of [NaN, Infinity, -1, 1.1, "12"]) {
    assert.equal(applyReadReceipt(base, "me", "peer", sequence), base);
  }
});
