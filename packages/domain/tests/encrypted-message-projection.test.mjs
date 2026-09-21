import test from "node:test";
import assert from "node:assert/strict";
import { projectEncryptedEvents } from "../dist/encrypted-message-projection.js";

function message(eventId, senderId, sequence, body = "hello") {
  return {
    eventId,
    senderId,
    sequence,
    event: {
      kind: "message",
      messageType: "text",
      body,
      replyTo: null,
      assetIds: [],
      attachments: [],
    },
  };
}

test("projection is deterministic and ignores duplicate replay", () => {
  const events = [
    message("m1", "alice", 1),
    { eventId: "e1", senderId: "alice", sequence: 2, event: { kind: "edit", targetMessageId: "m1", body: "edited" } },
    { eventId: "r1", senderId: "bob", sequence: 3, event: { kind: "reaction", targetMessageId: "m1", emoji: "❤️", active: true } },
  ];
  const once = projectEncryptedEvents(events);
  const replayed = projectEncryptedEvents([events[2], events[0], ...events, events[1]]);

  assert.deepEqual(replayed, once);
  assert.equal(once.messages[0].body, "edited");
  assert.deepEqual(once.messages[0].reactions, [{ emoji: "❤️", userIds: ["bob"] }]);
});

test("only original sender can edit or delete a message", () => {
  const result = projectEncryptedEvents([
    message("m1", "alice", 1),
    { eventId: "bad-edit", senderId: "bob", sequence: 2, event: { kind: "edit", targetMessageId: "m1", body: "hijack" } },
    { eventId: "bad-delete", senderId: "bob", sequence: 3, event: { kind: "delete", targetMessageId: "m1" } },
  ]);

  assert.equal(result.messages[0].body, "hello");
  assert.equal(result.messages[0].deleted, false);
  assert.deepEqual(result.rejectedEventIds, ["bad-edit", "bad-delete"]);
});

test("delete clears visible content and later reactions are rejected", () => {
  const result = projectEncryptedEvents([
    message("m1", "alice", 1, "secret"),
    { eventId: "d1", senderId: "alice", sequence: 2, event: { kind: "delete", targetMessageId: "m1" } },
    { eventId: "r1", senderId: "bob", sequence: 3, event: { kind: "reaction", targetMessageId: "m1", emoji: "❤️", active: true } },
  ]);

  assert.equal(result.messages[0].deleted, true);
  assert.equal(result.messages[0].body, null);
  assert.deepEqual(result.messages[0].reactions, []);
  assert.deepEqual(result.rejectedEventIds, ["r1"]);
});

test("reaction toggles are idempotent by event id and user", () => {
  const result = projectEncryptedEvents([
    message("m1", "alice", 1),
    { eventId: "r1", senderId: "bob", sequence: 2, event: { kind: "reaction", targetMessageId: "m1", emoji: "❤️", active: true } },
    { eventId: "r2", senderId: "bob", sequence: 3, event: { kind: "reaction", targetMessageId: "m1", emoji: "❤️", active: true } },
    { eventId: "r3", senderId: "bob", sequence: 4, event: { kind: "reaction", targetMessageId: "m1", emoji: "❤️", active: false } },
  ]);

  assert.deepEqual(result.messages[0].reactions, []);
});

test("events targeting unloaded messages fail closed", () => {
  const result = projectEncryptedEvents([
    { eventId: "e1", senderId: "alice", sequence: 4, event: { kind: "edit", targetMessageId: "missing", body: "x" } },
  ]);
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.rejectedEventIds, ["e1"]);
});

test("display timestamp survives projection without affecting sequence or legacy records", () => {
 const timestamp="2026-09-21T12:00:00.000Z";
 const result=projectEncryptedEvents([
  {...message("m1","alice",1),createdAt:timestamp},
  {eventId:"edit",senderId:"alice",sequence:3,createdAt:"2026-09-20T12:00:00Z",event:{kind:"edit",targetMessageId:"m1",body:"updated"}},
  message("m2","bob",2),
 ]);
 assert.equal(result.messages[0].createdAt,timestamp);
 assert.equal(result.messages[0].body,"updated");assert.equal(result.messages[1].createdAt,undefined);
 assert.equal(result.latestSequence,3);
});
