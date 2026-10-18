import { api, type HistoryPage } from './api';

// The server session is the sole live source. Legacy IndexedDB is left untouched.
export const readHistory = (offset = 0, signal?: AbortSignal): Promise<HistoryPage> => api.history(offset, signal);
