import { expect, test } from "@playwright/test";
import { applyReadReceipt } from "../../features/messenger/conversation-receipts";
import { typingPresenceLabel } from "../../features/messenger/typing-presence";
import type { Conversation } from "../../features/messenger/types";

test("typing presence labels direct, pair and larger group activity without content", () => {
  expect(typingPresenceLabel([])).toBeNull();
  expect(typingPresenceLabel(["Alice"])).toBe("Alice is typing…");
  expect(typingPresenceLabel(["Alice", "Bob"])).toBe("Alice and Bob are typing…");
  expect(typingPresenceLabel(["Alice", "Bob", "Carol"])).toBe("3 people are typing…");
});

test("read receipt merge is monotonic and never lets stale realtime state move backward", () => {
  const conversation = {
    id: "chat",
    last_read_sequence: 7,
    members: [
      { id: "me", last_read_sequence: 7 },
      { id: "peer", last_read_sequence: 5 },
    ],
  } as unknown as Conversation;

  const advanced = applyReadReceipt(conversation, "me", "peer", 9);
  expect(advanced.members.find((member) => member.id === "peer")?.last_read_sequence).toBe(9);

  const stale = applyReadReceipt(advanced, "me", "peer", 4);
  expect(stale).toBe(advanced);
  expect(stale.members.find((member) => member.id === "peer")?.last_read_sequence).toBe(9);

  const own = applyReadReceipt(stale, "me", "me", 10);
  expect(own.last_read_sequence).toBe(10);
  expect(own.members.find((member) => member.id === "me")?.last_read_sequence).toBe(10);
});
