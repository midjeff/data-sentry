export type AnalysisRecord = {
  id: string;
  createdAt: number;
  file: File;
  request: string;
  scenario: 'flagged' | 'clear';
};

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('data-sentry-history', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('analyses', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('analyses', mode);
      const request = run(tx.objectStore('analyses'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export const readHistory = () => transaction('readonly', (store) => store.getAll()) as Promise<AnalysisRecord[]>;
export const saveAnalysis = (record: AnalysisRecord) => transaction('readwrite', (store) => store.put(record));
export const deleteAnalysis = (id: string) => transaction('readwrite', (store) => store.delete(id));
