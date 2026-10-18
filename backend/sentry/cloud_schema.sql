CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, csrf_hash TEXT NOT NULL,
  created_at DOUBLE PRECISION NOT NULL, expires_at DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, owner TEXT REFERENCES sessions(token_hash),
  channel TEXT NOT NULL, mode TEXT NOT NULL, is_demo INTEGER NOT NULL,
  filename TEXT NOT NULL, extension TEXT NOT NULL,
  created_at DOUBLE PRECISION NOT NULL, deadline DOUBLE PRECISION NOT NULL,
  uploaded_at DOUBLE PRECISION, started_at DOUBLE PRECISION, finished_at DOUBLE PRECISION,
  updated_at DOUBLE PRECISION NOT NULL, stage TEXT NOT NULL, status TEXT NOT NULL,
  duration DOUBLE PRECISION, size BIGINT, worker_id TEXT, lease_until DOUBLE PRECISION,
  error_code TEXT, result_ref TEXT, verdict TEXT, timings TEXT NOT NULL DEFAULT '{}',
  batch_id TEXT, display_name TEXT, analysis_request TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,stage,created_at);
CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner,created_at);
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(token_hash), created_at DOUBLE PRECISION NOT NULL
);
