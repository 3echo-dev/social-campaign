-- 003_library.sql
-- Creative library ingestion jobs.
--
-- One row per "point Social Campaign at a folder" run. The counters are updated as
-- the pipeline moves so a job survives a server restart and can be resumed: assets
-- already registered (matched by sha256) are skipped on the next run.

CREATE TABLE library_jobs (
  id             TEXT PRIMARY KEY,
  brand_id       TEXT REFERENCES brands(id) ON DELETE SET NULL,
  source_folder  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  phase          TEXT NOT NULL DEFAULT 'inventory'
                 CHECK (phase IN ('inventory', 'hashing', 'probing', 'thumbnails', 'done')),
  files_found    INTEGER NOT NULL DEFAULT 0,
  hashed         INTEGER NOT NULL DEFAULT 0,
  probed         INTEGER NOT NULL DEFAULT 0,
  thumbnails     INTEGER NOT NULL DEFAULT 0,
  registered     INTEGER NOT NULL DEFAULT 0,
  duplicates     INTEGER NOT NULL DEFAULT 0,
  skipped        INTEGER NOT NULL DEFAULT 0,
  failed         INTEGER NOT NULL DEFAULT 0,
  errors_json    TEXT NOT NULL DEFAULT '[]',
  error          TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX idx_library_jobs_status ON library_jobs (status, created_at);
