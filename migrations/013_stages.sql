-- Stage execution records, and the one status a stage was missing.
--
-- Until now "where has this job got to" had two answers. The saved plan JSON held
-- one set of statuses, `job_stages` held another, and the phase strip read the plan
-- while every stage move wrote to the table. A stage could also be marked complete
-- by asserting it: `stage_advance` took the word for the deed, and `stage_update`
-- would happily insert a stage name that is in no route at all.
--
-- `stage_runs` is the execution record. One row per attempt at a stage: when it
-- started, when it finished, how it finished, which artifact it produced and any
-- note. Progress is rolled up from these rows and the current plan, so there is one
-- source for what has actually happened, and the saved plan versions stay immutable
-- history of what was intended.
--
-- `job_stages` keeps the current status per stage, and gains `needs_rework` so a
-- revision can mark a stage and everything downstream of it as work to redo instead
-- of silently leaving stale output in place.

CREATE TABLE stage_runs (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  stage        TEXT NOT NULL,
  attempt      INTEGER NOT NULL DEFAULT 1,
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  status       TEXT NOT NULL
               CHECK (status IN ('running', 'completed', 'skipped', 'not_applicable', 'waiting', 'needs_rework', 'failed')),
  artifact_id  TEXT,
  note         TEXT,
  UNIQUE (campaign_id, stage, attempt)
);

CREATE INDEX idx_stage_runs_campaign ON stage_runs (campaign_id, stage, attempt);

-- job_stages gains needs_rework. SQLite cannot widen a CHECK in place, so the table
-- is rebuilt and its rows carried across unchanged.
CREATE TABLE job_stages_next (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  stage        TEXT NOT NULL,
  status       TEXT NOT NULL
               CHECK (status IN ('required', 'completed', 'skipped', 'not_applicable', 'waiting', 'needs_rework')),
  stage_order  INTEGER NOT NULL DEFAULT 0,
  detail       TEXT,
  updated_at   TEXT NOT NULL,
  UNIQUE (campaign_id, stage)
);

INSERT INTO job_stages_next (id, campaign_id, stage, status, stage_order, detail, updated_at)
SELECT id, campaign_id, stage, status, stage_order, detail, updated_at FROM job_stages;

DROP INDEX IF EXISTS idx_job_stages_order;
DROP TABLE job_stages;
ALTER TABLE job_stages_next RENAME TO job_stages;

CREATE INDEX idx_job_stages_order ON job_stages (campaign_id, stage_order);
