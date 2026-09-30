/**
 * Copy validation: caption length, hook placement inside the visible cutoff, hashtag
 * count and format, link handling and mentions, per platform, plus the AI-generated
 * disclosure check for video.
 *
 * Logic ported from `the social-media-pipeline project's scripts/platform-check.js`
 * (3echo's own MIT project; see `platform-rules.mjs` for the license note), which runs
 * these same mechanical checks against a draft's front matter and the ```json block in
 * `platform-rules/<platform>.md`. This module runs the equivalent checks in process,
 * against a `CopyPackage` variant (`schemas/copy-package.schema.json`) instead of a
 * markdown draft file, since this plugin keeps copy as a database artifact rather than
 * a file on disk.
 *
 *   platform-check.js line ref -> this module
 *   caption+hashtags char count, `c.max_chars`            -> checkCaptionLength
 *   `c.visible_cutoff_chars` against the first line        -> checkHookCutoff
 *   `h.max` / `h.recommended_max` / `h.recommended_min`     -> checkHashtags
 *   `links.clickable_in_caption` against a URL in caption   -> checkLinks
 *   media required / text_only_allowed                      -> checkMedia
 *   AI-generated video disclosure                            -> checkDisclosure
 *
 * A hard error refuses the save (`fail`, matching platform-check.js's R-LIMIT/R-HOOK/
 * R-POLICY "fail" severity); a soft issue comes back as a warning the copywriter has
 * to address before the copy is safe to publish, but does not block saving a draft.
 */

import { rulesFor } from './platform-rules.mjs';

/**
 * @typedef {object} Finding
 * @property {'fail'|'warn'} severity
 * @property {string} code
 * @property {string} message
 */

/**
 * Hashtags found in a caption or an explicit hashtags list, in the shape
 * platform-check.js's own regex accepts: `#` followed by letters, numbers or
 * underscore, unicode aware.
 * @param {string[]} hashtags
 * @returns {string[]}
 */
function normalizedHashtags(hashtags) {
  return (Array.isArray(hashtags) ? hashtags : []).map((tag) => String(tag).trim()).filter(Boolean);
}

const HASHTAG_SHAPE = /^#[\p{L}\p{N}_]+$/u;

/**
 * @param {string} caption
 * @param {string[]} hashtags
 * @returns {number} the combined visible character count Buffer/Instagram/TikTok count against their limit.
 */
function combinedLength(caption, hashtags) {
  const tagsLine = hashtags.length > 0 ? `\n\n${hashtags.join(' ')}` : '';
  return [...`${caption}${tagsLine}`].length;
}

/**
 * @param {string} caption
 * @returns {string}
 */
function firstLine(caption) {
  return String(caption ?? '').split('\n')[0] ?? '';
}

/**
 * Check one CopyPackage variant against its platform's rules.
 * @param {object} variant a CopyPackage variants[] entry: {platform, caption, hook_line?, hashtags?, disclosure?, accessibility_text?}
 * @param {{has_media?: boolean, has_video?: boolean, ai_generated?: boolean}} [context]
 * @returns {{platform: string, pass: boolean, findings: Finding[], measured: {chars: number, first_line_chars: number, hashtag_count: number}}}
 */
export function checkCopy(variant, context = {}) {
  const platform = String(variant?.platform ?? '');
  const rules = rulesFor(platform);
  const caption = String(variant?.caption ?? '').trim();
  const hashtags = normalizedHashtags(variant?.hashtags);
  const chars = combinedLength(caption, hashtags);
  const hook = firstLine(variant?.hook_line && variant.hook_line.trim() ? variant.hook_line : caption);
  const hookChars = [...hook].length;

  /** @type {Finding[]} */
  const findings = [];
  const fail = (code, message) => findings.push({ severity: 'fail', code, message });
  const warn = (code, message) => findings.push({ severity: 'warn', code, message });

  if (!caption) {
    fail('R-LIMIT', 'The caption is empty.');
  }

  const c = rules.caption;
  if (c.max_chars && chars > c.max_chars) {
    fail('R-LIMIT', `Caption and hashtags together are ${chars} characters, over ${platform}'s limit of ${c.max_chars}.`);
  }
  if (c.ideal_max_chars && chars > c.ideal_max_chars) {
    warn(
      'R-LIMIT',
      `Caption is ${chars} characters, above the ideal ${c.ideal_min_chars ?? 0} to ${c.ideal_max_chars} for ${platform}.`,
    );
  }
  if (c.visible_cutoff_chars && hookChars > c.visible_cutoff_chars) {
    fail(
      'R-HOOK',
      `The hook is ${hookChars} characters; it has to land inside ${platform}'s visible cutoff of ${c.visible_cutoff_chars} characters before "See more" truncates it.`,
    );
  }

  const h = rules.hashtags;
  for (const tag of hashtags) {
    if (!HASHTAG_SHAPE.test(tag)) {
      fail('R-LIMIT', `"${tag}" is not a usable hashtag: no spaces or punctuation other than an underscore.`);
    }
  }
  if (h.max !== null && hashtags.length > h.max) {
    fail('R-LIMIT', `${hashtags.length} hashtags, ${platform}'s cap is ${h.max}.`);
  }
  if (hashtags.length > h.recommended_max) {
    warn('R-LIMIT', `${hashtags.length} hashtags, recommended at most ${h.recommended_max} on ${platform}.`);
  }
  if (h.recommended_min > 0 && hashtags.length < h.recommended_min) {
    warn('R-LIMIT', `${hashtags.length} hashtags, recommended at least ${h.recommended_min} on ${platform}.`);
  }

  const hasUrl = /https?:\/\//i.test(caption);
  if (hasUrl && rules.links.clickable_in_caption === false) {
    warn(
      'R-LIMIT',
      `A link in the caption will not be clickable on ${platform}; move it to the bio link or a link sticker, or the first comment.`,
    );
  }

  const hasMedia = context.has_media !== false;
  if (rules.media.required && !hasMedia) {
    fail('R-LIMIT', `${platform} requires media; this variant has none.`);
  }
  if (rules.media.text_only_allowed === false && !hasMedia) {
    fail('R-LIMIT', `Text-only posts are not allowed on ${platform}.`);
  }

  const disclosureText = String(variant?.disclosure ?? '').trim();
  const isVideo = Boolean(context.has_video);
  const isAiGenerated = context.ai_generated !== false; // 3echo Studio output defaults to AI-generated unless told otherwise.
  if (isVideo && isAiGenerated && rules.disclosure.ai_generated_video_label_required && !disclosureText) {
    fail(
      'R-POLICY',
      `This is an AI-generated video for ${platform}, which requires an AI-generated content disclosure; the disclosure field is empty.`,
    );
  }

  const mentionCount = (caption.match(/(^|\s)@[\w.]+/g) ?? []).length;

  return {
    platform,
    pass: !findings.some((entry) => entry.severity === 'fail'),
    findings,
    measured: { chars, first_line_chars: hookChars, hashtag_count: hashtags.length, mention_count: mentionCount },
  };
}

/**
 * Check every variant in a CopyPackage.
 * @param {any} copyPackage
 * @param {Record<string, {has_media?: boolean, has_video?: boolean, ai_generated?: boolean}>} [contextByPlatform]
 * @returns {{pass: boolean, results: ReturnType<typeof checkCopy>[]}}
 */
export function checkCopyPackage(copyPackage, contextByPlatform = {}) {
  const variants = Array.isArray(copyPackage?.variants) ? copyPackage.variants : [];
  const results = variants.map((variant) => checkCopy(variant, contextByPlatform[String(variant.platform)] ?? {}));
  return { pass: results.every((entry) => entry.pass), results };
}
