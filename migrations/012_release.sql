-- The release package: the one record that is previewed, approved, exported and published.
--
-- Until now the final review showed one set of posts while publishing rebuilt a
-- different set from whatever the latest copy and generated-media artifacts happened
-- to be. An approval therefore authorised nothing in particular, and the bytes that
-- went out could differ from the bytes a person looked at.
--
-- A release fixes exactly one deliverable per post: platform, caption, hashtags,
-- first comment, target account, schedule, and the exact asset with the sha256 of its
-- bytes at build time. Its digest covers that content, so any later edit produces a
-- different digest and the old approval no longer matches.
--
-- reviews.target records which release and digest a final review was opened on, so a
-- resolved approval names what it approved instead of standing for the campaign in
-- general.

CREATE TABLE release_packages (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  digest      TEXT NOT NULL,
  json        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'approved', 'superseded', 'published', 'exported')),
  created_at  TEXT NOT NULL,
  UNIQUE (campaign_id, version)
);

CREATE INDEX idx_release_packages_campaign ON release_packages (campaign_id, version);

CREATE TABLE release_posts (
  id            TEXT PRIMARY KEY,
  release_id    TEXT NOT NULL REFERENCES release_packages(id) ON DELETE CASCADE,
  post_index    INTEGER NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'tiktok')),
  asset_id      TEXT,
  asset_sha256  TEXT,
  caption       TEXT NOT NULL DEFAULT '',
  hashtags      TEXT NOT NULL DEFAULT '[]',
  first_comment TEXT,
  account_id    TEXT,
  scheduled_at  TEXT,
  UNIQUE (release_id, post_index)
);

CREATE INDEX idx_release_posts_release ON release_posts (release_id, post_index);

-- One row per dispatch of one post to a provider, written before the call is made.
--
-- state 'pending' means the row exists but the provider has not answered yet, which
-- is what a crash between the two leaves behind. 'unknown' means the call went out
-- and the answer was lost; nothing may ever retry it automatically, because the
-- provider may have accepted the post.
CREATE TABLE publish_attempts (
  id              TEXT PRIMARY KEY,
  release_id      TEXT NOT NULL REFERENCES release_packages(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  post_index      INTEGER NOT NULL,
  attempt         INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending', 'accepted', 'scheduled', 'published', 'failed', 'unknown')),
  provider_ref    TEXT,
  receipt         TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (release_id, post_index, attempt)
);

CREATE INDEX idx_publish_attempts_release ON publish_attempts (release_id, post_index, attempt);

ALTER TABLE reviews ADD COLUMN target TEXT;
