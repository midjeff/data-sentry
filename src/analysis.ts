import type { AnalysisRecord } from './history';
import type { BatchVideo } from './batch';

export const DEMO_SCAN_DURATION_MS = 6000;
export type DemoContext = { batchId: string; request: string; scenario: 'flagged' | 'clear' };

function simulateScan(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, DEMO_SCAN_DURATION_MS);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Local demo only: no AI inference or external requests are performed. */
export async function analyzeDemoVideo(video: BatchVideo, signal: AbortSignal, context: DemoContext): Promise<AnalysisRecord> {
  signal.throwIfAborted();
  await video.file.slice(0, 1).arrayBuffer();
  signal.throwIfAborted();
  await simulateScan(signal);
  return {
    id: video.id, status: 'completed', batchId: context.batchId, createdAt: video.createdAt ?? Date.now(),
    file: video.file, displayName: video.displayName,
    request: context.request, scenario: context.scenario,
  };
}
