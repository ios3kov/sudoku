import type { PendingMessage } from "./types";

const DB_NAME = "sudoku-private-v1";
const DB_VERSION = 1;
const OUTBOX_STORE = "outbox";
const KEYS_STORE = "keys";
const OUTBOX_KEY_ID = "outbox-aes-gcm-v1";

interface StoredOutboxItem {
  client_id: string;
  conversation_id: string;
  created_at: number;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: "client_id" });
      if (!db.objectStoreNames.contains(KEYS_STORE)) db.createObjectStore(KEYS_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function getOrCreateKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const tx = db.transaction(KEYS_STORE, "readonly");
    const request = tx.objectStore(KEYS_STORE).get(OUTBOX_KEY_ID);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error ?? new Error("Key read failed"));
  });
  if (existing) return existing;

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEYS_STORE, "readwrite");
    tx.objectStore(KEYS_STORE).put(key, OUTBOX_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Key write failed"));
  });
  return key;
}

function encode(value: PendingMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decode(value: ArrayBuffer): PendingMessage {
  return JSON.parse(new TextDecoder().decode(value)) as PendingMessage;
}

export async function enqueuePending(message: PendingMessage): Promise<void> {
  const db = await openDb();
  try {
    const key = await getOrCreateKey(db);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encode(message));
    const stored: StoredOutboxItem = {
      client_id: message.client_id,
      conversation_id: message.conversation_id,
      created_at: message.created_at,
      iv,
      ciphertext,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readwrite");
      tx.objectStore(OUTBOX_STORE).put(stored);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Outbox write failed"));
    });
  } finally {
    db.close();
  }
}

export async function listPending(): Promise<PendingMessage[]> {
  const db = await openDb();
  try {
    const key = await getOrCreateKey(db);
    const rows = await new Promise<StoredOutboxItem[]>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readonly");
      const request = tx.objectStore(OUTBOX_STORE).getAll();
      request.onsuccess = () => resolve(request.result as StoredOutboxItem[]);
      request.onerror = () => reject(request.error ?? new Error("Outbox read failed"));
    });
    const result: PendingMessage[] = [];
    for (const row of rows) {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv }, key, row.ciphertext);
      result.push(decode(plaintext));
    }
    return result.sort((a, b) => a.created_at - b.created_at);
  } finally {
    db.close();
  }
}

export async function removePending(clientId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readwrite");
      tx.objectStore(OUTBOX_STORE).delete(clientId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Outbox delete failed"));
    });
  } finally {
    db.close();
  }
}

export async function clearPending(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, "readwrite");
      tx.objectStore(OUTBOX_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Outbox clear failed"));
    });
  } finally {
    db.close();
  }
}
