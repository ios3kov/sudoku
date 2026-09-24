import { expect, test } from "@playwright/test";
import { decryptApplicationEvent } from "../../features/messenger/crypto/openmls-events";
import type { E2eeEnvelope } from "../../features/messenger/types";

const envelope: E2eeEnvelope = {
  version: 1,
  protocol: "mls-rfc9420",
  kind: "application",
  ciphertext: btoa("ciphertext"),
};

const baseAttachment = {
  version: 1,
  algorithm: "AES-256-GCM",
  assetId: "asset-voice",
  keyB64: "key",
  nonceB64: "nonce",
  originalName: "voice.webm",
  originalMime: "audio/webm",
  plaintextSize: 1200,
  plaintextSha256Hex: "0".repeat(64),
  ciphertextSha256Hex: "1".repeat(64),
};

function decryptor(payload: unknown) {
  return {
    decryptApplication: () =>
      new TextEncoder().encode(JSON.stringify(payload)),
  };
}

test("voice presentation survives the MLS application event boundary", () => {
  const voice = {
    durationMs: 4_200,
    waveform: [0.1, 0.4, 0.9, 0.3],
  };
  const result = decryptApplicationEvent(
    decryptor({
      version: 1,
      kind: "message",
      messageType: "voice",
      body: null,
      replyTo: null,
      assetIds: ["asset-voice"],
      attachments: [{ ...baseAttachment, voice }],
    }),
    "conversation",
    envelope,
  );

  expect(result.event.kind).toBe("message");
  if (result.event.kind !== "message") throw new Error("Expected message event");
  expect(result.event.attachments[0]).toMatchObject({ voice });
});

test("malformed encrypted voice presentation fails closed at the MLS boundary", () => {
  expect(() =>
    decryptApplicationEvent(
      decryptor({
        version: 1,
        kind: "message",
        messageType: "voice",
        body: null,
        replyTo: null,
        assetIds: ["asset-voice"],
        attachments: [{
          ...baseAttachment,
          voice: { durationMs: 4_200, waveform: [0.2, 2] },
        }],
      }),
      "conversation",
      envelope,
    )
  ).toThrow("Invalid decrypted MLS message event");
});
