import type { AnalysisRecord } from './history';

export type VideoStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type BatchVideo = { id: string; batchId?: string; createdAt?: number; request?: string; scenario?: 'flagged' | 'clear'; originalFilename?: string; needsFile?: boolean; file: File; displayName?: string; status: VideoStatus; error?: string; result?: AnalysisRecord };

export function shouldOpenCompletedResult(autoOpen: boolean, item: BatchVideo): boolean {
  return autoOpen && item.status === 'completed' && !!item.result;
}

export async function runVideoQueue(
  items: BatchVideo[], signal: AbortSignal,
  process: (item: BatchVideo) => Promise<AnalysisRecord>,
  onUpdate: (item: BatchVideo) => void,
  concurrency = 1,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer');
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < items.length) {
      const item = items[next++];
      onUpdate({ ...item, status: 'processing', error: undefined, result: undefined });
      try {
        const result = await process(item);
        if (signal.aborted) return;
        onUpdate({ ...item, status: 'completed', result });
      } catch (error) {
        if (signal.aborted) return;
        onUpdate({ ...item, status: 'failed', result: undefined, error: error instanceof Error ? error.message : 'ANALYSIS_FAILED' });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/** Sequential live queue: consult current state before each job, so restores can join a running batch. */
export async function runLiveVideoQueue(
  getItems: () => BatchVideo[], signal: AbortSignal,
  process: (item: BatchVideo, signal: AbortSignal) => Promise<AnalysisRecord>,
  onUpdate: (item: BatchVideo) => void,
  onActive: (job: { id: string; controller: AbortController } | null) => void,
) {
  while (!signal.aborted) {
    const item = getItems().find((entry) => entry.status === 'pending' && !entry.needsFile);
    if (!item) return;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    onActive({ id: item.id, controller });
    onUpdate({ ...item, status: 'processing', error: undefined });
    try {
      const result = await process(item, controller.signal);
      if (!controller.signal.aborted && getItems().some((entry) => entry.id === item.id && entry.status === 'processing')) onUpdate({ ...item, status: 'completed', result });
    } catch (error) {
      if (!controller.signal.aborted && getItems().some((entry) => entry.id === item.id)) onUpdate({ ...item, status: 'failed', error: String(error), result: undefined });
    } finally { signal.removeEventListener('abort', abort); onActive(null); }
  }
}

/** Tabs include every video in one actual batch, including cancelled videos. */
export function resultNavigationItems(items: BatchVideo[], batchId?: string, singleId?: string): BatchVideo[] {
  return items.filter((item) => (batchId ? item.batchId === batchId : item.id === singleId));
}
