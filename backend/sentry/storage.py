"""Leases protect incomplete upload cleanup from concurrent API writers."""
import os
import re
import shutil
import time


class UploadLease:
    def __init__(self, directory):
        self.file = (directory / ".upload.lock").open("a+b")
        if self.file.seek(0, 2) == 0:
            self.file.write(b"0")
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            raise

    def close(self):
        self.file.close()  # OS releases the lock, including on process crash.


def clean_incomplete_uploads(db, settings):
    with db.connect() as connection:
        rows = connection.execute("""SELECT id FROM jobs WHERE status='failed' AND uploaded_at IS NULL
            AND deadline<?""", (time.time()-5,)).fetchall()
    root = (settings.data_dir / "jobs").resolve()
    for row in rows:
        job_id = row[0]
        if not re.fullmatch(r"[a-f0-9]{32}", job_id):
            continue
        directory = root / job_id
        if not directory.is_dir() or directory.resolve() != directory:
            continue
        try:
            lease = UploadLease(directory)
        except OSError:
            continue  # An API process still owns these files.
        lease.close()
        # IDs are never reused. Only terminal jobs without a completed upload qualify.
        try:
            shutil.rmtree(directory)
        except OSError:
            continue  # Retry next sweep; never touch completed analyses.
