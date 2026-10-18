# DATA Sentry

## Vercel deployment

The approved root `vercel.json` configures three services in one project:

| Service | Root | Public access | Calls |
| --- | --- | --- | --- |
| `app` | `.` | `/` and other non-API paths | Browser calls relative `/api/ui/*` |
| `backend` | `backend` | `/api/*`, including authenticated jury routes and `/api/health/*` | Internal `storage` through the injected `STORAGE_URL` binding |
| `storage` | `services/storage` | None | Vercel Blob signing APIs |

Paths are preserved by the public rewrites. Cookies, video URLs and evidence URLs
remain under `/api/ui`. The static Vite frontend cannot consume runtime bindings.
The localhost proxy in `vite.config.ts` is only for the existing standalone local
workflow. `vercel dev` owns routing when running the project as services.

**Deployment and real inference are not ready.** ForteBank requires local AI
processing. Competition videos must not be uploaded to Vercel Blob until the
data-locality architecture is explicitly approved. Both the backend Blob writer
and the internal upload-token endpoint reject writes; changing environment
variables cannot enable them. Cloud admission/readiness also fail closed.

Real ML must execute on the local GPU computer, never in a Vercel Function.
The private Queue subscriber only fences and rejects pending jobs with
`ML_NOT_CONFIGURED`; it does not load models, download media or run FFmpeg.
The authenticated connection to the GPU computer and its real adapter remain
unimplemented. No hosted mock or jury mock is enabled.

The Vercel entrypoint uses Postgres for sessions, ownership and job metadata.
Private Blob read/signing support and the direct-upload protocol are retained as
dormant infrastructure, pending the locality decision. The existing Windows/SQLite
worker remains available for the separate local development workflow below.
No competition data was uploaded and no hosted deployment was performed.

Outstanding blockers: approval of cloud storage for video and derived artifacts
(and the permitted metadata boundary), GPU integration, real credentials, per-environment
database migrations, exact deployed domain verification, and hosted authentication,
private-access and routing checks. Resolve these before enabling competition use.

### Infrastructure setup after the blockers are resolved

1. Import this repository as one Vercel project with repository root `.`.
2. Connect a Postgres integration. Provision/use a **private** Blob store for
   competition material only if that architecture is approved. Use separate
   databases/stores for production and preview; no existing local SQLite data is
   automatically migrated. Infrastructure tests below use local synthetic fixtures.
3. Set the server environment variables below. Enable Vercel Queues for the project
   if prompted. `backend/pyproject.toml` declares the private `sentry.cloud_tasks`
   subscriber for the `sentry-analysis` topic; it has no public HTTP endpoint and
   currently rejects work without inference.
4. Apply the database schema once to each environment with
   `python -m sentry.cloud_db` from `backend`, using that environment's `DATABASE_URL`.
   This is an explicit migration command, never an import/build-time side effect.
5. Run `vercel dev` with synthetic data to check combined routing. Credentials,
   migrations, hosted checks and the GPU path must be verified before claiming
   readiness. This change does not deploy a project or provision paid resources.

| Variable | Value / source |
| --- | --- |
| `DATABASE_URL` | Postgres connection string; use the provider's pooled TLS URL in production |
| `BLOB_READ_WRITE_TOKEN` | Server-only private Blob credentials, if approved; upload signing/writes remain blocked in code |
| `BLOB_STORE_ID`, `VERCEL_OIDC_TOKEN` | Platform-provided Blob/OIDC configuration where available; do not invent OIDC tokens |
| `INTERNAL_SERVICE_TOKEN` | A shared random secret (at least 32 random bytes) for backend-to-storage authorization |
| `JURY_API_KEY` | Server-only jury API credential; an empty value denies jury access |
| `ALLOWED_ORIGINS` | Optional JSON subset of the trusted hosted origins below; cannot expand them. Development may explicitly list localhost origins |
| `VERCEL_PROJECT_PRODUCTION_URL` | Trusted platform value for the exact production domain (without scheme) |
| `VERCEL_URL`, `VERCEL_BRANCH_URL` | Trusted platform values for this preview deployment and branch; only added in `VERCEL_ENV=preview` |
| `PIPELINE_MODE` | `disabled` |
| `STORAGE_URL` | **Do not set.** Vercel injects it from the backend service binding |

Enable access to Vercel System Environment Variables. Hosted origins are exact
HTTPS values derived from the platform variables above, with no wildcard or
hostname-suffix matching. Production allows only its canonical production domain;
previews also allow their own exact deployment/branch origins. Other projects,
other preview deployments and localhost are not inferred or trusted. Missing
platform URLs leave the allowlist empty; a conflicting `ALLOWED_ORIGINS` value
fails startup. It may narrow the list, never broaden it. Verify the actual production
domain selected by Vercel in the project settings before hosted use.

The Vercel entrypoint ignores the local `backend/.env`, uses Postgres, and
uses production policy/Secure cookies except when `VERCEL_ENV=development`.
No `VITE_*` credential is used. The deployment ignore file excludes local secrets,
databases, uploads, model weights, Python environments and caches.

### Local services and verification

Use Node.js 20.19+ or 22.12+, Python **3.12**, and a current Vercel CLI (validated
with 64.5.0). For a clean checkout, create `backend/.venv` with Python 3.12 and
install `backend` with its test dependencies. The CLI reuses `backend/.venv`;
an existing Python 3.11 environment from the legacy workflow cannot run the
current Vercel runtime. Use a separate checkout for services testing if retaining it.

```powershell
npm.cmd ci
npm.cmd ci --prefix services/storage
py -3.12 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -e 'backend[test]'
# Set a development DATABASE_URL and INTERNAL_SERVICE_TOKEN in this shell,
# or use Vercel's linked Development environment. Never set STORAGE_URL.
$env:ALLOWED_ORIGINS = '["http://localhost:3000","http://127.0.0.1:3000"]'
$env:PIPELINE_MODE = 'disabled'
Push-Location backend
.venv/Scripts/python.exe -m sentry.cloud_db
Pop-Location
vercel dev
# Without linking/authentication: vercel dev -L (supply development env yourself).
```

Verify `/`, `/api/health/live` (200), `/api/health/ready` (503 while analysis is
disabled), and session/history using the configured origin. `/upload-token` and
`/read-url` must never reach the internal storage service through the public domain.

```powershell
npm.cmd run build
node --test tests/api.test.mjs tests/polling.test.mjs tests/cloud-upload.test.mjs
node --test services/storage/test.mjs
Push-Location backend
.venv/Scripts/python.exe -m pytest -q
Pop-Location
```

The cloud tests start and stop a disposable local PostgreSQL cluster; set
`TEST_POSTGRES_BIN` to its binary directory (the Windows default is PostgreSQL 17).
They never use the application's `DATABASE_URL`. They exercise real Postgres,
the Queue SDK's embedded dispatcher, in-memory Blob doubles, and synthetic fixtures.
Tests verify that cloud writes and serverless inference stay blocked, including
with `PIPELINE_MODE=real`. Private artifact tests seed fixtures directly; they do
not demonstrate real inference. Missing PostgreSQL/FFmpeg causes explicit skips.
Hosted credentials, account configuration and a real deployment remain unverified.

Verified after locality/origin safeguards on 2026-10-18: all 107 backend tests
and 19 focused JavaScript tests passed, including Postgres integration, exact
origin/CSRF/session/API-key checks, blocked cloud writes, and disabled serverless ML.
Earlier that day the frontend build passed and `vercel dev -L` started all three
services in an isolated checkout: `/` returned HTML, API liveness
returned 200, disabled readiness returned 503, and unknown API paths returned JSON
404. The existing frontend component suite fails on an outdated button-label
expectation; that failure was reproduced in an unchanged HEAD checkout. Its broader
run also hit a Node memory error. No hosted deployment or live Blob call was performed.

The retained direct-upload client would send bytes to Blob, so it must remain
unreachable through successful upload admission/token issuance until approval.
Tests simulate it only with in-memory transports. Postgres transaction/attempt
fencing and publication retry handling remain available for future GPU integration.
Private media endpoints still check ownership before issuing five-minute signed
read redirects. Treat those temporary links as bearer credentials.

Abandoned uploads and stale-attempt artifacts remain private; deleting the job
removes its Blob prefix. A retention/cleanup policy for unclaimed/abandoned data
should be chosen before enabling public analysis. SQL session expiration is checked
on access. Schema creation does not purge existing data.

References: [services and routing](https://vercel.com/docs/services),
[runtime bindings](https://vercel.com/docs/services/bindings),
[Python queue subscribers](https://vercel.com/docs/queues/python-sdk),
[private Blob storage](https://vercel.com/docs/vercel-blob/private-storage),
[trusted deployment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

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
