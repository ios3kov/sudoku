import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { projectEncryptedEvents } from "../dist/encrypted-message-projection.js";

test("10k encrypted events project within the mobile performance budget", () => {
  const records = [];
  let sequence = 1;

  for (let index = 0; index < 5000; index += 1) {
    const id = `m-${index}`;
    records.push({
      eventId: id,
      senderId: index % 2 ? "alice" : "bob",
      sequence: sequence++,
      event: {
        kind: "message",
        messageType: "text",
        body: `message ${index}`,
        replyTo: null,
        assetIds: [],
        attachments: [],
      },
    });
    records.push({
      eventId: `r-${index}`,
      senderId: index % 3 ? "alice" : "bob",
      sequence: sequence++,
      event: {
        kind: "reaction",
        targetMessageId: id,
        emoji: "👍",
        active: true,
      },
    });
  }

  const started = performance.now();
  const result = projectEncryptedEvents(records);
  const durationMs = performance.now() - started;

  console.log(`encrypted projection profile: 10000 events -> ${durationMs.toFixed(2)} ms`);
  assert.equal(result.messages.length, 5000);
  assert.equal(result.rejectedEventIds.length, 0);
  assert.ok(
    durationMs < 1000,
    `10k encrypted-event projection took ${durationMs.toFixed(2)} ms`,
  );
});
