/**
 * Brand intelligence: what onboarding learns about a brand's niche and how every later job uses it.
 *
 *   workspaces/<brand>/library/intelligence/
 *     posts.jsonl         every post that was taken apart, one line each (the last line of an id wins):
 *                         { id, pillar: own|competitor|viral, competitor?, platform, url, thumbnail?, caption, hook?, views?, likes?, date,
 *                           seenAt, outlierRatio?, labels: { format, editing, visualHook, series?, subtopic }, breakdown, transcriptExcerpt?,
 *                           runId?, removed? }
 *                         labels hold a format library id (pipeline/library/formats.json, format-library.mjs) or { custom: "text" }.
 *     subtopics.json      { status: draft|confirmed, items: [{ id, name, evidence: [postId], topViews, postCount, source: data|yours }],
 *                           updatedAt, confirmedAt? } - exactly 6 when confirmed (the person adds, edits and removes; at most 8 while editing)
 *     formats-rank.json   { updatedAt, formats: [{ id, name, posts, topViews, evidence: [postId], pillars, resultScore?, uses?, label? }] }
 *                         the brand's best formats, with the posts that show them and, once jobs have results, their score
 *     plan.json           { updatedAt, subtopics: [id x6], formats: [id x5], cells: [{ subtopic, format, idea, angle?, hook? }] } - the 6 by 5 grid
 *     plan-draft.json     the strategist writes this; savePlan checks it and writes plan.json
 *     progress.json       { status: running|ready, updatedAt, newBrand?, steps: [{ id, label, state: done|running|todo, detail? }] }
 *                         the onboarding checklist the board shows while the pass runs
 *
 * Where it comes from: the onboarding save (brand-research.mjs) files the posts the researcher took apart (fileIntelligence); the Director
 * writes the checklist, the subtopic draft and the plan check through the brand_intelligence_save tool; the person confirms the six
 * subtopics on the board (the `subtopics_confirm` request, board.mjs); the strategist writes plan-draft.json.
 *
 * Where it goes: the board document (`brand.intelligence`, boardIntelligence), the Strategy gate's Subtopic row (subtopicOptions), the
 * library block of every agent brief (intelligenceLines), and `plan_cell_start` (planCell), which starts a post job from a cell of the grid.
 *
 * brand-library.mjs, brand-results.mjs and brand-trends.mjs import this file or are imported by it; every use of them below is inside a
 * function, never at load time. Nothing in here throws on a store that cannot be read: it reads as an empty one.
 */

import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { InvalidInputError } from '../lib/errors.mjs';
import { appendLines, readJson, readLines, writeJsonAtomic } from '../lib/jsonl.mjs';
import { bankKindCounts, brandLibraryDir, readBank, readProven } from './brand-library.mjs';
import { rankBank } from './brand-results.mjs';
import { saveTrends } from './brand-trends.mjs';
import { AXES, axisEntries, cleanLabel, findEntry, labelId, labelName, mapLegacyFormat } from './format-library.mjs';
import * as runtime from './runtime.mjs';

export const SUBTOPIC_COUNT = 6;
export const SUBTOPICS_EDITING_MAX = 8;
export const PLAN_FORMATS = 5;
export const PILLARS = Object.freeze(['own', 'competitor', 'viral']);
const PILLAR_OF = Object.freeze({ brand: 'own', competitor: 'competitor', viral: 'viral' });
const SUBTOPIC_NAME_MAX = 80;
const IDEA_MAX = 300;
const NOTE_MAX = 200;
/** A checklist that says it is running but has not been touched for this long is a pass that died; the board shows what there is as ready. */
const RUNNING_STALE_MS = 3 * 60 * 60 * 1000;

/** The most the board document carries. */
export const BOARD_LIMITS = Object.freeze({ own: 10, competitors: 4, perCompetitor: 6, viral: 8, title: 160 });

const plain = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (value, limit) => {
  const text = plain(value);
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isoOf = now => {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
};
const stable = value => JSON.stringify(value, (_key, item) => (isObject(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item));
const hash = value => createHash('sha1').update(String(value)).digest('hex');

// ---------------------------------------------------------------- the folder
export function intelligenceDir(root, brand) {
  return join(brandLibraryDir(root, brand), 'intelligence');
}
const file = (root, brand, name) => join(intelligenceDir(root, brand), name);

function requireBrand(root, brand) {
  const dir = brandLibraryDir(root, brand);
  if (!existsSync(join(dir, '..', 'workspace.json'))) throw new InvalidInputError('That brand could not be found.', { fix: 'Use the brand slug from pipeline_status.' });
}

// ---------------------------------------------------------------- posts
/** A post's id: stable for its link, so the same post filed twice is one post. */
export function postId(url) {
  const key = String(url ?? '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return `ip-${hash(key).slice(0, 10)}`;
}

const viewsOf = post => (Number.isFinite(post.views) ? post.views : Number.isFinite(post.likes) ? post.likes : -1);
const byTraction = (a, b) => viewsOf(b) - viewsOf(a) || String(b.date ?? '').localeCompare(String(a.date ?? ''));

function cleanPostLine(line) {
  if (!isObject(line) || typeof line.id !== 'string' || !line.id || !PILLARS.includes(line.pillar)) return null;
  const url = runtime.webLink(line.url);
  if (!url) return null;
  return {
    id: line.id, pillar: line.pillar, ...(line.competitor ? { competitor: clip(line.competitor, 80) } : {}),
    platform: clip(line.platform, 20).toLowerCase(), url, ...(typeof line.thumbnail === 'string' && line.thumbnail ? { thumbnail: line.thumbnail } : {}),
    caption: clip(line.caption, 600), ...(line.hook ? { hook: clip(line.hook, 300) } : {}),
    ...(Number.isFinite(line.views) ? { views: line.views } : {}), ...(Number.isFinite(line.likes) ? { likes: line.likes } : {}),
    date: typeof line.date === 'string' ? line.date : null, seenAt: line.seenAt ?? null,
    ...(Number.isFinite(line.outlierRatio) ? { outlierRatio: line.outlierRatio } : {}),
    labels: isObject(line.labels) ? line.labels : {}, ...(isObject(line.breakdown) ? { breakdown: line.breakdown } : {}),
    ...(line.transcriptExcerpt ? { transcriptExcerpt: clip(line.transcriptExcerpt, 600) } : {}),
    ...(line.runId ? { runId: String(line.runId) } : {}), ...(line.removed === true ? { removed: true } : {}),
  };
}

/** The posts that were taken apart, one per id (the last line wins), best first. Removed posts are left out unless asked for. */
export function readPosts({ root, brand, includeRemoved = false } = {}) {
  const byId = new Map();
  for (const line of readLines(file(root, brand, 'posts.jsonl'))) if (typeof line.id === 'string' && line.id) byId.set(line.id, line);
  return [...byId.values()].map(cleanPostLine).filter(post => post && (includeRemoved || !post.removed)).sort(byTraction);
}

function recordOfPost(post, { runId, now }) {
  const breakdown = isObject(post.breakdown) ? post.breakdown : {};
  const { labels, transcriptExcerpt, ...seen } = breakdown;
  const hook = breakdown.spokenHook || breakdown.onScreenHook || '';
  return {
    id: postId(post.url), pillar: PILLAR_OF[post.source], ...(post.source === 'competitor' && post.competitor ? { competitor: post.competitor } : {}),
    platform: post.platform, url: post.url, ...(post.thumbnail ? { thumbnail: post.thumbnail } : {}),
    caption: post.caption || (hook && post.text !== hook ? post.text : '') || post.text || '', ...(hook ? { hook } : {}),
    ...(Number.isFinite(post.views) ? { views: post.views } : {}), ...(Number.isFinite(post.likes) ? { likes: post.likes } : {}),
    date: post.date, seenAt: isoOf(now), ...(Number.isFinite(post.outlierRatio) ? { outlierRatio: post.outlierRatio } : {}),
    labels: isObject(labels) ? labels : {}, breakdown: seen, ...(transcriptExcerpt ? { transcriptExcerpt } : {}),
    ...(runId ? { runId } : {}),
  };
}

/**
 * File the posts an onboarding run took apart (the checked topPosts that carry a breakdown). The same post again changes nothing; a post
 * taken apart again gets its new labels. A viral post is also saved as a trend (a format that is rising). Returns { saved, existing, trends? }.
 */
export function filePosts({ root, brand, posts, runId = null, now } = {}) {
  requireBrand(root, brand);
  const target = file(root, brand, 'posts.jsonl');
  const known = new Map();
  for (const line of readLines(target)) if (typeof line.id === 'string') known.set(line.id, line);
  const lines = [];
  let existing = 0;
  for (const post of Array.isArray(posts) ? posts : []) {
    if (!post || !post.breakdown || !PILLAR_OF[post.source]) continue;
    const record = recordOfPost(post, { runId, now });
    const same = known.get(record.id);
    if (same && stable({ ...same, seenAt: null, runId: null, removed: null }) === stable({ ...record, seenAt: null, runId: null, removed: null }) && !same.removed) { existing += 1; continue; }
    lines.push(record);
    known.set(record.id, record);
  }
  appendLines(target, lines);
  return { saved: lines.length, existing };
}

/** The viral posts that were taken apart, saved as trends the library already reuses for a week: the format and how it is edited, with the post as proof. */
export function fileViralTrends({ root, brand, posts, now } = {}) {
  const items = [];
  for (const post of Array.isArray(posts) ? posts : []) {
    if (!post || post.source !== 'viral' || !post.breakdown) continue;
    const labels = isObject(post.breakdown.labels) ? post.breakdown.labels : {};
    const format = labels.format ? labelName(labels.format) : plain(post.breakdown.format);
    const editing = labels.editing ? labelName(labels.editing) : '';
    if (!format) continue;
    const hook = post.breakdown.spokenHook || post.breakdown.onScreenHook || post.text;
    items.push({
      kind: 'format', text: clip(editing ? `${format}, ${editing.toLowerCase()}` : format, 300), platform: post.platform,
      evidence: [{ url: post.url, views: Number.isFinite(post.views) ? post.views : undefined, date: post.date, ...(post.thumbnail ? { thumbnail: post.thumbnail } : {}) }],
      ...(hook ? { why: clip(`Viral in the niche now. It opens: "${hook}"`, 380) } : {}),
    });
  }
  if (!items.length) return { saved: 0 };
  try { return { saved: saveTrends({ root, brand, items: items.slice(0, 10), now }).saved.length }; } catch { return { saved: 0 }; }
}

/**
 * Everything the onboarding save files for the intelligence: the posts, the viral trends and the formats ranking. Never throws a problem the
 * caller must handle: it returns { posts: { saved, existing }, trends?, formats }.
 */
export function fileIntelligence({ root, brand, posts, runId = null, now } = {}) {
  requireBrand(root, brand);
  writeJsonAtomic(file(root, brand, 'built.json'), { builtAt: isoOf(now), ...(runId ? { runId } : {}) });
  const filed = filePosts({ root, brand, posts, runId, now });
  const trends = fileViralTrends({ root, brand, posts, now });
  let formats = 0;
  try { formats = writeFormatsRank({ root, brand, now }).formats.length; } catch { formats = 0; }
  return { posts: filed, ...(trends.saved ? { trends: trends.saved } : {}), formats };
}

// ---------------------------------------------------------------- subtopics
const subtopicId = name => `st-${hash(plain(name).toLowerCase()).slice(0, 8)}`;
const nameKey = value => plain(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The six subtopics, or null when there are none yet: { status: draft|confirmed, items, updatedAt, confirmedAt? }. */
export function readSubtopics({ root, brand } = {}) {
  const raw = readJson(file(root, brand, 'subtopics.json'), null);
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  const items = raw.items.filter(item => isObject(item) && typeof item.id === 'string' && plain(item.name)).map(item => ({
    id: item.id, name: clip(item.name, SUBTOPIC_NAME_MAX), evidence: (Array.isArray(item.evidence) ? item.evidence : []).filter(id => typeof id === 'string'),
    topViews: Number.isFinite(item.topViews) ? item.topViews : null, postCount: Number.isFinite(item.postCount) ? item.postCount : 0,
    source: item.source === 'yours' ? 'yours' : 'data',
  }));
  if (!items.length) return null;
  return { status: raw.status === 'confirmed' ? 'confirmed' : 'draft', items, updatedAt: raw.updatedAt ?? null, ...(raw.confirmedAt ? { confirmedAt: raw.confirmedAt } : {}) };
}

/** What a subtopic's evidence shows: how many of its posts exist and the most views among them. */
function evidenceStats(evidence, posts) {
  const byId = new Map(posts.map(post => [post.id, post]));
  const found = evidence.map(id => byId.get(id)).filter(Boolean);
  const views = found.map(viewsOf).filter(value => value >= 0);
  return { evidence: found.map(post => post.id), postCount: found.length, topViews: views.length ? Math.max(...views) : null };
}

const uniqueId = (name, taken) => {
  let id = subtopicId(name);
  for (let n = 2; taken.has(id); n += 1) id = subtopicId(`${name} ${n}`);
  taken.add(id);
  return id;
};

/**
 * Write the draft of the subtopics: [{ name, evidence?: [postId], source? }]. The posts named as evidence give each its post count and top views.
 * A confirmed set is kept (the person's six are never replaced by a later run) unless `replace` is true. Returns { status, items, kept? }.
 */
export function saveSubtopicsDraft({ root, brand, items, replace = false, now } = {}) {
  requireBrand(root, brand);
  const current = readSubtopics({ root, brand });
  if (current?.status === 'confirmed' && replace !== true) return { status: 'confirmed', items: current.items, kept: true };
  if (!Array.isArray(items) || !items.length) throw new InvalidInputError('Pass the subtopics: [{ name, evidence: [post ids] }].', { fix: 'Cluster the topics of the posts in posts.jsonl into 6 subtopics, most viewed first.' });
  if (items.length > SUBTOPICS_EDITING_MAX) throw new InvalidInputError(`Keep at most ${SUBTOPICS_EDITING_MAX} subtopics (the draft should have ${SUBTOPIC_COUNT}).`);
  const posts = readPosts({ root, brand });
  const taken = new Set();
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const name = clip(item?.name, SUBTOPIC_NAME_MAX);
    if (!name) throw new InvalidInputError('Every subtopic needs a name of a few words.');
    if (seen.has(nameKey(name))) throw new InvalidInputError(`"${name}" is listed twice.`);
    seen.add(nameKey(name));
    const stats = evidenceStats(Array.isArray(item.evidence) ? item.evidence : [], posts);
    out.push({ id: uniqueId(name, taken), name, ...stats, source: item.source === 'yours' ? 'yours' : 'data' });
  }
  out.sort((a, b) => (b.topViews ?? -1) - (a.topViews ?? -1));
  const doc = { status: 'draft', items: out, updatedAt: isoOf(now) };
  writeJsonAtomic(file(root, brand, 'subtopics.json'), doc);
  return { status: 'draft', items: out };
}

/**
 * The person's answer on the board: the six subtopics as they now stand, [{ id?, name }]. An id that is in the draft keeps its evidence; a name
 * with no id is one the person added (source yours). Exactly six, no name twice. The plan drops the cells of a subtopic that is gone.
 * Returns { status: 'confirmed', items, planStale }.
 */
export function confirmSubtopics({ root, brand, items, now } = {}) {
  requireBrand(root, brand);
  if (!Array.isArray(items) || items.length !== SUBTOPIC_COUNT) throw new InvalidInputError(`Keep exactly ${SUBTOPIC_COUNT} subtopics: ${Array.isArray(items) ? `there are ${items.length}` : 'none were sent'}.`);
  const current = readSubtopics({ root, brand });
  const posts = readPosts({ root, brand });
  const byId = new Map((current?.items ?? []).map(item => [item.id, item]));
  const taken = new Set();
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const name = clip(item?.name, SUBTOPIC_NAME_MAX);
    if (!name) throw new InvalidInputError('Every subtopic needs a name.');
    if (seen.has(nameKey(name))) throw new InvalidInputError(`"${name}" is listed twice.`);
    seen.add(nameKey(name));
    const before = typeof item.id === 'string' ? byId.get(item.id) : null;
    if (before) {
      taken.add(before.id);
      const stats = evidenceStats(before.evidence, posts);
      out.push({ id: before.id, name, ...stats, source: before.source });
    } else {
      out.push({ id: null, name, evidence: [], postCount: 0, topViews: null, source: 'yours' });
    }
  }
  for (const item of out) if (!item.id) item.id = uniqueId(item.name, taken);
  const stamp = isoOf(now);
  writeJsonAtomic(file(root, brand, 'subtopics.json'), { status: 'confirmed', items: out, updatedAt: stamp, confirmedAt: stamp });
  // The plan keeps the cells of the subtopics that stand; a new subtopic has none until the strategist plans it.
  const plan = readJson(file(root, brand, 'plan.json'), null);
  let planStale = false;
  if (isObject(plan) && Array.isArray(plan.subtopics)) {
    const keep = new Set(out.map(item => item.id));
    const subtopics = plan.subtopics.filter(id => keep.has(id));
    const cells = (Array.isArray(plan.cells) ? plan.cells : []).filter(cell => keep.has(cell?.subtopic));
    planStale = subtopics.length !== out.length;
    writeJsonAtomic(file(root, brand, 'plan.json'), { ...plan, subtopics, cells, updatedAt: stamp });
  }
  return { status: 'confirmed', items: out, planStale };
}

// ---------------------------------------------------------------- formats ranking
/** The brand's formats, best first, with the posts that show them and what jobs using them earned. */
export function rankFormats({ root, brand } = {}) {
  const posts = readPosts({ root, brand });
  const groups = new Map();
  for (const post of posts) {
    const id = labelId(post.labels?.format);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, { id, name: findEntry(id)?.name ?? id, posts: 0, topViews: null, evidence: [], pillars: { own: 0, competitor: 0, viral: 0 } });
    const group = groups.get(id);
    group.posts += 1;
    group.pillars[post.pillar] += 1;
    if (group.evidence.length < 5) group.evidence.push(post.id);
    const views = viewsOf(post);
    if (views >= 0 && (group.topViews === null || views > group.topViews)) group.topViews = views;
  }
  let results = [];
  try { results = rankBank({ root, brand }).dimensions?.format ?? []; } catch { results = []; }
  for (const stat of results) {
    const id = typeof stat.key === 'string' && findEntry(stat.key)?.axis === 'format' ? stat.key : null;
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, { id, name: findEntry(id).name, posts: 0, topViews: null, evidence: [], pillars: { own: 0, competitor: 0, viral: 0 } });
    Object.assign(groups.get(id), { ...(Number.isFinite(stat.score) ? { resultScore: stat.score } : {}), uses: stat.uses, ...(stat.label ? { label: stat.label } : {}) });
  }
  const tier = row => (row.label === 'winner' ? 0 : row.label === 'weak' ? 2 : 1);
  return [...groups.values()].sort((a, b) => tier(a) - tier(b) || (b.topViews ?? -1) - (a.topViews ?? -1) || b.posts - a.posts || a.id.localeCompare(b.id));
}

/** Rewrite formats-rank.json from the posts and the results. Quiet on a store it cannot write: returns what it computed. */
export function writeFormatsRank({ root, brand, now } = {}) {
  const doc = { updatedAt: isoOf(now), formats: rankFormats({ root, brand }) };
  if (doc.formats.length) writeJsonAtomic(file(root, brand, 'formats-rank.json'), doc);
  return doc;
}

/** formats-rank.json refreshed after something changed (a job filed, results read). Never throws. */
export function refreshFormatsRankQuietly(options) {
  try {
    if (!existsSync(intelligenceDir(options.root, options.brand))) return null;
    return writeFormatsRank(options);
  } catch { return null; }
}

// ---------------------------------------------------------------- the plan
/** The plan: { updatedAt, subtopics, formats, cells, stale? }, or null. stale is true when the confirmed subtopics are not the ones it was made for. */
export function readPlan({ root, brand } = {}) {
  const raw = readJson(file(root, brand, 'plan.json'), null);
  if (!isObject(raw) || !Array.isArray(raw.cells)) return null;
  const subtopics = (Array.isArray(raw.subtopics) ? raw.subtopics : []).filter(id => typeof id === 'string');
  const formats = (Array.isArray(raw.formats) ? raw.formats : []).filter(id => typeof id === 'string');
  const cells = raw.cells.filter(cell => isObject(cell) && typeof cell.subtopic === 'string' && typeof cell.format === 'string' && plain(cell.idea)).map(cell => ({
    subtopic: cell.subtopic, format: cell.format, idea: clip(cell.idea, IDEA_MAX),
    ...(plain(cell.angle) ? { angle: clip(cell.angle, NOTE_MAX) } : {}), ...(plain(cell.hook) ? { hook: clip(cell.hook, NOTE_MAX) } : {}),
  }));
  if (!cells.length) return null;
  const subs = readSubtopics({ root, brand });
  const stale = Boolean(subs) && (subs.items.length !== subtopics.length || subs.items.some(item => !subtopics.includes(item.id)));
  return { updatedAt: raw.updatedAt ?? null, subtopics, formats, cells, ...(stale ? { stale: true } : {}) };
}

/**
 * Check the strategist's plan and file it. The plan is `plan` when given, else plan-draft.json beside it:
 * { subtopics: [id], formats: [id x5], cells: [{ subtopic, format, idea, angle?, hook? }] }, one cell for each subtopic and format.
 * Returns { status: 'saved', plan } or { status: 'needs_changes', problems: [text] } (nothing is written).
 */
export function savePlan({ root, brand, plan = null, now } = {}) {
  requireBrand(root, brand);
  const draftFile = file(root, brand, 'plan-draft.json');
  const given = isObject(plan) ? plan : readJson(draftFile, null);
  if (!isObject(given)) return { status: 'needs_changes', problems: ['There is no plan to check: write plan-draft.json in the intelligence folder first.'] };
  const problems = [];
  const subs = readSubtopics({ root, brand });
  if (!subs) return { status: 'needs_changes', problems: ['The subtopics are not saved yet, so there is nothing to plan across. Save the subtopic draft first.'] };
  const known = new Set(subs.items.map(item => item.id));
  const subtopics = Array.isArray(given.subtopics) ? [...new Set(given.subtopics)] : [];
  if (!subtopics.length) problems.push('subtopics must list the subtopic ids the plan covers.');
  for (const id of subtopics) if (!known.has(id)) problems.push(`subtopics: ${String(id)} is not one of the brand's subtopics (${[...known].join(', ')}).`);
  if (subtopics.length && subtopics.length !== Math.min(SUBTOPIC_COUNT, known.size)) problems.push(`subtopics must cover all ${Math.min(SUBTOPIC_COUNT, known.size)} subtopics (it lists ${subtopics.length}).`);
  const formats = Array.isArray(given.formats) ? [...new Set(given.formats)] : [];
  if (formats.length !== PLAN_FORMATS) problems.push(`formats must list ${PLAN_FORMATS} different format ids (it lists ${formats.length}).`);
  for (const id of formats) if (findEntry(id)?.axis !== 'format') problems.push(`formats: ${String(id)} is not a format in the library (pipeline/library/formats.json, axis format).`);
  const cells = [];
  const placed = new Set();
  (Array.isArray(given.cells) ? given.cells : []).forEach((cell, index) => {
    const where = `cells[${index}]`;
    if (!isObject(cell)) { problems.push(`${where} must be an object.`); return; }
    if (!subtopics.includes(cell.subtopic)) { problems.push(`${where}.subtopic ${String(cell.subtopic)} is not in subtopics.`); return; }
    if (!formats.includes(cell.format)) { problems.push(`${where}.format ${String(cell.format)} is not in formats.`); return; }
    const idea = plain(cell.idea);
    if (idea.length < 8 || idea.length > IDEA_MAX) { problems.push(`${where}.idea must be a post idea of 8 to ${IDEA_MAX} characters (${cell.subtopic} / ${cell.format}).`); return; }
    const key = `${cell.subtopic}|${cell.format}`;
    if (placed.has(key)) { problems.push(`${where} repeats ${cell.subtopic} / ${cell.format}.`); return; }
    placed.add(key);
    cells.push({ subtopic: cell.subtopic, format: cell.format, idea, ...(plain(cell.angle) ? { angle: clip(cell.angle, NOTE_MAX) } : {}), ...(plain(cell.hook) ? { hook: clip(cell.hook, NOTE_MAX) } : {}) });
  });
  for (const subtopic of subtopics) for (const format of formats) if (!placed.has(`${subtopic}|${format}`)) problems.push(`The cell ${subtopic} / ${format} has no idea.`);
  if (problems.length) return { status: 'needs_changes', problems: problems.slice(0, 20) };
  const doc = { updatedAt: isoOf(now), subtopics, formats, cells };
  writeJsonAtomic(file(root, brand, 'plan.json'), doc);
  try { rmSync(draftFile, { force: true }); } catch { /* a draft that stays is overwritten next time */ }
  return { status: 'saved', plan: doc };
}

/**
 * The cell of the plan a board click names, with the picks a job starts from. `subtopic` is the subtopic's id (or its name) and `format` the
 * format's library id. Throws a plain sentence when the cell is not there.
 */
export function planCell({ root, brand, subtopic, format } = {}) {
  const subs = readSubtopics({ root, brand });
  const item = subs?.items.find(entry => entry.id === subtopic || nameKey(entry.name) === nameKey(subtopic));
  if (!item) throw new Error('That subtopic is not one of this brand\'s subtopics.');
  const formatEntry = findEntry(typeof format === 'string' ? format : '');
  if (!formatEntry || formatEntry.axis !== 'format') throw new Error('That format is not in the format library.');
  const plan = readPlan({ root, brand });
  const cell = plan?.cells.find(entry => entry.subtopic === item.id && entry.format === formatEntry.id) ?? null;
  const posts = readPosts({ root, brand }).filter(post => labelId(post.labels?.format) === formatEntry.id).slice(0, 3);
  return {
    subtopic: { id: item.id, name: item.name }, format: { id: formatEntry.id, name: formatEntry.name },
    idea: cell?.idea ?? null, angle: cell?.angle ?? null, hook: cell?.hook ?? null,
    examples: posts.map(post => ({ url: post.url, platform: post.platform, ...(Number.isFinite(post.views) ? { views: post.views } : Number.isFinite(post.likes) ? { likes: post.likes } : {}), pillar: post.pillar })),
  };
}

// ---------------------------------------------------------------- progress
/** The onboarding checklist as the Director fills it in: the steps in order, each with the words the person reads. */
export const STEP_DEFAULTS = Object.freeze([
  ['website', 'Read your website: offer, audience and proof points'],
  ['accounts', 'Read your accounts and your competitors\' accounts'],
  ['own_top', 'Find your top posts'],
  ['own_teardown', 'Take apart your top 5 videos: hook, script, format, editing and visual hook'],
  ['competitors', 'Find your top 3 competitors'],
  ['rivals_teardown', 'Take apart their top 2 videos each'],
  ['viral', 'Find what is viral in your niche now'],
  ['pains', 'Pain points: comments, forums, reviews and competitor ads'],
  ['subtopics', 'Choose six subtopics for your niche'],
  ['plan', 'Build your 6 by 5 plan'],
  ['files', 'Write your brand files and fill your brand library'],
]);
const STEP_STATES = Object.freeze(['done', 'running', 'todo']);

function cleanStep(raw, fallbackLabel) {
  const id = plain(raw?.id).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 40);
  const label = clip(raw?.label || fallbackLabel, 160);
  if (!id || !label) return null;
  const state = STEP_STATES.includes(raw?.state) ? raw.state : 'todo';
  const detail = clip(raw?.detail, 200);
  return { id, label, state, ...(detail ? { detail } : {}) };
}

/** The checklist: { status, updatedAt, newBrand?, steps }, or null when none was written. */
export function readProgress({ root, brand } = {}) {
  const raw = readJson(file(root, brand, 'progress.json'), null);
  if (!isObject(raw) || !Array.isArray(raw.steps)) return null;
  return {
    status: raw.status === 'ready' ? 'ready' : 'running', updatedAt: raw.updatedAt ?? null, ...(raw.newBrand === true ? { newBrand: true } : {}),
    steps: raw.steps.map(step => cleanStep(step)).filter(Boolean),
  };
}

/**
 * Update the checklist. `steps` replaces the list ([{ id, label?, state, detail? }]; a known id needs no label); `step` changes one step and
 * adds it when it is new. `status` is running or ready (it becomes ready by itself when every step is done); `newBrand` says the brand has no
 * posts of its own. A first call with neither list gives the default checklist, every step still to do. Returns the checklist.
 */
export function writeProgress({ root, brand, status = null, steps = null, step = null, newBrand = undefined, now } = {}) {
  requireBrand(root, brand);
  const current = readProgress({ root, brand });
  const labelOf = id => STEP_DEFAULTS.find(([key]) => key === id)?.[1] ?? null;
  let list = current ? current.steps : STEP_DEFAULTS.map(([id, label]) => ({ id, label, state: 'todo' }));
  if (Array.isArray(steps)) {
    list = steps.map(item => cleanStep(item, labelOf(plain(item?.id).toLowerCase()))).filter(Boolean);
    if (!list.length) throw new InvalidInputError('The steps need an id, and a label for an id that is not a standard step.', { fix: `Standard ids: ${STEP_DEFAULTS.map(([id]) => id).join(', ')}.` });
  }
  if (isObject(step)) {
    const id = plain(step.id).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    const at = list.findIndex(item => item.id === id);
    const merged = cleanStep({ ...(at >= 0 ? list[at] : {}), ...step, id }, labelOf(id));
    if (!merged) throw new InvalidInputError('A step needs an id, and a label when it is not a standard step.', { fix: `Standard ids: ${STEP_DEFAULTS.map(([key]) => key).join(', ')}.` });
    if (step.detail === '' || step.detail === null) delete merged.detail;
    if (at >= 0) list[at] = merged; else list.push(merged);
  }
  const allDone = list.length > 0 && list.every(item => item.state === 'done');
  const ready = status === 'ready' || (status !== 'running' && allDone);
  const doc = {
    status: ready ? 'ready' : 'running', updatedAt: isoOf(now),
    ...((newBrand === undefined ? current?.newBrand : newBrand) === true ? { newBrand: true } : {}),
    steps: list,
  };
  writeJsonAtomic(file(root, brand, 'progress.json'), doc);
  return doc;
}

/**
 * The checklist at the start of an onboarding run: the standard steps, all still to do and the first one running. A checklist that is already
 * running (a restart of the same pass) is left as it is. Never throws.
 */
export function startChecklist({ root, brand, now } = {}) {
  try {
    const current = readProgress({ root, brand });
    if (current && current.status === 'running') return current;
    const steps = STEP_DEFAULTS.map(([id, label], at) => ({ id, label, state: at === 0 ? 'running' : 'todo' }));
    return writeProgress({ root, brand, status: 'running', steps, now });
  } catch { return null; }
}

// ---------------------------------------------------------------- the board document
function titleOf(post) {
  return clip(post.hook || post.caption, BOARD_LIMITS.title);
}

function boardPost(post, subtopicByPost) {
  const labels = {};
  for (const key of ['format', 'editing', 'visualHook', 'series']) if (post.labels?.[key]) labels[key] = post.labels[key];
  const subtopic = subtopicByPost.get(post.id) ?? post.labels?.subtopic;
  if (subtopic) labels.subtopic = subtopic;
  return {
    id: post.id, platform: post.platform, url: post.url, ...(post.thumbnail ? { thumbnail: post.thumbnail } : {}), title: titleOf(post),
    ...(Number.isFinite(post.views) ? { views: post.views } : {}), ...(Number.isFinite(post.likes) ? { likes: post.likes } : {}),
    date: post.date, labels, ...(post.competitor ? { competitor: post.competitor } : {}),
    ...(Number.isFinite(post.outlierRatio) ? { outlierRatio: post.outlierRatio } : {}),
  };
}

const BANK_SUMMARY_KINDS = Object.freeze([['pains', 'pain'], ['objections', 'objection'], ['desires', 'desire'], ['angles', 'angle'], ['hooks', 'hook'], ['ctas', 'cta']]);

/** Each bank in short: { count, top }, how many items it holds (both banks, removed ones left out) and the words of its best one (the person's own first). */
function banksSummary({ root, brand }) {
  let counts = {};
  try { counts = bankKindCounts({ root, brand }); } catch { counts = {}; }
  const topOf = kind => {
    try {
      const own = readBank({ root, brand, bank: 'yours', kind, limit: 1, ranked: false })[0];
      const proven = readProven({ root, brand, kind, limit: 1 })[0];
      return clip((own ?? proven)?.text, 140);
    } catch { return ''; }
  };
  return Object.fromEntries(BANK_SUMMARY_KINDS.map(([key, kind]) => {
    const top = counts[kind] ? topOf(kind) : '';
    return [key, { count: counts[kind] ?? 0, ...(top ? { top } : {}) }];
  }));
}

/**
 * `brand.intelligence` of the board document, or null when the brand has nothing yet (the key is then left out):
 *   { status: running|ready, updatedAt, steps, own: [Post], competitors: [{ name, posts: [Post] }], viral: [Post],
 *     subtopics?: { status, items }, plan?: { subtopics, formats, cells, stale? }, formatNames: { id: name },
 *     banksSummary: { pains, objections, desires, angles, hooks, ctas } each { count, top? }, newBrand }
 *   Post = { id, platform, url, thumbnail?, title, views?, likes?, date, labels: { format, editing, visualHook, series?, subtopic }, competitor?, outlierRatio? }
 * subtopics and plan are there only once they exist. Sizes are capped (BOARD_LIMITS) so the whole document stays small. Never throws.
 */
export function boardIntelligence({ root, brand, now } = {}) {
  try {
    const posts = readPosts({ root, brand });
    const subs = readSubtopics({ root, brand });
    const plan = readPlan({ root, brand });
    const progress = readProgress({ root, brand });
    if (!posts.length && !subs && !plan && !progress) return null;
    const subtopicByPost = new Map();
    for (const item of subs?.items ?? []) for (const id of item.evidence) if (!subtopicByPost.has(id)) subtopicByPost.set(id, item.id);
    const shown = list => list.map(post => boardPost(post, subtopicByPost));
    const own = shown(posts.filter(post => post.pillar === 'own').slice(0, BOARD_LIMITS.own));
    const viral = shown(posts.filter(post => post.pillar === 'viral').slice(0, BOARD_LIMITS.viral));
    const rivals = new Map();
    for (const post of posts.filter(item => item.pillar === 'competitor')) {
      const name = post.competitor || 'Competitor';
      if (!rivals.has(name)) rivals.set(name, []);
      rivals.get(name).push(post);
    }
    const competitors = [...rivals].slice(0, BOARD_LIMITS.competitors).map(([name, list]) => ({ name, posts: shown(list.slice(0, BOARD_LIMITS.perCompetitor)) }));
    const updated = [progress?.updatedAt, subs?.updatedAt, plan?.updatedAt, ...posts.map(post => post.seenAt)].filter(Boolean).sort().pop() ?? isoOf(now);
    const when = Date.parse(isoOf(now));
    const alive = progress && progress.status === 'running' && Number.isFinite(Date.parse(progress.updatedAt)) && when - Date.parse(progress.updatedAt) < RUNNING_STALE_MS;
    const out = {
      status: alive ? 'running' : 'ready', updatedAt: updated, steps: progress ? progress.steps : [],
      own, competitors, viral,
      ...(subs ? { subtopics: { status: subs.status, items: subs.items } } : {}),
      ...(plan ? { plan: { subtopics: plan.subtopics, formats: plan.formats, cells: plan.cells, ...(plan.stale ? { stale: true } : {}) } } : {}),
      formatNames: Object.fromEntries(AXES.flatMap(axis => axisEntries(axis).map(entry => [entry.id, entry.name]))),
      banksSummary: banksSummary({ root, brand }),
      newBrand: progress?.newBrand === true || (posts.length > 0 && !posts.some(post => post.pillar === 'own')),
    };
    return out;
  } catch { return null; }
}

/** The same document with the heavy parts taken out, for a board that is over its size limit: no thumbnails, and fewer posts. */
export function slimIntelligence(intelligence) {
  if (!isObject(intelligence)) return intelligence;
  const slim = post => { const { thumbnail, ...rest } = post; return rest; };
  return {
    ...intelligence,
    own: (intelligence.own ?? []).slice(0, 5).map(slim),
    competitors: (intelligence.competitors ?? []).map(group => ({ ...group, posts: group.posts.slice(0, 3).map(slim) })),
    viral: (intelligence.viral ?? []).slice(0, 4).map(slim),
  };
}

// ---------------------------------------------------------------- the Strategy gate and the agents' brief
/** The Subtopic row of the Strategy gate: the brand's six, [{ id, text, hint? }], best first. Empty when the brand has none. */
export function subtopicOptions({ root, brand } = {}) {
  try {
    const subs = readSubtopics({ root, brand });
    if (!subs) return [];
    return subs.items.map(item => {
      const hint = [item.postCount ? `${item.postCount} ${item.postCount === 1 ? 'post' : 'posts'}` : '', Number.isFinite(item.topViews) ? `top ${item.topViews.toLocaleString('en-US')}` : '', item.source === 'yours' ? 'added by you' : ''].filter(Boolean).join(', ');
      return { id: item.id, text: item.name, ...(hint ? { hint } : {}) };
    });
  } catch { return []; }
}

const countsOf = (posts, pick) => {
  const groups = new Map();
  for (const post of posts) {
    const id = labelId(post.labels?.[pick]);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, { id, posts: 0, topViews: -1 });
    const group = groups.get(id);
    group.posts += 1;
    group.topViews = Math.max(group.topViews, viewsOf(post));
  }
  return [...groups.values()].sort((a, b) => b.posts - a.posts || b.topViews - a.topViews);
};
const viewsText = value => (value >= 0 ? `, top ${value.toLocaleString('en-US')}` : '');

/**
 * The lines of the brand intelligence for an agent's brief: the six subtopics, the formats that work with their proof, the editing styles and
 * visual hooks seen, what is viral now, and where the plan is. Empty when the brand has none. Kept to a few hundred words.
 */
export function intelligenceLines({ root, brand } = {}) {
  try {
    const posts = readPosts({ root, brand });
    const subs = readSubtopics({ root, brand });
    const plan = readPlan({ root, brand });
    if (!posts.length && !subs && !plan) return [];
    const lines = ['Brand intelligence (what works in this brand\'s niche, learned at onboarding; a job\'s topic comes from one of the six subtopics and its format from the format library pipeline/library/formats.json; the files are in workspaces/{brand}/library/intelligence/):'];
    if (subs) {
      const shown = subs.items.map(item => `${item.name} (${item.id}${item.postCount ? `, ${item.postCount} ${item.postCount === 1 ? 'post' : 'posts'}` : ''}${Number.isFinite(item.topViews) ? `, top ${item.topViews.toLocaleString('en-US')}` : ''})`);
      lines.push(`- Subtopics (${subs.status === 'confirmed' ? 'confirmed by the person' : 'a draft the person has not confirmed yet'}): ${shown.join('; ')}.`);
    }
    const ranked = rankFormats({ root, brand }).slice(0, 5);
    if (ranked.length) {
      lines.push(`- Formats that work for this brand (posts that beat the usual, taken apart; a label is its posted results): ${ranked.map(row => `${row.name} (${row.id}, ${row.posts} ${row.posts === 1 ? 'post' : 'posts'}${viewsText(row.topViews ?? -1)}${row.label ? `, ${row.label}${Number.isFinite(row.resultScore) ? ` ${row.resultScore}x` : ''}` : ''})`).join('; ')}.`);
    }
    for (const [pick, title] of [['editing', 'Editing styles seen'], ['visualHook', 'Visual hooks seen']]) {
      const seen = countsOf(posts, pick).slice(0, 4);
      if (seen.length) lines.push(`- ${title}: ${seen.map(row => `${findEntry(row.id)?.name ?? row.id} (${row.id}, ${row.posts} ${row.posts === 1 ? 'post' : 'posts'})`).join('; ')}.`);
    }
    const viral = posts.filter(post => post.pillar === 'viral').slice(0, 2);
    if (viral.length) {
      lines.push(`- Viral in the niche now (Concept C and Transposition can borrow a format proven elsewhere): ${viral.map(post => `${labelName(post.labels?.format) || 'a video'}, ${labelName(post.labels?.editing) || 'editing unknown'}${post.hook ? `, opens "${clip(post.hook, 80)}"` : ''} (${post.platform}${Number.isFinite(post.views) ? `, ${post.views.toLocaleString('en-US')} views` : ''}, ${post.url})`).join('; ')}.`);
    }
    if (plan) lines.push(`- A 6 by 5 plan is on file (${plan.cells.length} post ideas, one for each subtopic and format${plan.stale ? '; some subtopics changed since it was made' : ''}): read plan.json for the idea of a cell.`);
    lines.push('- When a job comes from a plan cell its job.json has an intelligence block (subtopic, format, idea): use them. Otherwise the topic comes from a subtopic with its evidence (Data), the angle from the brand\'s pain and angle banks (Creativity) and the format from the library, preferring one proven elsewhere that the brand has not used (Transposition).');
    return lines;
  } catch { return []; }
}

/**
 * Whether onboarding has built this brand's intelligence: the save of a research run writes built.json, even for a brand with no posts to take
 * apart yet (a new company). A brand onboarded before this file existed has neither, so its next research start runs the pass once.
 */
export function intelligenceBuilt({ root, brand } = {}) {
  try { return existsSync(file(root, brand, 'built.json')) || existsSync(file(root, brand, 'posts.jsonl')); } catch { return false; }
}

/** The stats a status line needs: how many posts and which pillars are filed. */
export function intelligenceCounts({ root, brand } = {}) {
  try {
    const posts = readPosts({ root, brand });
    return { posts: posts.length, own: posts.filter(post => post.pillar === 'own').length, competitor: posts.filter(post => post.pillar === 'competitor').length, viral: posts.filter(post => post.pillar === 'viral').length };
  } catch { return { posts: 0, own: 0, competitor: 0, viral: 0 }; }
}

/**
 * The labels a filed job carries, from the concept record it was filed with ({ format, editing, visualHook, subtopic }, each the words of the
 * concept's field or of the person's Strategy pick): { format?, editing?, visualHook?, subtopic? }, or null when it names none. A container id of
 * the older visual-formats playbook (F-TALKING-HEAD) is carried onto the axes it stands for (legacyFormats in pipeline/library/formats.json).
 */
export function labelsOfConcept(concept) {
  if (!isObject(concept)) return null;
  const labels = {};
  const legacyId = String(concept.format ?? '').match(/\b(F-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/)?.[1];
  const legacy = legacyId && findEntry(legacyId)?.axis !== 'format' ? mapLegacyFormat(legacyId) : null;
  const format = jobLabel(concept.format, 'format');
  if (format && typeof format === 'string') labels.format = format;
  else if (legacy?.format) labels.format = legacy.format;
  else if (format && !legacy && !legacyId) labels.format = format;
  const editing = jobLabel(concept.editing, 'editing') ?? legacy?.editing ?? null;
  if (editing) labels.editing = editing;
  const visualHook = jobLabel(concept.visualHook, 'visualHook') ?? legacy?.visualHook ?? null;
  if (visualHook) labels.visualHook = visualHook;
  const subtopic = jobLabel(concept.subtopic, 'subtopic');
  if (subtopic) labels.subtopic = subtopic;
  return Object.keys(labels).length ? labels : null;
}

/** The label a filed job carries on one axis, from a concept field or a Strategy pick: a library id, or { custom }. */
export function jobLabel(value, axis) {
  const text = plain(value);
  if (!text) return null;
  const out = cleanLabel(text, axis);
  if (out.value) return out.value;
  // "F-TUTORIAL Tutorial" and "E-SCREEN-RECORDING - Screen recording": the id inside the line is the label.
  const id = text.match(/\b([FEVS]-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/)?.[1];
  if (id && findEntry(id)?.axis === axis) return id;
  return { custom: clip(text, SUBTOPIC_NAME_MAX) };
}

