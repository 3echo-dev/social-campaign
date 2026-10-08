/**
 * The Metricool connection and which Metricool brand each plugin brand posts through.
 *
 * What the connector told us lives in integrations.json under providers.metricool
 * (state, namespace and last_probe come from integration_probe; brands from
 * pipeline_metricool_brands_save). The choice per plugin brand lives in that brand's
 * profile as `publishing`. Nothing here calls Metricool: the running Claude session
 * reads getBrandSettings and hands the result in.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { integrationsPath } from '../lib/paths.mjs';
import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import { askQuestion, listQuestions, plainWordsProblem, withdrawQuestion, QUESTION_OPTION_LIMIT, OPTION_TEXT_LIMIT } from './questions.mjs';
import * as runtime from './runtime.mjs';

const require = createRequire(import.meta.url);
const brandProfile = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-brand-profile.js'));
const durable = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-durable.js'));

export const METRICOOL = 'metricool';
export const METRICOOL_NETWORKS = Object.freeze(['facebook', 'instagram', 'tiktok']);
export const METRICOOL_BRAND_LIMIT = 50;
/** Every Inbox question this module asks starts with this, which is how its answer is found again. */
export const METRICOOL_QUESTION_PREFIX = 'Which Metricool brand should';

const BRAND_ID = /^[A-Za-z0-9_-]{1,40}$/;
const NETWORK_VALUE_LIMIT = 200;
const LABEL_LIMIT = 120;

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function text(value, limit) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

/** One brand as getBrandSettings returned it (networksData) or as already normalised (networks). */
function cleanBrand(entry) {
  if (!plain(entry)) return null;
  const id = text(entry.id ?? entry.blogId, 40);
  if (!id || !BRAND_ID.test(id)) return null;
  const data = plain(entry.networksData) ? entry.networksData : {};
  const given = plain(entry.networks) ? entry.networks : {};
  const networks = {};
  for (const network of METRICOOL_NETWORKS) {
    networks[network] = text(given[network] ?? data[`${network}Data`], NETWORK_VALUE_LIMIT);
  }
  return { id, label: text(entry.label ?? entry.name, LABEL_LIMIT) || `Brand ${id}`, timezone: text(entry.timezone, 60), networks };
}

/**
 * The brands list the way it is stored: `[{id, label, timezone, networks:{facebook, instagram, tiktok}}]`.
 * Accepts the getBrandSettings result whole (`{data:[...]}`), its data array, or an already normalised list.
 * An entry without a usable id is dropped; a repeated id keeps its first entry.
 */
export function normalizeMetricoolBrands(input) {
  const list = Array.isArray(input) ? input : plain(input) && Array.isArray(input.data) ? input.data : null;
  if (!list) throw new Error('Pass the brands exactly as getBrandSettings returned them.');
  if (list.length > METRICOOL_BRAND_LIMIT) throw new Error(`Metricool returned more than ${METRICOOL_BRAND_LIMIT} brands, which is more than this can hold.`);
  const seen = new Set();
  const brands = [];
  for (const entry of list) {
    const brand = cleanBrand(entry);
    if (!brand || seen.has(brand.id)) continue;
    seen.add(brand.id);
    brands.push(brand);
  }
  if (list.length && !brands.length) throw new Error('None of these brands has an id, so none could be saved.');
  return brands;
}

function providersOf(file) {
  return plain(file) && plain(file.providers) ? file.providers : {};
}

export function readMetricoolRecord(root) {
  const record = providersOf(readJsonFile(integrationsPath(root), {}))[METRICOOL];
  return plain(record) ? record : null;
}

export function readMetricoolBrands(root) {
  const record = readMetricoolRecord(root);
  if (!record || !Array.isArray(record.brands)) return [];
  return record.brands.map(cleanBrand).filter(Boolean);
}

/** Store the brands under providers.metricool, keeping the rest of the record (state, namespace, last_probe) as it is. */
export function saveMetricoolBrands(root, input) {
  const brands = normalizeMetricoolBrands(input);
  updateJsonFile(
    integrationsPath(root),
    (current) => {
      const base = plain(current) ? current : {};
      const providers = { ...providersOf(base) };
      const previous = plain(providers[METRICOOL]) ? providers[METRICOOL] : {};
      providers[METRICOOL] = { ...previous, brands, brands_updated_at: new Date().toISOString() };
      return { ...base, providers };
    },
    { providers: {} },
  );
  return brands;
}

// ---------------------------------------------------------------------------
// The choice per plugin brand
// ---------------------------------------------------------------------------

function resolveBrand(root, brand) {
  const value = String(brand || '').trim();
  if (!value) throw new Error('Say which brand this is for.');
  const entry = runtime.listBrands({ root }).find(item => item.slug === value || item.id === value || item.brandId === value);
  if (!entry) throw new Error('This brand could not be found.');
  return entry;
}

function profileFile(brandDir) {
  return join(brandDir, 'brand', 'profile.json');
}

const NOT_READY = 'Finish this brand\'s profile before choosing where its posts go.';

/** Whether this plugin brand has the finished profile its Metricool choice is written into. */
export function metricoolBrandReady(root, brand) {
  const value = String(brand || '').trim();
  const entry = runtime.listBrands({ root }).find(item => item.slug === value || item.id === value || item.brandId === value);
  return Boolean(entry) && Boolean(brandProfile.read(entry.path));
}

/** The saved choice, or null. Only a Metricool record with a blogId counts. */
export function readBrandPublishing(brandDir) {
  const profile = readJsonFile(profileFile(brandDir), null);
  const publishing = plain(profile) ? profile.publishing : null;
  if (!plain(publishing) || publishing.provider !== METRICOOL) return null;
  const blogId = text(publishing.blogId, 40);
  if (!blogId) return null;
  return { provider: METRICOOL, blogId, label: text(publishing.label, LABEL_LIMIT) || `Brand ${blogId}`, chosenAt: text(publishing.chosenAt, 40) };
}

/**
 * Write `publishing` into the brand profile without touching anything else, and without a
 * revision bump: this is a connection setting, not a declared edit, and a bump would
 * unconfirm the content pillars. Needs a complete profile to write into, and keeps the
 * profile inside the same size limit every other profile write is held to.
 */
function saveBrandPublishing(brandDir, { blogId, label }) {
  const file = profileFile(brandDir);
  let record = null;
  durable.update(file, (raw) => {
    let current = null;
    try { current = JSON.parse(raw); } catch { current = null; }
    if (!brandProfile.validRecord(current)) throw new Error(NOT_READY);
    const same = plain(current.publishing) && current.publishing.provider === METRICOOL && current.publishing.blogId === blogId && current.publishing.label === label;
    if (same) { record = current.publishing; return raw; }
    record = { provider: METRICOOL, blogId, label, chosenAt: new Date().toISOString() };
    const next = `${JSON.stringify({ ...current, publishing: record }, null, 2)}\n`;
    if (Buffer.byteLength(next, 'utf8') > brandProfile.MAX_PROFILE_BYTES) throw new Error('Keep the brand profile under 40 KB.');
    return next;
  });
  return record;
}

// ---------------------------------------------------------------------------
// The Inbox question
// ---------------------------------------------------------------------------

/** A line the Inbox accepts (no ids, file names or code words), made from a label, never replaced by a number. */
function plainLabel(value) {
  let line = String(value ?? '').replace(/\s+/g, ' ').trim();
  const steps = [
    text => text.replace(/_+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[`{}<>()=&|\\/]/g, ' '),
    text => text.replace(/[^\p{L}\p{N} ]/gu, ' '),
    text => text.replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2'),
    text => text.replace(/\p{N}+/gu, ' '),
  ];
  for (const step of [null, ...steps]) {
    if (step) line = step(line).replace(/\s+/g, ' ').trim();
    if (line && !plainWordsProblem(line)) return line;
  }
  return 'Another Metricool brand';
}

/** The handle that tells two same-named brands apart: "Instagram @acme". */
function handleHint(brand) {
  for (const [network, name] of [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook']]) {
    const value = brand.networks?.[network];
    if (!value) continue;
    const handle = plainLabel(String(value).replace(/^@/, ''));
    return `${name} @${handle}`;
  }
  return '';
}

/**
 * The saved brands as Inbox answers, `[{text, blogId}]`: the real Metricool label, shown plain, and a
 * linked handle added to any label that more than one brand shares. The question stores this list, and
 * the answer is read back against it, so the order of the brands never matters.
 */
export function metricoolQuestionOptions(brands) {
  const base = brands.map(brand => plainLabel(brand.label).slice(0, OPTION_TEXT_LIMIT - 30));
  const counts = new Map();
  for (const line of base) counts.set(line.toLowerCase(), (counts.get(line.toLowerCase()) || 0) + 1);
  const used = new Set();
  return brands.map((brand, index) => {
    let line = base[index];
    if (counts.get(line.toLowerCase()) > 1) {
      const hint = handleHint(brand);
      if (hint) line = `${line} (${hint})`.slice(0, OPTION_TEXT_LIMIT);
    }
    let candidate = line;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${line.slice(0, OPTION_TEXT_LIMIT - 5)} (${n})`;
    used.add(candidate.toLowerCase());
    return { text: candidate, blogId: brand.id };
  });
}

function questionText(name) {
  const named = `${METRICOOL_QUESTION_PREFIX} ${name} post through?`;
  return plainWordsProblem(named) || named.length > 300 ? `${METRICOOL_QUESTION_PREFIX} this brand post through?` : named;
}

function questionFile(root, questionId) {
  return join(root, '.social-pipeline', 'board', 'questions', `${questionId}.json`);
}

/** The options a question was asked with, as saved on it. */
function storedOptions(question) {
  const list = plain(question?.metricool) && Array.isArray(question.metricool.options) ? question.metricool.options : [];
  return list.filter(item => plain(item) && typeof item.text === 'string' && typeof item.blogId === 'string');
}

function sameOptions(question, options) {
  return JSON.stringify(storedOptions(question)) === JSON.stringify(options);
}

/** Save what this module knows about a question (its options with their blogIds, whether its answer was used) on the question itself. */
function saveQuestionMeta(root, questionId, patch) {
  const file = questionFile(root, questionId);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  record.metricool = { ...(plain(record.metricool) ? record.metricool : {}), ...patch };
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(record, null, 2));
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** An answered question whose answer has been used, or was overruled by a later choice, is never applied again. */
function markAnswersConsumed(root, brandSlug) {
  for (const question of metricoolQuestions(root, 'answered')) {
    if (question.brand === brandSlug && !question.metricool?.consumed) saveQuestionMeta(root, question.questionId, { consumed: true });
  }
}

function metricoolQuestions(root, status) {
  return listQuestions({ root, status, readOnly: true }).filter(isMetricoolQuestion);
}

function withdrawOpenQuestions(root, brandSlug) {
  for (const question of metricoolQuestions(root, 'open')) {
    if (question.brand === brandSlug) withdrawQuestion({ root, questionId: question.questionId });
  }
}

/** The brand the person picked, saved as that plugin brand's own choice. */
export function chooseMetricoolBrand({ root, brand, blogId }) {
  const entry = resolveBrand(root, brand);
  if (!brandProfile.read(entry.path)) throw new Error(NOT_READY);
  const id = String(blogId ?? '').trim();
  const match = readMetricoolBrands(root).find(item => item.id === id);
  if (!match) throw new Error('This is not one of the saved Metricool brands.');
  const publishing = saveBrandPublishing(entry.path, { blogId: match.id, label: match.label });
  withdrawOpenQuestions(root, entry.slug);
  markAnswersConsumed(root, entry.slug);
  return { brand: entry.slug, brandName: entry.name || entry.slug, blogId: publishing.blogId, label: publishing.label };
}

/**
 * The brand an answered question named, read against the options it was asked with. An answer that was
 * already used, or is older than the brand's current saved choice (the person chose again since), is ignored.
 */
function answeredBrand(root, brandSlug, brands, current) {
  for (const question of metricoolQuestions(root, 'answered')) {
    if (question.brand !== brandSlug || question.metricool?.consumed) continue;
    if (current?.chosenAt && String(question.answeredAt || '') < current.chosenAt) continue;
    const given = String(question.answer?.choice ?? question.answer?.text ?? '').trim().toLowerCase();
    const picked = given ? storedOptions(question).find(option => option.text.toLowerCase() === given) : null;
    const match = picked ? brands.find(item => item.id === picked.blogId) : null;
    if (match) return match;
  }
  return null;
}

/**
 * Whether the lone Metricool brand can be taken for a plugin brand without asking: at least one of its accounts
 * is the one on the brand card, and none is a different account or one the brand card does not list.
 */
function fitsBrandCard(channels, metricoolBrand) {
  const values = Object.values(metricoolCoverage(channels, metricoolBrand.networks));
  return values.some(value => value === 'linked' || value === 'unverified') && !values.some(value => value === 'different_handle' || value === 'only_in_metricool');
}

/**
 * Give every plugin brand that has a finished profile and no working choice yet a Metricool brand.
 * A brand that never chose, with one brand in Metricool whose accounts match the brand card, gets it at once. A saved choice that Metricool no
 * longer lists is never replaced silently, even with one brand left: it is reported as needsChoice and the
 * Inbox question is asked, so the person says which brand to use now. Otherwise a saved answer to the
 * question is applied, else the question is asked once, with its options saved on it. More than the Inbox can offer as buttons: left to the brand card's own choice.
 * Every open question that no longer fits (the brand is done, not ready, the brands changed, or Metricool
 * has none) is taken back. Safe to repeat.
 */
export function reconcileMetricoolChoices({ root }) {
  const brands = readMetricoolBrands(root);
  const result = { chosen: [], asked: [], waiting: [], needsChoice: [] };
  const open = metricoolQuestions(root, 'open');
  const keep = new Set();
  const options = metricoolQuestionOptions(brands);
  for (const entry of brands.length ? runtime.listBrands({ root }) : []) {
    const profile = brandProfile.read(entry.path);
    if (!profile) continue;
    const current = readBrandPublishing(entry.path);
    if (current && brands.some(item => item.id === current.blogId)) continue;
    let pick = brands.length === 1 && !current && fitsBrandCard(profile.channels, brands[0]) ? { brand: brands[0], how: 'auto' } : null;
    if (!pick) {
      const answer = answeredBrand(root, entry.slug, brands, current);
      if (answer) pick = { brand: answer, how: 'answer' };
    }
    if (pick) {
      saveBrandPublishing(entry.path, { blogId: pick.brand.id, label: pick.brand.label });
      if (pick.how === 'answer') markAnswersConsumed(root, entry.slug);
      result.chosen.push({ brand: entry.slug, blogId: pick.brand.id, label: pick.brand.label, how: pick.how });
      continue;
    }
    result.waiting.push(entry.slug);
    if (brands.length > QUESTION_OPTION_LIMIT) {
      if (current) result.needsChoice.push({ brand: entry.slug, was: current.label });
      continue;
    }
    const existing = open.find(question => question.brand === entry.slug && sameOptions(question, options));
    if (existing) { keep.add(existing.questionId); continue; }
    const question = askQuestion({ root, brand: entry.slug, text: questionText(entry.name || entry.slug), options: options.map(option => option.text), allowText: false });
    saveQuestionMeta(root, question.questionId, { options });
    keep.add(question.questionId);
    result.asked.push({ brand: entry.slug, questionId: question.questionId });
    if (current) result.needsChoice.push({ brand: entry.slug, was: current.label });
  }
  for (const question of open) {
    if (!keep.has(question.questionId)) withdrawQuestion({ root, questionId: question.questionId });
  }
  return result;
}

/** The same, for a moment when a failure must not undo what just happened (a brand finishing onboarding). */
export function reconcileMetricoolChoicesQuietly({ root }) {
  try { return reconcileMetricoolChoices({ root }); } catch { return null; }
}

/** Save what getBrandSettings returned, then choose or ask for each brand that needs it. */
export function saveBrandsAndChoose({ root, brands }) {
  const saved = saveMetricoolBrands(root, brands);
  return { brands: saved, ...reconcileMetricoolChoices({ root }) };
}

export function isMetricoolQuestion(question) {
  return Boolean(question) && typeof question.text === 'string' && question.text.startsWith(METRICOOL_QUESTION_PREFIX);
}

export function metricoolConnected(root) {
  return readMetricoolRecord(root)?.state === 'connected';
}

// ---------------------------------------------------------------------------
// Coverage: does Metricool post to the same accounts the brand card lists?
// ---------------------------------------------------------------------------

function handleOf(value) {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

/** A URL part, decoded; a part that cannot be decoded reads as unknown (empty), never throws. */
function partOf(value) {
  try { return decodeURIComponent(String(value ?? '')); } catch { return ''; }
}

/** The account a brand-card URL or a Metricool value points at: a handle, and for Facebook possibly a numeric page id. */
function accountOf(network, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { name: '', id: '' };
  if (!/^https?:\/\//i.test(raw)) {
    const handle = handleOf(partOf(raw));
    return /^\d+$/.test(handle) ? { name: '', id: handle } : { name: handle, id: '' };
  }
  let url;
  try { url = new URL(raw); } catch { return { name: '', id: '' }; }
  const segments = url.pathname.split('/').filter(Boolean).map(partOf);
  if (network === 'facebook') {
    const queryId = url.searchParams.get('id');
    if (queryId && /^\d+$/.test(queryId)) return { name: '', id: queryId };
    const first = (segments[0] || '').toLowerCase();
    const tail = segments[segments.length - 1] || '';
    if ((first === 'pages' || first === 'people') && /^\d+$/.test(tail)) return { name: handleOf(segments[1]), id: tail };
    // facebook.com/p/Some-Page-100012345678901/: the page id is the digits ending the last part.
    if (first === 'p' && segments[1]) {
      const id = /(\d{5,})$/.exec(segments[1]);
      if (id) return { name: '', id: id[1] };
    }
    return { name: handleOf(segments[0]), id: '' };
  }
  return { name: handleOf(segments.find(part => part.startsWith('@')) || segments[0]), id: '' };
}

/** true, false, or null when the two cannot be compared (a vanity name against a numeric page id, or an unreadable part). */
function sameAccount(network, cardUrl, metricoolValue) {
  const card = accountOf(network, cardUrl);
  const theirs = accountOf(network, metricoolValue);
  if (card.id && theirs.id) return card.id === theirs.id;
  if (card.name && theirs.name) return card.name === theirs.name;
  return null;
}

/**
 * Per platform, how the Metricool brand lines up with the brand card's channel links:
 * `linked`; `not_linked` (the card lists the channel and Metricool has none); `only_in_metricool`
 * (Metricool has one and the card lists none); `different_handle`; or `unverified` (a Facebook name
 * against a numeric page id, or a link that cannot be read: check it in Metricool). A platform neither
 * lists is left out. Never throws.
 */
export function metricoolCoverage(channels, networks) {
  const coverage = {};
  for (const network of METRICOOL_NETWORKS) {
    try {
      const channel = plain(channels) ? channels[network] : null;
      const url = plain(channel) && channel.status === 'provided' && typeof channel.url === 'string' ? channel.url : null;
      const theirs = plain(networks) ? text(networks[network], NETWORK_VALUE_LIMIT) : null;
      if (!url && !theirs) continue;
      if (!theirs) coverage[network] = 'not_linked';
      else if (!url) coverage[network] = 'only_in_metricool';
      else {
        const same = sameAccount(network, url, theirs);
        coverage[network] = same === null ? 'unverified' : same ? 'linked' : 'different_handle';
      }
    } catch {
      coverage[network] = 'unverified';
    }
  }
  return coverage;
}

/**
 * What the board shows on a brand card: where its posts go and how each platform lines up, or null
 * when no choice is saved yet. `found` is false when the saved brand is no longer in the list Metricool
 * last returned; `connected` is false when Metricool is not connected, and then nothing is compared.
 * A failure reading one brand gives `{unreadable: true}` for that brand alone and never breaks the board.
 */
export function brandPublishingInfo({ brandDir, channels, brands, connected = true }) {
  try {
    const publishing = readBrandPublishing(brandDir);
    if (!publishing) return null;
    const match = brands.find(item => item.id === publishing.blogId) || null;
    return {
      provider: METRICOOL,
      blogId: publishing.blogId,
      label: match ? match.label : publishing.label,
      found: Boolean(match),
      connected,
      timezone: match ? match.timezone : null,
      coverage: match && connected ? metricoolCoverage(channels, match.networks) : {},
    };
  } catch {
    return { provider: METRICOOL, unreadable: true };
  }
}
