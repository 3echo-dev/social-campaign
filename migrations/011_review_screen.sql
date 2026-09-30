-- Add reviews.screen_id, so a review row can be matched back to the pane screen it
-- opened.
--
-- This is what lets a restarted server, which has restored a gate screen from
-- pane-state.json but has no memory of the in-process gate that was waiting on it,
-- find the still-pending review row for that screen and start waiting on it again.
-- Without this column the only link between a review and its screen lived in the
-- process's own in-memory pendingGates map, which a restart always throws away.
--
-- Nullable: a review recorded before this migration has no screen_id and is simply
-- never rehydrated after a restart, which is no worse than today's behavior.

ALTER TABLE reviews ADD COLUMN screen_id TEXT;

CREATE INDEX idx_reviews_screen ON reviews (screen_id);
