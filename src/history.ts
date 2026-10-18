export type AnalysisRecord = {
  id: string;
  createdAt: number;
  batchId?: string;
  file: File;
  originalFilename?: string;
  needsFile?: boolean;
  displayName?: string;
  request: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
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
let mutations: Promise<unknown> = Promise.resolve();
function mutate<T>(run: () => Promise<T>): Promise<T> {
  const pending = mutations.catch(() => {}).then(run);
  mutations = pending;
  return pending;
}
export const saveAnalysis = (record: AnalysisRecord) => mutate(() => transaction('readwrite', (store) => store.put(record)));
export const deleteAnalysis = (id: string) => mutate(() => transaction('readwrite', (store) => store.delete(id)));

/** Group only by persisted batch IDs; legacy records stay independent. */
export function groupHistory(records: AnalysisRecord[]): { id: string; records: AnalysisRecord[] }[] {
  const groups = new Map<string, { id: string; records: AnalysisRecord[] }>();
  for (const record of [...records].sort((a, b) => b.createdAt - a.createdAt)) {
    const id = record.batchId ? `batch:${record.batchId}` : `video:${record.id}`;
    const group = groups.get(id);
    if (group) group.records.push(record);
    else groups.set(id, { id, records: [record] });
  }
  return [...groups.values()];
}
