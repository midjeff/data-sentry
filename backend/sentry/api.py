import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
import logging
import os
from pathlib import Path
import secrets
import shutil
import time
import uuid
from urllib.parse import unquote

from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartException, MultiPartParser

from .config import Settings
from .db import Database
from .errors import SentryError, safe_error
from .media import probe
from .services import (job_dir, jury_response, owned_job, read_result, readiness,
                       require_processing, ui_response)
from .storage import UploadLease

COOKIE = "sentry_session"
EXTENSIONS = {".mov", ".mp4", ".avi", ".mkv", ".webm"}
log = logging.getLogger(__name__)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class UploadLimit(MultiPartException):
    pass


class LimitedMultipartParser(MultiPartParser):
    """Bound file bytes during parsing, before spool files can grow without limit."""
    def __init__(self, *args, file_limit, **kwargs):
        super().__init__(*args, **kwargs)
        self.file_limit = file_limit
        self.part_bytes = 0
        self.header_bytes = 0

    def on_part_begin(self):
        super().on_part_begin()
        self.part_bytes = 0
        self.header_bytes = 0

    def count_header(self, start, end):
        self.header_bytes += end-start
        if self.header_bytes > 16384:
            raise MultiPartException("Multipart headers exceed limit")

    def on_header_field(self, data, start, end):
        self.count_header(start, end)
        super().on_header_field(data, start, end)

    def on_header_value(self, data, start, end):
        self.count_header(start, end)
        super().on_header_value(data, start, end)

    def on_part_data(self, data, start, end):
        self.part_bytes += end-start
        if self.part_bytes > self.file_limit:
            raise UploadLimit("Upload exceeds configured limit")
        super().on_part_data(data, start, end)

    async def parse(self):
        try:
            return await super().parse()
        except BaseException:
            # Also close partial spools on disconnect, deadline, or cancellation.
            for file in self._files_to_close_on_error:
                file.close()
            raise


def create_app(settings=None, database=None, storage=None, publisher=None):
    settings = settings or Settings()
    cloud = settings.storage_backend == 'vercel'
    if cloud:
        from .cloud_db import CloudDatabase
        from .cloud_storage import CloudStorage, input_key, result_prefix
        from .cloud_uploads import register_uploads, publish_job
        db = database or CloudDatabase(settings)
        storage = storage or CloudStorage(settings)
        publisher = publisher or publish_job
    else:
        db = database or Database(settings)

    @asynccontextmanager
    async def lifespan(app):
        yield

    app = FastAPI(title="DATA Sentry backend", version="0.1.0", lifespan=lifespan)
    app.state.settings, app.state.db = settings, db
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True,
                       allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token", "Range", "X-Sentry-Batch", "X-Sentry-Display-Name", "X-Sentry-Request"],
                       expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"])

    @app.exception_handler(SentryError)
    async def sentry_error(request, error):
        return JSONResponse({"error": safe_error(error.code)}, status_code=error.status)

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse({"error": safe_error("NOT_FOUND" if error.status_code == 404 else "INVALID_UPLOAD")},
                            status_code=error.status_code)

    @app.exception_handler(Exception)
    async def unexpected_error(request, error):
        # No exception text: model errors can contain private paths and descriptions.
        log.error("request_failed error=PIPELINE_FAILED")
        return JSONResponse({"error": safe_error("PIPELINE_FAILED")}, status_code=500)

    @app.middleware("http")
    async def private_responses(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def jury_auth(request):
        expected = settings.jury_api_key.get_secret_value()
        supplied = request.headers.get("X-API-Key", "")
        if not expected or not hmac.compare_digest(expected.encode(), supplied.encode()):
            raise SentryError("UNAUTHORIZED", 401)

    def origin_auth(request):
        if request.headers.get("origin") not in settings.allowed_origins:
            raise SentryError("CSRF_REJECTED", 403)

    def browser_auth(request, mutate=False):
        token = request.cookies.get(COOKIE, "")
        session = db.session(digest(token)) if token else None
        if not session:
            raise SentryError("UNAUTHORIZED", 401)
        if mutate:
            origin_auth(request)
            if not hmac.compare_digest(session["csrf_hash"], digest(request.headers.get("X-CSRF-Token", ""))):
                raise SentryError("CSRF_REJECTED", 403)
        return session["token_hash"]

    if cloud:
        register_uploads(app, settings, db, storage, publisher, browser_auth)

    @app.get('/api/health/live')
    def public_live():
        return {'api_running': True}

    @app.get('/api/health/ready')
    def public_ready():
        return ready()

    @app.get("/health/live")
    def live():
        return {"api_running": True}

    @app.get("/health/ready")
    def ready():
        state = readiness(db, settings)
        return JSONResponse(state, status_code=200 if state["demo_processing_available"] or state["real_pipeline_ready"] else 503)

    @app.post("/api/ui/session")
    def session(request: Request):
        origin_auth(request)
        token = request.cookies.get(COOKIE, "")
        existing = db.session(digest(token)) if token else None
        csrf = secrets.token_urlsafe(32)
        if existing:
            db.rotate_csrf(existing["token_hash"], digest(csrf))
        else:
            token = secrets.token_urlsafe(32)
            db.create_session(digest(token), digest(csrf))
        response = JSONResponse({"csrf_token": csrf, **({'upload_transport': 'blob'} if cloud else {})})
        response.set_cookie(COOKIE, token, max_age=settings.session_ttl_sec, httponly=True,
                            secure=settings.cookie_secure, samesite="lax", path="/api/ui")
        return response

    async def upload(request, channel, owner):
        if cloud:
            # Large bodies must bypass Functions; use the direct upload protocol.
            require_processing(db, settings, channel)
            raise SentryError('INVALID_UPLOAD', 422)
        batch_id = request.headers.get("X-Sentry-Batch") if channel == "ui" else None
        if batch_id and (len(batch_id) != 32 or not db.owns_batch(batch_id, owner)):
            raise SentryError("NOT_FOUND", 404)
        display_name = unquote(request.headers.get("X-Sentry-Display-Name", "")) if channel == "ui" else None
        analysis_request = unquote(request.headers.get("X-Sentry-Request", "")) if channel == "ui" else ""
        if (display_name and (len(display_name) > 512 or any(ord(c) < 32 for c in display_name))) or len(analysis_request) > 4000:
            raise SentryError("INVALID_UPLOAD", 422)
        started = time.time()
        deadline = started + settings.job_timeout_sec
        require_processing(db, settings, channel)
        if not request.headers.get("content-type", "").lower().startswith("multipart/form-data;"):
            raise SentryError("INVALID_UPLOAD", 422)
        # Raw multipart budget bounds headers/boundaries too; actual file bytes have their own limit.
        body_limit = settings.upload_limit_bytes + 65536
        try:
            if int(request.headers.get("content-length", "0")) > body_limit:
                raise SentryError("UPLOAD_TOO_LARGE", 413)
        except ValueError:
            raise SentryError("INVALID_UPLOAD", 422) from None
        job_id = uuid.uuid4().hex
        directory = settings.data_dir / "jobs" / job_id
        form = None
        reserved = False
        success = False
        lease = None

        async def bounded_stream():
            received = 0
            async for chunk in request.stream():
                received += len(chunk)
                if received > body_limit:
                    raise UploadLimit("Body too large")
                yield chunk

        try:
            async with asyncio.timeout(settings.job_timeout_sec):
                parser = LimitedMultipartParser(request.headers, bounded_stream(), max_files=1, max_fields=0,
                                                max_part_size=1024, file_limit=settings.upload_limit_bytes)
                form = await parser.parse()
                fields = form.multi_items()
                if len(fields) != 1 or fields[0][0] != "file" or not isinstance(fields[0][1], UploadFile):
                    raise SentryError("INVALID_UPLOAD", 422)
                file = fields[0][1]
                # Filename is metadata only. Extension is selected from a fixed allowlist.
                filename = (file.filename or "")[:512]
                extension = Path(filename).suffix.lower()
                if extension not in EXTENSIONS:
                    raise SentryError("UNSUPPORTED_EXTENSION", 415)
                if not file.size:
                    raise SentryError("INVALID_UPLOAD", 422)
                db.reserve(job_id, owner, channel, filename, extension, started, batch_id, display_name or filename, analysis_request)
                reserved = True
                directory.mkdir()
                lease = UploadLease(directory)
                (directory / "artifacts").mkdir()
                (directory / "evidence").mkdir()
                temporary = directory / "upload.part"
                target = directory / f"input{extension}"

                def copy_and_validate():
                    size = 0
                    with temporary.open("xb") as output:
                        while chunk := file.file.read(1024 * 1024):
                            if time.time() >= deadline:
                                raise SentryError("JOB_TIMEOUT", 408)
                            size += len(chunk)
                            if size > settings.upload_limit_bytes:
                                raise SentryError("UPLOAD_TOO_LARGE", 413)
                            output.write(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    if size == 0:
                        raise SentryError("INVALID_UPLOAD", 422)
                    os.replace(temporary, target)
                    return probe(target, settings, deadline), size

                # Shield the bounded media operation so cleanup never races its open files.
                copy_task = asyncio.create_task(run_in_threadpool(copy_and_validate))
                try:
                    duration, size = await asyncio.shield(copy_task)
                except asyncio.CancelledError:
                    try:
                        await copy_task
                    except Exception:
                        pass
                    raise
                db.enqueue(job_id, duration, size)
                success = True
                log.info("job=%s stage=queued upload_preparation_sec=%.3f", job_id, time.time()-started)
                return JSONResponse({"job_id": job_id}, status_code=202)
        except UploadLimit:
            raise SentryError("UPLOAD_TOO_LARGE", 413) from None
        except MultiPartException:
            raise SentryError("INVALID_UPLOAD", 422) from None
        except TimeoutError:
            raise SentryError("JOB_TIMEOUT", 408) from None
        finally:
            if form is not None:
                await form.close()
            if lease is not None:
                lease.close()
            if not success:
                if reserved:
                    db.abandon_upload(job_id)
                if directory.exists():
                    # Only this request's freshly generated directory can be removed.
                    shutil.rmtree(directory)

    @app.post("/api/v1/analyze")
    async def jury_upload(request: Request):
        jury_auth(request)
        return await upload(request, "jury", None)

    @app.get("/api/v1/jobs/{job_id}")
    def jury_job(job_id: str, request: Request):
        jury_auth(request)
        return jury_response(settings, owned_job(db, job_id, jury=True))

    @app.post("/api/ui/analyze")
    async def ui_upload(request: Request):
        owner = browser_auth(request, mutate=True)
        return await upload(request, "ui", owner)

    @app.get("/api/ui/jobs")
    def history(request: Request, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
        owner = browser_auth(request)
        db.expire()
        rows, total = db.history(owner, limit, offset)
        return {"items": [ui_response(settings, job) for job in rows], "total": total, "limit": limit, "offset": offset}

    @app.post("/api/ui/batches")
    def create_batch(request: Request):
        owner = browser_auth(request, mutate=True)
        batch_id = uuid.uuid4().hex
        db.create_batch(batch_id, owner)
        return {"batch_id": batch_id}

    @app.get("/api/ui/batches/{batch_id}")
    def batch_jobs(batch_id: str, request: Request):
        owner = browser_auth(request)
        if not db.owns_batch(batch_id, owner):
            raise SentryError("NOT_FOUND", 404)
        db.expire()
        return {"items": [ui_response(settings, job) for job in db.batch_history(batch_id, owner)]}

    @app.post("/api/ui/jobs/{job_id}/cancel")
    def cancel_job(job_id: str, request: Request):
        owner = browser_auth(request, mutate=True)
        owned_job(db, job_id, owner)
        db.cancel(job_id, owner)
        return ui_response(settings, owned_job(db, job_id, owner), detail=True)

    @app.post("/api/ui/jobs/{job_id}/restore")
    def restore_job(job_id: str, request: Request):
        owner = browser_auth(request, mutate=True)
        job = owned_job(db, job_id, owner)
        if cloud:
            require_processing(db, settings, 'ui')
            storage.head(input_key(job))
            db.restore_cloud(job_id, owner, publisher)
            return ui_response(settings, owned_job(db, job_id, owner), detail=True, storage=storage)
        path = job_dir(settings, job) / f'input{job["extension"]}'
        if not path.is_file() or not job["uploaded_at"]:
            raise SentryError("ARTIFACT_UNAVAILABLE", 409)
        require_processing(db, settings, "ui")
        db.restore(job_id, owner)
        return ui_response(settings, owned_job(db, job_id, owner), detail=True)

    @app.delete("/api/ui/jobs/{job_id}")
    def delete_job(job_id: str, request: Request):
        owner = browser_auth(request, mutate=True)
        job = owned_job(db, job_id, owner)
        if cloud:
            # Retain the record on storage failure so deletion is retryable.
            if job['status'] == 'processing' or job['worker_id'] is not None:
                raise SentryError('JOB_BUSY', 409)
            # Hold the write lock while deleting so restore cannot race cleanup.
            with db.connect(True) as connection:
                current = connection.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
                if not current or current['status'] == 'processing' or current['worker_id'] is not None:
                    raise SentryError('JOB_BUSY', 409)
                storage.delete_job(job_id)
                connection.execute('DELETE FROM jobs WHERE id=?', (job_id,))
        else:
            db.delete_job(job_id, owner)
            shutil.rmtree(job_dir(settings, job), ignore_errors=True)
        return {"deleted": True}

    @app.get("/api/ui/jobs/{job_id}")
    def ui_job(job_id: str, request: Request):
        return ui_response(settings, owned_job(db, job_id, browser_auth(request)), detail=True, storage=storage)

    @app.get("/api/ui/jobs/{job_id}/video")
    def video(job_id: str, request: Request):
        job = owned_job(db, job_id, browser_auth(request))
        if cloud:
            if not job['uploaded_at']:
                raise SentryError('NOT_FOUND', 404)
            return RedirectResponse(storage.read_url(input_key(job)), status_code=307,
                                    headers={'Referrer-Policy': 'no-referrer'})
        path = job_dir(settings, job) / f'input{job["extension"]}'
        if not job["uploaded_at"] or not path.is_file():
            raise SentryError("NOT_FOUND", 404)
        return FileResponse(path)

    @app.get("/api/ui/jobs/{job_id}/evidence/{frame_id}")
    def evidence(job_id: str, frame_id: str, request: Request):
        job = owned_job(db, job_id, browser_auth(request))
        if job["status"] != "done":
            raise SentryError("NOT_FOUND", 404)
        result = read_result(settings, job, storage)
        if frame_id not in {frame.frame_id for frames in result.evidence for frame in frames}:
            raise SentryError("NOT_FOUND", 404)
        if cloud:
            return RedirectResponse(storage.read_url(result_prefix(job) + f'/evidence/{frame_id}.jpg'),
                                    status_code=307, headers={'Referrer-Policy': 'no-referrer'})
        return FileResponse(job_dir(settings, job) / "evidence" / f"{frame_id}.jpg", media_type="image/jpeg")

    return app
