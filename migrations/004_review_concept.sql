-- Widen reviews.kind so the concept gate has a name of its own.
--
-- Until now a concept review was stored under kind 'media', because the original
-- CHECK constraint only named the four gates from the spec. SQLite cannot alter a
-- CHECK constraint in place, so the table is rebuilt: create the new shape, copy
-- every row across, drop the old table, rename, and put the index back. The whole
-- file runs inside the single transaction that db/migrate.mjs wraps around it. No other
-- table references reviews, so foreign keys stay on throughout.
--
-- Existing rows are copied unchanged. A concept review recorded before this update
-- stays under 'media', because nothing in the row says which of the two it was.

CREATE TABLE reviews_new (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('strategy', 'concept', 'cost', 'media', 'final')),
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
