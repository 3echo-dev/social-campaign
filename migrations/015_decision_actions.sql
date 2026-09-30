-- Durable pane decisions.
--
-- The pane JSON file remains a delivery projection for older workspaces and for
-- the browser, while this inbox is the source of truth for action receipts once
-- migration 015 has been applied.
--
-- A receipt is retained after acknowledgement so a lost HTTP response can be
-- retried by its stable id without applying the review twice.
-- Pending and claimed rows remain available after a process crash, with the claim
-- lease allowing a replacement consumer to take over safely.

CREATE TABLE decision_actions (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT,
  campaign_id      TEXT,
  review_id        TEXT,
  screen_id        TEXT NOT NULL,
  screen_revision  INTEGER NOT NULL DEFAULT 0,
  screen_type     TEXT,
  context_key      TEXT,
  target_revision  TEXT,
  action           TEXT NOT NULL,
  payload          TEXT NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'claimed', 'applied')),
  consumer_id      TEXT,
  claim_expires_at TEXT,
  claimed_at       TEXT,
  acknowledged_at  TEXT,
  applied_at       TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX idx_decision_actions_screen
  ON decision_actions (screen_id, status, created_at, id);
CREATE INDEX idx_decision_actions_review
  ON decision_actions (review_id, status, created_at, id);
