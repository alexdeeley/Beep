import type { Operation } from "../shared/types.js";

const DB_NAME = "wall-offline-queue";
const STORE = "ops";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Strokes made while offline are queued here and flushed once the socket
 * reconnects. The server's idempotent insert (keyed on operation id) makes
 * this safe to retry blindly - a queued op that actually made it through
 * right before the connection dropped just gets deduplicated server-side.
 */
export class OfflineQueue {
  private dbPromise = openDb();

  async enqueue(op: Operation): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(op);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async remove(id: string): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async all(): Promise<Operation[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as Operation[]);
      req.onerror = () => reject(req.error);
    });
  }
}
