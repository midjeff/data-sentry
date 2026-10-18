import { api, errorCode, isAbort, type Job } from './api';

// Schedule after completion; ignore every delivery after selection changes.
export function watchJob(jobId: string, onJob: (job: Job) => void, onError: (code: string) => void,
  getJob = api.job, delay = 2000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  async function poll() {
    let again = true;
    try {
      const job = await getJob(jobId, controller.signal);
      if (stopped) return;
      onJob(job); again = job.status === 'processing';
    } catch (error) {
      if (stopped || isAbort(error)) return;
      const code = errorCode(error); onError(code);
      again = code === 'NETWORK_ERROR' || code === 'SERVER_UNAVAILABLE';
    }
    if (!stopped && again) timer = setTimeout(() => { void poll(); }, delay);
  }
  void poll();
  return () => { stopped = true; controller.abort(); clearTimeout(timer); };
}
