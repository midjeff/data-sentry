import time
import uuid

from sentry.db import Database
from sentry.storage import UploadLease, clean_incomplete_uploads
from .test_worker import enqueue


def test_incomplete_cleanup_respects_writer_lease_and_completed_uploads(settings, video):
    db = Database(settings)
    complete_id = enqueue(settings, video)
    job_id = uuid.uuid4().hex
    db.reserve(job_id, None, "ui", "incomplete.mov", ".mov", time.time()-40)
    directory = settings.data_dir / "jobs" / job_id
    directory.mkdir()
    (directory / "upload.part").write_bytes(b"partial")
    lease = UploadLease(directory)
    db.expire()
    clean_incomplete_uploads(db, settings)
    assert directory.exists()
    lease.close()
    clean_incomplete_uploads(db, settings)
    assert not directory.exists()
    assert (settings.data_dir / "jobs" / complete_id / "input.mov").exists()
