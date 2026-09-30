-- Durable workflow revisions and publication recovery.
--
-- Artifact rows stay in history, but an invalidated row must never satisfy a
-- stage or an approval after a revision.  Stage runs keep the exact output
-- version and the artifact dependencies they observed, while publish attempts
-- keep enough lifecycle information to distinguish a reservation made before a
-- provider call from a call whose outcome was lost.

ALTER TABLE artifacts ADD COLUMN invalidated_at TEXT;
ALTER TABLE artifacts ADD COLUMN invalidation_reason TEXT;

ALTER TABLE stage_runs ADD COLUMN output_kind TEXT;
ALTER TABLE stage_runs ADD COLUMN output_version INTEGER;

CREATE TABLE artifact_dependencies (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  stage_run_id   TEXT NOT NULL REFERENCES stage_runs(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN ('input', 'output', 'approval')),
  kind           TEXT NOT NULL,
  artifact_id    TEXT,
  version        INTEGER,
  review_id      TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (stage_run_id, dependency_type, kind, artifact_id, version, review_id)
);

CREATE INDEX idx_artifact_dependencies_campaign
  ON artifact_dependencies (campaign_id, dependency_type, kind, version);
CREATE INDEX idx_artifact_dependencies_artifact
  ON artifact_dependencies (artifact_id, version);

ALTER TABLE publish_attempts ADD COLUMN lease_expires_at TEXT;
ALTER TABLE publish_attempts ADD COLUMN dispatch_started_at TEXT;
ALTER TABLE publish_attempts ADD COLUMN resolved_at TEXT;
ALTER TABLE publish_attempts ADD COLUMN intent_json TEXT;

-- Rows created before lease tracking could already have crossed the provider
-- boundary, so an upgrade must preserve them as unclear rather than making them
-- eligible for a duplicate retry.
UPDATE publish_attempts
SET state = 'unknown',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP,
    receipt = CASE
      WHEN receipt IS NULL OR receipt = '{}' THEN '{"recovered":"This pending attempt existed before lifecycle tracking and may have reached the provider."}'
      ELSE receipt
    END
WHERE state = 'pending' AND lease_expires_at IS NULL AND dispatch_started_at IS NULL;

CREATE INDEX idx_publish_attempts_recovery
  ON publish_attempts (state, lease_expires_at, dispatch_started_at);
