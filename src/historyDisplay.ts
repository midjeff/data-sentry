import type { JobSummary } from './api';

export type HistoryPreferences = { showStatusIcons: boolean; showBatchGrouping: boolean };
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function readHistoryPreferences(storage: PreferenceStorage): HistoryPreferences {
  const read = (key: string) => { try { return storage.getItem(key) !== 'false'; } catch { return true; } };
  return { showStatusIcons: read('showHistoryStatusIcons'), showBatchGrouping: read('showHistoryBatchGrouping') };
}
export function saveHistoryPreferences(storage: PreferenceStorage, preferences: HistoryPreferences) {
  try {
    storage.setItem('showHistoryStatusIcons', String(preferences.showStatusIcons));
    storage.setItem('showHistoryBatchGrouping', String(preferences.showBatchGrouping));
  } catch { /* Preferences still work when browser storage is unavailable. */ }
}

export function historyViolationStatus(record: Pick<JobSummary, 'verdict' | 'status'>): 'flagged' | 'clear' | undefined {
  if (record.status !== 'done') return undefined;
  return record.verdict === 'violation' ? 'flagged' : record.verdict === 'no_violation' ? 'clear' : undefined;
}
export function groupHistory(records: JobSummary[]): { id: string; records: JobSummary[] }[] {
  const groups = new Map<string, { id: string; records: JobSummary[] }>();
  for (const record of records) {
    const id = record.batchId ? `batch:${record.batchId}` : `video:${record.id}`;
    const group = groups.get(id);
    if (group) group.records.push(record); else groups.set(id, { id, records: [record] });
  }
  return [...groups.values()];
}
