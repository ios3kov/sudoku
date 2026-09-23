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

/** Request success is provisional; only transaction completion acknowledges a write. */
function transact<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode,
  work: (store: IDBObjectStore, result: (value: T) => void, abort: (error: Error) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Crypto storage transaction aborted"));
    try { work(tx.objectStore(store), (value) => { result = value; }, (error) => { reject(error); tx.abort(); }); }
    catch (error) { tx.abort(); reject(error); }
  });
}

function requestInTransaction<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return transact(db, store, mode, (objectStore, result) => {
    const pending = request(objectStore);
    pending.onsuccess = () => result(pending.result);
  });
}

async function getWrappingKey(db: IDBDatabase, create = true): Promise<CryptoKey> {
  const existing = await requestInTransaction(db, KEY_STORE, "readonly", (store) => store.get(WRAPPING_KEY_ID));
  if (existing instanceof CryptoKey) return existing;
  if (existing !== undefined || !create) throw new Error("Protocol wrapping key is missing or invalid");

  // Generate outside a transaction (WebCrypto awaits would make it inactive).
  const candidate = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
  // Overlapping readwrite transactions on the same store are serialized by
  // IndexedDB, even across tabs. Recheck and insert within ONE transaction so
  // a second initializer cannot overwrite the first writer's wrapping key.
  return transact<CryptoKey>(db, KEY_STORE, "readwrite", (store, result) => {
    const read = store.get(WRAPPING_KEY_ID);
    read.onsuccess = () => {
      if (read.result instanceof CryptoKey) result(read.result);
      else if (read.result === undefined) { store.put(candidate, WRAPPING_KEY_ID); result(candidate); }
      else read.transaction!.abort();
    };
  });
}

function equalRecord(a: StoredCiphertext | undefined, b: StoredCiphertext | undefined): boolean {
  if (!a || !b) return a === b;
  const equal = (left: ArrayBuffer, right: ArrayBuffer) => {
    const x = new Uint8Array(left), y = new Uint8Array(right);
    return x.length === y.length && x.every((byte, index) => byte === y[index]);
  };
  return equal(a.iv, b.iv) && equal(a.ciphertext, b.ciphertext);
}

export class BrowserProtocolStateStore {
  // Optimistic concurrency protects separate adapter instances/tabs. Retain
  // ciphertext only, never an additional plaintext journal. A stale writer
  // fails closed instead of replacing a newer MLS ratchet/outbox snapshot.
  private readonly observed = new Map<string, StoredCiphertext | undefined>();
  private readonly closed = new Set<string>();

  async put(id: string, value: Uint8Array): Promise<void> {
    const db = await openDatabase();
    try {
      if (this.closed.has(id)) throw new Error("Crypto state is closed; reload secure messaging");
      if (!this.observed.has(id)) {
        const stored = await requestInTransaction(db, STATE_STORE, "readonly", (store) => store.get(id));
        this.observed.set(id, stored);
      }
      const expected = this.observed.get(id);
      const key = await getWrappingKey(db);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new Uint8Array(value.byteLength);
      plaintext.set(value);
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
      const record = {iv: iv.buffer.slice(0), ciphertext} satisfies StoredCiphertext;
      await transact<void>(db, STATE_STORE, "readwrite", (store, result, abort) => {
        const read = store.get(id);
        read.onsuccess = () => {
          if (this.closed.has(id)) { abort(new Error("Crypto state is closed; reload secure messaging")); return; }
          if (!equalRecord(expected, read.result)) {
            abort(new Error("Secure state changed in another tab; reload secure messaging"));
            return;
          }
          store.put(record, id);
          result(undefined);
        };
      });
      this.observed.set(id, record);
    } finally {
      db.close();
    }
  }

  async get(id: string): Promise<Uint8Array | null> {
    const db = await openDatabase();
    try {
      const stored = await requestInTransaction(db, STATE_STORE, "readonly", (store) => store.get(id)) as StoredCiphertext | undefined;
      if (!stored) { this.observed.set(id, undefined); return null; }
      const key = await getWrappingKey(db, false);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(stored.iv) },
        key,
        stored.ciphertext,
      );
      this.observed.set(id, stored);
      return new Uint8Array(plaintext);
    } finally {
      db.close();
    }
  }

  close(id: string): void {
    // Synchronously retire one adapter's view of this state. This blocks stale
    // async writes during pagehide/unmount without deleting durable MLS state.
    this.closed.add(id);
    this.observed.delete(id);
  }

  async delete(id: string): Promise<void> {
    this.close(id);
    const db = await openDatabase();
    try {
      await requestInTransaction(db, STATE_STORE, "readwrite", (store) => store.delete(id));
    } finally {
      db.close();
    }
  }
}
