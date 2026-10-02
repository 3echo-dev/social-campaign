/**
 * The per-job board document: the readable content of a job's current review,
 * research, strategy and outputs, kept out of the workspace projection so that
 * projection stays small.
 *
 * One document per job, stored in the artifact database as jobDocs/<jobId> and
 * written by board-sync from the JSON file artifact.mjs saves beside the
 * projection. Every document stays under the artifact database's 200 KiB
 * per-document budget: text is trimmed per file with a truncated flag, images
 * are small thumbnails, a video is only a poster frame and its duration (never
 * its bytes), and anything that still does not fit is listed without its
 * content (omitted).
 *
 * Paths in the document are job-relative. The workspace root never appears,
 * not even inside file text, where it is redacted.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACT_FILES, PROVIDERS, canonicalDeliverable, canonicalItem, canonicalJobKey, parseJobKey, quoteTotals, readEstimates, readLanded, readRecords } from './facts.mjs';
import { labelCheckStatus, readLabelCheck } from './label-qc.mjs';
import { FIELDS as RECIPE_FIELDS, readJobRecipes } from './recipe.mjs';
import { HANDOFF_ONLY_TEXT, localDateTime, postTypeChoices, projectPublish, validZone, whenText } from './publish-preflight.mjs';
import { attemptState, projectPublishStatus, readAttempts } from './publish-attempts.mjs';
import { APP_ORIGIN, hostedAssetBySha, readApprovedIntent } from './media-host.mjs';
import { agentBox, coreOnlyAgentBox } from './agent-box.mjs';

const require = createRequire(import.meta.url);
const recipeRules = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts', 'lib-recipe.js'));
const deliverableRules = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts', 'lib-deliverable.js'));
const handoffRules = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts', 'lib-handoff-validation.js'));
const frontmatter = require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts', 'lib-frontmatter.js'));
const PLATFORM_RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'platform-rules');

export const JOB_DOCUMENT_COLLECTION = 'jobDocs';
export const JOB_DOCUMENT_BUDGET_BYTES = 204800; // 200 KiB, the artifact database per-document budget
export const JOB_DOCUMENT_TEXT_LIMIT = 20000; // characters kept per text file
export const JOB_DOCUMENT_RESEARCH_TEXT_LIMIT = 12000;
export const JOB_DOCUMENT_THUMB_BYTES = 48 * 1024; // the largest image inlined as a data URL
const REVIEW_THUMB_BUDGET_BYTES = 96 * 1024; // all review thumbnails and posters together
export const JOB_DOCUMENT_FILE_LIST_BYTES = 64 * 1024;
const THUMB_EDGE = 320;
const FIELD_LIMIT = 1500;
const TEXT_FILE_MAX_BYTES = 512 * 1024;
const MAX_THUMBS = 24;
const MAX_CONCEPTS = 8;
const MAX_PANELS = 60;
const MAX_BOARDS = 12;
const MAX_POSTS = 12;
// A post holds one video or up to 35 pictures (supplied-media.mjs MAX_FILES); the card and the kit show every one.
const MAX_POST_FILES = 35;
const MAX_QUOTE_ROWS = 80;
const MAX_STILLS = 40;
const MAX_REVIEW_URLS = 200;
const SCALE_ABOVE_CHARS = 4096;
const PUBLISH_INTENT_PATH = 'publish/intent.json';
const PUBLISH_HOSTED_PATH = 'publish/hosted-media.json';
const HANDOFF_ONLY_NOTE = HANDOFF_ONLY_TEXT;
const REPORT_PATH = 'report/report.md';
const STILLS_PREFIX = 'report/stills/';
const REPORT_TRIMMED_TEXT = 4000;

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv']);
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const VIDEO_TYPES = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
const MEDIA_TYPES = { ...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES };
const RESEARCH_ORDER = ['audience', 'competitors', 'product-evidence', 'video-analysis', 'watch-report'];

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const byteSize = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const mediaKind = path => {
  const ext = extname(path).toLowerCase();
  return IMAGE_TYPES[ext] ? 'image' : VIDEO_TYPES[ext] ? 'video' : AUDIO_TYPES[ext] ? 'audio' : null;
};

const RECIPE_FIELD_LABELS = Object.freeze({ pillar: 'Content pillar', angle: 'Angle', hookFamily: 'Hook', cta: 'Call to action', hashtags: 'Hashtags' });
const RESEARCH_FILE_LABELS = Object.freeze({
  audience: 'Audience research',
  competitors: 'Competitor research',
  customer: 'Customer comments',
  'product-evidence': 'Product evidence',
  'video-analysis': 'Video analysis',
  'watch-report': 'Watch report',
  'source-watch': 'Source watch',
});
const BRAND_FILE_LABELS = Object.freeze({ research: 'Brand research', profile: 'Brand profile', 'brand-voice': 'Brand voice' });
const EVIDENCE_SITE_NAMES = Object.freeze({
  'instagram.com': 'Instagram', 'tiktok.com': 'TikTok', 'facebook.com': 'Facebook', 'youtube.com': 'YouTube',
  'x.com': 'X', 'twitter.com': 'X', 'linkedin.com': 'LinkedIn', 'threads.net': 'Threads', 'reddit.com': 'Reddit',
});
const CTA_LABEL_OVERRIDES = Object.freeze({ dm: 'Send a DM', none: 'No call to action' });

function humanizeCode(value) {
  const words = String(value || '').replace(/^H-/, '').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words ? words.replace(/\b\w/g, letter => letter.toUpperCase()) : '';
}

function evidenceFileLabel(path) {
  const segments = String(path || '').split('/').filter(Boolean);
  const folder = segments[0] || '';
  const base = (segments[segments.length - 1] || '').replace(/\.[a-z0-9]+$/i, '');
  if (folder === 'research') return RESEARCH_FILE_LABELS[base.toLowerCase()] || humanizeCode(base) || 'Research notes';
  if (folder === 'brand') return BRAND_FILE_LABELS[base.toLowerCase()] || `Brand ${humanizeCode(base).toLowerCase()}`.trim();
  return humanizeCode(base) || 'Reference';
}

function evidenceLinkLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./i, '').toLowerCase();
    if (EVIDENCE_SITE_NAMES[host]) return EVIDENCE_SITE_NAMES[host];
    const root = host.split('.').slice(-2, -1)[0] || host;
    return root ? root[0].toUpperCase() + root.slice(1) : 'Link';
  } catch { return 'Link'; }
}

function evidenceLabel(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.kind === 'link' && typeof item.url === 'string') return evidenceLinkLabel(item.url);
  if (item.kind === 'file' && typeof item.path === 'string') return evidenceFileLabel(item.path);
  return null;
}

function plainOption(option) {
  return {
    id: option.id,
    label: clip(option.label, 80),
    reason: clip(option.reason, 240),
    evidence: (option.evidence || []).map(evidenceLabel).filter(Boolean).slice(0, 5),
  };
}

function chosenSummary(field, payload) {
  if (!payload) return null;
  if (field === 'hashtags') {
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    return { source: payload.source, value: tags.length ? tags.join(' ') : 'No hashtags' };
  }
  const value = typeof payload.label === 'string' ? payload.label.trim() : '';
  return { source: payload.source, value: value || null };
}

function recipeCatalog() {
  const families = [...recipeRules.hookFamilies().entries()].map(([code, mechanisms]) => ({
    code,
    label: humanizeCode(code),
    mechanisms: mechanisms.map(mechanism => ({ code: mechanism, label: humanizeCode(mechanism) })),
  }));
  const ctaStyles = (recipeRules.CTA_STYLES || []).map(code => ({ code, label: CTA_LABEL_OVERRIDES[code] || humanizeCode(code) }));
  return { hookFamilies: families, ctaStyles };
}
const RECIPE_CATALOG = recipeCatalog();

/**
 * Where each Metricool post of the job stands (scheduled, posted with its link, failed with the reason, late, waiting
 * in the app, check in Metricool), projected from publish/metricool.jsonl against the posting plan. A post the person marked
 * as posted themselves reads 'marked', with the link they gave. Null when the job has no Metricool plan or nothing was
 * sent yet; never throws.
 */
export function publishStatusSection(dir, now) {
  try {
    const intent = JSON.parse(readFileSync(join(dir, 'publish', 'intent.json'), 'utf8'));
    const status = projectPublishStatus({ jobDir: dir, intent, now });
    if (!status) return null;
    const marks = handoffRules.readPersonPosts(dir);
    return {
      ...status,
      posts: status.posts.map(post => {
        const mark = marks[post.id];
        if (!mark) return post;
        return { ...post, status: 'marked', publicUrl: mark.link || null, plannerUrl: post.plannerUrl, reason: null, checkAfter: null, lid: null };
      }),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The posting kit ("I'll post it myself")
// ---------------------------------------------------------------------------

const KIT_CHECKLIST_MAX = 5;
const KIT_APP_URL = /^https:\/\/agentc\.3echo\.ai\/assets\/([A-Za-z0-9_-]{1,128})\?workspaceId=([A-Za-z0-9_-]{1,128})$/;
const KIT_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
// Lines of a platform's manual posting checklist that the kit says another way: the caption already holds the hashtags,
// the AI label has its own line, and a person posting one post does not need the account, partnership or analytics steps.
const KIT_SKIP = /^confirm\b|paid partnership|branded content|ai-generated|ai info|ai disclosure|insights|analytics|hashtags|^(?:share|post|publish)\b/i;
// What a person starts on the platform for each post type: Reel and Story are the products' own names.
const KIT_NEW = Object.freeze({ post: 'post', reel: 'Reel', story: 'Story', carousel: 'carousel post', video: 'video', photo: 'photo post' });

const platformChecklists = new Map();
function rulesChecklist(platform) {
  if (!/^[a-z]{2,20}$/.test(String(platform))) return [];
  if (!platformChecklists.has(platform)) {
    let lines = [];
    try {
      const rules = frontmatter.jsonBlock(join(PLATFORM_RULES_DIR, `${platform}.md`));
      if (Array.isArray(rules?.manual_posting_checklist)) lines = rules.manual_posting_checklist.filter(item => typeof item === 'string');
    } catch { lines = []; }
    platformChecklists.set(platform, lines);
  }
  return platformChecklists.get(platform);
}

function kitLine(line, placement) {
  const noun = KIT_NEW[placement] || 'post';
  return line
    .replace(/\s+(?:from|named in|in) the hand-off package/gi, '')
    .replace('start a new post, reel, or story matching the media kind', `start a new ${noun}`)
    .replace('upload the exact video or photo-carousel files', placement === 'photo' ? 'upload the exact photos' : 'upload the exact video')
    .replace(/the exact (?:image, carousel, or video|image, video, or multi-photo) files/, 'the exact files')
    .split(/;|, then /)[0]
    .replace(/\.$/, '')
    .trim();
}

/**
 * The short list a person follows to post one post by hand, from that platform's manual posting checklist in
 * pipeline/platform-rules: the steps that apply to one post of this type, in plain words, and a last line that
 * hands over to Mark as posted. At most five lines.
 */
export function kitChecklist(platform, placement) {
  const lines = rulesChecklist(platform).filter(line => !KIT_SKIP.test(line)).map(line => kitLine(line, placement)).filter(Boolean);
  const kept = lines.slice(0, KIT_CHECKLIST_MAX - 1).map(line => `${line}.`);
  return [...kept, 'Post it, then press Mark as posted below.'];
}

// "Thu 1 Oct, 6:30 pm, Singapore time": when the person said they posted it, in the plan's own zone, or '' when the plan has none.
function markedText(at, zone) {
  const instant = Date.parse(at);
  if (!Number.isFinite(instant) || !validZone(zone)) return '';
  return whenText({ dateTime: localDateTime(instant, zone), timezone: zone }) || '';
}

// The 3echo page for a file that is in the plan's own workspace, or null. The link is the one saved when the file was
// hosted, or built from the asset and workspace of a file made there, and only ever the 3echo app address.
function kitAppUrl(dir, item, planWorkspace) {
  if (!planWorkspace || typeof item?.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(item.sha256)) return null;
  const found = hostedAssetBySha(dir, item.sha256.toLowerCase(), planWorkspace);
  if (!found || !KIT_TOKEN.test(String(found.assetId || ''))) return null;
  const link = typeof found.appUrl === 'string' && found.appUrl ? found.appUrl : found.workspaceId === planWorkspace ? `${APP_ORIGIN}/assets/${found.assetId}?workspaceId=${planWorkspace}` : null;
  const hit = link ? KIT_APP_URL.exec(link) : null;
  return hit && hit[1] === found.assetId && hit[2] === planWorkspace ? link : null;
}

// What the person has to do about the AI label when they post by hand.
const kitAiLabel = post => (post.aiGenerated ? (post.platform === 'tiktok' ? 'Turn on the AI-generated label when you post' : 'Mark it as made with AI when you post') : null);

/**
 * The posting kit: the posts the person posts themselves, from the approved posting plan (readApprovedIntent: the latest
 * publish approval must cover the plan as it is on disk). For an "I'll post it myself" plan that is every post. For a Metricool
 * plan it is only the posts Claude handed over (it could not send them), plus any the person already marked: never a refusal
 * Claude is still fixing, and never a post it may still send. Each entry has the type, time with its zone, account, caption with hashtags, first comment,
 * the checklist and the AI-label line, the 3echo page of each file when it is hosted, and whether it was marked posted.
 * `previewOf(item)` (optional) gives the preview of a plan file the board draws beside its Download link (a media reference the
 * way the review's posts carry them: thumbnail or player), or null; the kit shows no preview when it is not given.
 * `settled` is true when every post of the plan is either sent through Metricool or marked, which is when the job closes, and
 * `closed` when it has (`state` is COMPLETE). Null for any other job, and when the approval no longer covers the plan; never throws.
 */
export function postingKitSection(dir, publish, now, state = null, previewOf = null) {
  try {
    const approved = readApprovedIntent(dir);
    if (!approved.ok || !Array.isArray(approved.document?.posts) || !approved.document.posts.length) return null;
    const intent = approved.document;
    const marks = handoffRules.readPersonPosts(dir);
    const entries = readAttempts(dir);
    const settled = intent.posts.every(post => marks[post.id] || attemptState(entries, post.id).sent);
    let list = intent.posts;
    if (intent.route !== 'self') {
      if (!String(intent.route).startsWith('metricool_')) return null;
      list = intent.posts.filter(post => marks[post.id] || (attemptState(entries, post.id).handedOver && !attemptState(entries, post.id).sent));
    }
    if (!list.length) return null;
    const projected = projectPublish(intent, { ...(publish || {}), now });
    const planWorkspace = typeof intent.studioWorkspace?.id === 'string' ? intent.studioWorkspace.id : null;
    const posts = list.slice(0, MAX_POSTS).map(post => {
      const row = projected?.posts?.[intent.posts.indexOf(post)] || {};
      const mark = marks[post.id] || null;
      const zone = post.publicationDate?.timezone;
      return {
        id: post.id,
        label: row.label || deliverableRules.placementWords(post.platform, post.placement) || 'Post',
        when: row.when?.text || '',
        account: row.account || null,
        text: typeof post.text === 'string' ? post.text : '',
        firstComment: typeof post.firstComment === 'string' ? post.firstComment : '',
        aiLabel: kitAiLabel(post),
        checklist: kitChecklist(post.platform, post.placement),
        media: (Array.isArray(post.media) ? post.media : []).slice(0, MAX_POST_FILES).map(item => {
          let preview = null;
          try { preview = typeof previewOf === 'function' ? previewOf(item) : null; } catch { preview = null; }
          return {
            name: basename(String(item?.path || '')),
            kind: item?.kind || null,
            appUrl: kitAppUrl(dir, item, planWorkspace),
            ...(preview && typeof preview === 'object' ? { preview } : {}),
          };
        }),
        marked: mark ? { at: mark.at, ...(markedText(mark.at, zone) ? { text: markedText(mark.at, zone) } : {}), ...(mark.link ? { link: mark.link } : {}) } : null,
      };
    });
    const markedCount = posts.filter(post => post.marked).length;
    return { route: intent.route === 'self' ? 'self' : 'partial', posts, markedCount, allMarked: markedCount === posts.length, settled, closed: state === 'COMPLETE' };
  } catch {
    return null;
  }
}

/**
 * What the person has to do about posts that are already out or ready, as Inbox items for the job page, from the projected
 * status list and posting kit: a post waiting for their answer ("Is this post in Metricool?"), a post that failed after it
 * reached Metricool (fixed there, and kept until they say they handled it, even once the job is closed; not one that was
 * refused before anything was saved, which Claude fixes and sends again), and the posts still to post themselves. When every post is out and only the closing is left, the item says
 * Claude is closing the job (`closing`: it does not need the person). `need` is the same thing as the step rail says it,
 * `target` is what the item scrolls to on the page ('post:<id>' for one row of the status list, 'kit' for the posting kit).
 */
export function postInboxItems({ status = null, kit = null, jobId = null, closed = false } = {}) {
  const items = [];
  for (const post of Array.isArray(status?.posts) ? status.posts : []) {
    if (!post || typeof post.id !== 'string') continue;
    if (post.status === 'needs_check') {
      items.push({ kind: 'post', jobId, text: 'Tell Claude whether a post is in Metricool', summary: clip(post.label || 'This post', 120), target: `post:${post.id}` });
    } else if (post.status === 'failed' && post.sentOut !== false) {
      // It reached Metricool and failed there: one instruction, to fix it in Metricool, which stays until the person says they
      // handled it (even after the job is complete). Never the posting kit: it may be live or half made.
      items.push({
        kind: 'post', jobId, text: 'A post failed in Metricool', need: 'Fix it in Metricool', dismissible: true, lid: typeof post.lid === 'string' ? post.lid : null,
        summary: clip(`${post.label || 'This post'}: ${post.reason || 'Metricool could not publish it.'}`, 240), target: `post:${post.id}`,
        ...(typeof post.plannerUrl === 'string' && post.plannerUrl ? { plannerUrl: post.plannerUrl } : {}),
      });
    }
  }
  const posts = Array.isArray(kit?.posts) ? kit.posts : [];
  const left = posts.filter(post => !post?.marked).length;
  if (posts.length && left && !closed) {
    items.push({
      kind: 'post', jobId, text: `Post it yourself: ${posts.length - left} of ${posts.length} posted`,
      need: left === 1 ? 'Post it yourself, then mark it as posted' : `Post ${left} posts yourself, then mark each as posted`, target: 'kit',
    });
  } else if (posts.length && !left && kit?.settled && !closed) {
    items.push({ kind: 'post', jobId, text: `Post it yourself: ${posts.length} of ${posts.length} posted`, summary: 'Claude is closing this job.', need: 'Claude is closing this job', target: 'kit', closing: true });
  }
  return items;
}

/**
 * The line that heads a job whose posts are out or ready, from the projected status list and posting kit, or null when the
 * usual line stands. "Finished" is only ever said at COMPLETE; before that, with every post out, Claude is closing the job.
 * `marked` is whether the person marked any post as posted.
 */
export function postingLine({ status = null, kit = null, state = null, marked = false } = {}) {
  if (state === 'COMPLETE') {
    const rows = Array.isArray(status?.posts) ? status.posts : [];
    // A failure that reached Metricool is still the person's to fix there, so the job is done but not "all done".
    const failed = rows.filter(post => post?.status === 'failed' && post.sentOut !== false).length;
    if (failed) return failed === 1 ? 'Done, but one post failed in Metricool. Fix it there.' : `Done, but ${failed} posts failed in Metricool. Fix them there.`;
    const sentOnes = rows.some(post => post?.status !== 'marked');
    if (marked && sentOnes) return 'All done. Your posts are with Metricool, and the rest are marked as posted.';
    return marked ? 'All done. Every post is marked as posted.' : status ? 'All done. Your posts are with Metricool.' : null;
  }
  if (state !== 'PUBLISH_APPROVED' && state !== 'HANDOFF_READY') return null;
  const left = (Array.isArray(kit?.posts) ? kit.posts : []).filter(post => !post?.marked).length;
  if (kit?.settled || (status?.allSent && !kit)) return 'Claude is closing this job.';
  if (left && state === 'PUBLISH_APPROVED') return 'Your posting kit is ready. Post each one, then mark it as posted.';
  if ((Array.isArray(status?.posts) ? status.posts : []).some(post => post?.status === 'needs_check')) return 'Tell Claude whether a post is in Metricool.';
  return null;
}

function recipesSection(root, brand, jobId) {
  if (!root || !brand || !jobId) return null;
  let data;
  try { data = readJobRecipes({ root, brand, jobId }); } catch { return null; }
  const deliverables = {};
  for (const [id, entry] of Object.entries(data.deliverables || {}).slice(0, MAX_POSTS)) {
    if (!entry.options) continue;
    const chosenFields = entry.chosen ? entry.recipe?.fields : null;
    const fields = {};
    for (const field of RECIPE_FIELDS) {
      const options = (entry.options.fields?.[field] || []).map(plainOption);
      fields[field] = { label: RECIPE_FIELD_LABELS[field], options, chosen: chosenSummary(field, chosenFields?.[field]) };
    }
    deliverables[id] = { chosen: Boolean(entry.chosen), fields };
  }
  return Object.keys(deliverables).length ? deliverables : null;
}

function clip(value, limit = FIELD_LIMIT) {
  const text = String(value ?? '').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function cleanCell(value) {
  return String(value ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|').trim();
}

const wholeNumber = value => {
  const text = String(value ?? '').trim();
  const number = Number(text);
  return text !== '' && Number.isInteger(number) && number >= 0 ? number : null;
};

const metaNumber = value => {
  const text = String(value ?? '').trim();
  const number = Number(text);
  return text !== '' && Number.isFinite(number) ? number : null;
};

// A YAML comment is " # text" (a space on both sides of the #), so a hashtag,
// a hex colour or anything inside a quoted value or an inline [list] survives.
function stripComment(value) {
  const text = String(value).trim();
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end > 0) return text.slice(0, end + 1);
  }
  if (/^["']/.test(text)) {
    const end = text.indexOf(text[0], 1);
    if (end > 0) return text.slice(0, end + 1);
  }
  return text.replace(/\s+#(?:\s.*)?$/, '').trim();
}

function unquote(value) {
  const text = String(value).trim();
  return /^(["']).*\1$/.test(text) ? text.slice(1, -1) : text;
}

/**
 * Split YAML-style front matter off a markdown file. Understands the flat shape
 * the pipeline templates use: `key: value`, `key: [a, b]`, a block list of
 * `  - item` lines, and trailing `# comments`.
 */
export function splitFrontMatter(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return { meta: {}, body: source };
  const meta = {};
  let listKey = null;
  for (const raw of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s*(.*)$/.exec(raw);
    if (item && listKey) {
      const value = unquote(stripComment(item[1]));
      if (value) meta[listKey].push(value);
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw);
    if (!pair) { listKey = null; continue; }
    const value = stripComment(pair[2]);
    if (value === '') { meta[pair[1]] = []; listKey = pair[1]; continue; }
    listKey = null;
    if (/^\[.*\]$/.test(value)) meta[pair[1]] = value.slice(1, -1).split(',').map(entry => unquote(entry.trim())).filter(Boolean);
    else meta[pair[1]] = unquote(value);
  }
  return { meta, body: source.slice(match[0].length) };
}

// The text of a `# Heading` section (any heading level), up to the next heading
// of the same or a higher level.
function sectionText(body, name) {
  const lines = body.split(/\r?\n/);
  const pattern = new RegExp(`^(#{1,6})\\s+${name}\\s*$`, 'i');
  const start = lines.findIndex(line => pattern.test(line.trim()));
  if (start < 0) return null;
  const level = pattern.exec(lines[start].trim())[1].length;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading && heading[1].length <= level) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

// Everything above the "## Details" record block: the part written for a person.
function readablePart(body) {
  const index = body.search(/^##\s+Details\s*$/im);
  return index < 0 ? body : body.slice(0, index);
}

function tableRows(lines, startIndex) {
  const rows = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('|')) break;
    rows.push(line.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cleanCell));
  }
  return rows;
}

const isSeparator = cells => cells.length > 0 && cells.every(cell => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')));

function findTable(body, headerTest) {
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().startsWith('|')) continue;
    const rows = tableRows(lines, index);
    if (rows.length >= 2 && isSeparator(rows[1]) && headerTest(rows[0].map(cell => cell.toLowerCase()))) {
      return { header: rows[0], rows: rows.slice(2).filter(row => !isSeparator(row)) };
    }
    index += Math.max(0, rows.length - 1);
  }
  return null;
}

/**
 * concepts.md: `## Concept A: title (recommended)` sections, each a bullet list
 * of `- Label: value` fields, plus the Media quote table's total credits per
 * concept and the front matter credits.
 */
export function parseConcepts(text) {
  const { meta, body } = splitFrontMatter(text);
  const concepts = [];
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (heading) {
      const concept = /^Concept\s+([A-Za-z0-9]{1,8})\s*(?:[:.\-\u2013\u2014]\s*(.*))?$/i.exec(heading[1].trim());
      if (concept) {
        const rawTitle = concept[2] || '';
        const id = concept[1].toUpperCase();
        current = {
          id,
          title: clip(rawTitle.replace(/\(\s*recommended\s*\)/i, '').replace(/[`*]/g, '').trim(), 200) || `Concept ${id}`,
          recommended: /\(\s*recommended\s*\)/i.test(rawTitle),
          fields: [],
          credits: null,
        };
        concepts.push(current);
      } else current = null;
      continue;
    }
    if (!current) continue;
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const field = /^\**([^:*]{1,120}?)\**:\s*(.*)$/.exec(bullet[1].trim());
      current.fields.push(field ? { label: clip(field[1], 120), value: clip(field[2]) } : { label: '', value: clip(bullet[1]) });
      continue;
    }
    if (/^\s{2,}\S/.test(line) && current.fields.length) {
      const last = current.fields[current.fields.length - 1];
      last.value = clip(`${last.value} ${line.trim()}`);
    }
  }
  const quote = findTable(body, header => header.some(cell => cell.includes('concept')) && header.some(cell => cell.includes('total')));
  if (quote) {
    const totalIndex = quote.header.findIndex(cell => /total/i.test(cell));
    for (const row of quote.rows) {
      const id = /^(?:concept\s+)?([A-Za-z0-9]{1,8})\b/i.exec(row[0] || '')?.[1]?.toUpperCase();
      const credits = wholeNumber(String(row[totalIndex] ?? '').replace(/[^0-9]/g, ''));
      const concept = concepts.find(item => item.id === id);
      if (concept && credits !== null) concept.credits = credits;
    }
  }
  return {
    use: typeof meta.use === 'string' ? meta.use : null,
    creditsQuoted: wholeNumber(meta.credits_quoted),
    creditsCeiling: wholeNumber(meta.credits_ceiling),
    concepts: concepts.slice(0, MAX_CONCEPTS),
  };
}

// A combined "Spoken / on-screen" cell: labelled parts when the writer labelled
// them, else the template's "spoken / on-screen" order.
function splitSpokenOnScreen(cell) {
  const text = String(cell || '').trim();
  if (!text) return { voiceover: '', onScreen: '' };
  const marks = [...text.matchAll(/(spoken|vo|voiceover|voice-over|on-?screen(?:\s+text)?|super)\s*:/gi)];
  if (marks.length) {
    const parts = { voiceover: '', onScreen: '' };
    marks.forEach((mark, index) => {
      const value = text.slice(mark.index + mark[0].length, index + 1 < marks.length ? marks[index + 1].index : undefined).replace(/^[\s/;,]+|[\s/;,]+$/g, '');
      if (/on-?screen|super/i.test(mark[1])) parts.onScreen = value; else parts.voiceover = value;
    });
    return parts;
  }
  const split = text.split(/\s+\/\s+/);
  return split.length > 1 ? { voiceover: split[0].trim(), onScreen: split.slice(1).join(' / ').trim() } : { voiceover: text, onScreen: '' };
}

// The Frame cell in words a person reads: what the camera sees for a frame to
// generate, and plainly which frames reuse an existing image or real footage.
// A stray colon or label left after the marker ("TO GENERATE: ...") is not
// content, so the marker regexes eat it and stripLeadingLabel mops up the rest.
function frameText(cell) {
  const text = stripLeadingLabel(cell);
  const asset = /^ASSET:\s*(.*)$/i.exec(text);
  if (asset) {
    const name = stripLeadingLabel(asset[1]);
    return name && !CODE_LIKE_RE.test(name) ? `Existing image: ${name}` : 'Existing image';
  }
  const produce = /^TO PRODUCE\b\s*:?\s*(.*)$/i.exec(text);
  if (produce) return produce[1].trim() ? `Filmed footage: ${produce[1].trim()}` : 'Filmed footage';
  return text.replace(/^TO GENERATE\b\s*:?\s*/i, '');
}

// A leading label ("Shot:", "Voiceover:") or stray punctuation left over once
// a cell's own marker is consumed: a person reads the content, not the label.
function stripLeadingLabel(value) {
  const text = String(value ?? '').trim();
  return text
    .replace(/^[\s:;,\-\u2013\u2014]+/, '')
    .replace(/^(?:shot|frame|camera|action|voice\s*-?\s*over|vo|on[- ]?screen(?:\s+text)?|caption|super|note)\s*:\s*/i, '')
    .replace(/^[\s:;,\-\u2013\u2014]+/, '')
    .trim();
}

// A parenthetical task number, stage code or file path is production
// bookkeeping dropped from a panel field; the rest of the sentence stays.
const INTERNAL_ASIDE_RE = /\(([^()]*\b(?:task|stage)\s*\d+[a-z]?\b[^()]*|[^()]*[\\/][^()]*\.[a-z0-9]{2,4}[^()]*)\)/gi;
const FILE_REF_RE = /\b(?:[\w.-]+[\\/])+[\w.-]+\.(?:md|json|png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a|csv|txt)\b/gi;
const CODE_LIKE_RE = /\b[0-9a-f]{8,}\b|\.[a-z0-9]{2,4}$/i;

// A field that only says nothing is there ("none", "n/a", "silent"), with or
// without a production explanation, is empty to a person, never a note.
const NO_CONTENT_RE = /^(?:none|n\/a|na|nil|silent|not applicable|no\b[\s\S]{0,24}\b(?:voiceover|vo|sound|audio)\b)\b/i;

function cleanNote(value) {
  const text = stripLeadingLabel(value);
  if (!text) return '';
  const wrapped = /^\((.+)\)$/.exec(text);
  if (NO_CONTENT_RE.test(wrapped ? wrapped[1].trim() : text)) return '';
  return text.replace(INTERNAL_ASIDE_RE, '').replace(FILE_REF_RE, '')
    .replace(/\s{2,}/g, ' ').replace(/^[\s:;,\-\u2013\u2014]+|[\s:;,\-\u2013\u2014]+$/g, '').trim();
}

// The deliverable's readable label: platform plus the format its aspect ratio
// reads as on that platform ("Facebook Story", "Instagram Reel"), the same
// words a person would use, never the "D1" code alone.
const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X', threads: 'Threads', youtube: 'YouTube' };
const DELIVERABLE_FORMATS = {
  facebook: { '9:16': 'Story', '1:1': 'post', '4:5': 'post', '3:4': 'post', '16:9': 'video', '4:3': 'video' },
  instagram: { '9:16': 'Reel', '1:1': 'post', '4:5': 'post', '3:4': 'post', '16:9': 'video', '4:3': 'video' },
  tiktok: { '9:16': 'video', '1:1': 'video', '4:5': 'video', '16:9': 'video' },
  youtube: { '9:16': 'Short', '16:9': 'video' },
  linkedin: { '16:9': 'video', '1:1': 'post', '4:5': 'post' },
  x: { '16:9': 'video', '1:1': 'post' },
  threads: { '1:1': 'post', '4:5': 'post', '9:16': 'Story' },
};
function deliverableFormat(platform, aspectRatio) {
  const key = String(platform ?? '').toLowerCase();
  return (key && DELIVERABLE_FORMATS[key]?.[aspectRatio]) || (aspectRatio ? 'video' : null);
}
function deliverablePlatformLabel(platform) {
  const key = String(platform ?? '').toLowerCase();
  return key ? PLATFORM_LABELS[key] || (key[0].toUpperCase() + key.slice(1)) : '';
}

/**
 * drafts/D*\/storyboard.md: the panel table, in the Sequence line's order, with
 * cut panels left out. Each panel carries its shot, on-screen text, voiceover and
 * duration in seconds, a permanent `ref` ("P1") for decisions and chat edits, and
 * a readable `label` ("Panel 1") a person reads. Fields are cleaned of leading
 * labels, production notes (task/stage references, file paths) and "no voiceover"
 * explanations, which read as null rather than an internal note.
 */
export function parseStoryboard(text) {
  const { meta, body } = splitFrontMatter(text);
  const table = findTable(body, header => header.some(cell => cell === 'id' || cell.includes('panel')) && header.some(cell => /frame|shot|duration/.test(cell)));
  const panels = [];
  if (table) {
    const header = table.header.map(cell => cell.toLowerCase());
    const col = test => header.findIndex(test);
    const idCol = col(cell => cell === 'id' || cell === 'panel' || cell === 'panel id');
    const frameCol = col(cell => /frame|shot/.test(cell));
    const actionCol = col(cell => /action|camera/.test(cell));
    const durationCol = col(cell => /duration|second|\(s\)/.test(cell));
    const combinedCol = col(cell => /spoken/.test(cell) && /on-?screen/.test(cell));
    const onScreenCol = combinedCol >= 0 ? -1 : col(cell => /on-?screen|super/.test(cell));
    const voiceCol = combinedCol >= 0 ? -1 : col(cell => /spoken|voice|\bvo\b|dialogue|audio/.test(cell));
    const keepCol = col(cell => /keep|cut/.test(cell));
    table.rows.forEach((row, index) => {
      if (keepCol >= 0 && /^cut$/i.test(String(row[keepCol] || '').trim())) return;
      const spoken = combinedCol >= 0 ? splitSpokenOnScreen(row[combinedCol]) : { voiceover: row[voiceCol] ?? '', onScreen: row[onScreenCol] ?? '' };
      const voiceover = cleanNote(spoken.voiceover);
      const duration = metaNumber(String(row[durationCol] ?? '').replace(/[^0-9.]/g, ''));
      panels.push({
        ref: clip(row[idCol] ?? '', 40) || `P${index + 1}`,
        shot: clip(cleanNote(frameText(row[frameCol]))),
        camera: clip(cleanNote(actionCol >= 0 ? row[actionCol] : '')),
        onScreen: clip(cleanNote(spoken.onScreen)),
        voiceover: voiceover ? clip(voiceover) : null,
        durationSeconds: duration ? duration : null, // 0 means no duration (a still), never "0 s"
        source: /^ASSET\b/i.test(stripLeadingLabel(row[frameCol])) ? 'kept' : 'new',
      });
    });
  }
  const sequence = /\*\*Sequence:\*\*\s*([^\r\n]+)/i.exec(body)?.[1]
    ?.split(/\s*(?:->|→|,)\s*/).map(item => item.replace(/[`*]/g, '').trim()).filter(Boolean) || [];
  const ordered = sequence.length && panels.some(panel => sequence.includes(panel.ref))
    ? sequence.map(ref => panels.find(panel => panel.ref === ref)).filter(Boolean)
    : panels;
  const platform = typeof meta.platform === 'string' ? meta.platform : null;
  const aspectRatio = typeof meta.aspect_ratio === 'string' ? meta.aspect_ratio : null;
  const format = deliverableFormat(platform, aspectRatio);
  const runtimeSeconds = metaNumber(meta.runtime_s);
  const shown = ordered.slice(0, MAX_PANELS);
  const totalSeconds = shown.length && shown.every(panel => panel.durationSeconds > 0)
    ? Math.round(shown.reduce((sum, panel) => sum + panel.durationSeconds, 0) * 10) / 10
    : null;
  return {
    ref: typeof meta.deliverable === 'string' ? meta.deliverable : null,
    label: [deliverablePlatformLabel(platform), format].filter(Boolean).join(' ') || null,
    platform,
    format,
    aspectRatio,
    runtimeSeconds: runtimeSeconds ? runtimeSeconds : null, // 0 means no runtime (a still), never "0 s"
    totalSeconds,
    panels: shown.map((panel, index) => ({ ...panel, label: `Panel ${index + 1}` })),
  };
}

/** The post.md Publish plan table: account, platform, time and destination per row. */
export function parsePublishPlan(body) {
  const section = sectionText(body, 'Publish plan');
  if (!section) return [];
  const table = findTable(section, header => header.some(cell => /platform|account/.test(cell)));
  if (!table) return [];
  const header = table.header.map(cell => cell.toLowerCase());
  const col = test => header.findIndex(test);
  const cols = {
    account: col(cell => /account|handle/.test(cell)),
    platform: col(cell => /platform/.test(cell)),
    publishAt: col(cell => /publish|when|time|date|schedule/.test(cell)),
    destination: col(cell => /destination|url|link/.test(cell)),
    settings: col(cell => /setting/.test(cell)),
  };
  return table.rows
    .map(row => Object.fromEntries(Object.entries(cols).map(([key, index]) => [key, clip(index >= 0 ? row[index] : '', 300)])))
    .filter(row => Object.values(row).some(Boolean))
    .slice(0, 20);
}

/** drafts/D*\/post.md: the hook, caption, hashtags, CTA, media and publish plan a person approves. */
export function parsePost(text) {
  const { meta, body } = splitFrontMatter(text);
  const readable = readablePart(body);
  const hashtagsSection = sectionText(readable, 'Hashtags');
  const hashtags = Array.isArray(meta.hashtags) && meta.hashtags.length
    ? meta.hashtags
    : (hashtagsSection || '').split(/[\s,]+/).filter(tag => /^#\S+/.test(tag));
  const caption = clip(sectionText(readable, 'Caption') || '', 6000);
  const lines = caption.split(/\r?\n/);
  const first = lines.findIndex(line => line.trim());
  return {
    deliverable: typeof meta.deliverable === 'string' ? meta.deliverable : null,
    platform: typeof meta.platform === 'string' ? meta.platform : null,
    hook: first >= 0 ? clip(lines[first], 600) : '',
    caption,
    hashtags: hashtags.slice(0, 60).map(tag => clip(tag, 100)),
    cta: clip(sectionText(readable, 'CTA') || ''),
    media: (Array.isArray(meta.media) ? meta.media : []).filter(path => typeof path === 'string' && path).slice(0, MAX_POST_FILES),
    accessibilityText: clip(typeof meta.accessibility_text === 'string' ? meta.accessibility_text : ''),
    publishPlan: parsePublishPlan(body),
  };
}

const QUOTE_KINDS = new Set(['image', 'video', 'voice']);

function quoteDetail(item, estimate) {
  const inputs = estimate?.inputs && typeof estimate.inputs === 'object' ? estimate.inputs : {};
  const parts = [];
  if (item.kind === 'video') {
    const seconds = Number(inputs.duration);
    if (Number.isFinite(seconds) && seconds > 0) parts.push(`${seconds} seconds`);
    if (typeof inputs.resolution === 'string' && inputs.resolution.trim()) parts.push(clip(inputs.resolution, 20));
    if (inputs.generateAudio === false) parts.push('no sound');
  }
  if (item.kind === 'voice' && Number(item.generationsCount) > 1) parts.push(`${Number(item.generationsCount)} versions`);
  return parts.join(', ');
}

export function parseQuote(value, { made = new Set(), estimates = [] } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const byId = new Map(estimates.filter(entry => entry?.estimateId).map(entry => [entry.estimateId, entry]));
  const items = (Array.isArray(source.items) ? source.items : [])
    .filter(item => item && typeof item === 'object' && PROVIDERS.includes(item.provider) && QUOTE_KINDS.has(item.kind))
    .map(item => {
      const credits = Number(item.credits);
      const key = canonicalJobKey(item.key);
      return {
        deliverable: clip(item.deliverable || '', 12) || null,
        panel: clip(item.panel || '', 12) || null,
        version: Number.isSafeInteger(Number(item.version)) && Number(item.version) > 0 ? Number(item.version) : 1,
        kind: item.kind,
        provider: item.provider,
        credits: Number.isFinite(credits) && credits >= 0 ? credits : null,
        detail: quoteDetail(item, byId.get(item.estimateId)),
        made: Boolean(key && made.has(key)),
      };
    });
  return { items: items.slice(0, MAX_QUOTE_ROWS), totals: quoteTotals(source.items), truncated: items.length > MAX_QUOTE_ROWS };
}

/**
 * The duration of an MP4 or MOV file in seconds, read from its moov/mvhd box
 * without decoding anything. Null for any other file or on any read problem.
 */
export function mp4DurationSeconds(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const box = offset => {
      const head = Buffer.alloc(16);
      if (readSync(fd, head, 0, 16, offset) < 8) return null;
      let length = head.readUInt32BE(0);
      let headerSize = 8;
      if (length === 1) { length = Number(head.readBigUInt64BE(8)); headerSize = 16; } else if (length === 0) length = size - offset;
      return length >= headerSize ? { length, type: head.toString('latin1', 4, 8), headerSize } : null;
    };
    for (let offset = 0, guard = 0; offset < size && guard < 4096; guard += 1) {
      const top = box(offset);
      if (!top) return null;
      if (top.type === 'moov') {
        const end = offset + top.length;
        for (let child = offset + top.headerSize, inner = 0; child < end && inner < 4096; inner += 1) {
          const entry = box(child);
          if (!entry) return null;
          if (entry.type === 'mvhd') {
            const body = Buffer.alloc(32);
            readSync(fd, body, 0, 32, child + entry.headerSize);
            const v1 = body[0] === 1;
            const timescale = v1 ? body.readUInt32BE(20) : body.readUInt32BE(12);
            const duration = v1 ? Number(body.readBigUInt64BE(24)) : body.readUInt32BE(16);
            return timescale ? Math.round((duration / timescale) * 10) / 10 : null;
          }
          child += entry.length;
        }
        return null;
      }
      offset += top.length;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

let ffmpegMissing = false;

// A small JPEG of an image or of a video's first frame, cached by content hash so
// each file is scaled once. Uses ffmpeg when it is installed; without it only an
// image already small enough is inlined, and a video gets no poster.
function scaledThumbnail(file, sha256, cacheDir, { video = false } = {}) {
  if (!cacheDir || !sha256 || ffmpegMissing) return null;
  const target = join(cacheDir, `${sha256}.jpg`);
  try { if (existsSync(target)) return readFileSync(target); } catch { return null; }
  mkdirSync(cacheDir, { recursive: true });
  const temp = join(cacheDir, `${sha256}.${process.pid}.${randomUUID()}.tmp.jpg`);
  const scale = `scale='min(${THUMB_EDGE},iw)':'min(${THUMB_EDGE},ih)':force_original_aspect_ratio=decrease`;
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...(video ? ['-ss', '0.5'] : []), '-i', file, '-frames:v', '1', '-vf', scale, '-q:v', '7', temp], { windowsHide: true, shell: false, timeout: 20000 });
  if (result.error?.code === 'ENOENT') { ffmpegMissing = true; return null; }
  try {
    if (result.status === 0 && existsSync(temp) && statSync(temp).size > 0) {
      renameSync(temp, target);
      return readFileSync(target);
    }
  } catch { /* A concurrent writer produced the same file. */ }
  rmSync(temp, { force: true });
  return null;
}

function redact(text, root) {
  if (!root) return text;
  let out = text;
  for (const variant of new Set([root, root.replaceAll('\\', '/'), root.replaceAll('/', '\\')])) {
    if (variant.length > 3) out = out.split(variant).join('<workspace>');
  }
  return out;
}

function titleOf(path, body) {
  const heading = /^#\s+(.+)$/m.exec(body || '')?.[1];
  if (heading && !/[{}]/.test(heading)) return clip(heading.replace(/[`*]/g, ''), 160);
  return basename(path);
}

function withinJob(dir, path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path) || /^[a-z]:/i.test(path)) return null;
  try {
    const base = realpathSync(dir);
    const file = realpathSync(resolve(dir, path));
    const rel = relative(base, file);
    if (!rel || rel.startsWith('..') || rel.startsWith(sep) || /^[a-z]:/i.test(rel)) return null;
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

function priorityOf(path, reviewPaths, strategyPath, researchPaths) {
  if (reviewPaths.has(path)) return 0;
  if (path === strategyPath) return 1;
  if (researchPaths.includes(path)) return 2;
  const value = path.toLowerCase();
  if (value.startsWith('drafts/')) return 3;
  if (value.startsWith('media/')) return 4;
  if (value.startsWith('handoff/')) return 5;
  if (!value.includes('/')) return 6;
  if (value.startsWith('validation/')) return 7;
  return 8;
}

function researchFiles(artifacts) {
  const rank = path => {
    const index = RESEARCH_ORDER.indexOf(basename(path, '.md').toLowerCase());
    return index < 0 ? RESEARCH_ORDER.length : index;
  };
  return artifacts
    .map(item => item.path)
    .filter(path => /^research\/[^/]+\.md$/i.test(path))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function reportStills(artifacts) {
  return artifacts
    .map(item => item.path)
    .filter(path => path.startsWith(STILLS_PREFIX) && !path.slice(STILLS_PREFIX.length).includes('/') && IMAGE_TYPES[extname(path).toLowerCase()])
    .sort();
}

export function stillSeconds(path) {
  const name = basename(String(path || ''));
  const clock = /(\d+)m(\d{1,2}(?:\.\d+)?)s\.[a-z0-9]+$/i.exec(name);
  if (clock) return Math.round((Number(clock[1]) * 60 + Number(clock[2])) * 100) / 100;
  const seconds = /(\d+(?:\.\d+)?)s\.[a-z0-9]+$/i.exec(name);
  return seconds ? Math.round(Number(seconds[1]) * 100) / 100 : null;
}

function strategyFile(artifacts) {
  const paths = new Set(artifacts.map(item => item.path));
  return ['strategy.md', 'brief.md'].find(path => paths.has(path)) || null;
}

const MAKERS = Object.freeze({ threeEcho: '3Echo Studio', elevenLabs: 'ElevenLabs' });
const MADE_KIND_WORDS = Object.freeze({ image: 'Image', video: 'Video clip', voice: 'Voice-over', audio: 'Voice-over' });
const PROMPT_LIMIT = 2000;
const finiteNumber = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

function madeSettings(inputs, kind) {
  const value = inputs && typeof inputs === 'object' ? inputs : {};
  const parts = [];
  const ratio = typeof value.aspectRatio === 'string' ? value.aspectRatio : typeof value.ratio === 'string' ? value.ratio : '';
  if (/^\d{1,2}:\d{1,2}$/.test(ratio.trim())) parts.push(ratio.trim());
  const seconds = finiteNumber(value.duration);
  if (seconds && seconds > 0) parts.push(`${seconds} seconds`);
  if (typeof value.resolution === 'string' && /^[\w ]{1,12}$/.test(value.resolution.trim())) parts.push(value.resolution.trim());
  if (kind === 'video' && value.generateAudio === false) parts.push('No sound');
  if (kind === 'video' && value.generateAudio === true) parts.push('With sound');
  const versions = finiteNumber(value.generations_count);
  if (versions && versions > 1) parts.push(`${versions} versions`);
  if (typeof value.language === 'string' && /^[A-Za-z -]{2,20}$/.test(value.language.trim())) parts.push(value.language.trim());
  return parts;
}

function landedKind(entry, create) {
  const fromCreate = typeof create?.kind === 'string' ? create.kind : null;
  if (fromCreate && MADE_KIND_WORDS[fromCreate]) return fromCreate;
  const mime = String(entry.mimeType || '');
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'voice';
  const kind = mediaKind(entry.file);
  return kind === 'audio' ? 'voice' : kind;
}

function landedSlot(entry) {
  const parsed = parseJobKey(entry.key);
  return {
    deliverable: canonicalDeliverable(entry.deliverable) || parsed?.deliverable || null,
    panel: canonicalItem(entry.panel) || parsed?.item || null,
    version: Number.isSafeInteger(Number(entry.version)) && Number(entry.version) > 0 ? Number(entry.version) : parsed?.version || null,
  };
}

function generationRecords(dir) {
  const job = { dir };
  let landed = [];
  let records = [];
  try { landed = readLanded(job).filter(entry => entry.type === 'landed' && typeof entry.file === 'string' && entry.file); } catch { landed = []; }
  try { records = readRecords(job); } catch { records = []; }
  const creates = new Map();
  const results = new Map();
  for (const record of records) {
    if (!record || typeof record.providerJobId !== 'string') continue;
    if (record.type === 'create' && !creates.has(record.providerJobId)) creates.set(record.providerJobId, record);
    if (record.type === 'result') results.set(record.providerJobId, record);
  }
  const entries = landed.map(entry => ({ ...entry, ...landedSlot(entry), kind: landedKind(entry, creates.get(entry.providerJobId)) }));
  const byFile = new Map();
  const byAsset = new Map();
  for (const entry of entries) {
    byFile.set(entry.file, entry);
    if (typeof entry.assetId === 'string' && entry.assetId) byAsset.set(entry.assetId, entry);
  }
  return { entries, byFile, byAsset, creates, results };
}

function madeLabel(entry) {
  const item = [entry.deliverable, entry.panel].filter(Boolean).join(' ');
  const word = (MADE_KIND_WORDS[entry.kind] || 'File').toLowerCase();
  return item ? `${item} ${word}` : null;
}

function generationInfo(generation, path) {
  const entry = generation.byFile.get(path);
  if (!entry) return null;
  const create = generation.creates.get(entry.providerJobId) || null;
  const result = generation.results.get(entry.providerJobId) || null;
  const inputs = create?.inputs && typeof create.inputs === 'object' ? create.inputs : {};
  const sources = [...new Set([...(Array.isArray(inputs.assetIds) ? inputs.assetIds : []), ...(Array.isArray(create?.inputAssetIds) ? create.inputAssetIds : [])])]
    .map(assetId => generation.byAsset.get(assetId))
    .filter(source => source && source.file !== entry.file)
    .map(madeLabel)
    .filter(Boolean);
  const made = {
    maker: MAKERS[entry.provider || create?.provider] || MAKERS.threeEcho,
    what: MADE_KIND_WORDS[entry.kind] || 'File',
    item: [entry.deliverable, entry.panel].filter(Boolean).join(' ') || null,
    version: entry.version || null,
    settings: madeSettings(inputs, entry.kind),
    from: [...new Set(sources)],
    startedAt: typeof create?.at === 'string' ? create.at : null,
    savedAt: typeof entry.at === 'string' ? entry.at : null,
    credits: finiteNumber(entry.finalCredits) ?? finiteNumber(result?.finalCredits) ?? finiteNumber(create?.reservedCredits),
  };
  const info = { made };
  const prompt = typeof create?.prompt === 'string' ? create.prompt.trim() : '';
  if (prompt) info.prompt = clip(prompt, PROMPT_LIMIT);
  if (entry.deliverable && entry.panel) {
    const versions = new Map();
    for (const other of generation.entries) {
      if (other.deliverable !== entry.deliverable || other.panel !== entry.panel || !other.version) continue;
      versions.set(other.version, typeof other.at === 'string' ? other.at : null);
    }
    if (versions.size > 1) info.versions = [...versions.entries()].sort((a, b) => a[0] - b[0]).map(([version, savedAt]) => ({ version, savedAt }));
  }
  return info;
}

function panelFrames(generation, manifests, shaOf) {
  const frames = new Map();
  const rank = kind => (kind === 'image' ? 0 : kind === 'video' ? 1 : 2);
  const offer = (deliverable, panel, path, kind, version, order) => {
    if (!deliverable || !panel || !shaOf.has(path) || rank(kind) > 1) return;
    const key = `${deliverable}|${panel}`;
    const current = frames.get(key);
    const candidate = { path, kind, version: version || 0, order };
    if (!current || rank(kind) < rank(current.kind) || (rank(kind) === rank(current.kind) && (candidate.version > current.version || (candidate.version === current.version && order > current.order)))) {
      frames.set(key, candidate);
    }
  };
  manifests.forEach(manifest => {
    const deliverable = canonicalDeliverable(manifest.deliverable);
    (Array.isArray(manifest.items) ? manifest.items : []).forEach(item => {
      if (typeof item?.file !== 'string') return;
      offer(deliverable, canonicalItem(item.panel), item.file, mediaKind(item.file), 0, -1);
    });
  });
  generation.entries.forEach((entry, index) => offer(entry.deliverable, entry.panel, entry.file, entry.kind === 'voice' ? 'audio' : entry.kind, entry.version, index));
  return frames;
}

// The deliverable's post type in a person's words ("Instagram reel"), from the job's own
// deliverable, or null when the job has none for this ref or its post type is not known yet.
// A job made before post types existed gets the one it can only be, never a guess.
function placementLabel(job, ref) {
  const deliverables = Array.isArray(job?.deliverables) ? job.deliverables : [];
  const match = ref ? deliverables.find(item => item && item.id === ref) : null;
  if (!match) return null;
  return deliverableRules.placementWords(match.platform, deliverableRules.derivePlacement(match));
}

function briefSeconds(job, ref) {
  const deliverables = Array.isArray(job?.deliverables) ? job.deliverables : [];
  const match = deliverables.find(item => item && item.id === ref) || (deliverables.length === 1 ? deliverables[0] : null);
  const range = match?.durationSeconds;
  if (!range || typeof range !== 'object') return null;
  const min = finiteNumber(range.min);
  const max = finiteNumber(range.max);
  if (min === null && max === null) return null;
  return { min: min ?? max, max: max ?? min };
}

const FLAG_SUBJECTS = Object.freeze({ video: ['Your footage', 'video'], image: ['Your photo', 'image'] });

// Which deliverable a flag is about, the way the person sees it ("The Instagram Reel", "The second
// Instagram post"), or null when the job does not say. A picture of a Reel or a video post is its cover.
function flagDeliverable(job, flag, fileKind) {
  if (!flag.deliverable || !Array.isArray(job?.deliverables)) return null;
  const spec = deliverableRules.withDerivedPlacements(job);
  const match = spec.deliverables.find(item => item && item.id === flag.deliverable);
  if (!match) return null;
  const name = deliverableRules.describe(spec, match);
  const filmed = ['reel', 'video'].includes(match.placement);
  return name[0].toUpperCase() + name.slice(1) + (fileKind !== 'video' && filmed ? ' cover' : '');
}

export function flagSentence(flag, fileKind, job = null) {
  const video = fileKind === 'video';
  const [supplied, word] = FLAG_SUBJECTS[video ? 'video' : 'image'];
  const subject = flag.role === 'supplied' ? supplied : flagDeliverable(job, flag, fileKind) || `The ${word}`;
  const at = video && flag.at ? ` at ${flag.at}` : '';
  const seen = clip(String(flag.seen || '').replace(/'/g, '’'), 120);
  const expected = flag.expected ? clip(String(flag.expected).replace(/'/g, '’'), 120) : '';
  if (flag.kind === 'possible misspelling') return `${subject}${at} reads '${seen}'${expected ? `, not '${expected}'` : ''}.`;
  if (flag.kind === 'unexpected mark') return `${subject}${at} shows a '${seen}' mark that is not the brand's.`;
  return `${subject}${at} shows '${seen}', which is not in the approved copy.`;
}

function labelCheckSection(root, project, dir, still, job = null, files = []) {
  if (!root || !project?.brand || !project?.jobId) return null;
  let status;
  let record;
  try {
    status = labelCheckStatus({ root, brand: project.brand, jobId: project.jobId, files });
    record = readLabelCheck({ root, brand: project.brand, jobId: project.jobId });
  } catch {
    return null;
  }
  if (!status || status.state === 'not_needed') return null;
  const kindOf = new Map((status.files || []).map(file => [file.path, file.kind]));
  const frameOf = new Map((record?.frames || []).map(frame => [frame.frameId, frame]));
  const flags = status.state === 'current' ? (status.flags || []).map(flag => {
    const entry = { id: flag.id, text: flagSentence(flag, kindOf.get(flag.file), job) };
    const image = frameOf.get(flag.frameId)?.image;
    if (typeof image === 'string' && image) {
      const rel = relative(dir, resolve(root, image)).split(sep).join('/');
      const thumb = rel && !rel.startsWith('..') ? still(rel) : null;
      if (thumb) entry.still = thumb;
    }
    return entry;
  }) : [];
  return { state: status.state, checkedAt: status.checkedAt || null, flags };
}

function postDeliverable(path, post) {
  return canonicalDeliverable(post.deliverable) || canonicalDeliverable(/(?:^|\/)(D\d+)\//i.exec(path)?.[1]) || null;
}

function fileList(artifacts, rank) {
  const entries = artifacts.map((item, index) => ({ index, entry: item, cost: byteSize(item) + 1 }));
  const total = entries.reduce((sum, item) => sum + item.cost, 2);
  if (total <= JOB_DOCUMENT_FILE_LIST_BYTES) return { artifacts, omitted: 0 };
  const kept = new Set();
  let size = 2;
  for (const item of [...entries].sort((a, b) => rank(a.entry.path) - rank(b.entry.path) || a.index - b.index)) {
    if (size + item.cost > JOB_DOCUMENT_FILE_LIST_BYTES) continue;
    kept.add(item.index);
    size += item.cost;
  }
  return { artifacts: entries.filter(item => kept.has(item.index)).map(item => item.entry), omitted: entries.length - kept.size };
}

function jobInbox(inbox) {
  return {
    items: Array.isArray(inbox?.items) ? inbox.items : [],
    announcement: typeof inbox?.announcement === 'string' ? inbox.announcement : '',
  };
}

function jobDetails(details, rank) {
  if (!details || typeof details !== 'object') return null;
  const list = fileList(Array.isArray(details.artifacts) ? details.artifacts : [], rank);
  return {
    intake: details.intake ?? null,
    pendingReviews: Array.isArray(details.pendingReviews) ? details.pendingReviews : [],
    stages: Array.isArray(details.stages) ? details.stages : [],
    usageStages: Array.isArray(details.usageStages) ? details.usageStages : [],
    metrics: details.metrics ?? null,
    brandProfile: details.brandProfile ?? null,
    artifacts: list.artifacts,
    ...(list.omitted ? { artifactsOmitted: list.omitted } : {}),
  };
}

function outputTitle(platform, kind, index, count, label = null) {
  const word = kind === 'video' ? 'video' : kind === 'audio' ? 'voice-over' : 'image';
  // A deliverable with a post type is named by it: "Instagram Reel", not "Instagram video".
  const base = label && kind !== 'audio' ? label : platform ? `${deliverablePlatformLabel(platform)} ${word}` : word[0].toUpperCase() + word.slice(1);
  return count > 1 ? `${base} ${index + 1}` : base;
}

// A Reel or TikTok video that also has a picture shows it as the cover; other pictures and clips
// of a post with a post type are numbered among their own kind, so a Reel's cover is never
// "Instagram Reel 2".
function postOutputTitles(post, label, media) {
  const kinds = media.map(path => mediaKind(path));
  const filmed = Boolean(label) && /(Reel|video)$/.test(label);
  return media.map((path, index) => {
    const kind = kinds[index];
    if (!label) return outputTitle(post.platform, kind, index, media.length, null);
    if (filmed && kind === 'image') return `${label} cover`;
    const same = kinds.map((other, at) => (other === kind ? at : -1)).filter(at => at >= 0);
    return outputTitle(post.platform, kind, same.indexOf(index), same.length, label);
  });
}

/**
 * Build the job document.
 *
 * @param {object} options
 * @param {string} options.dir the job directory
 * @param {string} [options.root] the workspace root, redacted from file text
 * @param {string|null} options.workspaceId
 * @param {object} options.project the job snapshot's project (jobId, brand, state, revision, artifacts)
 * @param {object} [options.job] the job record, for the posting schedule and account
 * @param {string|null} options.gate the review the job is waiting on, if any
 * @param {object|null} options.review the registered review record for that gate, if any
 * @param {string|null} [options.thumbDir] where scaled thumbnails are cached, keyed by content hash
 * @param {object|null} [options.publish] what the Metricool connection says about this brand (publishContext in
 *   publish-intent.mjs): connected, found, label, networks, coverage. Only read for the posting decision.
 * @param {boolean} [options.handoffOnly] a job routed before 0.8, whose posting decision was folded into the final
 *   approval: it ends with the hand-off package, and the document says so
 * @param {object|null} [options.agents] what agentBox needs besides the document itself (snapshot, requests, retriedAt, blockedLine):
 *   when given, the document carries `agents`, the Agent Box section; left out, it carries none
 * @param {number} [options.now] the clock the publish status is projected at (ms since 1970)
 * @param {number} [options.budgetBytes]
 */
export function buildJobDocument({ dir, root = null, workspaceId = null, project, job = null, gate = null, review = null, details = null, inbox = null, reviewUrl = null, thumbDir = null, studioWorkspace = null, publish = null, handoffOnly = false, agents = null, now = Date.now(), budgetBytes = JOB_DOCUMENT_BUDGET_BYTES }) {
  const artifacts = Array.isArray(project?.artifacts) ? project.artifacts : [];
  const shaOf = new Map(artifacts.map(item => [item.path, item.sha256]));
  const kindOf = new Map(artifacts.map(item => [item.path, item.kind || null]));
  const currentReview = Boolean(gate && review && review.gate === gate && review.revision === project.revision && Array.isArray(review.artifacts) && review.artifacts.length);
  const reviewPaths = new Set(currentReview ? review.artifacts.map(item => item.path) : []);
  const registered = new Map(currentReview ? review.artifacts.map(item => [item.path, item.sha256]) : []);
  const research = researchFiles(artifacts);
  const strategy = strategyFile(artifacts);
  const uploaded = path => {
    if (typeof reviewUrl !== 'function' || !shaOf.get(path)) return null;
    try { return reviewUrl({ path, sha256: shaOf.get(path) }) || null; } catch { return null; }
  };

  const document = {
    schemaVersion: 1,
    workspaceId,
    jobId: project.jobId,
    brand: project.brand,
    revision: project.revision,
    state: project.state,
    ...(handoffOnly ? { publishNote: HANDOFF_ONLY_NOTE } : {}),
    review: gate ? { gate, revision: currentReview ? review.revision : project.revision, current: currentReview, paths: [...reviewPaths] } : null,
    inbox: jobInbox(inbox),
    research,
    strategy,
    files: [],
    truncated: false,
  };
  const reviewUrls = {};
  for (const item of artifacts) {
    if (Object.keys(reviewUrls).length >= MAX_REVIEW_URLS) break;
    const url = mediaKind(item.path) ? uploaded(item.path) : null;
    if (url) reviewUrls[item.path] = url;
  }
  if (Object.keys(reviewUrls).length) document.reviewUrls = reviewUrls;
  const shared = jobDetails(details, path => priorityOf(path, reviewPaths, strategy, research));
  if (shared) {
    document.details = shared;
    if (shared.artifactsOmitted) document.truncated = true;
  }
  const sent = publishStatusSection(dir, now);
  if (sent) document.publishStatus = sent;
  const recipes = recipesSection(root, project.brand, project.jobId);
  if (recipes) { document.recipes = recipes; document.recipeCatalog = RECIPE_CATALOG; }

  // One read per file, shared by the review parsers and the file list.
  const loaded = new Map();
  const load = path => {
    if (loaded.has(path)) return loaded.get(path);
    const file = withinJob(dir, path);
    const ext = extname(path).toLowerCase();
    let bytes = null;
    try {
      const size = file ? statSync(file).size : Infinity;
      if ((TEXT_EXTENSIONS.has(ext) && size <= TEXT_FILE_MAX_BYTES) || (IMAGE_TYPES[ext] && size <= JOB_DOCUMENT_THUMB_BYTES)) bytes = readFileSync(file);
    } catch { bytes = null; }
    const raw = bytes && TEXT_EXTENSIONS.has(ext) ? redact(bytes.toString('utf8'), root) : null;
    const result = { file, bytes, raw, sha256: bytes ? digest(bytes) : null };
    loaded.set(path, result);
    return result;
  };
  const changedSince = path => {
    const { sha256 } = load(path);
    return Boolean(sha256 && registered.get(path) && sha256 !== registered.get(path));
  };
  const json = path => {
    const { raw } = load(path);
    try { return raw == null ? null : JSON.parse(raw); } catch { return null; }
  };

  // Video posters and durations come from the generation manifests: a clip is
  // seeded from a panel image, and the stitched cut opens on its first clip.
  const manifests = artifacts.map(item => item.path).filter(path => /(^|\/)generation-manifest\.json$/i.test(path)).map(json).filter(Boolean);
  const posterOf = new Map();
  const durationOf = new Map();
  for (const manifest of manifests) {
    const items = Array.isArray(manifest.items) ? manifest.items : [];
    const panelImage = new Map(items.filter(item => item?.kind === 'image' && item.file).map(item => [item.panel, item.file]));
    const clipByStem = new Map();
    for (const item of items) {
      if (item?.kind !== 'video' || typeof item.file !== 'string') continue;
      clipByStem.set(basename(item.file, extname(item.file)), item);
      if (panelImage.has(item.panel)) posterOf.set(item.file, panelImage.get(item.panel));
      if (Number.isFinite(Number(item.durationSeconds))) durationOf.set(item.file, Number(item.durationSeconds));
    }
    const output = manifest.stitch?.output;
    const order = Array.isArray(manifest.stitch?.order) ? manifest.stitch.order : [];
    if (typeof output === 'string' && order.length) {
      const firstClip = clipByStem.get(order[0]);
      if (firstClip && posterOf.has(firstClip.file)) posterOf.set(output, posterOf.get(firstClip.file));
      const seconds = order.map(stem => Number(clipByStem.get(stem)?.durationSeconds)).filter(Number.isFinite);
      if (seconds.length === order.length) durationOf.set(output, seconds.reduce((sum, value) => sum + value, 0));
    }
  }
  const siblingPoster = path => {
    const folder = posix.dirname(path);
    const stem = basename(path, extname(path));
    const prefix = folder === '.' ? '' : `${folder}/`;
    const candidates = [stem, `${stem}-poster`, `${stem}.poster`, 'poster'].flatMap(name => ['.jpg', '.jpeg', '.png', '.webp'].map(ext => `${prefix}${name}${ext}`));
    return candidates.find(candidate => shaOf.has(candidate)) || null;
  };

  let reviewThumbBytes = 0;
  let thumbCount = 0;
  const thumbData = (path, { video = false, scaled = false } = {}) => {
    const { file, bytes } = load(path);
    if (!file) return null;
    const type = IMAGE_TYPES[extname(path).toLowerCase()];
    const raw = !video && !scaled && type && bytes && bytes.length <= JOB_DOCUMENT_THUMB_BYTES ? `data:${type};base64,${bytes.toString('base64')}` : null;
    if (raw && raw.length <= SCALE_ABOVE_CHARS) return raw;
    const resized = scaledThumbnail(file, shaOf.get(path) || load(path).sha256 || digest(readFileSync(file)), thumbDir, { video });
    const shrunk = resized && resized.length <= JOB_DOCUMENT_THUMB_BYTES ? `data:image/jpeg;base64,${resized.toString('base64')}` : null;
    return shrunk && (!raw || shrunk.length < raw.length) ? shrunk : raw;
  };
  const thumbnail = (path, { video = false, budget = null, scaled = false } = {}) => {
    if (thumbCount >= MAX_THUMBS) return null;
    const data = thumbData(path, { video, scaled });
    if (!data) return null;
    if (budget === 'review') {
      if (reviewThumbBytes + data.length > REVIEW_THUMB_BUDGET_BYTES) return null;
      reviewThumbBytes += data.length;
    }
    thumbCount += 1;
    return data;
  };
  const mediaRef = (path, { budget = 'review' } = {}) => {
    const kind = mediaKind(path);
    const ref = { path, title: basename(path), mimeType: MEDIA_TYPES[extname(path).toLowerCase()] || null, kind };
    if (!kind) return ref;
    const copy = uploaded(path);
    if (copy) ref.reviewUrl = copy;
    if (kind === 'image' && !copy) {
      const thumb = thumbnail(path, { budget });
      if (thumb) ref.thumb = thumb;
    }
    if (kind === 'video') {
      const file = load(path).file;
      const seconds = (file && mp4DurationSeconds(file)) ?? durationOf.get(path) ?? null;
      if (seconds !== null) ref.durationSeconds = seconds;
      const posterPath = posterOf.get(path) || siblingPoster(path);
      if (posterPath) {
        ref.posterPath = posterPath;
        const poster = thumbnail(posterPath, { budget });
        if (poster) ref.poster = poster;
      } else if (file) {
        const frame = thumbnail(path, { video: true, budget });
        if (frame) ref.poster = frame;
      }
    }
    return ref;
  };

  // The posting kit shows each file of a post beside its Download link, with the same tile the posting decision uses. The file
  // is the one the person approved: one that changed since shows nothing rather than something else. The previews are set apart
  // here and put back after the files are listed, only where the document has room, so they are the first thing to go.
  const kitPreview = item => {
    const path = typeof item?.path === 'string' ? item.path : '';
    if (!path || !mediaKind(path) || !shaOf.has(path) || shaOf.get(path) !== item.sha256) return null;
    return mediaRef(path);
  };
  const kit = postingKitSection(dir, publish, now, project.state, kitPreview);
  const kitPreviews = [];
  if (kit) {
    for (const post of kit.posts) for (const entry of post.media) if (entry.preview) { kitPreviews.push([entry, entry.preview]); delete entry.preview; }
    document.postingKit = kit;
  }

  const stillPaths = reportStills(artifacts);
  const stillSet = new Set(stillPaths);
  const reportFile = shaOf.has(REPORT_PATH) ? load(REPORT_PATH) : null;
  if (reportFile?.raw != null) {
    const { body } = splitFrontMatter(reportFile.raw);
    const text = body.trim();
    const heading = titleOf(REPORT_PATH, body);
    const limit = JOB_DOCUMENT_RESEARCH_TEXT_LIMIT;
    document.report = {
      path: REPORT_PATH,
      sha256: shaOf.get(REPORT_PATH),
      title: heading === basename(REPORT_PATH) ? 'Report' : heading,
      text: text.length > limit ? text.slice(0, limit) : text,
      truncated: text.length > limit,
      stills: stillPaths.slice(0, MAX_STILLS).map(path => {
        const still = { path, at: stillSeconds(path) };
        const thumb = thumbnail(path, { budget: 'review' });
        if (thumb) still.thumb = thumb;
        const copy = uploaded(path);
        if (copy) still.reviewUrl = copy;
        return still;
      }),
    };
    if (registered.has(REPORT_PATH)) document.report.changed = changedSince(REPORT_PATH);
    if (stillPaths.length > MAX_STILLS) document.report.stillsOmitted = stillPaths.length - MAX_STILLS;
    if (document.report.truncated || document.report.stillsOmitted) document.truncated = true;
  }

  const generation = generationRecords(dir);
  const frames = panelFrames(generation, manifests, shaOf);
  const boardFrames = path => {
    const parsed = parseStoryboard(load(path).raw);
    const deliverable = canonicalDeliverable(parsed.ref) || canonicalDeliverable(/(?:^|\/)(D\d+)\//i.exec(path)?.[1]);
    const hits = parsed.panels.map(panel => (deliverable ? frames.get(`${deliverable}|${canonicalItem(panel.ref)}`) : null) || null);
    return { parsed, deliverable, hits };
  };
  const needsThumb = hit => Boolean(hit) && !(hit.kind === 'image' && uploaded(hit.path));
  let framePlan = [];
  const planFrameThumbs = paths => {
    const sizes = paths.flatMap(path => boardFrames(path).hits.filter(needsThumb).map(hit => thumbData(hit.path, { video: hit.kind === 'video' })?.length ?? null));
    const room = { bytes: REVIEW_THUMB_BUDGET_BYTES - reviewThumbBytes, count: MAX_THUMBS - thumbCount };
    const fits = new Set();
    const ranked = sizes.map((size, index) => ({ size, index })).filter(item => item.size !== null).sort((x, y) => x.size - y.size || x.index - y.index);
    const order = [...ranked.filter(item => item.index === 0), ...ranked.filter(item => item.index !== 0)];
    for (const { size, index } of order) {
      if (room.count <= 0 || size > room.bytes) continue;
      room.bytes -= size;
      room.count -= 1;
      fits.add(index);
    }
    framePlan = sizes.map((_, index) => fits.has(index));
  };
  const storyboardEntry = path => {
    const { parsed, deliverable, hits } = boardFrames(path);
    const brief = briefSeconds(job, deliverable);
    const panels = parsed.panels.map((panel, index) => {
      const hit = hits[index];
      if (!hit) return panel;
      const frame = { kind: hit.kind };
      const copy = uploaded(hit.path);
      if (copy) frame.reviewUrl = copy;
      if (needsThumb(hit)) {
        const thumb = framePlan.shift() ? thumbnail(hit.path, { video: hit.kind === 'video', budget: 'review' }) : null;
        if (thumb) frame.thumb = thumb;
        else if (load(hit.path).file) {
          frame.thumbOmitted = true;
          document.truncated = true;
        }
      }
      return { ...panel, frame };
    });
    const label = placementLabel(job, parsed.ref || deliverable);
    return { path, ...parsed, ...(label ? { label } : {}), ref: parsed.ref || deliverable || null, ...(brief ? { briefSeconds: brief } : {}), panels };
  };

  if (currentReview) {
    const paths = [...reviewPaths];
    const conceptPath = paths.find(path => /(^|\/)concepts\.md$/i.test(path));
    if (conceptPath && load(conceptPath).raw != null) {
      document.review.concepts = { path: conceptPath, sha256: registered.get(conceptPath), changed: changedSince(conceptPath), ...parseConcepts(load(conceptPath).raw) };
    }
    const boards = paths.filter(path => /(^|\/)storyboard\.md$/i.test(path)).sort().slice(0, MAX_BOARDS);
    if (boards.length) {
      const readable = boards.filter(path => load(path).raw != null);
      planFrameThumbs(readable);
      document.review.storyboards = readable
        .map(path => ({ sha256: registered.get(path), changed: changedSince(path), ...storyboardEntry(path) }));
    }
    if (gate === 'sample' && review.sample && typeof review.artifacts[0]?.path === 'string') {
      const path = review.artifacts[0].path;
      const ref = mediaRef(path);
      const sample = { path, sha256: registered.get(path), changed: changedSince(path), kind: ref.kind || null };
      for (const key of ['deliverable', 'panel', 'version', 'rest']) sample[key] = review.sample[key] ?? null;
      for (const key of ['thumb', 'poster', 'durationSeconds', 'reviewUrl']) if (ref[key] != null) sample[key] = ref[key];
      document.review.sample = sample;
    }
    if (gate === 'price' && reviewPaths.has(FACT_FILES.quote)) {
      const value = json(FACT_FILES.quote);
      if (value) {
        const job = { dir };
        const made = new Set(readRecords(job).filter(record => record.type === 'create').map(record => canonicalJobKey(record.key)).filter(Boolean));
        document.review.quote = { path: FACT_FILES.quote, sha256: registered.get(FACT_FILES.quote), changed: changedSince(FACT_FILES.quote), ...parseQuote(value, { made, estimates: readEstimates(job) }) };
        if (studioWorkspace) document.review.studioWorkspace = studioWorkspace;
      }
    }
    const posts = paths.filter(path => /(^|\/)post\.md$/i.test(path)).sort().slice(0, MAX_POSTS);
    const shownMedia = new Set(document.report ? stillPaths : []);
    if (posts.length) {
      document.review.posts = posts.filter(path => load(path).raw != null).map(path => {
        const post = parsePost(load(path).raw);
        const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
        const mediaPaths = post.media.map(item => {
          const clean = item.replace(/^\.\//, '');
          return shaOf.has(clean) ? clean : base + clean;
        }).filter(item => shaOf.has(item));
        mediaPaths.forEach(item => shownMedia.add(item));
        const label = placementLabel(job, postDeliverable(path, post));
        return { path, sha256: registered.get(path), changed: changedSince(path), ...post, ...(label ? { label } : {}), media: mediaPaths.map(item => mediaRef(item)) };
      });
    }
    // Media registered for the review that no post already shows.
    document.review.media = gate === 'sample' ? [] : paths.filter(path => mediaKind(path) && !shownMedia.has(path)).map(path => mediaRef(path));
    if (gate === 'content') {
      const labelCheck = labelCheckSection(root, project, dir, rel => thumbnail(rel, { budget: 'review', scaled: true }), job, review.artifacts);
      if (labelCheck) document.review.labelCheck = labelCheck;
    }
    if (gate === 'publish' || gate === 'content') {
      const schedule = job?.schedule && typeof job.schedule === 'object' ? job.schedule : null;
      const account = typeof job?.account === 'string' ? job.account : job?.account && typeof job.account === 'object' ? job.account.handle || null : null;
      document.review.schedule = {
        publishAt: typeof schedule?.publishAt === 'string' ? clip(schedule.publishAt, 80) : null,
        timezone: typeof schedule?.timezone === 'string' ? clip(schedule.timezone, 80) : null,
        account: account ? clip(account, 120) : null,
        platforms: Array.isArray(job?.platforms) ? job.platforms.filter(item => typeof item === 'string').slice(0, 10) : [],
      };
    }
    if (gate === 'publish') {
      // The posting plan the approval covers, with its checks run again now (a time that has passed shows).
      const intent = json(PUBLISH_INTENT_PATH);
      // Files already in the plan's own workspace (uploaded there, or made there for this job) are not held to the upload size.
      const hosted = new Set();
      const planWorkspace = intent && typeof intent.studioWorkspace === 'object' && intent.studioWorkspace ? intent.studioWorkspace.id : null;
      if (planWorkspace) {
        for (const [sha, entry] of Object.entries(json(PUBLISH_HOSTED_PATH) || {})) if (entry && entry.workspaceId === planWorkspace) hosted.add(sha);
        const madeIn = new Map();
        for (const record of readRecords({ dir })) {
          const where = record.workspaceId || record.inputs?.workspaceId;
          if (record.type === 'create' && record.providerJobId && typeof where === 'string') madeIn.set(record.providerJobId, where.trim());
        }
        for (const entry of readLanded({ dir })) {
          if (entry.type !== 'landed' || entry.provider !== 'threeEcho' || entry.converted || madeIn.get(entry.providerJobId) !== planWorkspace) continue;
          for (const sha of [entry.sha256, entry.promotedSha256]) if (typeof sha === 'string') hosted.add(sha);
        }
      }
      // `changed`: the plan on disk is no longer the one this decision was registered with.
      const changed = registered.has(PUBLISH_INTENT_PATH) ? changedSince(PUBLISH_INTENT_PATH) : false;
      // A post whose deliverable has no post type (a job planned before 0.8) carries the types it can still be.
      const typeChoices = postTypeChoices(intent?.posts, job?.deliverables);
      document.review.publish = projectPublish(intent && typeof intent === 'object' ? intent : { posts: [] }, { ...(publish || {}), now, changed, hosted, typeChoices });
      if (studioWorkspace) document.review.studioWorkspace = studioWorkspace;
    }
  }

  if (!(currentReview && document.review.storyboards?.length)) {
    const boards = artifacts.map(item => item.path).filter(path => /^drafts\/D\d+\/storyboard\.md$/i.test(path)).sort().slice(0, MAX_BOARDS).filter(path => load(path).raw != null);
    if (boards.length) {
      planFrameThumbs(boards);
      document.storyboards = boards.map(storyboardEntry);
    }
  }

  const pinned = [];
  const pinnedPaths = new Set();
  for (const postPath of artifacts.map(item => item.path).filter(path => /^drafts\/D\d+\/post\.md$/i.test(path)).sort().slice(0, MAX_POSTS)) {
    const raw = load(postPath).raw;
    if (raw == null) continue;
    const post = parsePost(raw);
    const base = postPath.slice(0, postPath.lastIndexOf('/') + 1);
    const media = post.media.map(item => {
      const clean = item.replace(/^\.\//, '');
      return shaOf.has(clean) ? clean : base + clean;
    }).filter(path => shaOf.has(path) && mediaKind(path) && !pinnedPaths.has(path));
    const ref = postDeliverable(postPath, post);
    const titles = postOutputTitles(post, placementLabel(job, ref), media);
    media.forEach((path, index) => {
      pinnedPaths.add(path);
      pinned.push({ path, deliverable: ref, title: titles[index] });
    });
  }
  for (const manifest of manifests) {
    const output = manifest.stitch?.output;
    if (typeof output !== 'string' || !shaOf.has(output) || pinnedPaths.has(output) || !mediaKind(output)) continue;
    pinnedPaths.add(output);
    pinned.push({ path: output, deliverable: canonicalDeliverable(manifest.deliverable), title: outputTitle(null, mediaKind(output), 0, 1) });
  }
  if (pinned.length) document.outputs = { pinned };

  // The Agent Box goes in before the file list, so the files fill what is left of the budget. A file with a heading shows it as its title.
  if (agents) {
    const titles = new Map();
    for (const item of Array.isArray(details?.artifacts) ? details.artifacts : []) {
      if (typeof item?.path !== 'string' || extname(item.path).toLowerCase() !== '.md') continue;
      const { raw } = load(item.path);
      if (raw == null) continue;
      const title = titleOf(item.path, splitFrontMatter(raw).body);
      if (title !== basename(item.path)) titles.set(item.path, title);
    }
    try {
      document.agents = agentBox({ ...agents, dir, details, inbox: document.inbox, now, pinned, titles });
    } catch { /* the board still shows the job without its agents */ }
  }

  // Add file entries in priority order while the document stays under budget.
  // An entry that no longer fits is kept as metadata only, flagged omitted, so
  // the board can still say the content is on this computer.
  const order = artifacts.map(item => item.path)
    .sort((a, b) => priorityOf(a, reviewPaths, strategy, research) - priorityOf(b, reviewPaths, strategy, research) || a.localeCompare(b));
  const margin = 256;
  let size = byteSize(document);
  for (const path of order) {
    const ext = extname(path).toLowerCase();
    // Internal bookkeeping: generation manifests, task contracts, plans,
    // checkpoints and other JSON stay off the board entirely. A storyboard's
    // or the price gate's JSON is parsed into panels or itemised rows above;
    // nothing needs the raw file, so it never becomes a file entry to dump.
    if (ext === '.json') continue;
    const { raw, sha256 } = load(path);
    const entry = { path, sha256: shaOf.get(path) || null, kind: kindOf.get(path) || null, title: basename(path) };
    const mimeType = MEDIA_TYPES[ext] || { '.md': 'text/markdown', '.csv': 'text/csv', '.txt': 'text/plain' }[ext] || null;
    if (mimeType) entry.mimeType = mimeType;
    if (sha256 && entry.sha256 && sha256 !== entry.sha256) entry.changed = true;
    if (raw != null) {
      const { body } = ext === '.md' ? splitFrontMatter(raw) : { body: raw };
      if (ext === '.md') entry.title = titleOf(path, body);
      if (!(document.report && path === REPORT_PATH)) {
        const limit = research.includes(path) ? JOB_DOCUMENT_RESEARCH_TEXT_LIMIT : JOB_DOCUMENT_TEXT_LIMIT;
        const text = body.trim();
        entry.text = text.length > limit ? text.slice(0, limit) : text;
        if (text.length > limit) entry.truncated = true;
      }
    }
    const kind = mediaKind(path);
    if (kind) {
      const allowThumb = (reviewPaths.has(path) || /^(media|drafts)\//i.test(path)) && !(document.report && stillSet.has(path));
      const ref = allowThumb ? mediaRef(path, { budget: null }) : { reviewUrl: uploaded(path) };
      for (const key of ['thumb', 'poster', 'posterPath', 'durationSeconds', 'reviewUrl']) if (ref[key] != null) entry[key] = ref[key];
    }
    const made = generationInfo(generation, path);
    if (made) Object.assign(entry, made);
    let cost = byteSize(entry) + 1;
    for (const key of ['thumb', 'poster']) {
      if (size + cost > budgetBytes - margin && entry[key]) { delete entry[key]; cost = byteSize(entry) + 1; }
    }
    if (size + cost > budgetBytes - margin && entry.text) {
      const fixed = byteSize({ ...entry, text: '', truncated: true }) + 1;
      let keep = Math.floor((budgetBytes - margin - size - fixed) / 2);
      while (keep > 1000 && size + fixed + byteSize(entry.text.slice(0, keep)) > budgetBytes - margin) keep = Math.floor(keep * 0.8);
      if (keep > 1000) { entry.text = entry.text.slice(0, keep); entry.truncated = true; }
      else { delete entry.text; delete entry.truncated; entry.omitted = true; }
      cost = byteSize(entry) + 1;
    }
    if (size + cost > budgetBytes - margin) { document.truncated = true; continue; }
    if (entry.truncated || entry.omitted) document.truncated = true;
    document.files.push(entry);
    size += cost;
  }
  for (const [entry, preview] of kitPreviews) {
    const cost = byteSize({ preview }) + 1;
    if (size + cost > budgetBytes - margin) continue;
    entry.preview = preview;
    size += cost;
  }
  // Only pathological input makes the parsed review itself too large: shed the
  // file contents, then the review thumbnails, then the parsed structures,
  // rather than exceed the budget.
  if (byteSize(document) > budgetBytes && kitPreviews.length) for (const [entry] of kitPreviews) delete entry.preview;
  if (byteSize(document) > budgetBytes) {
    document.truncated = true;
    document.files = document.files.map(({ path, sha256, title, mimeType, kind }) => ({ path, sha256, title, mimeType, kind, omitted: true }));
  }
  if (byteSize(document) > budgetBytes && document.storyboards) {
    document.truncated = true;
    delete document.storyboards;
  }
  if (byteSize(document) > budgetBytes && document.details?.usageStages.length) {
    document.truncated = true;
    document.details.usageStages = [];
    document.details.usageStagesDropped = true;
  }
  if (byteSize(document) > budgetBytes && document.review) {
    const strip = ref => { delete ref.thumb; delete ref.poster; };
    (document.review.media || []).forEach(strip);
    (document.review.posts || []).forEach(post => post.media.forEach(strip));
    (document.review.storyboards || []).forEach(board => board.panels.forEach(panel => {
      if (!panel.frame) return;
      if (panel.frame.thumb) {
        panel.frame.thumbOmitted = true;
        document.truncated = true;
      }
      strip(panel.frame);
    }));
    (document.review.labelCheck?.flags || []).forEach(flag => { delete flag.still; });
  }
  if (byteSize(document) > budgetBytes && document.report?.stills.some(still => still.thumb)) {
    document.truncated = true;
    document.report.stills.forEach(still => { delete still.thumb; });
  }
  if (byteSize(document) > budgetBytes && document.review) {
    for (const key of ['studioWorkspace', 'posts', 'storyboards', 'concepts', 'quote', 'media', 'sample', 'labelCheck', 'publish']) {
      delete document.review[key];
      if (byteSize(document) <= budgetBytes) break;
    }
  }
  if (byteSize(document) > budgetBytes && document.report?.stills.length) {
    document.truncated = true;
    document.report.stillsOmitted = (document.report.stillsOmitted || 0) + document.report.stills.length;
    document.report.stills = [];
  }
  if (byteSize(document) > budgetBytes && document.report?.text.length > REPORT_TRIMMED_TEXT) {
    document.truncated = true;
    document.report.text = document.report.text.slice(0, REPORT_TRIMMED_TEXT);
    document.report.truncated = true;
  }
  if (byteSize(document) > budgetBytes && document.recipes) {
    document.truncated = true;
    delete document.recipes;
    delete document.recipeCatalog;
  }
  if (byteSize(document) > budgetBytes && document.postingKit) {
    document.truncated = true;
    delete document.postingKit;
  }
  if (byteSize(document) > budgetBytes && document.agents) {
    document.truncated = true;
    document.agents = coreOnlyAgentBox(document.agents);
  }
  if (byteSize(document) > budgetBytes) document.files = [];
  if (byteSize(document) > budgetBytes && document.details?.artifacts.length) {
    document.truncated = true;
    document.details.artifactsOmitted = (document.details.artifactsOmitted || 0) + document.details.artifacts.length;
    document.details.artifacts = [];
  }
  return document;
}

