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

// ---------------------------------------------------------------- the top posts in the draft
/**
 * Check a draft's `topPosts`: the best posts social_outliers_find (or social_profile_get) showed on the brand's own accounts
 * and on its competitors'. Each is { source: 'brand' | 'competitor', competitor?, platform, url, text, views, likes?, date }.
 * `text` is the post's opening words exactly as its caption has them. A post without a caption, views or date is left out of the
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
  input.slice(0, MAX_TOP_POSTS).forEach((item, index) => {
    const field = `topPosts[${index}]`;
    const fail = (key, problem) => problems.push({ field: `${field}.${key}`, problem });
    if (!isObject(item)) { problems.push({ field, problem: 'Each post must be an object.' }); return; }
    for (const key of Object.keys(item)) {
      if (!['source', 'competitor', 'platform', 'url', 'text', 'views', 'likes', 'date'].includes(key)) fail(key, `"${key}" is not a post field. Use source, competitor, platform, url, text, views (likes instead of views for Instagram), date.`);
    }
    const source = item.source;
    if (source !== 'brand' && source !== 'competitor') fail('source', 'source must be brand (one of the brand\'s own posts) or competitor.');
    const platform = typeof item.platform === 'string' ? item.platform.trim().toLowerCase() : '';
    if (!TOP_POST_PLATFORMS.includes(platform)) fail('platform', `platform must be one of ${TOP_POST_PLATFORMS.join(', ')}.`);
    const url = runtime.webLink(item.url);
    if (!url) fail('url', 'url must be the https link of the post.');
    else if (TOP_POST_PLATFORMS.includes(platform) && !hostMatches(url, platform)) fail('url', `url must be a link on ${platform}.`);
    const text = plain(item.text);
    if (!text) fail('text', 'text is empty. Use the post\'s opening words exactly as its caption has them, or leave the post out.');
    else if (text.length > POST_TEXT_MAX) fail('text', `text must be at most ${POST_TEXT_MAX} characters (has ${text.length}).`);
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
    value.push({ source, competitor, platform, url, text, views, likes, date });
  });
  return { value, problems };
}

/** The evidence a post leaves in the proven bank: {url, likes, date} for a post with likes and no views (Instagram), {url, views, date} otherwise. */
function evidenceOfPost(post) {
  const likesOnly = !Number.isFinite(post.views) && Number.isFinite(post.likes);
  return likesOnly ? { url: post.url, likes: post.likes, date: post.date } : { url: post.url, views: post.views, date: post.date };
}

/**
 * Save the posts as proven hooks, once each. A post whose words are already in the bank is not added again, so a second save of
 * the same run, or a second run that finds the same post, changes nothing.
 * @returns {{ saved: number, existing: number, skipped: number }}
 */
export function fileTopPosts({ root, brand, posts, now }) {
  let saved = 0;
  let existing = 0;
  let skipped = 0;
  for (const post of Array.isArray(posts) ? posts : []) {
    try {
      const out = addToBank({
        root, brand, bank: 'proven', kind: 'hook', text: post.text,
        evidence: evidenceOfPost(post),
        source: post.source, competitor: post.source === 'competitor' ? post.competitor : null, now,
      });
      if (out.saved) saved += 1; else existing += 1;
    } catch { skipped += 1; }
  }
  return { saved, existing, skipped };
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
  return `- ${item.platform}: "${clip(item.text, 200)}" - ${[countText(item), item.date, item.url].filter(Boolean).join(', ')}`;
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
