import type { BatchVideo } from './batch';
import type { DemoContext } from './analysis';
export type QueueSnapshot = { items: BatchVideo[]; context: DemoContext };
function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('data-sentry-queue', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('queue');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function access(mode: IDBTransactionMode, value?: QueueSnapshot): Promise<QueueSnapshot | undefined> {
  const db = await openQueue();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('queue', mode);
      const store = tx.objectStore('queue');
      const request = value ? store.put(value, 'current') : store.get('current');
      tx.oncomplete = () => resolve(value ?? request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
let writes: Promise<unknown> = Promise.resolve();
export const saveQueue = (value: QueueSnapshot) => {
  const write = writes.catch(() => {}).then(() => access('readwrite', value));
  writes = write;
  return write;
};
export async function readQueue() {
  const snapshot = await access('readonly');
  if (!snapshot) return undefined;
  snapshot.items = recoverQueueItems(snapshot.items);
  return snapshot;
}

export function recoverQueueItems(items: BatchVideo[]): BatchVideo[] {
  return items.map((item) => ({ ...item,
    // Interrupted scans restart only after an explicit Restore.
    status: item.status === 'processing' || item.status === 'pending' ? 'cancelled' : item.status,
    needsFile: !item.file || item.file.size === 0,
    file: item.file ?? new File([], item.originalFilename ?? item.displayName ?? 'video'),
  }));
}
