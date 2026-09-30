/**
 * Platform copy rules: caption limits, hook visibility cutoff, hashtag counts,
 * media requirements and disclosure requirements for Facebook, Instagram and TikTok.
 *
 * Ported as data from the machine readable ```json blocks in
 * `the social-media-pipeline project's platform-rules/facebook.md`,
 * `instagram.md` and `tiktok.md`, each checked 2026-09-02 by that project, at commit
 * 27eaa3ce0069d847c9da09c800da6db6b00c70c1. It is 3echo's own project, and its
 * `.claude-plugin/plugin.json` declares `"license": "MIT"`; it has no LICENSE file or
 * package.json. Its rules are ported here as data with this header noting the source
 * rather than imported as code.
 *
 * Every field below carries the same "checked" date the source file carries, and a
 * `[VERIFY]` marker in the source's own `sources` block means that figure was not
 * independently confirmed against a first party page at the time it was written.
 * `verified_at` on each platform's rules is that same 2026-09-02 date; a builder that
 * re-checks a figure against Meta or TikTok's own docs should move that date forward
 * and note it here.
 */

/**
 * @typedef {object} PlatformRules
 * @property {string} platform
 * @property {string} verified_at
 * @property {{max_chars: number, visible_cutoff_chars: number, ideal_min_chars: number|null, ideal_max_chars: number|null}} caption
 * @property {{max: number|null, recommended_min: number, recommended_max: number}} hashtags
 * @property {{required: boolean, text_only_allowed: boolean}} media
 * @property {{ai_generated_video_label_required: boolean, paid_partnership_label_available: boolean}} disclosure
 * @property {{clickable_in_caption: boolean}} links
 * @property {string} source
 */

/** @type {Record<'facebook'|'instagram'|'tiktok', PlatformRules>} */
export const PLATFORM_RULES = {
  facebook: {
    platform: 'facebook',
    verified_at: '2026-09-02',
    caption: { max_chars: 63206, visible_cutoff_chars: 477, ideal_min_chars: 40, ideal_max_chars: 80 },
    hashtags: { max: null, recommended_min: 0, recommended_max: 2 },
    media: { required: false, text_only_allowed: true },
    disclosure: { ai_generated_video_label_required: true, paid_partnership_label_available: true },
    links: { clickable_in_caption: true },
    source: 'social-media-pipeline/platform-rules/facebook.md, checked 2026-09-02 (3echo, MIT)',
  },
  instagram: {
    platform: 'instagram',
    verified_at: '2026-09-02',
    caption: { max_chars: 2200, visible_cutoff_chars: 125, ideal_min_chars: null, ideal_max_chars: null },
    hashtags: { max: 30, recommended_min: 3, recommended_max: 5 },
    media: { required: true, text_only_allowed: false },
    disclosure: { ai_generated_video_label_required: true, paid_partnership_label_available: true },
    links: { clickable_in_caption: false },
    source: 'social-media-pipeline/platform-rules/instagram.md, checked 2026-09-02 (3echo, MIT)',
  },
  tiktok: {
    platform: 'tiktok',
    verified_at: '2026-09-02',
    caption: { max_chars: 2200, visible_cutoff_chars: 150, ideal_min_chars: null, ideal_max_chars: null },
    hashtags: { max: null, recommended_min: 3, recommended_max: 5 },
    media: { required: true, text_only_allowed: false },
    disclosure: { ai_generated_video_label_required: true, paid_partnership_label_available: true },
    links: { clickable_in_caption: false },
    source: 'social-media-pipeline/platform-rules/tiktok.md, checked 2026-09-02 (3echo, MIT)',
  },
};

/** Platforms this plugin writes copy for. */
export const PLATFORMS = /** @type {const} */ (['facebook', 'instagram', 'tiktok']);

/**
 * @param {string} platform
 * @returns {PlatformRules}
 */
export function rulesFor(platform) {
  const rules = PLATFORM_RULES[/** @type {'facebook'|'instagram'|'tiktok'} */ (platform)];
  if (!rules) throw new Error(`No copy rules for platform "${platform}".`);
  return rules;
}
