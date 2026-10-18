import json
import logging
import sqlite3
import time
from contextlib import contextmanager

from .errors import SentryError

log = logging.getLogger(__name__)


class Database:
    def __init__(self, settings):
        self.settings = settings
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        (settings.data_dir / "jobs").mkdir(exist_ok=True)
        self.path = settings.data_dir / "app.sqlite3"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, csrf_hash TEXT NOT NULL,
                    created_at REAL NOT NULL, expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, owner TEXT REFERENCES sessions(token_hash),
                    channel TEXT NOT NULL, mode TEXT NOT NULL, is_demo INTEGER NOT NULL,
                    filename TEXT NOT NULL, extension TEXT NOT NULL,
                    created_at REAL NOT NULL, deadline REAL NOT NULL, uploaded_at REAL,
                    started_at REAL, finished_at REAL, updated_at REAL NOT NULL,
                    stage TEXT NOT NULL, status TEXT NOT NULL,
                    duration REAL, size INTEGER, worker_id TEXT,
                    error_code TEXT, result_ref TEXT, verdict TEXT,
                    timings TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, stage, created_at);
                CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner, created_at);
                CREATE TABLE IF NOT EXISTS worker (
                    slot INTEGER PRIMARY KEY CHECK(slot=1),
                    id TEXT NOT NULL, heartbeat REAL NOT NULL,
                    mode TEXT NOT NULL, ready INTEGER NOT NULL, error_code TEXT
                );
            """)

            columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
            for name, declaration in {"batch_id": "TEXT", "display_name": "TEXT", "analysis_request": "TEXT NOT NULL DEFAULT ''", "attempt": "INTEGER NOT NULL DEFAULT 1"}.items():
                if name not in columns:
                    db.execute(f"ALTER TABLE jobs ADD COLUMN {name} {declaration}")
            db.execute("CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(token_hash), created_at REAL NOT NULL)")

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=5000")
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            if write:
                db.commit()
        except BaseException:
            if write:
                db.rollback()
            raise
        finally:
            db.close()

    def session(self, token_hash):
        with self.connect() as db:
            row = db.execute("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?",
                             (token_hash, time.time())).fetchone()
            return dict(row) if row else None

    def create_session(self, token_hash, csrf_hash):
        now = time.time()
        with self.connect(True) as db:
            db.execute("INSERT INTO sessions VALUES (?,?,?,?)",
                       (token_hash, csrf_hash, now, now + self.settings.session_ttl_sec))

    def rotate_csrf(self, owner, csrf_hash):
        with self.connect(True) as db:
            db.execute("UPDATE sessions SET csrf_hash=? WHERE token_hash=?", (csrf_hash, owner))

    def reserve(self, job_id, owner, channel, filename, extension, created_at, batch_id=None, display_name=None, analysis_request=""):
        now = time.time()
        with self.connect(True) as db:
            db.execute("""UPDATE jobs SET status='failed', error_code='JOB_TIMEOUT',
                       finished_at=?, updated_at=? WHERE status='processing' AND deadline<=?""", (now, now, now))
            count = db.execute("SELECT count(*) FROM jobs WHERE status='processing'").fetchone()[0]
            if count >= self.settings.queue_capacity:
                raise SentryError("QUEUE_FULL", 503)
            db.execute("""INSERT INTO jobs
                (id,owner,channel,mode,is_demo,filename,extension,created_at,deadline,updated_at,stage,status)
                VALUES (?,?,?,?,?,?,?,?,?,?, 'preparing','processing')""",
                       (job_id, owner, channel, self.settings.pipeline_mode,
                        int(self.settings.pipeline_mode == "mock"), filename, extension,
                        created_at, created_at + self.settings.job_timeout_sec, now))
            db.execute("UPDATE jobs SET batch_id=?,display_name=?,analysis_request=? WHERE id=?", (batch_id, display_name, analysis_request, job_id))

    def enqueue(self, job_id, duration, size):
        now = time.time()
        with self.connect(True) as db:
            result = db.execute("""UPDATE jobs SET stage='queued',duration=?,size=?,uploaded_at=?,updated_at=?
                WHERE id=? AND status='processing' AND deadline>?""", (duration, size, now, now, job_id, now))
            if result.rowcount != 1:
                raise SentryError("JOB_TIMEOUT", 408)

    def abandon_upload(self, job_id):
        with self.connect(True) as db:
            db.execute("DELETE FROM jobs WHERE id=? AND uploaded_at IS NULL", (job_id,))

    def get(self, job_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            return dict(row) if row else None

    def history(self, owner, limit, offset):
        with self.connect() as db:
            total = db.execute("SELECT count(*) FROM jobs WHERE owner=?", (owner,)).fetchone()[0]
            rows = db.execute("SELECT * FROM jobs WHERE owner=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
                              (owner, limit, offset)).fetchall()
            return [dict(row) for row in rows], total

    def heartbeat(self, worker_id, ready, error=None):
        with self.connect(True) as db:
            db.execute("""INSERT INTO worker VALUES(1,?,?,?,?,?) ON CONFLICT(slot) DO UPDATE SET
                id=excluded.id,heartbeat=excluded.heartbeat,mode=excluded.mode,
                ready=excluded.ready,error_code=excluded.error_code""",
                       (worker_id, time.time(), self.settings.pipeline_mode, int(ready), error))

    def worker_state(self):
        with self.connect() as db:
            row = db.execute("SELECT * FROM worker WHERE slot=1").fetchone()
            return dict(row) if row else None

    def expire(self):
        now = time.time()
        with self.connect(True) as db:
            db.execute("""UPDATE jobs SET status='failed',error_code='JOB_TIMEOUT',finished_at=?,updated_at=?
                WHERE status='processing' AND deadline<=?""", (now, now, now))

    def recover(self):
        # Called only while holding the OS worker lock, after the previous child tree exited.
        now = time.time()
        with self.connect(True) as db:
            db.execute("""UPDATE jobs SET status='failed',error_code='WORKER_INTERRUPTED',
                finished_at=?,updated_at=? WHERE status='processing' AND worker_id IS NOT NULL""", (now, now))
        with self.connect(True) as db:
            db.execute("UPDATE jobs SET worker_id=NULL WHERE status!='processing'")
        self.expire()

    def claim(self, worker_id):
        now = time.time()
        with self.connect(True) as db:
            # A single durable slot, even when independent callers race.
            if db.execute("SELECT 1 FROM jobs WHERE worker_id IS NOT NULL AND status IN ('processing','cancelled')").fetchone():
                return None
            row = db.execute("""SELECT id FROM jobs WHERE status='processing' AND stage='queued'
                AND deadline>? AND mode=? ORDER BY created_at,id LIMIT 1""", (now, self.settings.pipeline_mode)).fetchone()
            if not row:
                return None
            db.execute("""UPDATE jobs SET worker_id=?,started_at=?,updated_at=?,stage='preparing'
                WHERE id=? AND status='processing' AND worker_id IS NULL""", (worker_id, now, now, row[0]))
            return dict(db.execute("SELECT * FROM jobs WHERE id=?", (row[0],)).fetchone())

    def stage(self, job_id, worker_id, stage):
        now = time.time()
        with self.connect(True) as db:
            changed = db.execute("""UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND worker_id=?
                AND status='processing' AND deadline>?""", (stage, now, job_id, worker_id, now)).rowcount
        if not changed:
            raise SentryError("JOB_TIMEOUT")
        log.info("job=%s stage=%s", job_id, stage)

    def fail(self, job_id, code, worker_id=None):
        now = time.time()
        with self.connect(True) as db:
            db.execute("""UPDATE jobs SET status='failed',error_code=?,finished_at=?,updated_at=?
                WHERE id=? AND status='processing' AND (? IS NULL OR worker_id=?)""",
                       (code, now, now, job_id, worker_id, worker_id))
        log.info("job=%s error=%s", job_id, code)

    def finish(self, job_id, worker_id, verdict, timings):
        now = time.time()
        with self.connect(True) as db:
            return db.execute("""UPDATE jobs SET status='done',finished_at=?,updated_at=?,
                result_ref='final_result.json',verdict=?,timings=?,worker_id=NULL WHERE id=? AND worker_id=?
                AND status='processing' AND deadline>?""",
                (now, now, verdict, json.dumps(timings), job_id, worker_id, now)).rowcount == 1


    def create_batch(self, batch_id, owner):
        with self.connect(True) as db:
            db.execute("INSERT INTO batches VALUES (?,?,?)", (batch_id, owner, time.time()))

    def owns_batch(self, batch_id, owner):
        with self.connect() as db:
            return db.execute("SELECT 1 FROM batches WHERE id=? AND owner=?", (batch_id, owner)).fetchone() is not None

    def batch_history(self, batch_id, owner):
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM jobs WHERE batch_id=? AND owner=? ORDER BY created_at,id", (batch_id, owner))]

    def cancel(self, job_id, owner):
        now = time.time()
        with self.connect(True) as db:
            db.execute("UPDATE jobs SET status='cancelled',verdict=NULL,error_code=NULL,finished_at=?,updated_at=? WHERE id=? AND owner=? AND channel='ui' AND status='processing'", (now, now, job_id, owner))

    def release(self, job_id, worker_id):
        with self.connect(True) as db:
            db.execute("UPDATE jobs SET worker_id=NULL WHERE id=? AND worker_id=? AND status!='processing'", (job_id, worker_id))

    def restore(self, job_id, owner):
        now = time.time()
        with self.connect(True) as db:
            row = db.execute("SELECT * FROM jobs WHERE id=? AND owner=? AND channel='ui'", (job_id, owner)).fetchone()
            if row is None:
                raise SentryError("NOT_FOUND", 404)
            if row["status"] == "processing":
                return  # idempotent restore, never a second queue entry
            if row["status"] not in {"cancelled", "failed"}:
                raise SentryError("INVALID_STATE", 409)
            if row["worker_id"] is not None:
                raise SentryError("JOB_BUSY", 409)
            if db.execute("SELECT count(*) FROM jobs WHERE status='processing'").fetchone()[0] >= self.settings.queue_capacity:
                raise SentryError("QUEUE_FULL", 503)
            db.execute("""UPDATE jobs SET status='processing',stage='queued',deadline=?,started_at=NULL,
                finished_at=NULL,worker_id=NULL,error_code=NULL,result_ref=NULL,verdict=NULL,timings='{}',
                updated_at=?,attempt=attempt+1 WHERE id=?""", (now+self.settings.job_timeout_sec, now, job_id))

    def delete_job(self, job_id, owner):
        with self.connect(True) as db:
            row = db.execute("SELECT * FROM jobs WHERE id=? AND owner=? AND channel='ui'", (job_id, owner)).fetchone()
            if row is None:
                raise SentryError("NOT_FOUND", 404)
            if row["status"] == "processing" or row["worker_id"] is not None:
                raise SentryError("JOB_BUSY", 409)
            db.execute("DELETE FROM jobs WHERE id=?", (job_id,))
