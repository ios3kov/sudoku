import { assertBrowserCryptoCapabilities } from "./capabilities";

const DB_NAME = "sudoku-private-crypto";
const DB_VERSION = 1;
const KEY_STORE = "keys";
const STATE_STORE = "state";
const WRAPPING_KEY_ID = "protocol-state-wrapping-key";

interface StoredCiphertext {
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

function openDatabase(): Promise<IDBDatabase> {
  assertBrowserCryptoCapabilities();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open crypto storage"));
  });
}

function transactionRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function getWrappingKey(db: IDBDatabase): Promise<CryptoKey> {
  const readTx = db.transaction(KEY_STORE, "readonly");
  const existing = await transactionRequest(readTx.objectStore(KEY_STORE).get(WRAPPING_KEY_ID));
  if (existing instanceof CryptoKey) return existing;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const writeTx = db.transaction(KEY_STORE, "readwrite");
  await transactionRequest(writeTx.objectStore(KEY_STORE).put(key, WRAPPING_KEY_ID));
  return key;
}

export class BrowserProtocolStateStore {
  async put(id: string, value: Uint8Array): Promise<void> {
    const db = await openDatabase();
    try {
      const key = await getWrappingKey(db);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new Uint8Array(value.byteLength);
      plaintext.set(value);
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
      const tx = db.transaction(STATE_STORE, "readwrite");
      await transactionRequest(tx.objectStore(STATE_STORE).put(
        { iv: iv.buffer.slice(0), ciphertext } satisfies StoredCiphertext,
        id,
      ));
    } finally {
      db.close();
    }
  }

  async get(id: string): Promise<Uint8Array | null> {
    const db = await openDatabase();
    try {
      const stored = await transactionRequest(db.transaction(STATE_STORE, "readonly").objectStore(STATE_STORE).get(id)) as StoredCiphertext | undefined;
      if (!stored) return null;
      const key = await getWrappingKey(db);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(stored.iv) },
        key,
        stored.ciphertext,
      );
      return new Uint8Array(plaintext);
    } finally {
      db.close();
    }
  }

  async delete(id: string): Promise<void> {
    const db = await openDatabase();
    try {
      await transactionRequest(db.transaction(STATE_STORE, "readwrite").objectStore(STATE_STORE).delete(id));
    } finally {
      db.close();
    }
  }
}
