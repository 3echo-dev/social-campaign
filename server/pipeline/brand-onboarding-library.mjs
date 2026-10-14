/**
 * What a brand onboarding research run leaves in the brand library, so the first job starts from it.
 *
 * A job files its research as workspaces/<brand>/library/research/<jobId>.json (brand-library.mjs, researchIndex), and the next
 * job reuses brand and competitor research under 30 days old. Onboarding research used to leave nothing there, so the first job
 * read the same pages again. When a run is saved this module:
 *
 *   - writes the run's findings as two plain files beside the run, onboarding/<runId>/research/brand.md and competitors.md,
 *     each with its sources, read dates and capture files;
 *   - files them as the library entry library/research/onboarding-<runId>.json, in the shape researchIndex reads
 *     ({ jobId, at, files: [{ path, sha256, topic, at }], industry? }), with the topics `brand` and `competitors`, so the
 *     30-day rule applies and a newer job's file of the same topic takes over;
 *   - saves the top posts the run found on the brand's own accounts and on each competitor's as proven bank items
 *     (source brand or competitor, with the competitor's name and the post's link, views and date; an Instagram post, which
 *     shows no views to a signed-out reader, carries its likes instead), the same call
 *     brand_bank_save makes, so saving the same run twice adds nothing.
 *   - for the few top videos the run took apart (pipeline_video_teardown, with media_transcribe for the words), a post also
 *     carries a `breakdown` of what the video shows: the spoken opening line, the on-screen text hook, its format, shot types,
 *     pacing (cuts per 10 seconds), whether a presenter is on camera, the sound, and the call to action. The spoken hook (else the
 *     on-screen one) is the item's text and the caption becomes its note; the format, the style and the call to action go to the
 *     same bank as proven `format`, `style` and `cta` items with the post's link as their evidence, and the breakdowns are
 *     written into brand/platform-playbook.md (brand-files.js) and the research files.
 *
 * The industry the person picks afterwards is not saved here: the onboard-brand skill saves it with brand_bank_save as an
 * `industry` item of the `yours` bank, which the Strategy gate's industry row (strategy-options.mjs) pre-selects.
 *
 * Nothing in here may fail a research save: the caller catches and reports.
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { addToBank, brandLibraryDir, countText } from './brand-library.mjs';
import * as runtime from './runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const durable = require(join(HERE, '..', '..', 'pipeline', 'scripts', 'lib-durable.js'));
const evidence = require(join(HERE, '..', '..', 'pipeline', 'scripts', 'lib-onboarding-evidence.js'));

export const TOP_POST_PLATFORMS = Object.freeze(['instagram', 'tiktok', 'facebook']);
export const MAX_TOP_POSTS = 12;
/** The videos a run takes apart: the brand's own best and the competitors' best, 5 in all (each teardown is one fetch of the run's budget). */
export const MAX_OWN_BREAKDOWNS = 3;
export const MAX_COMPETITOR_BREAKDOWNS = 2;
export const MAX_BREAKDOWNS = MAX_OWN_BREAKDOWNS + MAX_COMPETITOR_BREAKDOWNS;
export const BREAKDOWN_SOUNDS = Object.freeze(['music', 'voiceover', 'music and voiceover', 'none']);
const POST_FIELDS = Object.freeze(['source', 'competitor', 'platform', 'url', 'text', 'caption', 'views', 'likes', 'date', 'breakdown']);
const BREAKDOWN_FIELDS = Object.freeze(['spokenHook', 'onScreenHook', 'format', 'style', 'shotTypes', 'cutsPer10s', 'presenter', 'sound', 'cta']);
const OWN_PER_PLATFORM = 3;
const PER_COMPETITOR = 2;
const POST_TEXT_MAX = 600;
const DAY_MS = 86400000;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const plain = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (value, limit) => {
  const text = plain(value);
  return text.length > limit ? `${text.slice(0, limit - 3).trimEnd()}...` : text;
};

function hostMatches(url, platform) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return false; }
  if (platform === 'facebook') return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch';
  return host === `${platform}.com` || host.endsWith(`.${platform}.com`);
}

// ---------------------------------------------------------------- the video breakdowns in the draft
const sameWords = (a, b) => plain(a).toLowerCase().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '') === plain(b).toLowerCase().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '');

/**
 * Check one post's `breakdown`: what the researcher saw and heard when it took the video apart with pipeline_video_teardown and
 * media_transcribe. { spokenHook?, onScreenHook?, format, style?, shotTypes?: [text], cutsPer10s?, presenter?: boolean, sound?, cta? }.
 * `format` is needed (what kind of video it is); the hooks are the words as they are said or shown, left out when there are none;
 * cutsPer10s is the teardown's cut count over its length, times ten. Returns the cleaned breakdown, or null when it has a problem.
 */
function breakdownOf(raw, field, fail) {
  if (!isObject(raw)) { fail('breakdown', 'breakdown must be an object, or left out for a post that was not taken apart.'); return null; }
  let ok = true;
  const bad = (key, problem) => { ok = false; fail(`breakdown.${key}`, problem); };
  for (const key of Object.keys(raw)) if (!BREAKDOWN_FIELDS.includes(key)) bad(key, `"${key}" is not a breakdown field. Use ${BREAKDOWN_FIELDS.join(', ')}.`);
  const text = (key, max, required = false) => {
    const value = raw[key];
    if (value === undefined || value === null || value === '') { if (required) bad(key, `${key} is required: say what kind of video it is.`); return ''; }
    if (typeof value !== 'string') { bad(key, `${key} must be text.`); return ''; }
    const words = plain(value);
    if (words.length > max) bad(key, `${key} must be at most ${max} characters (has ${words.length}).`);
    return words;
  };
  const out = {};
  const spokenHook = text('spokenHook', 300);
  const onScreenHook = text('onScreenHook', 300);
  const format = text('format', 120, true);
  const style = text('style', 160);
  const cta = text('cta', 160);
  if (spokenHook) out.spokenHook = spokenHook;
  if (onScreenHook) out.onScreenHook = onScreenHook;
  if (format) out.format = format;
  if (style) out.style = style;
  if (raw.shotTypes !== undefined && raw.shotTypes !== null) {
    if (!Array.isArray(raw.shotTypes)) bad('shotTypes', 'shotTypes must be a list of short shot names such as "close up".');
    else {
      if (raw.shotTypes.length > 6) bad('shotTypes', `shotTypes holds at most 6 shots (has ${raw.shotTypes.length}).`);
      const shots = raw.shotTypes.slice(0, 6).map((item) => (typeof item === 'string' ? plain(item) : ''));
      if (shots.some((item) => !item || item.length > 60)) bad('shotTypes', 'Each shot type is a short name, at most 60 characters.');
      else if (shots.length) out.shotTypes = shots;
    }
  }
  if (raw.cutsPer10s !== undefined && raw.cutsPer10s !== null) {
    if (typeof raw.cutsPer10s !== 'number' || !Number.isFinite(raw.cutsPer10s) || raw.cutsPer10s < 0 || raw.cutsPer10s > 40) bad('cutsPer10s', 'cutsPer10s must be a number from 0 to 40: the teardown\'s cut count over the video\'s length in seconds, times 10.');
    else out.cutsPer10s = Math.round(raw.cutsPer10s * 10) / 10;
  }
  if (raw.presenter !== undefined && raw.presenter !== null) {
    if (typeof raw.presenter !== 'boolean') bad('presenter', 'presenter must be true when a person talks or shows themselves on camera, false when none does, or left out when unclear.');
    else out.presenter = raw.presenter;
  }
  if (raw.sound !== undefined && raw.sound !== null && raw.sound !== '') {
    const sound = typeof raw.sound === 'string' ? plain(raw.sound).toLowerCase() : '';
    if (!BREAKDOWN_SOUNDS.includes(sound)) bad('sound', `sound must be one of ${BREAKDOWN_SOUNDS.join(', ')}.`);
    else out.sound = sound;
  }
  if (cta) out.cta = cta;
  return ok ? out : null;
}

/** How fast the cuts come, in words, from cuts per 10 seconds. */
export function pacingWords(cutsPer10s) {
  if (!Number.isFinite(cutsPer10s)) return null;
  if (cutsPer10s >= 6) return 'fast cuts';
  if (cutsPer10s >= 2) return 'steady cuts';
  return 'few cuts';
}

/** The style line of a breakdown: the researcher's own words, else one made from what was measured (pacing, presenter, sound). */
export function styleOf(breakdown) {
  if (breakdown?.style) return breakdown.style;
  const parts = [
    pacingWords(breakdown?.cutsPer10s) ? `${pacingWords(breakdown.cutsPer10s)} (about ${breakdown.cutsPer10s} per 10 seconds)` : null,
    breakdown?.presenter === true ? 'a presenter on camera' : breakdown?.presenter === false ? 'no presenter' : null,
    breakdown?.sound && breakdown.sound !== 'none' ? breakdown.sound : breakdown?.sound === 'none' ? 'no sound' : null,
  ].filter(Boolean);
  return parts.length >= 2 ? parts.join(', ') : null;
}

// ---------------------------------------------------------------- the top posts in the draft
/**
 * Check a draft's `topPosts`: the best posts social_outliers_find (or social_profile_get) showed on the brand's own accounts
 * and on its competitors'. Each is { source: 'brand' | 'competitor', competitor?, platform, url, text, views, likes?, date, caption?, breakdown? }.
 * `text` is the post's opening words exactly as its caption has them. A post the run took apart (at most 3 of the brand's own and 2 of
 * its competitors') carries a `breakdown` (see breakdownOf); its `text` is then the spoken hook when it has one, else the on-screen
 * hook, and the caption becomes `caption`, so whichever way the draft gives them the checked post has the hook as its text and the
 * caption as its note. A post without a caption, views or date is left out of the
 * draft by the researcher, never filled in or rounded. Instagram shows no view counts to a signed-out reader, so an Instagram post
 * may carry `likes` instead of `views`; a post that has both keeps both, with views as the headline. Every other platform needs views.
 * A checked post always has both keys: `views` and `likes` are a whole number or null.
 * @returns {{ value: object[], problems: {field: string, problem: string}[] }}
 */
export function topPostsProblems(input, { competitors = [], now = new Date() } = {}) {
  const problems = [];
  if (input === undefined || input === null) return { value: [], problems };
  if (!Array.isArray(input)) return { value: [], problems: [{ field: 'topPosts', problem: 'topPosts must be a list.' }] };
  if (input.length > MAX_TOP_POSTS) problems.push({ field: 'topPosts', problem: `topPosts holds at most ${MAX_TOP_POSTS} posts (has ${input.length}).` });
  const known = new Map(competitors.map((name) => [String(name).toLowerCase(), String(name)]));
  const value = [];
  const own = {};
  const theirs = {};
  let breakdowns = 0;
  let ownBreakdowns = 0;
  let competitorBreakdowns = 0;
  input.slice(0, MAX_TOP_POSTS).forEach((item, index) => {
    const field = `topPosts[${index}]`;
    const fail = (key, problem) => problems.push({ field: `${field}.${key}`, problem });
    if (!isObject(item)) { problems.push({ field, problem: 'Each post must be an object.' }); return; }
    for (const key of Object.keys(item)) {
      if (!POST_FIELDS.includes(key)) fail(key, `"${key}" is not a post field. Use source, competitor, platform, url, text, views (likes instead of views for Instagram), date, and caption and breakdown for a video that was taken apart.`);
    }
    const source = item.source;
    if (source !== 'brand' && source !== 'competitor') fail('source', 'source must be brand (one of the brand\'s own posts) or competitor.');
    const platform = typeof item.platform === 'string' ? item.platform.trim().toLowerCase() : '';
    if (!TOP_POST_PLATFORMS.includes(platform)) fail('platform', `platform must be one of ${TOP_POST_PLATFORMS.join(', ')}.`);
    const url = runtime.webLink(item.url);
    if (!url) fail('url', 'url must be the https link of the post.');
    else if (TOP_POST_PLATFORMS.includes(platform) && !hostMatches(url, platform)) fail('url', `url must be a link on ${platform}.`);
    let text = plain(item.text);
    if (!text) fail('text', 'text is empty. Use the post\'s opening words exactly as its caption has them, or leave the post out.');
    else if (text.length > POST_TEXT_MAX) fail('text', `text must be at most ${POST_TEXT_MAX} characters (has ${text.length}).`);
    let caption = '';
    if (item.caption !== undefined && item.caption !== null && item.caption !== '') {
      if (typeof item.caption !== 'string') fail('caption', 'caption must be text: the post\'s caption.');
      else if (plain(item.caption).length > POST_TEXT_MAX) fail('caption', `caption must be at most ${POST_TEXT_MAX} characters.`);
      else caption = plain(item.caption);
    }
    let breakdown = null;
    if (item.breakdown !== undefined && item.breakdown !== null) {
      breakdown = breakdownOf(item.breakdown, field, fail);
      if (breakdown) {
        const hook = breakdown.spokenHook || breakdown.onScreenHook || '';
        // The hook that was said (else shown) is the item's text; the caption it replaces is kept as a note.
        if (hook && text && !sameWords(text, hook)) { if (!caption) caption = text; text = hook; }
        else if (hook && !text) text = hook;
        breakdowns += 1;
        if (item.source === 'brand') ownBreakdowns += 1;
        if (item.source === 'competitor') competitorBreakdowns += 1;
      }
    }
    const count = (raw) => (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null);
    const views = count(item.views);
    const likes = count(item.likes);
    const given = (raw) => raw !== undefined && raw !== null;
    if (given(item.likes) && likes === null) fail('likes', 'likes must be the number shown on the post, or left out.');
    else if (views === null && (given(item.views) || !(platform === 'instagram' && likes !== null))) {
      fail('views', platform === 'instagram'
        ? 'views must be the number shown on the post. Instagram shows no views to a signed-out reader, so an Instagram post carries its likes instead: give likes, the number shown on the post. A post with neither readable is left out.'
        : 'views must be the number shown on the post. A post with no readable views is left out. Only an Instagram post may carry likes instead of views, because Instagram shows no views to a signed-out reader.');
    }
    const date = typeof item.date === 'string' ? item.date.trim() : '';
    if (!PLAIN_DATE.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) fail('date', 'date must be the day the post was published, as YYYY-MM-DD. A post with no readable date is left out.');
    else if (Date.parse(`${date}T00:00:00Z`) > now.getTime() + DAY_MS) fail('date', 'date is in the future.');
    let competitor = null;
    if (source === 'competitor') {
      competitor = known.get(String(item.competitor ?? '').trim().toLowerCase()) ?? null;
      if (!competitor) fail('competitor', 'competitor must be the name of one of this brand\'s competitors.');
    } else if (item.competitor !== undefined && item.competitor !== null && item.competitor !== '') {
      fail('competitor', 'competitor is only for a competitor\'s post.');
    }
    if (source === 'brand' && TOP_POST_PLATFORMS.includes(platform)) {
      own[platform] = (own[platform] ?? 0) + 1;
      if (own[platform] === OWN_PER_PLATFORM + 1) problems.push({ field: 'topPosts', problem: `Keep at most ${OWN_PER_PLATFORM} posts per own account (${platform} has more).` });
    }
    if (source === 'competitor' && competitor) {
      theirs[competitor] = (theirs[competitor] ?? 0) + 1;
      if (theirs[competitor] === PER_COMPETITOR + 1) problems.push({ field: 'topPosts', problem: `Keep at most ${PER_COMPETITOR} posts per competitor (${competitor} has more).` });
    }
    value.push({ source, competitor, platform, url, text, ...(caption && caption !== text ? { caption } : {}), views, likes, date, ...(breakdown ? { breakdown } : {}) });
  });
  if (ownBreakdowns > MAX_OWN_BREAKDOWNS) problems.push({ field: 'topPosts', problem: `Take apart at most ${MAX_OWN_BREAKDOWNS} of the brand's own videos (${ownBreakdowns} have a breakdown).` });
  if (competitorBreakdowns > MAX_COMPETITOR_BREAKDOWNS) problems.push({ field: 'topPosts', problem: `Take apart at most ${MAX_COMPETITOR_BREAKDOWNS} competitor videos in all (${competitorBreakdowns} have a breakdown).` });
  return { value, problems };
}

/** How many of the checked posts carry a breakdown, and how many of them are the brand's own. */
export function breakdownCounts(posts) {
  const list = (Array.isArray(posts) ? posts : []).filter((post) => post && post.breakdown);
  return { total: list.length, own: list.filter((post) => post.source === 'brand').length, competitor: list.filter((post) => post.source === 'competitor').length };
}

/** The evidence a post leaves in the proven bank: {url, likes, date} for a post with likes and no views (Instagram), {url, views, date} otherwise. */
function evidenceOfPost(post) {
  const likesOnly = !Number.isFinite(post.views) && Number.isFinite(post.likes);
  return likesOnly ? { url: post.url, likes: post.likes, date: post.date } : { url: post.url, views: post.views, date: post.date };
}

/**
 * The lines a post gives the bank besides its main hook, as { kind, text, note? }: the on-screen hook when it differs from the spoken
 * one (a second hook, noted as shown on screen), the format, the style and the call to action of a video that was taken apart.
 */
export function breakdownLines(post) {
  const breakdown = post?.breakdown;
  if (!breakdown) return [];
  const lines = [];
  if (breakdown.spokenHook && breakdown.onScreenHook && !sameWords(breakdown.spokenHook, breakdown.onScreenHook)) lines.push({ kind: 'hook', text: breakdown.onScreenHook, note: 'The text shown on screen at the start of the video.' });
  if (breakdown.format) lines.push({ kind: 'format', text: breakdown.format });
  const style = styleOf(breakdown);
  if (style) lines.push({ kind: 'style', text: style });
  if (breakdown.cta) lines.push({ kind: 'cta', text: breakdown.cta });
  return lines;
}

/**
 * Save the posts as proven hooks, once each. A post whose words are already in the bank is not added again, so a second save of
 * the same run, or a second run that finds the same post, changes nothing. A post that was taken apart also gives its on-screen hook,
 * format, style and call to action as proven items with the same link as their evidence (`breakdowns` counts those), and a hook
 * that is not the caption keeps the caption as its note.
 * @returns {{ saved: number, existing: number, skipped: number, breakdowns?: { videos: number, saved: number, existing: number } }} breakdowns is there only when a post was taken apart
 */
export function fileTopPosts({ root, brand, posts, now }) {
  let saved = 0;
  let existing = 0;
  let skipped = 0;
  const breakdowns = { videos: 0, saved: 0, existing: 0 };
  for (const post of Array.isArray(posts) ? posts : []) {
    const common = { root, brand, bank: 'proven', evidence: evidenceOfPost(post), source: post.source, competitor: post.source === 'competitor' ? post.competitor : null, now };
    try {
      const out = addToBank({ ...common, kind: 'hook', text: post.text, note: post.caption ? `The post's caption: ${post.caption}` : null });
      if (out.saved) saved += 1; else existing += 1;
    } catch { skipped += 1; continue; }
    if (!post.breakdown) continue;
    breakdowns.videos += 1;
    for (const line of breakdownLines(post)) {
      try {
        const out = addToBank({ ...common, kind: line.kind, text: line.text, note: line.note ?? null });
        if (out.saved) breakdowns.saved += 1; else breakdowns.existing += 1;
      } catch { skipped += 1; }
    }
  }
  return { saved, existing, skipped, ...(breakdowns.videos ? { breakdowns } : {}) };
}

// ---------------------------------------------------------------- the research files
const day = (value) => String(value ?? '').slice(0, 10);
const FINDING_TITLES = Object.freeze([
  ['summary', 'Summary'], ['voice', 'How the brand sounds'], ['uniqueMechanism', 'What makes it different'],
  ['alternativeSolution', 'What customers used before'], ['heroProduct', 'Hero products'], ['constraints', 'Claims and creative limits'],
  ['strategy', 'Strategic context'], ['postAudit', 'What recent posts show'], ['competitorRationale', 'Why these competitors'],
]);

function findingText(value) {
  if (typeof value === 'string') return plain(value);
  if (Array.isArray(value)) return value.map(plain).filter(Boolean).join('\n');
  return '';
}

function post(item) {
  const head = `- ${item.platform}: "${clip(item.text, 200)}" - ${[countText(item), item.date, item.url].filter(Boolean).join(', ')}`;
  const more = [];
  if (item.caption) more.push(`  Caption: "${clip(item.caption, 200)}"`);
  const video = item.breakdown ? videoFacts(item.breakdown) : '';
  if (video) more.push(`  Taken apart: ${video}`);
  return [head, ...more].join('\n');
}

/** What a breakdown found, in one line: format, pacing, presenter, sound, call to action and the shots. */
export function videoFacts(breakdown) {
  const parts = [
    breakdown.format,
    Number.isFinite(breakdown.cutsPer10s) ? `${breakdown.cutsPer10s} cuts per 10 seconds` : null,
    breakdown.presenter === true ? 'presenter on camera' : breakdown.presenter === false ? 'no presenter' : null,
    breakdown.sound ? (breakdown.sound === 'none' ? 'no music or voice-over' : breakdown.sound) : null,
    Array.isArray(breakdown.shotTypes) && breakdown.shotTypes.length ? `shots: ${breakdown.shotTypes.join(', ')}` : null,
    breakdown.onScreenHook ? `on screen: "${clip(breakdown.onScreenHook, 120)}"` : null,
    breakdown.cta ? `call to action: "${clip(breakdown.cta, 120)}"` : null,
  ].filter(Boolean);
  return parts.join('; ');
}

function sourceLine(source, base) {
  const capture = source.captureRef ? `, capture ${base}/${source.captureRef}` : '';
  return `- ${source.url} (${source.kind || 'source'}, read ${day(source.observedAt)}${capture})`;
}

function evidenceLine(row) {
  const excerpt = row.supportingExcerpt ? ` Excerpt: "${clip(row.supportingExcerpt, 240)}"` : '';
  return `- ${clip(row.question, 160)}: ${clip(row.finding, 400)} (${row.source || 'no source'}, ${day(row.observedAt)}, ${row.semantics || 'unlabelled'}).${excerpt}`;
}

function gapLine(gap) {
  if (!isObject(gap)) return null;
  const question = clip(gap.question, 200);
  const reason = clip(gap.reason, 300);
  return question ? `- ${question}${reason && reason !== question ? `: ${reason}` : ''}` : null;
}

/** The two files as { brand, competitors } text; competitors is null when the run found nothing on a competitor. */
export function researchMarkdown({ name, runId, date, record, profile, posts, base }) {
  const sources = Array.isArray(record.sources) ? record.sources : [];
  const kindByUrl = new Map(sources.map((source) => [evidence.normUrl(source.url), source.kind || '']));
  const isCompetitorRow = (row) => String(kindByUrl.get(evidence.normUrl(row.source)) || '').startsWith('competitor');
  const rows = Array.isArray(record.evidenceMatrix) ? record.evidenceMatrix : [];
  const details = Array.isArray(record.competitorDetails) ? record.competitorDetails : [];
  const gaps = (Array.isArray(record.gaps) ? record.gaps : []).map(gapLine).filter(Boolean);
  const until = new Date(Date.parse(`${date}T00:00:00Z`) + 30 * DAY_MS).toISOString().slice(0, 10);
  const head = (title) => [`# ${title}: ${name}`, '', `Brand onboarding research, read ${date} (run ${runId}). Reuse it until ${until}; after that, read the pages again.`, ''];

  const own = [];
  own.push(...head('Brand research'));
  const findings = record.findings && typeof record.findings === 'object' ? record.findings : {};
  for (const [key, title] of FINDING_TITLES) {
    if (key === 'competitorRationale') continue;
    const text = findingText(findings[key]);
    if (text) own.push(`## ${title}`, '', text.slice(0, 1500), '');
  }
  if (profile && plain(profile.audience)) own.push('## Audience', '', plain(profile.audience), '');
  if (profile && plain(profile.market)) own.push('## Positioning', '', plain(profile.market), '');
  const ownRows = rows.filter((row) => !isCompetitorRow(row));
  if (ownRows.length) own.push('## What the pages show', '', ...ownRows.slice(0, 20).map(evidenceLine), '');
  const ownPosts = posts.filter((item) => item.source === 'brand');
  if (ownPosts.length) own.push('## The brand\'s best posts', '', ...ownPosts.map(post), '');
  const ownSources = sources.filter((source) => !String(source.kind || '').startsWith('competitor'));
  if (ownSources.length) own.push('## Sources', '', ...ownSources.map((source) => sourceLine(source, base)), '');
  const ownGaps = gaps.filter((line) => !details.some((detail) => line.toLowerCase().includes(String(detail.name).toLowerCase())));
  if (ownGaps.length) own.push('## Not found', '', ...ownGaps, '');

  const rivals = [];
  const competitorPosts = posts.filter((item) => item.source === 'competitor');
  if (details.length || competitorPosts.length) {
    rivals.push(...head('Competitors'));
    const text = findingText(findings.competitorRationale);
    if (text) rivals.push(text.slice(0, 1500), '');
    for (const detail of details) {
      rivals.push(`## ${detail.name}`, '');
      if (detail.rationale) rivals.push(`Why a competitor: ${plain(detail.rationale)}`, '');
      const handles = Object.entries(detail.handles ?? {}).map(([platform, handle]) => `${platform} ${handle}`);
      if (handles.length || detail.website) rivals.push(`Accounts: ${[...handles, detail.website].filter(Boolean).join(', ')}`, '');
      const evidenceUrls = new Set((detail.evidence ?? []).map((item) => evidence.normUrl(item.url)));
      const theirRows = rows.filter((row) => evidenceUrls.has(evidence.normUrl(row.source)));
      if (theirRows.length) rivals.push(...theirRows.map(evidenceLine), '');
      else if ((detail.evidence ?? []).length) rivals.push(...detail.evidence.map((item) => `- ${item.url} (read ${day(item.observedAt)})`), '');
      const theirPosts = competitorPosts.filter((item) => String(item.competitor).toLowerCase() === String(detail.name).toLowerCase());
      if (theirPosts.length) rivals.push('Best posts:', ...theirPosts.map(post), '');
      const mine = gaps.filter((line) => line.toLowerCase().includes(String(detail.name).toLowerCase()));
      if (mine.length) rivals.push('Not found:', ...mine, '');
    }
    const shown = new Set(details.map((detail) => String(detail.name).toLowerCase()));
    const stray = competitorPosts.filter((item) => !shown.has(String(item.competitor).toLowerCase()));
    if (stray.length) rivals.push('## Other competitor posts', '', ...stray.map((item) => `- ${item.competitor}: ${post(item).slice(2)}`), '');
    const rivalSources = sources.filter((source) => String(source.kind || '').startsWith('competitor'));
    if (rivalSources.length) rivals.push('## Sources', '', ...rivalSources.map((source) => sourceLine(source, base)), '');
  }
  const body = (lines) => `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  return { brand: body(own), competitors: rivals.length ? body(rivals) : null };
}

/**
 * Write the two research files and the library entry for a saved run. Idempotent: the same run again rewrites the same files
 * and the same entry. `record` is the saved research record (lib-brand-research.read), `posts` the validated top posts.
 * @returns {{ jobId: string, entry: string, files: {path: string, topic: string}[] }}
 */
export function fileOnboardingResearch({ root, brand, brandDir, name: brandName, runId, record, profile, posts = [], now = new Date() }) {
  const at = now.toISOString();
  const date = at.slice(0, 10);
  const name = plain(brandName) || brand;
  const relativeRun = posix.join('workspaces', brand, 'onboarding', runId);
  const text = researchMarkdown({ name, runId, date, record, profile, posts, base: relativeRun });
  const written = [];
  for (const [topic, content] of [['brand', text.brand], ['competitors', text.competitors]]) {
    if (!content) continue;
    const relative = posix.join(relativeRun, 'research', `${topic}.md`);
    durable.atomicWrite(join(brandDir, 'onboarding', runId, 'research', `${topic}.md`), content);
    written.push({ path: relative, sha256: createHash('sha256').update(content).digest('hex'), topic, at });
  }
  const industry = typeof profile?.industry === 'string' && profile.industry.trim() ? clip(profile.industry, 80) : null;
  const jobId = `onboarding-${runId}`;
  const entry = { jobId, at, files: written, ...(industry ? { industry } : {}) };
  const file = join(brandLibraryDir(root, brand), 'research', `${jobId}.json`);
  let current = null;
  try { current = JSON.parse(readFileSync(file, 'utf8')); } catch { current = null; }
  const same = current && JSON.stringify(current.files?.map((item) => [item.path, item.sha256, item.topic])) === JSON.stringify(written.map((item) => [item.path, item.sha256, item.topic]));
  if (!same) durable.atomicWrite(file, `${JSON.stringify(entry, null, 2)}\n`);
  return { jobId, entry: posix.join('workspaces', brand, 'library', 'research', `${jobId}.json`), files: written.map(({ path, topic }) => ({ path, topic })) };
}
