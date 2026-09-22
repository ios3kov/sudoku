import type { EncryptedAttachmentMetadata } from "../../../features/messenger/types";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Transport/hardware boundaries only: the tested React views and state store
// remain the actual production modules. No fixture enters the application.
export const controls = {
  permissions: [] as Array<ReturnType<typeof deferred<MediaStream>>>,
  tracks: [] as Array<{ stopped: boolean; stop: () => void }>,
  recorders: [] as Recorder[],
  decryptions: [] as Array<ReturnType<typeof deferred<File>>>,
  uploads: [] as Array<ReturnType<typeof deferred<unknown>>>,
  sends: [] as unknown[],
  createdUrls: [] as string[],
  revokedUrls: [] as string[],
  observers: new Set<() => void>(),
  intersecting: true,
  failConstructor: false,
  failStart: false,
  blocked: false,
  metadata: {
    version: 1, algorithm: "AES-256-GCM", assetId: "asset-one",
    keyB64: "AA==", nonceB64: "AA==", originalName: "private.txt",
    originalMime: "text/plain", plaintextSize: 7,
    plaintextSha256Hex: "0".repeat(64), ciphertextSha256Hex: "1".repeat(64),
  } as EncryptedAttachmentMetadata,
  grant(index = 0) {
    const track = { stopped: false, stop() { this.stopped = true; } };
    this.tracks.push(track);
    this.permissions[index].resolve({ getTracks: () => [track] } as unknown as MediaStream);
  },
  intersection(visible: boolean) {
    this.intersecting = visible;
    [...this.observers].forEach((notify) => notify());
  },
};

export class Recorder {
  static isTypeSupported() { return true; }
  mimeType = "audio/webm";
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    if (controls.failConstructor) throw new Error("unsupported recorder");
    controls.recorders.push(this);
  }
  start() {
    if (controls.failStart) throw new Error("failed to start");
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    // Events are queued, like native MediaRecorder. A failed/cancelled recorder
    // must detach listeners before the queued stop can publish any voice data.
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["voice"]) });
      this.onstop?.();
    });
  }
  fail() {
    this.onerror?.();
    this.stop();
  }
}
