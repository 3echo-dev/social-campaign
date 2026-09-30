-- Idempotent evidence ingestion and evidence retrieval on resume.
--
-- research_evidence had no way to tell a genuine repeat observation from a fresh
-- one: saving the same web finding twice created two rows, which could look like
-- independent corroboration when it was really the same page read again.
--
-- dedup_key is a stable identity for one evidence item: platform, the plan target it
-- answers (when there was a plan), the normalised source url and a hash of its text.
-- A repeat save with the same key updates last_verified_at on the existing row
-- instead of inserting a new one. The partial unique index leaves old rows (saved
-- before this migration, with no dedup_key) alone.

ALTER TABLE research_evidence ADD COLUMN dedup_key TEXT;
ALTER TABLE research_evidence ADD COLUMN last_verified_at TEXT;

UPDATE research_evidence SET last_verified_at = created_at WHERE last_verified_at IS NULL;

CREATE UNIQUE INDEX idx_research_evidence_dedup ON research_evidence (dedup_key) WHERE dedup_key IS NOT NULL;
