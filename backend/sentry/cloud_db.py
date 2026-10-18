"""Postgres persistence and fenced, retryable queue deliveries.

The short write transactions share an advisory lock so capacity checks and legacy
state transitions remain atomic across instances. Media work never holds it.
"""
from contextlib import contextmanager
from pathlib import Path
import time
import uuid

from .db import Database
from .errors import SentryError


class Row(dict):
    def __getitem__(self, key):
        return tuple(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def row_factory(cursor):
    names = [column.name for column in cursor.description] if cursor.description else []
    return lambda values: Row(zip(names, values))


class Connection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql, params=()):
        # All SQL is repository-owned; values remain bound parameters.
        return self.connection.execute(sql.replace('?', '%s'), params)


class CloudDatabase(Database):
    def __init__(self, settings):
        self.settings = settings

    @contextmanager
    def connect(self, write=False):
        import psycopg
        url = self.settings.database_url.get_secret_value()
        if not url:
            raise SentryError('ARTIFACT_UNAVAILABLE', 503)
        with psycopg.connect(url, row_factory=row_factory, connect_timeout=10,
                             prepare_threshold=None) as connection:
            if write:
                connection.execute('SELECT pg_advisory_xact_lock(84721301)')
            yield Connection(connection)

    def migrate(self):
        with self.connect(True) as db:
            db.connection.execute(Path(__file__).with_name('cloud_schema.sql').read_text())

    def reserve(self, *args, **kwargs):
        super().reserve(*args, **kwargs)
        with self.connect(True) as db:
            # Upload time is separate from the processing deadline.
            db.execute('UPDATE jobs SET deadline=? WHERE id=?', (time.time() + 600, args[0]))

    def complete_upload(self, job_id, size, publish):
        with self.connect(True) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row or row['status'] != 'processing' or row['deadline'] <= time.time():
                raise SentryError('INVALID_STATE', 409)
            if row['uploaded_at'] is not None:
                return
            # Publish before committing queued state. A fast delivery retries while
            # upload is uncommitted. A crash cannot commit a job without a message.
            # An ambiguous send can duplicate delivery, which the claim fences.
            publish({'job_id': job_id, 'attempt': row['attempt']})
            now = time.time()
            db.execute("UPDATE jobs SET size=?,uploaded_at=?,updated_at=?,deadline=?,stage='queued' WHERE id=?",
                       (size, now, now, now + self.settings.job_timeout_sec, job_id))

    def claim_delivery(self, job_id, attempt):
        self.expire()
        with self.connect(True) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row or row['attempt'] != attempt or row['status'] != 'processing':
                return None
            if row['uploaded_at'] is None or (row['lease_until'] or 0) > time.time():
                raise RuntimeError('Delivery is not ready; retry')
            worker_id = uuid.uuid4().hex
            now = time.time()
            db.execute("UPDATE jobs SET worker_id=?,lease_until=?,started_at=?,stage='preparing',updated_at=? WHERE id=?",
                       (worker_id, now + 60, now, now, job_id))
            return dict(db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone())

    def renew(self, job_id, worker_id):
        with self.connect(True) as db:
            changed = db.execute("UPDATE jobs SET lease_until=? WHERE id=? AND worker_id=? AND status='processing' AND deadline>?",
                                 (time.time() + 60, job_id, worker_id, time.time())).rowcount
            return changed == 1

    def set_duration(self, job_id, worker_id, duration):
        with self.connect(True) as db:
            db.execute('UPDATE jobs SET duration=? WHERE id=? AND worker_id=?', (duration, job_id, worker_id))

    def finish_cloud(self, job_id, worker_id, result_ref, verdict):
        now = time.time()
        with self.connect(True) as db:
            return db.execute("""UPDATE jobs SET status='done',result_ref=?,verdict=?,finished_at=?,updated_at=?,
                worker_id=NULL,lease_until=NULL WHERE id=? AND worker_id=? AND status='processing' AND deadline>?""",
                (result_ref, verdict, now, now, job_id, worker_id, now)).rowcount == 1

    def release_delivery(self, job_id, worker_id):
        with self.connect(True) as db:
            db.execute('UPDATE jobs SET worker_id=NULL,lease_until=NULL WHERE id=? AND worker_id=?', (job_id, worker_id))

    def fail(self, job_id, code, worker_id=None):
        now = time.time()
        with self.connect(True) as db:
            sql = "UPDATE jobs SET status='failed',error_code=?,finished_at=?,updated_at=? WHERE id=? AND status='processing'"
            params = (code, now, now, job_id)
            if worker_id is not None:
                sql += ' AND worker_id=?'
                params += (worker_id,)
            db.execute(sql, params)

    def restore_cloud(self, job_id, owner, publish):
        with self.connect(True) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=? AND owner=?', (job_id, owner)).fetchone()
            if not row:
                raise SentryError('NOT_FOUND', 404)
            if row['status'] == 'processing':
                return
            if row['status'] not in {'failed', 'cancelled'} or row['uploaded_at'] is None:
                raise SentryError('INVALID_STATE', 409)
            if (row['lease_until'] or 0) > time.time():
                raise SentryError('JOB_BUSY', 409)
            if db.execute("SELECT count(*) FROM jobs WHERE status='processing'").fetchone()[0] >= self.settings.queue_capacity:
                raise SentryError('QUEUE_FULL', 503)
            publish({'job_id': job_id, 'attempt': row['attempt'] + 1})
            db.execute("""UPDATE jobs SET status='processing',stage='queued',deadline=?,started_at=NULL,
                finished_at=NULL,worker_id=NULL,lease_until=NULL,error_code=NULL,result_ref=NULL,verdict=NULL,
                timings='{}',updated_at=?,attempt=attempt+1 WHERE id=?""",
                       (time.time() + self.settings.job_timeout_sec, time.time(), job_id))

    def expire(self):
        super().expire()
        with self.connect(True) as db:
            db.execute("UPDATE jobs SET worker_id=NULL,lease_until=NULL WHERE status!='processing' AND lease_until<?", (time.time(),))


if __name__ == '__main__':
    from .config import Settings
    CloudDatabase(Settings.for_vercel()).migrate()
