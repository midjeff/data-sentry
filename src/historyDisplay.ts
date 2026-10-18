import type { AnalysisRecord } from './history';

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

// Legacy saved records are completed demos. Queue entries must never receive a success icon.
export function historyViolationStatus(record: Pick<AnalysisRecord, 'scenario' | 'status'>): 'flagged' | 'clear' | undefined {
  if (record.status !== undefined && record.status !== 'completed') return undefined;
  return record.scenario === 'flagged' || record.scenario === 'clear' ? record.scenario : undefined;
}
