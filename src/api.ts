// Browser contract only. All server-to-view mapping lives here.
export type Status = 'processing' | 'done' | 'failed' | 'cancelled';
export type Verdict = 'violation' | 'no_violation';
export type JobSummary = {
  id: string; filename: string; createdAt: number; uploadedAt: number | null;
  batchId: string | null; originalFilename: string; analysisRequest: string; attempt: number;
  status: Status; stage: string; isDemo: boolean; verdict: Verdict | null; errorCode?: string;
};
export type Evidence = { id: string; timestamp: number; requestedTimestamp: number; offset: number; url: string };
export type Violation = {
  type: string; timestamp: number; description: string; evidence: Evidence[];
  regulatoryReferences: Record<string, unknown>[];
};
export type Result = { verdict: Verdict; duration: number; violations: Violation[] };
export type Job = JobSummary & ({ status: 'done'; result: Result } | { status: 'processing' | 'failed' | 'cancelled'; result?: never });
export type HistoryPage = { items: JobSummary[]; total: number; limit: number; offset: number };

export class ApiError extends Error {
  constructor(public code: string, public status = 0) { super(code); this.name = 'ApiError'; }
}
export const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
export const errorCode = (error: unknown) => error instanceof ApiError ? error.code : 'NETWORK_ERROR';
const invalid = (): never => { throw new ApiError('INVALID_RESPONSE'); };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const text = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : invalid();
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid();
const integer = (value: unknown): number => Number.isInteger(number(value)) ? value as number : invalid();
const boolean = (value: unknown): boolean => typeof value === 'boolean' ? value : invalid();
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : invalid();
const id = (value: unknown): string => /^[a-f0-9]{32}$/.test(text(value)) ? value as string : invalid();
const verdict = (value: unknown): Verdict => value === 'violation' || value === 'no_violation' ? value : invalid();
const within = (value: unknown, duration: number): number => number(value) < duration ? value as number : invalid();

function summary(value: unknown): JobSummary {
  const data = record(value), status = data.status;
  if (status !== 'processing' && status !== 'done' && status !== 'failed' && status !== 'cancelled') invalid();
  return { id: id(data.job_id), filename: data.display_name == null ? text(data.filename) : text(data.display_name), originalFilename: text(data.filename),
    batchId: data.batch_id == null ? null : id(data.batch_id), analysisRequest: data.analysis_request == null ? '' : typeof data.analysis_request === 'string' ? data.analysis_request : invalid(), attempt: data.attempt == null ? 1 : integer(data.attempt), createdAt: number(data.created_at) * 1000,
    uploadedAt: data.uploaded_at === null ? null : number(data.uploaded_at) * 1000,
    status: status as Status, stage: text(data.stage), isDemo: boolean(data.is_demo),
    verdict: data.verdict === null ? null : verdict(data.verdict),
    ...(status === 'failed' ? { errorCode: text(record(data.error).code) } : {}) };
}

export function mapJob(value: unknown): Job {
  const data = record(value), job = summary(data);
  if (job.status !== 'done') return { ...job, status: job.status };
  const result = record(data.result), decision = record(result.decision);
  if (decision.schema_version !== '1.0' || decision.complete !== true || boolean(decision.is_demo) !== job.isDemo) invalid();
  const duration = number(decision.source_duration_sec);
  if (duration <= 0) invalid();
  const finalVerdict = verdict(decision.verdict), violations = list(decision.violations), evidence = list(result.evidence);
  if (finalVerdict !== job.verdict || (finalVerdict === 'violation') !== (violations.length > 0) || evidence.length !== violations.length) invalid();
  return { ...job, status: 'done', result: { verdict: finalVerdict, duration, violations: violations.map((value, index) => {
    const violation = record(value), frames = list(evidence[index]), requested = list(violation.evidence_timestamps);
    if (frames.length < 1 || frames.length > 3 || frames.length !== requested.length) invalid();
    return { type: text(violation.type), timestamp: within(violation.timecode_sec, duration), description: text(violation.description),
      regulatoryReferences: violation.regulatory_references == null ? [] : list(violation.regulatory_references).map(record),
      evidence: frames.map((value, index) => {
        const frame = record(value), frameId = id(frame.frame_id), url = `/api/ui/jobs/${job.id}/evidence/${frameId}`;
        if (frame.url !== url || number(frame.width) <= 0 || number(frame.height) <= 0) invalid();
        const timestamp = within(frame.timestamp_sec, duration), requestedTimestamp = within(frame.requested_timestamp_sec, duration);
        if (typeof frame.selection_offset_sec !== 'number' || !Number.isFinite(frame.selection_offset_sec) ||
            Math.abs(timestamp - requestedTimestamp - frame.selection_offset_sec) > 1e-6 || requestedTimestamp !== requested[index]) invalid();
        return { id: frameId, timestamp, requestedTimestamp, offset: frame.selection_offset_sec as number, url };
      }) };
  }) } };
}

export const videoUrl = (jobId: string) => `/api/ui/jobs/${id(jobId)}/video`;

export function createApiClient(fetcher: typeof fetch = (...args) => fetch(...args)) {
  let csrf: string | undefined;
  let initialization: Promise<void> | undefined;
  let uploading = false;

  async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try { response = await fetcher(path, { ...options, credentials: 'include' }); }
    catch (error) { if (isAbort(error)) throw error; throw new ApiError('NETWORK_ERROR'); }
    let data: unknown;
    try { data = await response.json(); }
    catch (error) {
      if (isAbort(error)) throw error;
      throw new ApiError(response.ok ? 'INVALID_RESPONSE' : 'SERVER_UNAVAILABLE', response.status);
    }
    if (!response.ok) {
      let code = 'SERVER_UNAVAILABLE';
      if (data && typeof data === 'object' && 'error' in data) {
        const error = data.error;
        if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') code = error.code;
      }
      if (code === 'UNAUTHORIZED' || code === 'CSRF_REJECTED') csrf = undefined;
      throw new ApiError(code, response.status);
    }
    return data;
  }

  function initialize(): Promise<void> {
    if (initialization) return initialization;
    if (csrf) return Promise.resolve();
    // Shared across renders/Strict Mode. A consumer must not abort this shared request.
    initialization = request('/api/ui/session', { method: 'POST' }).then(value => {
      csrf = text(record(value).csrf_token);
    }).finally(() => { initialization = undefined; });
    return initialization;
  }

  return {
    initialize,
    async history(offset = 0, signal?: AbortSignal): Promise<HistoryPage> {
      await initialize(); signal?.throwIfAborted();
      const data = record(await request(`/api/ui/jobs?limit=20&offset=${integer(offset)}`, { signal }));
      const items = list(data.items).map(summary), total = integer(data.total), limit = integer(data.limit);
      if (integer(data.offset) !== offset || limit !== 20 || items.length > limit || items.length > total) invalid();
      return { items, total, limit, offset };
    },
    async job(jobId: string, signal?: AbortSignal): Promise<Job> {
      await initialize(); signal?.throwIfAborted();
      const job = mapJob(await request(`/api/ui/jobs/${id(jobId)}`, { signal }));
      if (job.id !== jobId) invalid();
      return job;
    },
    async createBatch(): Promise<string> {
      await initialize();
      return id(record(await request('/api/ui/batches', { method: 'POST', headers: { 'X-CSRF-Token': csrf! } })).batch_id);
    },
    async batch(batchId: string, signal?: AbortSignal): Promise<JobSummary[]> {
      await initialize(); signal?.throwIfAborted();
      const items = list(record(await request(`/api/ui/batches/${id(batchId)}`, { signal })).items).map(summary);
      if (items.some((item) => item.batchId !== batchId)) invalid();
      return items;
    },
    async cancel(jobId: string): Promise<Job> {
      await initialize();
      return mapJob(await request(`/api/ui/jobs/${id(jobId)}/cancel`, { method: 'POST', headers: { 'X-CSRF-Token': csrf! } }));
    },
    async restore(jobId: string): Promise<Job> {
      await initialize();
      return mapJob(await request(`/api/ui/jobs/${id(jobId)}/restore`, { method: 'POST', headers: { 'X-CSRF-Token': csrf! } }));
    },
    async delete(jobId: string): Promise<void> {
      await initialize();
      const result = record(await request(`/api/ui/jobs/${id(jobId)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf! } }));
      if (result.deleted !== true) invalid();
    },
    async upload(file: File, signal?: AbortSignal, metadata?: { batchId?: string; displayName: string; request: string }): Promise<string> {
      if (uploading) throw new ApiError('UPLOAD_IN_PROGRESS');
      uploading = true;
      try {
        await initialize(); signal?.throwIfAborted();
        const body = new FormData(); body.append('file', file);
        const data = record(await request('/api/ui/analyze', { method: 'POST', body, signal, headers: { 'X-CSRF-Token': csrf!, ...(metadata ? { ...(metadata.batchId ? { 'X-Sentry-Batch': metadata.batchId } : {}), 'X-Sentry-Display-Name': encodeURIComponent(metadata.displayName), 'X-Sentry-Request': encodeURIComponent(metadata.request) } : {}) } }));
        return id(data.job_id);
      } finally { uploading = false; }
      // Never automatically retry POSTs, including ambiguous network failures.
    },
  };
}

export const api = createApiClient();
