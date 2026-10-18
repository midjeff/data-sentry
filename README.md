# DATA Sentry

Stage 2 connects the existing React/Vite interface to the local FastAPI backend:
browser session → manual upload → durable worker job → polling → server result,
private video/evidence and paginated history. Russian, Kazakh and English, themes,
branding, sidebar/mobile navigation and the two-column results presentation are retained.

Development uses **server-side demonstrations**. Every mock result is labeled
“Демонстрационный результат”, including saved history. There is no client-side
analysis simulator or fallback result when the server is unavailable.

## Windows setup

Requirements: Node.js 20.19+ or 22.12+ (tested: 24.14.0), Python 3.11, FFmpeg/ffprobe.
The existing backend environment is under `backend/.venv`. It does not require a GPU.
See [backend setup](backend/README.md) if the Python environment has not been created.

```powershell
Set-Location C:\Users\Shwepes\datathon
npm.cmd ci
Set-Location backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -m pip install -r requirements.lock -e '.[test]'
```

No shell activation or ExecutionPolicy changes are needed.

## Three terminals

Terminal 1 — API:

```powershell
Set-Location C:\Users\Shwepes\datathon\backend
$env:APP_ENV = 'development'
$env:PIPELINE_MODE = 'mock'
$env:DATA_DIR = 'C:\Users\Shwepes\datathon\backend\data'
$env:COOKIE_SECURE = 'false'
$env:ALLOWED_ORIGINS = '["http://localhost:5173"]'
.\.venv\Scripts\python.exe -m uvicorn sentry.api:create_app --factory --host 127.0.0.1 --port 8000
```

Terminal 2 — persistent worker:

```powershell
Set-Location C:\Users\Shwepes\datathon\backend
$env:APP_ENV = 'development'
$env:PIPELINE_MODE = 'mock'
$env:MOCK_SCENARIO = 'violations'
$env:DATA_DIR = 'C:\Users\Shwepes\datathon\backend\data'
$env:COOKIE_SECURE = 'false'
$env:ALLOWED_ORIGINS = '["http://localhost:5173"]'
.\.venv\Scripts\python.exe -m sentry.worker
```

Terminal 3 — frontend:

```powershell
Set-Location C:\Users\Shwepes\datathon
npm.cmd run dev
```

Open **http://localhost:5173**. Vite uses `strictPort: true`; an occupied port is an
error, not a silently changed frontend origin. API requests use relative `/api/ui/*`
URLs. The development proxy preserves `/api`, forwards to `http://127.0.0.1:8000`
and leaves the browser Origin intact. That origin is allowed by the backend's
default development settings and by the explicit commands above.

The proxy is for local development, not a production deployment. Do not expose
Vite publicly. Production defaults remain unchanged: pipeline disabled by default,
mock forbidden in production, Secure cookies required for HTTPS production.
No jury key is needed or used by React; no `VITE_*` secret is configured.

For other development scenarios, set worker `MOCK_SCENARIO` to `no_violation` or
`failure`, then restart the worker. The UI does not select scenarios.

## Using the connected interface

Select/drop one nonempty MOV, MP4, AVI, MKV or WEBM, then click Start Analysis.
Uppercase extensions and generic/empty MIME types are accepted. Selection never
uploads automatically. The server enforces its configured size limit and media
validation; the frontend has no conflicting hardcoded byte limit. The initial
backend default is 256 MiB, not a competition requirement.

Uploads send one multipart field named `file`, cookies and the in-memory CSRF token.
The browser supplies the multipart boundary. Double submission is guarded. A
connection failure never automatically repeats an upload: inspect refreshed history
before deciding to submit again, because the original request may have succeeded.

The processing display reflects the real upload request and backend status/stage.
Polling occurs approximately every two seconds after the previous request finishes.
It stops on terminal status or selection/unmount cleanup. Temporary network failures
preserve the last known job state and show a connection error. Returning to the
upload screen does not cancel the server job.

Only validated final decisions are displayed. Every returned event, description,
fractional timestamp and evidence frame is mapped from the UI response; missing
regulatory references produce no invented reference. Model-provided text is shown
as supplied, without fabricated translations. Failed jobs have no successful verdict.

The video uses the private server endpoint; selecting an event seeks to its exact
timestamp, including 0.0, after metadata arrives. Evidence thumbnails and enlarged
frames use their actual server timestamps. Browser codec failures do not prevent
server upload/analysis and do not trigger transcoding. AVI, MKV and some MOV codecs
may remain unplayable in a particular browser.

History is loaded from `GET /api/ui/jobs?limit=20&offset=...`, with loading, error,
empty, refresh and page controls. Open an entry to fetch its detail and resume polling
if still processing. A page refresh obtains a new in-memory CSRF token while retaining
the valid HttpOnly session cookie and therefore the same history. Losing/expiring
that cookie can make prior analyses inaccessible; there is no account recovery in Stage 2.

The old IndexedDB demo records are neither merged nor deleted. Theme preferences
are preserved. Video contents, evidence, tokens and full results are not stored in
localStorage; only the existing theme preference uses it.

### Unsupported previous controls

The backend has **no delete-analysis endpoint** and accepts **no textual analysis
request or scenario form field**. The old delete buttons, request textarea and
frontend demo selector were removed from the live flow. No route was invented and
no successful server action is simulated. History's existing sidebar presentation
remains in use.

## Actual UI boundary

`src/api.ts` is the only backend-to-view mapping:

- Session: POST `/api/ui/session` → `csrf_token`; valid cookies retain ownership.
- Upload: POST `/api/ui/analyze` → 202 `job_id`.
- History: `items/total/limit/offset`, with summary metadata and no images.
- Detail: `job_id/filename/created_at/uploaded_at/status/stage/is_demo/verdict`.
  Successful detail adds `result.decision` and `result.evidence`, indexed per violation.
- Media: `/api/ui/jobs/{id}/video` and the validated same-origin evidence URLs
  returned by the backend.

The UI contract is different from jury JSON. The browser never calls jury routes.
Essential result fields, completion, verdict consistency, demo provenance, timestamps
and evidence URLs are validated before rendering. Session initialization is shared
across concurrent consumers and React Strict Mode. CSRF/session failures invalidate
the in-memory token; the next manual action can recover it. POST uploads are never
automatically retried.

Vite retains its default filesystem deny patterns and additionally denies the private
`backend/` and `.qa/` trees and SQLite files, including `/@fs` access. No runtime data
was copied into `public/`. Keep any custom DATA_DIR outside the frontend's served tree.

## Verification executed on Windows, 2026-10-18

```powershell
Set-Location C:\Users\Shwepes\datathon
npm.cmd run build
npm.cmd run typecheck
npm.cmd test

# Stop development services first: this harness owns ports 8000 and 5173.
npm.cmd run test:integration
# Or leave existing services running and use temporary test-only ports:
npm.cmd run test:integration -- --isolated-ports

Set-Location backend
.\.venv\Scripts\python.exe -m pytest -q
```

- Build and TypeScript check: passed. No separate lint configuration exists.
- Frontend unit/component tests: **27 passed, 0 failed, 0 skipped**. These use controlled
  responses and jsdom, covering session deduplication, CSRF, one POST per click sequence,
  upload errors, all extensions, drag/drop, both verdicts, failures, stale polling,
  history reload/pagination, demo labels, zero/fractional seeks, evidence, themes/languages.
- Network integration: **four scenarios passed** against actual separate Vite,
  Uvicorn and mock-worker processes: violations, no_violation, failed job and offline API.
  The actual React code ran in jsdom with real HTTP through Vite. Cookie transport and
  Origin were emulated in memory because jsdom has no browser fetch cookie stack.
  Verified history after a fresh app mount, session reuse, independent session isolation
  for history/job/video/evidence, JPEG bytes, Range 206 and rejection of an untrusted Origin.
  A complete run passed on the documented development ports; the final repeat used
  temporary isolated ports because independently started API/worker terminals were
  active. Test-only port overrides do not change the development proxy configuration.
- Vite private-file checks passed for ordinary paths, uppercase paths, query variants
  and `/@fs`; frontend source remained available.
- Backend regression suite: **69 passed**, no skips. The existing Starlette/httpx
  deprecation warning remains; no package was upgraded to hide it.
- **Real-browser smoke was not executed**: browser inventory was empty and opening
  an in-app tab returned `Browser is not available: iab`. Native dialog behavior,
  actual media decoding, visual/responsive appearance and browser cookie policies
  still require a connected real browser. jsdom/HTTP checks do not establish them.

Tests generate synthetic local video only; competition datasets are not read.
The network harness creates isolated test storage below ignored `backend/data/`
and stops its own processes after the run. Tests add only development dependencies:
jsdom 26.1.0 and an explicit declaration of the already-used esbuild 0.28.2.
Runtime React/Vite versions were not changed.

## Source map and next stage

- `src/api.ts`: cookie/CSRF client, response validation, view mapping.
- `src/polling.ts`: sequential polling and cancellation/stale-response guards.
- `src/history.ts`: server history access; no browser result database.
- `src/App.tsx`: upload, history, selection and real job lifecycle.
- `src/components/`: existing presentation connected to server data.
- `src/i18n.tsx`: Russian/Kazakh/English interface and safe error translations.
- `tests/`: focused client/DOM tests and the Windows network smoke harness.
- [Backend contract](backend/INTEGRATION.md): the proposed final decision boundary.

Backend routes, authentication, ownership, worker and ML adapters required **no runtime
changes** for Stage 2; only backend README wording was updated to point to this integration.

Stage 3 still needs the real visual + decision pipeline inside RealPipelineAdapter,
approved legal interpretation from its owners, source-relative evidence timestamps,
GPU/runtime lifecycle and latency/quality verification. No real models, regulations,
production deployment, commit or push were introduced here.
