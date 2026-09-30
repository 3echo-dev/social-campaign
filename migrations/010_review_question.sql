-- Widen reviews.kind again so a question asked through the pane (question_ask) has
-- a kind of its own, the same way migration 004 gave the concept gate one.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt exactly as
-- migration 004 did: create the new shape, copy every row across, drop the old table,
-- rename, and put the index back.

CREATE TABLE reviews_new (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('strategy', 'concept', 'cost', 'media', 'final', 'question')),
  payload       TEXT NOT NULL,
  decision      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'resolved')),
  created_at    TEXT NOT NULL,
  resolved_at   TEXT
);

INSERT INTO reviews_new (id, campaign_id, kind, payload, decision, status, created_at, resolved_at)
SELECT id, campaign_id, kind, payload, decision, status, created_at, resolved_at FROM reviews;

DROP TABLE reviews;

ALTER TABLE reviews_new RENAME TO reviews;

CREATE INDEX idx_reviews_campaign ON reviews (campaign_id, kind, status);
