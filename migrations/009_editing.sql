-- Renders of edit decision lists, and the verifications run against them.
--
-- The EditDecisionList itself is an artifact. What a render adds is the record of
-- how it was cut: the real length of every clip, where the subtitle file is, and the
-- joined video before overlays and subtitles, which verification compares against.
-- edl_hash identifies what a render depends on, so saving the same list again does
-- not reset how many failed verifications it has had; after three the editing tools
-- refuse and the media-producer has to ask the user.

CREATE TABLE edit_renders (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  render_id    TEXT NOT NULL,            -- the asset id of the registered render
  edl_version  INTEGER NOT NULL,
  edl_hash     TEXT NOT NULL,
  preset       TEXT NOT NULL,
  path         TEXT NOT NULL,
  json         TEXT NOT NULL,            -- segments, cues, subtitle files, sizes, warnings
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_edit_renders_render ON edit_renders (campaign_id, render_id, created_at);

CREATE TABLE edit_verifications (
  id              TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  edit_render_id  TEXT NOT NULL REFERENCES edit_renders(id) ON DELETE CASCADE,
  render_id       TEXT NOT NULL,
  edl_version     INTEGER NOT NULL,
  edl_hash        TEXT NOT NULL,
  attempt         INTEGER NOT NULL,
  passed          INTEGER NOT NULL CHECK (passed IN (0, 1)),
  json            TEXT NOT NULL,         -- the checks and the frame sheet
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_edit_verifications_edl ON edit_verifications (campaign_id, edl_hash);
