"""Direct-upload protocol. Client-provided blob URLs are never accepted."""
from pathlib import Path
import time
import uuid

from fastapi import Request
from pydantic import BaseModel, Field

from .errors import SentryError
from .services import owned_job, require_processing
from .cloud_storage import input_key

TOPIC = 'sentry-analysis'


def publish_job(payload):
    from vercel.queue.sync import QueueClient
    # Do not deduplicate sends at the broker: a prior send can have succeeded
    # while the DB transaction rolled back. A later retry needs a fresh delivery.
    # Database attempt/lease fencing provides processing idempotency instead.
    QueueClient().send(TOPIC, payload)


class UploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    size: int = Field(gt=0)
    batch_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')
    display_name: str = Field(min_length=1, max_length=512)
    analysis_request: str = Field(default='', max_length=4000)


def register_uploads(app, settings, db, storage, publish, browser_auth):
    @app.post('/api/ui/uploads')
    def begin(body: UploadRequest, request: Request):
        owner = browser_auth(request, mutate=True)
        require_processing(db, settings, 'ui')
        extension = Path(body.filename).suffix.lower()
        if extension not in {'.mov', '.mp4', '.avi', '.mkv', '.webm'}:
            raise SentryError('UNSUPPORTED_EXTENSION', 415)
        if body.size > min(settings.upload_limit_bytes, 268435456):
            raise SentryError('UPLOAD_TOO_LARGE', 413)
        if any(ord(c) < 32 for c in body.display_name):
            raise SentryError('INVALID_UPLOAD', 422)
        if body.batch_id and not db.owns_batch(body.batch_id, owner):
            raise SentryError('NOT_FOUND', 404)
        job_id = uuid.uuid4().hex
        db.reserve(job_id, owner, 'ui', body.filename, extension, time.time(),
                   body.batch_id, body.display_name, body.analysis_request)
        pathname = input_key(db.get(job_id))
        try:
            token = storage.upload_token(pathname, body.size)
        except Exception:
            db.abandon_upload(job_id)
            raise
        return {'job_id': job_id, 'pathname': pathname, 'token': token}

    @app.post('/api/ui/uploads/{job_id}/complete', status_code=202)
    def complete(job_id: str, request: Request):
        owner = browser_auth(request, mutate=True)
        job = owned_job(db, job_id, owner)
        require_processing(db, settings, 'ui')
        if job['uploaded_at'] is not None:
            return {'job_id': job_id}
        metadata = storage.head(input_key(job))
        if metadata.pathname != input_key(job) or metadata.size <= 0:
            raise SentryError('INVALID_UPLOAD', 422)
        if metadata.size > min(settings.upload_limit_bytes, 268435456):
            raise SentryError('UPLOAD_TOO_LARGE', 413)
        db.complete_upload(job_id, metadata.size, publish)
        return {'job_id': job_id}
