import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function bundle(source, name) {
  await mkdir('.qa/tests', { recursive: true });
  const outfile = path.resolve(`.qa/tests/${name}.mjs`);
  await build({ entryPoints: [source], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
  return pathToFileURL(outfile).href;
}
export const idA = 'a'.repeat(32), idB = 'b'.repeat(32), frameA = 'c'.repeat(32), frameB = 'd'.repeat(32);
export function job(id = idA, status = 'done', verdict = 'violation', demo = true) {
  const result = { job_id: id, filename: `${id[0]}.MOV`, created_at: 1760000000, uploaded_at: 1760000001,
    status, stage: status === 'processing' ? 'queued' : 'finalizing', is_demo: demo,
    verdict: status === 'done' ? verdict : null, timings: {} };
  if (status === 'failed') result.error = { code: 'PIPELINE_FAILED', message: 'Safe server message.' };
  if (status === 'done') {
    const violations = verdict === 'violation' ? [0, 0.55].map((timestamp, index) => ({ type: `Server event ${index + 1}`,
      description: `Server description ${index + 1}`, timecode_sec: timestamp, evidence_timestamps: [timestamp], regulatory_references: null })) : [];
    result.result = { decision: { schema_version: '1.0', complete: true, source_duration_sec: 2.0, verdict,
      violations, is_demo: demo, provenance: 'controlled-test-double' }, evidence: violations.map((violation, index) => [{
      frame_id: index ? frameB : frameA, timestamp_sec: index ? 0.6 : 0, requested_timestamp_sec: violation.timecode_sec,
      selection_offset_sec: index ? 0.05 : 0, width: 96, height: 64,
      url: `/api/ui/jobs/${id}/evidence/${index ? frameB : frameA}`,
    }]) };
  }
  return result;
}
export function summary(value) { const { result, ...rest } = value; return rest; }
export const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
export function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
