-- Give the working generation manifest an artifact kind of its own.
--
-- The manifest used to share the 'GeneratedMediaPackage' kind with the finished
-- package it projects onto, which meant the reader had to guess which of the two a
-- row held by looking for an `items` array. The manifest now lives under
-- 'GenerationManifest' and the finished projection keeps 'GeneratedMediaPackage'.
--
-- Existing rows that carry an `items` array are the working manifest, so they move
-- across. artifacts is unique on (campaign_id, kind, version) and no row exists
-- under the new kind yet, so the version numbers carry over untouched.

UPDATE artifacts
   SET kind = 'GenerationManifest'
 WHERE kind = 'GeneratedMediaPackage'
   AND json IS NOT NULL
   AND json_valid(json)
   AND json_type(json, '$.items') = 'array';
