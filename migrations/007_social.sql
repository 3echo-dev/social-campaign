-- Social research storage.
--
-- social_records caches what the social and web tools read, one row per platform,
-- operation and target, so a repeated call inside the time to live answers from
-- here instead of asking the platform again. json holds the whole research envelope.
--
-- web_evidence_requests remembers every web evidence plan a tool handed out, and
-- research_evidence holds what Claude then found with web search and web fetch,
-- with provenance. A record is an observation; the notes Claude adds about it are
-- inferences and live in their own column, never mixed into the record.

CREATE TABLE social_records (
  id                TEXT PRIMARY KEY,
  platform          TEXT NOT NULL
                    CHECK (platform IN ('tiktok', 'instagram', 'facebook', 'meta', 'web')),
  kind              TEXT NOT NULL
                    CHECK (kind IN ('profile', 'post', 'comments', 'search', 'ads', 'crawl')),
  source_ref        TEXT NOT NULL,                  -- the normalised target, for example tiktok:@brand
  json              TEXT NOT NULL,
  coverage          TEXT NOT NULL CHECK (coverage IN ('full', 'partial', 'none')),
  observed_at       TEXT NOT NULL,
  last_verified_at  TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  UNIQUE (platform, kind, source_ref)
);

CREATE INDEX idx_social_records_expiry ON social_records (expires_at);

CREATE TABLE web_evidence_requests (
  request_id   TEXT PRIMARY KEY,
  platform     TEXT NOT NULL
               CHECK (platform IN ('tiktok', 'instagram', 'facebook', 'meta', 'web')),
  operation    TEXT NOT NULL,
  target       TEXT NOT NULL,
  plan_json    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  answered_at  TEXT
);

CREATE TABLE research_evidence (
  id           TEXT PRIMARY KEY,
  request_id   TEXT,                                -- a web_evidence_requests id, when the item answers a plan
  campaign_id  TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  platform     TEXT NOT NULL
               CHECK (platform IN ('tiktok', 'instagram', 'facebook', 'meta', 'web')),
  kind         TEXT NOT NULL CHECK (kind IN ('post', 'profile', 'comment', 'ad', 'page')),
  url          TEXT NOT NULL,
  record_json  TEXT NOT NULL,                       -- the observation, in the record shape
  notes_json   TEXT,                                -- Claude's inferences about it, kept apart
  source_type  TEXT NOT NULL CHECK (source_type = 'web_evidence'),
  source_ref   TEXT NOT NULL,
  observed_at  TEXT NOT NULL,
  confidence   REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_research_evidence_request ON research_evidence (request_id);
CREATE INDEX idx_research_evidence_campaign ON research_evidence (campaign_id, platform, kind);
