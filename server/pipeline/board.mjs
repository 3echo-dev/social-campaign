import { randomUUID, createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, realpathSync, statSync, renameSync, watch } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as runtime from './runtime.mjs';
import { projectJobMetrics } from '../studio/metrics.mjs';
import { integrationsPath } from '../lib/paths.mjs';
import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import { buildJobDocument, parseConcepts, parseStoryboard } from './job-document.mjs';
import * as facts from './facts.mjs';
import { answerQuestion, listQuestions, plainWordsProblem, validateAnswer } from './questions.mjs';
import { landOutputs, repairPromotions } from './land-outputs.mjs';
import { copiesMissingFor, isReviewMediaPath, reviewUrlFor } from './review-copies.mjs';
import { assertContentQc } from './label-qc.mjs';
import { FIELDS as RECIPE_FIELDS, checkRecipePicks, chooseRecipe, readJobRecipes } from './recipe.mjs';
import { chooseStudioWorkspace, readStudioWorkspaceChoice, readStudioWorkspaceList, studioWorkspaceInfo } from './studio-workspace.mjs';

const states = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-states.js'));
const campaignReport = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-campaign-report.js'));
const stageMetrics = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-stage-metrics.js'));
const libBrandKit = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-brand-kit.js'));
const pipelineEvents = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-events.js'));
const kinds = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-kinds.js'));
const stagesLib = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-stages.js'));
const wording = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-wording.js'));
const REQUEST_ID = /^[a-zA-Z0-9_-]{8,100}$/;
const KIND_LABELS = Object.freeze({ research: 'Research', creative_analysis: 'Analysis', video_breakdown: 'Video breakdown' });
const POST_OR_CAMPAIGN = 'Post or campaign';
const LINK_LIMIT = 20;
const NEEDS_A_BRAND = 'A post or campaign needs a brand. Choose one, or onboard a new one.';

export function kindLabel(kind) {
  const id = runtime.jobKindOf(kind);
  return (id && KIND_LABELS[id]) || POST_OR_CAMPAIGN;
}

function isReportKind(kind) {
  const entry = kinds.kindOf(kind);
  return Boolean(entry && entry.status === 'active' && entry.makesContent === false);
}
const digest = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const MEDIA_TYPES={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg'};
const PROJECTION_BUDGET_BYTES = 204800; // 200 KiB
const PROJECTION_TOO_LARGE = 'The board has too much to show at once, so it was not updated. Remove some old jobs from this workspace, then try again.';

function serializedByteSize(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function applyProjectionBudget(projection) {
  if (serializedByteSize(projection) <= PROJECTION_BUDGET_BYTES) return { ...projection, truncated: false };
  const truncated = { ...projection, truncated: true };
  if (serializedByteSize(truncated) > PROJECTION_BUDGET_BYTES) throw new Error(PROJECTION_TOO_LARGE);
  return truncated;
}

function rootOf(root) {
  if (!root) throw new Error('Choose a local workspace through setup first.');
  runtime.initializeWorkspace({ root });
  return runtime.readWorkspace({ root }).root || root;
}

function jobDirectory(root, brand, jobId) {
  const job = runtime.listJobs({ root, brand }).find(job => job.jobId === jobId);
  if (!job) throw new Error('Job not found in this workspace.');
  return job.path;
}

function artifactFile(dir, path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path) || /^[a-z]:/i.test(path)) throw new Error('Use a relative artifact path within the job.');
  const base = realpathSync(dir), file = realpathSync(resolve(dir, path));
  const rel = relative(base, file);
  if (!rel || rel.startsWith('..') || rel.startsWith(sep) || /^[a-z]:/i.test(rel)) throw new Error('Artifact is outside the job.');
  if (!statSync(file).isFile()) throw new Error('Artifact is not a file.');
  return file;
}

const SAFE_BRAND_PROFILE_FIELDS = [
  'market', 'targetMarket', 'audience', 'geography', 'language', 'customerSegment',
  'voice', 'voiceGuidance', 'strategy', 'contentPillars', 'terminology',
  'examples', 'forbiddenClaims', 'competitors',
];

function unsafeProfileKey(key) {
  const normalized = String(key).replace(/[-_]/g, '').toLowerCase();
  return new Set([
    'path', 'file', 'filepath', 'absolutepath', 'credential', 'credentials',
    'password', 'token', 'secret', 'apikey', 'sourcepath', 'sourcepaths',
    'sourceref', 'sourcerefs', 'asset', 'assets', 'brandasset', 'brandassets',
  ]).has(normalized)
    || normalized.endsWith('path')
    || normalized.endsWith('token')
    || normalized.endsWith('secret');
}

function safeArtifactProfileValue(value, key = '', depth = 0) {
  if (depth > 5 || unsafeProfileKey(key)) return undefined;
  if (typeof value === 'string') {
    if (/^(?:[a-z]:[\\/]|[\\/]{1,2}|file:)/i.test(value) || /(?:password|token|secret|api[_-]?key)=/i.test(value)) return undefined;
    return value;
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => safeArtifactProfileValue(item, key, depth + 1)).filter((item) => item !== undefined);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([childKey]) => !unsafeProfileKey(childKey))
      .map(([childKey, childValue]) => [childKey, safeArtifactProfileValue(childValue, childKey, depth + 1)])
      .filter(([, childValue]) => childValue !== undefined));
  }
  return undefined;
}

function researchSuggestedFields(profile) {
  const filled = profile.provenance && profile.provenance.researchFilled;
  if (!filled || typeof filled !== 'object') return [];
  return Object.keys(filled).filter(name => filled[name] && filled[name].suggested === true);
}

function boardBrandProfile(brand, includePreviews) {
  let profile;
  try { profile = read(join(brand.path, 'brand', 'profile.json')); } catch { return null; }
  if (includePreviews) return { ...profile, researchSuggested: researchSuggestedFields(profile) };
  const safe = { channels: safeArtifactProfileValue(profile.channels, 'channels'), researchSuggested: researchSuggestedFields(profile) };
  for (const field of SAFE_BRAND_PROFILE_FIELDS) {
    if (profile[field] !== undefined) safe[field] = safeArtifactProfileValue(profile[field], field);
  }
  if (profile.visualIdentity && typeof profile.visualIdentity === 'object') {
    safe.visualIdentity = {};
    if (Array.isArray(profile.visualIdentity.palette)) safe.visualIdentity.palette = safeArtifactProfileValue(profile.visualIdentity.palette, 'palette');
    if (Array.isArray(profile.visualIdentity.fonts)) safe.visualIdentity.fonts = safeArtifactProfileValue(profile.visualIdentity.fonts, 'fonts');
  }
  return safe;
}

function boardArtifact(artifact, includePreviews, job) {
  const item = { path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes, kind: artifact.kind };
  const mediaType = includePreviews ? MEDIA_TYPES[extname(artifact.path).toLowerCase()] : null;
  if (mediaType) {
    item.mimeType = mediaType;
    item.previewUrl = '/api/board/media?' + new URLSearchParams({ brand: job.brand, jobId: job.jobId, path: artifact.path, sha256: artifact.sha256 });
  }
  return item;
}

// Intake questions the board can answer inline. The keys are the job fields
// route-job.js names in route.missingFields (rule 1 reports schema paths such as
// "audience.description", rules 2 and 3 add "deliverables (at least one)",
// "budget" and "landingPageUrl"); intakeFieldKey maps each one to the top-level
// field the form asks about. Anything else stays a plain blocker for chat.
const PLATFORM_LABELS = Object.freeze({ facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X', threads: 'Threads', youtube: 'YouTube' });
const option = ([value, label]) => ({ value, label });
export const INTAKE_OPTIONS = Object.freeze({
  kind: Object.freeze([['organic_post', 'Single post'], ['organic_series', 'Post series'], ['ugc_creative', 'UGC video'], ['paid_campaign', 'Paid campaign'], ['content_repurpose', 'Repurpose a video']].map(option)),
  objective: Object.freeze([['awareness', 'Awareness'], ['engagement', 'Engagement'], ['traffic', 'Website traffic'], ['leads', 'Leads'], ['sales', 'Sales'], ['app_installs', 'App installs'], ['retention', 'Retention']].map(option)),
  distribution: Object.freeze([['organic', 'Organic'], ['paid', 'Paid'], ['both', 'Organic and paid']].map(option)),
  format: Object.freeze([['static_image', 'Image'], ['carousel', 'Carousel'], ['brand_video', 'Brand video'], ['ugc', 'UGC video'], ['motion_graphic', 'Motion graphic'], ['text_only', 'Text only']].map(option)),
});
const INTAKE_FIELD_SPECS = Object.freeze({
  request: { label: 'What to make', input: 'textarea', placeholder: 'What should Claude make, and what should it say?' },
  kind: { label: 'Type of content', input: 'select' },
  links: { label: 'Links', input: 'links', placeholder: 'https://' },
  objective: { label: 'Campaign goal', input: 'select' },
  distribution: { label: 'Organic or paid distribution', input: 'select' },
  platforms: { label: 'Social platforms', input: 'checkboxes' },
  deliverables: { label: 'Formats and quantities', input: 'deliverables' },
  audience: { label: 'Target audience', input: 'textarea', placeholder: 'Who is this for?' },
  budget: { label: 'Budget', input: 'budget' },
  landingPageUrl: { label: 'Landing page', input: 'url', placeholder: 'https://' },
  productPhoto: { label: 'Product photo', input: 'photo' },
  subjectPhoto: { label: 'Character picture', input: 'photo' },
});
// Rule 6c's blocker text (route-job.js), matched so the board can offer an
// actual upload field instead of leaving this as an unanswerable bullet.
const PRODUCT_PHOTO_BLOCKER = /^(a photo of the product|the product photo at .+, which is not there)$/;
const SUBJECT_PHOTO_BLOCKER = /^the character picture at .+, which is not there$/;
const INTAKE_ORDER = Object.keys(INTAKE_FIELD_SPECS);
// The brief's core answers, always shown on the form with what Claude already
// filled in, so the person sees the whole brief; only missing ones are marked.
const INTAKE_CORE = new Set(['kind', 'objective', 'distribution', 'platforms', 'deliverables', 'audience']);
// Never a question: references and supporting material are optional.
const INTAKE_NEVER_ASKED = new Set(['evidence', 'sourceRefs']);
const INTAKE_STATES = new Set(['INTAKE_PENDING', 'NEEDS_CLARIFICATION', 'UNSUPPORTED']);
const INTAKE_TEXT_LIMIT = 6000;
const INTAKE_PATCH_LIMIT_BYTES = 32 * 1024;
const ASPECT_RATIOS = new Set(['9:16', '1:1', '4:5', '16:9', '4:3', '3:4']);

function v1Platforms() {
  try {
    const config = readFileSync(join(runtime.runtimeConstants.pipelineRoot, 'CONFIG.md'), 'utf8');
    const list = /^platforms_v1:\s*\[([^\]]*)\]/m.exec(config)?.[1].split(',').map(item => item.trim()).filter(item => PLATFORM_LABELS[item]);
    if (list?.length) return list;
  } catch { /* The router falls back to the same default. */ }
  return ['facebook', 'instagram', 'tiktok'];
}
const PLATFORMS_V1 = Object.freeze(v1Platforms());

const SOURCE_QUESTIONS = Object.freeze({
  [kinds.SOURCE_NEEDS.link_or_file]: Object.freeze({ need: 'link_or_file', label: 'Links to the posts or campaign to analyse' }),
  [kinds.SOURCE_NEEDS.video]: Object.freeze({ need: 'video', label: 'The video to break down (a link, or a file on this computer)' }),
});
const sourceQuestion = raw => (typeof raw === 'string' ? SOURCE_QUESTIONS[raw.trim()] || null : null);

const PLAIN_NEEDS = Object.freeze([
  [/^platform:\s*([a-z]+)/i, hit => `${PLATFORM_LABELS[hit[1].toLowerCase()] || 'That platform'} is not supported yet. Choose Facebook, Instagram or TikTok.`],
  [/^(?:creativeDiscipline|discipline):/i, () => 'One of the formats is not supported yet. Choose a different format.'],
  [/^(?:kind|workflow):/i, () => 'This type of content is not supported yet. Choose a different type.'],
  [/^the product photo at .+, which is not there$/i, () => 'The product photo could not be found. Add it again.'],
  [/^the character picture at .+, which is not there$/i, () => 'The character picture could not be found. Add it again.'],
  [/^the file .+, which is not there$/i, () => 'A file named in the brief could not be found. Add it again.'],
]);

export function plainNeed(raw) {
  const value = typeof raw === 'string' ? raw : plainObject(raw) ? raw.label || raw.message || raw.field || '' : '';
  const text = String(value).trim();
  if (!text) return null;
  const source = sourceQuestion(text);
  if (source) return source.label;
  for (const [pattern, say] of PLAIN_NEEDS) {
    const hit = pattern.exec(text);
    if (hit) return say(hit);
  }
  const bare = text.replace(/\s*\(.*\)\s*$/, '');
  if (/^[a-z][A-Za-z0-9_.:[\]-]*$/.test(bare)) {
    const words = bare.replace(/\[\d+\]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._:-]+/g, ' ').trim().toLowerCase();
    return words ? words[0].toUpperCase() + words.slice(1) : null;
  }
  return text;
}

/** The top-level intake field a route missing-field entry is about, or null. */
export function intakeFieldKey(raw) {
  const text = String(typeof raw === 'string' ? raw : raw?.field ?? '').trim().replace(/\s*\(.*\)\s*$/, '');
  const head = text.split(/[.[]/)[0].trim();
  const key = head === 'brief' ? 'request' : head;
  return Object.hasOwn(INTAKE_FIELD_SPECS, key) ? key : null;
}

function intakeEditable(snapshot) {
  const state = snapshot.project?.state || snapshot.status?.state;
  return INTAKE_STATES.has(state) || (state === 'BLOCKED' && snapshot.route?.status !== 'ROUTED' && !snapshot.plan);
}

const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const stringList = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 50) : []);

function channelPlatforms(profile) {
  const channels = plainObject(profile?.channels) ? profile.channels : {};
  return PLATFORMS_V1.filter(name => {
    const channel = channels[name];
    const value = typeof channel === 'string' ? channel : channel?.url || channel?.value || '';
    return /^https?:\/\//i.test(String(value).trim());
  });
}

function intakeDeliverables(job) {
  return (Array.isArray(job.deliverables) ? job.deliverables : []).filter(plainObject).filter(item => PLATFORMS_V1.includes(item.platform)).slice(0, 20).map(item => {
    const extra = {};
    if (Array.isArray(item.aspectRatios)) extra.aspectRatios = item.aspectRatios.filter(ratio => ASPECT_RATIOS.has(ratio));
    if (item.durationSeconds === null || plainObject(item.durationSeconds)) extra.durationSeconds = item.durationSeconds;
    if (typeof item.locale === 'string' && item.locale.length <= 20) extra.locale = item.locale;
    if (typeof item.talkingCharacter === 'boolean') extra.talkingCharacter = item.talkingCharacter;
    return {
      id: typeof item.id === 'string' && /^D\d+$/.test(item.id) ? item.id : null,
      platform: item.platform,
      count: Number.isInteger(item.count) && item.count >= 1 ? item.count : 1,
      format: INTAKE_OPTIONS.format.some(entry => entry.value === item.creativeDiscipline) ? item.creativeDiscipline : '',
      extra,
    };
  });
}

function intakeFieldValue(key, job, profile, knownPlatforms) {
  switch (key) {
    case 'request': return typeof job.request === 'string' ? job.request : '';
    case 'kind':
    case 'objective':
    case 'distribution': return INTAKE_OPTIONS[key].some(entry => entry.value === job[key]) ? job[key] : '';
    case 'links': return runtime.sourceLinks(job.sourceRefs).slice(0, LINK_LIMIT);
    case 'platforms': return knownPlatforms.length ? knownPlatforms : channelPlatforms(profile);
    case 'deliverables': return intakeDeliverables(job);
    case 'audience': {
      const audience = plainObject(job.audience) ? job.audience : {};
      const extra = {};
      for (const name of ['personas', 'locations', 'languages', 'exclusions']) if (Array.isArray(audience[name])) extra[name] = stringList(audience[name]);
      const description = typeof audience.description === 'string' && audience.description.trim() ? audience.description : typeof profile?.audience === 'string' ? profile.audience : '';
      return { description: description.slice(0, INTAKE_TEXT_LIMIT), extra };
    }
    case 'budget': {
      const budget = plainObject(job.budget) ? job.budget : {};
      const extra = {};
      for (const name of ['dailyAmount', 'lifetimeAmount']) if (Number.isFinite(budget[name]) && budget[name] >= 0) extra[name] = budget[name];
      for (const name of ['startAt', 'endAt']) if (typeof budget[name] === 'string' && budget[name].length <= 40) extra[name] = budget[name];
      return { currency: typeof budget.currency === 'string' ? budget.currency : '', maxTotalAmount: Number.isFinite(budget.maxTotalAmount) ? budget.maxTotalAmount : null, extra };
    }
    case 'landingPageUrl': return typeof job.landingPageUrl === 'string' ? job.landingPageUrl : '';
    case 'productPhoto': return null;
    case 'subjectPhoto': {
      const asset = job.productAsset;
      const saved = asset && typeof asset === 'object' ? asset.path : asset;
      return typeof saved === 'string' && saved.trim() ? { saved: true } : null;
    }
    default: return null;
  }
}

/**
 * The inline intake form a job needs on the board: the brief's core answers with
 * what Claude already filled in from the brief and the brand profile, each field
 * flagged missing when the route still needs it, plus any other route field that
 * is missing, and the blockers the board cannot answer (for chat). Null when
 * nothing is missing, so the board shows no panel at all.
 */
export function projectIntake(snapshot, profile = null) {
  const route = snapshot.route || {};
  const job = plainObject(snapshot.job) ? snapshot.job : {};
  const core = isReportKind(job.kind) ? new Set() : job.subject === 'character' ? new Set([...INTAKE_CORE, 'subjectPhoto']) : INTAKE_CORE;
  const missing = new Set();
  const other = [];
  let source = null;
  for (const item of [...(route.missingFields || []), ...(route.missing || [])]) {
    const text = typeof item === 'string' ? item : JSON.stringify(item);
    if (sourceQuestion(text)) { source = sourceQuestion(text); missing.add('links'); continue; }
    const head = text.replace(/\s*\(.*\)\s*$/, '').split(/[.[]/)[0].trim();
    if (INTAKE_NEVER_ASKED.has(head)) continue;
    const key = intakeFieldKey(item);
    if (key) missing.add(key);
    else if (plainNeed(item)) other.push(plainNeed(item));
  }
  const knownPlatforms = (Array.isArray(job.platforms) ? job.platforms : []).filter(name => PLATFORMS_V1.includes(name));
  if (missing.has('deliverables') && !knownPlatforms.length) missing.add('platforms');
  const blockedOn = BLOCKED_STATES.has(snapshot.project?.state) ? null : snapshot.status?.blockedOn;
  for (const item of [...(route.blockers || []), ...(route.unsupported || []), blockedOn]) {
    if (!item || ['nothing', 'you'].includes(String(item).trim().toLowerCase())) continue;
    const text = typeof item === 'string' ? item : JSON.stringify(item);
    // Rule 6c's product-photo blocker is answerable right here, as a real
    // upload field, instead of sitting in the "still needed" bullet list with
    // no way to act on it.
    if (PRODUCT_PHOTO_BLOCKER.test(text)) { missing.add('productPhoto'); continue; }
    if (SUBJECT_PHOTO_BLOCKER.test(text)) { missing.add('subjectPhoto'); continue; }
    if (plainNeed(item)) other.push(plainNeed(item));
  }
  const unanswered = [...new Set(other)].filter(item => !missing.has(intakeFieldKey(item)));
  if (!missing.size && !unanswered.length) return null;
  const editable = intakeEditable(snapshot);
  const fields = editable && missing.size ? INTAKE_ORDER.filter(key => core.has(key) || missing.has(key)).map(key => {
    const spec = INTAKE_FIELD_SPECS[key];
    const asked = key === 'links' && source ? source : null;
    const field = { key, label: asked ? asked.label : spec.label, input: spec.input, missing: missing.has(key), value: intakeFieldValue(key, job, profile, knownPlatforms) };
    if (asked) field.need = asked.need;
    if (spec.placeholder) field.placeholder = spec.placeholder;
    if (spec.input === 'select') field.options = INTAKE_OPTIONS[key];
    if (spec.input === 'checkboxes') field.options = PLATFORMS_V1.map(value => ({ value, label: PLATFORM_LABELS[value] }));
    if (spec.input === 'deliverables') {
      field.options = INTAKE_OPTIONS.format;
      field.platforms = PLATFORMS_V1.map(value => ({ value, label: PLATFORM_LABELS[value] }));
    }
    return field;
  }) : [];
  const brief = typeof job.request === 'string' ? job.request.trim().slice(0, 1200) : '';
  return { editable, revision: snapshot.project?.revision ?? null, brief, platforms: knownPlatforms, fields, other: unanswered };
}

function intakeText(value, key, { required = true } = {}) {
  if (typeof value !== 'string') throw new TypeError(`Intake field ${key} must be a string.`);
  if (required && !value.trim()) throw new TypeError(`Intake field ${key} cannot be empty.`);
  if (value.length > INTAKE_TEXT_LIMIT) throw new TypeError(`Intake field ${key} is too long.`);
}

function onlyKeys(value, allowed, key) {
  if (!plainObject(value)) throw new TypeError(`Intake field ${key} must be an object.`);
  for (const name of Object.keys(value)) if (!allowed.includes(name)) throw new Error(`Intake field ${key}.${name} is not editable from the board.`);
}

function nonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * The board's intake answers, checked the same way runtime.updateJobIntake checks
 * a patch (an object whose keys are editable intake fields of the right type),
 * narrowed to what the board form produces and checked against the job schema's
 * enums, so a bad answer is refused before any job file is touched.
 */
export function validateIntakePatch(patch) {
  if (!plainObject(patch)) throw new TypeError('An intake patch object is required.');
  const keys = Object.keys(patch);
  if (!keys.length) throw new Error('Answer at least one intake question.');
  if (serializedByteSize(patch) > INTAKE_PATCH_LIMIT_BYTES) throw new Error('These intake answers are too long.');
  if (keys.includes('brief') && keys.includes('request')) throw new Error('Use either brief or request, not both.');
  for (const key of keys) {
    const value = patch[key];
    if (key === 'brief' || key === 'request') { intakeText(value, key); continue; }
    if (key === 'kind' || key === 'objective' || key === 'distribution') {
      if (!INTAKE_OPTIONS[key].some(entry => entry.value === value)) throw new TypeError(`Choose a supported ${INTAKE_FIELD_SPECS[key].label.toLowerCase()}.`);
      continue;
    }
    if (key === 'links') {
      if (!Array.isArray(value) || !value.length || value.length > LINK_LIMIT) throw new TypeError(`Add between one and ${LINK_LIMIT} links.`);
      if (value.some(item => typeof item !== 'string' || !runtime.webLink(item))) throw new TypeError('Each link must be a full https address.');
      continue;
    }
    if (key === 'platforms') {
      if (!Array.isArray(value) || !value.length) throw new TypeError('Choose at least one platform.');
      if (value.some(item => !PLATFORMS_V1.includes(item)) || new Set(value).size !== value.length) throw new TypeError(`Platforms must be distinct values from ${PLATFORMS_V1.join(', ')}.`);
      continue;
    }
    if (key === 'deliverables') {
      if (!Array.isArray(value) || !value.length || value.length > 20) throw new TypeError('Add between one and 20 formats.');
      const ids = new Set();
      for (const item of value) {
        onlyKeys(item, ['id', 'platform', 'count', 'creativeDiscipline', 'ugcSource', 'talkingCharacter', 'aspectRatios', 'durationSeconds', 'locale'], 'deliverables');
        if (typeof item.id !== 'string' || !/^D\d+$/.test(item.id) || ids.has(item.id)) throw new TypeError('Each format needs a distinct id such as D1.');
        ids.add(item.id);
        if (!PLATFORMS_V1.includes(item.platform)) throw new TypeError(`Each format needs a platform from ${PLATFORMS_V1.join(', ')}.`);
        if (!Number.isInteger(item.count) || item.count < 1 || item.count > 100) throw new TypeError('Each quantity must be a whole number from 1 to 100.');
        if (!INTAKE_OPTIONS.format.some(entry => entry.value === item.creativeDiscipline)) throw new TypeError('Each format must be a supported format.');
        if (item.creativeDiscipline === 'ugc' ? item.ugcSource !== 'ai' : item.ugcSource !== undefined) throw new TypeError('UGC formats are AI generated; only a UGC format carries ugcSource ai.');
        if (item.talkingCharacter !== undefined && typeof item.talkingCharacter !== 'boolean') throw new TypeError('A talking character must be true or false.');
        if (item.aspectRatios !== undefined && (!Array.isArray(item.aspectRatios) || item.aspectRatios.some(ratio => !ASPECT_RATIOS.has(ratio)))) throw new TypeError('Aspect ratios must be supported ratios.');
        if (item.durationSeconds !== undefined && item.durationSeconds !== null && (!plainObject(item.durationSeconds) || Object.entries(item.durationSeconds).some(([name, seconds]) => !['min', 'max'].includes(name) || !nonNegative(seconds)))) throw new TypeError('A duration must be a min and max in seconds.');
        if (item.locale !== undefined && (typeof item.locale !== 'string' || item.locale.length > 20)) throw new TypeError('A locale must be a short language tag.');
      }
      continue;
    }
    if (key === 'audience') {
      onlyKeys(value, ['description', 'personas', 'locations', 'languages', 'exclusions'], key);
      intakeText(value.description, 'audience.description');
      for (const name of ['personas', 'locations', 'languages', 'exclusions']) {
        if (value[name] !== undefined && (!Array.isArray(value[name]) || value[name].length > 50 || value[name].some(item => typeof item !== 'string' || item.length > 500))) throw new TypeError(`Intake field audience.${name} must be a list of short text.`);
      }
      continue;
    }
    if (key === 'evidence') {
      onlyKeys(value, ['supplied', 'notes'], key);
      if (typeof value.supplied !== 'boolean') throw new TypeError('Intake field evidence.supplied must be true or false.');
      if (value.notes !== undefined) intakeText(value.notes, 'evidence.notes', { required: false });
      continue;
    }
    if (key === 'budget') {
      onlyKeys(value, ['currency', 'maxTotalAmount', 'dailyAmount', 'lifetimeAmount', 'startAt', 'endAt'], key);
      if (typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) throw new TypeError('A budget needs a three-letter currency code, for example SGD.');
      if (!nonNegative(value.maxTotalAmount)) throw new TypeError('A budget needs a maximum total amount of zero or more.');
      for (const name of ['dailyAmount', 'lifetimeAmount']) if (value[name] !== undefined && !nonNegative(value[name])) throw new TypeError(`Intake field budget.${name} must be zero or more.`);
      for (const name of ['startAt', 'endAt']) if (value[name] !== undefined && (typeof value[name] !== 'string' || value[name].length > 40)) throw new TypeError(`Intake field budget.${name} must be a date.`);
      continue;
    }
    if (key === 'landingPageUrl') {
      let url = null;
      try { url = typeof value === 'string' && value.length <= 2000 ? new URL(value) : null; } catch { url = null; }
      if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('The landing page must be a full http or https URL.');
      continue;
    }
    throw new Error(`The intake field ${key} is not editable from the board.`);
  }
  return patch;
}

/**
 * Check a board intake answer against the live job before anything is written:
 * the revision the board showed, a state that still accepts intake edits (the
 * same rule runtime.updateJobIntake applies), and a valid patch.
 */
export function validateIntakeUpdate({ root, brand, jobId, expectedRevision, patch }) {
  if (typeof brand !== 'string' || !brand.trim() || typeof jobId !== 'string' || !jobId.trim()) throw new Error('Choose the job these answers belong to.');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('An expected integer job revision is required.');
  validateIntakePatch(patch);
  const snapshot = runtime.readJobSnapshot({ root, brand, jobId });
  if (snapshot.project.revision !== expectedRevision) throw new Error(`The job changed since these questions were shown. Actual revision is ${snapshot.project.revision}.`);
  if (!intakeEditable(snapshot)) throw new Error(`Intake can only be updated before execution begins; current state is ${snapshot.project.state}.`);
  return snapshot;
}

// The price approval (the credit cost estimate) is not a pipeline state: the job
// sits in STORYBOARD_APPROVED or in production while the media stage prices the
// work. It is a board review of its own, registered with the quote or manifest
// files, pending until its decision is recorded or the job moves on.
export const PRICE_GATE = 'price';
const PRICE_STATES = new Set(['STORYBOARD_APPROVED', 'MEDIA_GENERATING', 'MEDIA_READY', 'CHANGES_REQUESTED']);
const REFERENCE_ART_STATES = new Set(facts.REFERENCE_ART_STATES);
const PRICE_TOO_EARLY = 'The price comes after the storyboard is approved and before or during media production. Before that, only pictures for reference art can be priced.';
const REFERENCE_ART_ONLY = 'Before the storyboard is approved, only pictures for reference art can be priced. Price the video after the storyboard is approved.';
const notTranscription = items => items.filter(item => !facts.isTranscriptionItem(item));
const referenceImagesOnly = items => items.length > 0 && items.every(item => item?.kind === 'image' && facts.isReferenceItem(item));
const transcriptionOnly = items => items.length > 0 && items.every(facts.isTranscriptionItem);

const referenceArtSeat = state => REFERENCE_ART_STATES.has(state) || state === 'CHANGES_REQUESTED';

function priceRefusal(job, items) {
  const state = facts.readJobState(job.dir).state;
  if (transcriptionOnly(items)) return facts.isFinishedState(state) ? PRICE_TOO_EARLY : null;
  if (facts.referenceArtOnly(job)) {
    if (!referenceArtSeat(state)) return PRICE_TOO_EARLY;
    return referenceImagesOnly(notTranscription(items)) ? null : REFERENCE_ART_ONLY;
  }
  return PRICE_STATES.has(state) ? null : PRICE_TOO_EARLY;
}

function priceOpen(root, brand, jobId) {
  const job = facts.jobAt(root, brand, jobId);
  if (!job) return false;
  const items = facts.readQuote(job)?.quote?.items || [];
  if (transcriptionOnly(items)) return !facts.isFinishedState(job.state);
  if (facts.referenceArtOnly(job)) return referenceArtSeat(job.state) && referenceImagesOnly(notTranscription(items));
  return PRICE_STATES.has(job.state);
}
export const FINDINGS_GATE = 'findings';
const REVIEW_GATES = Object.freeze(['concept', 'storyboard', 'content', 'publish', 'campaign_proposal', 'campaign_activation', FINDINGS_GATE]);
const GATE_WORDS = Object.freeze({ concept: 'concept', storyboard: 'storyboard', price: 'price', sample: 'sample image', content: 'final post', publish: 'posting plan', campaign_proposal: 'campaign plan', campaign_activation: 'going live', findings: 'report' });
const REPORT_FILE = 'report/report.md';
const REPORT_STILLS_DIR = 'report/stills';
const STILL_TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const NO_WALK_STATES = new Set(['BLOCKED', 'ESCALATED', 'COMPLETE', 'CANCELLED']);
export const SAMPLE_GATE = 'sample';
export const SAMPLE_DECISION_FILE = 'approvals/sample.json';
const SAMPLE_KINDS = new Set(['image', 'video']);
const SAMPLE_MEDIA = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov']);

function slotOf(key) {
  const parsed = facts.parseJobKey(key);
  return parsed ? `${parsed.deliverable}|${parsed.item}` : null;
}

export function sampleReview(root, brand, jobId, snapshot) {
  if (!priceOpen(root, brand, jobId)) return null;
  const job = facts.jobAt(root, brand, jobId);
  if (!job) return null;
  const items = (facts.readQuote(job)?.quote?.items || []).filter(item => item && slotOf(item.key) && !facts.isReferenceItem(item) && !facts.isTranscriptionItem(item));
  if (!items.length) return null;
  const records = facts.readRecords(job);
  const studioCreates = records.filter(record => record.type === 'create' && record.provider === facts.THREE_ECHO && slotOf(record.key) && !facts.isReferenceItem(record.key));
  const marked = items.find(item => item.provider === facts.THREE_ECHO && item.sample === true);
  const firstCreate = records.find(record => record.type === 'create' && record.provider === facts.THREE_ECHO && !facts.isReferenceItem(record.key));
  const sample = facts.parseJobKey(marked ? marked.key : firstCreate?.key);
  if (!sample) return null;
  const slot = slotOf(sample.key);
  const rest = items.filter(item => item.provider === facts.THREE_ECHO && SAMPLE_KINDS.has(item.kind) && slotOf(item.key) !== slot);
  if (!rest.length || studioCreates.some(record => slotOf(record.key) !== slot)) return null;
  let landed = null;
  for (const entry of facts.readLanded(job)) {
    if (entry.type === 'landed' && typeof entry.file === 'string' && facts.canonicalJobKey(entry.key) === sample.key && SAMPLE_MEDIA.has(extname(entry.file).toLowerCase())) landed = entry;
  }
  if (!landed) return null;
  let bytes;
  try { bytes = readFileSync(artifactFile(job.dir, landed.file)); } catch { return null; }
  const sha256 = digest(bytes);
  const decided = readJsonFile(join(job.dir, ...SAMPLE_DECISION_FILE.split('/')), null);
  if (decided && facts.canonicalJobKey(decided.key) === sample.key && decided.sha256 === sha256 && ['approve', 'changes'].includes(decided.decision)) return null;
  const counts = { image: 0, video: 0 };
  for (const item of rest) counts[item.kind] += 1;
  return {
    brand, jobId, gate: SAMPLE_GATE, revision: snapshot.project.revision,
    artifacts: [{ path: landed.file, sha256, bytes: bytes.length }],
    sample: { key: sample.key, deliverable: sample.deliverable, panel: sample.item, version: sample.version, rest: counts },
  };
}

/** The review the job is waiting on: its state gate, or an undecided price review. */
function pendingReview(root, brand, jobId, snapshot) {
  const gate = states.gateOf(snapshot.project.state);
  if (gate) return { gate, review: readReviewRecord(root, brand, jobId, gate) };
  if (!priceOpen(root, brand, jobId)) return { gate: null, review: null };
  const record = readReviewRecord(root, brand, jobId, PRICE_GATE);
  if (record && record.revision === snapshot.project.revision && !record.decision) return { gate: PRICE_GATE, review: record };
  const sample = sampleReview(root, brand, jobId, snapshot);
  return sample ? { gate: SAMPLE_GATE, review: sample } : { gate: null, review: null };
}

const COPY_GATES = new Set(['sample', 'content', 'publish']);

export function reviewCopyGaps({ root, brand, jobId } = {}) {
  root = rootOf(root);
  const job = facts.jobAt(root, brand, jobId);
  const waiting = job && (COPY_GATES.has(states.gateOf(job.state)) || PRICE_STATES.has(job.state));
  if (!waiting) return { gate: null, missing: [] };
  const light = { project: { state: job.state, revision: job.revision } };
  const { gate, review } = pendingReview(root, brand, jobId, light);
  if (!COPY_GATES.has(gate) || !review || review.revision !== job.revision) return { gate, missing: [] };
  const { missing } = copiesMissingFor(root, review.artifacts);
  return { gate, missing };
}

export function reviewCopiesFor(root, record) {
  if (!COPY_GATES.has(record?.gate)) return { missing: [], next: 'This review does not need copies on the board.' };
  return copiesMissingFor(root, record.artifacts);
}

export function reviewMediaPaths({ root, brand, jobId, all = false } = {}) {
  root = rootOf(root);
  const job = facts.jobAt(root, brand, jobId);
  if (!job) return [];
  const records = [pendingReview(root, brand, jobId, { project: { state: job.state, revision: job.revision } }).review];
  if (all) records.push(...['content', 'publish'].map(gate => readReviewRecord(root, brand, jobId, gate)));
  const paths = records.flatMap(record => (Array.isArray(record?.artifacts) ? record.artifacts : [])).map(item => item?.path).filter(path => typeof path === 'string' && isReviewMediaPath(path));
  return [...new Set(paths)];
}

function readReviewRecord(root, brand, jobId, gate) {
  if (!gate) return null;
  try { return read(reviewFile(root, brand, jobId, gate)); } catch { return null; }
}

function thumbnailDirectory(root) {
  return join(root, '.social-pipeline', 'board', 'thumbs');
}

function localMediaUrl(job) {
  return ({ path, sha256 }) => '/api/board/media?' + new URLSearchParams({ brand: job.brand, jobId: job.jobId, path, sha256 });
}

/**
 * The job documents (see job-document.mjs) for every job in the workspace, or
 * for the named jobs only. Each is under the artifact database's per-document
 * budget and carries no local path.
 */
export function boardJobDocuments({ root, jobIds = null } = {}) {
  root = rootOf(root);
  const workspaceId = runtime.readWorkspace({ root }).workspaceId;
  const brandDirBySlug = new Map(runtime.listBrands({ root }).map(brand => [brand.slug, brand.path]));
  const profiles = new Map();
  const profileOf = slug => {
    if (!profiles.has(slug)) profiles.set(slug, rawBrandProfile(brandDirBySlug.get(slug)));
    return profiles.get(slug);
  };
  const questionsByJob = openQuestionsByJob(root);
  return runtime.listJobs({ root }).filter(job => !jobIds || jobIds.includes(job.jobId)).map(job => {
    const snapshot = runtime.readJobSnapshot({ root, brand: job.brand, jobId: job.jobId });
    const { gate, review } = pendingReview(root, job.brand, job.jobId, snapshot);
    const reviewUrl = ({ sha256 }) => reviewUrlFor(root, { brand: job.brand, jobId: job.jobId, sourceSha: sha256 });
    const studioWorkspace = gate === PRICE_GATE ? studioWorkspaceInfo({ root, brandDir: brandDirBySlug.get(job.brand) || null, jobDir: job.path }) : null;
    const details = jobDetails({ root, job, snapshot, gate, review, profile: profileOf(job.brand), usage: jobUsage(root, job, snapshot), includePreviews: false });
    const inbox = jobDocumentInbox(jobInbox({ root, snapshot, gate, review, intake: details.intake, questions: questionsByJob.get(job.jobId), dir: job.path }));
    const document = buildJobDocument({ dir: job.path, root, workspaceId, project: snapshot.project, job: snapshot.job, gate, review, details, inbox, media: 'inline', reviewUrl, thumbDir: thumbnailDirectory(root), studioWorkspace });
    return { jobId: job.jobId, brand: job.brand, terminal: states.isTerminal(snapshot.project.state), document };
  });
}

function rawBrandProfile(brandDir) {
  if (!brandDir) return null;
  try { return read(join(brandDir, 'brand', 'profile.json')); } catch { return null; }
}

function jobUsage(root, job, snapshot) {
  return stageMetrics.jobUsage(job.path, root, { createdAt: snapshot.job?.createdAt });
}

function jobBlockers(snapshot) {
  return [snapshot.status.blockedOn, ...(snapshot.route?.blockers || snapshot.route?.missingFields || snapshot.route?.missing || [])].filter(value => value && value !== 'Nothing').map(plainNeed).filter(Boolean);
}

const BLOCKED_STATES = new Set(['BLOCKED', 'ESCALATED']);

function blockedReason(snapshot) {
  if (!BLOCKED_STATES.has(snapshot.project.state)) return null;
  const said = plainNeed(snapshot.status?.blockedOn);
  if (!said || plainWordsProblem(said)) return null;
  const reason = wording.blockedReason(said);
  return reason && !plainWordsProblem(reason) ? reason : null;
}

function boardStage(stage) {
  if (!plainObject(stage)) return stage;
  const { tasks, ...rest } = stage;
  return rest;
}

const SETTLED_STAGE_STATUSES = new Set(['complete', 'pending', 'cancelled']);

function stageSummary(stages) {
  const list = Array.isArray(stages) ? stages : [];
  const current = list.find(stage => plainObject(stage) && !SETTLED_STAGE_STATUSES.has(stage.status));
  return { done: list.filter(stage => plainObject(stage) && stage.status === 'complete').length, total: list.length, current: current?.label || null };
}

function jobDetails({ root, job, snapshot, gate, review, profile, usage, includePreviews }) {
  let report = null;
  try {
    const reportInputs = join(job.path, 'report-inputs.json');
    report = campaignReport.report(job.path, root, existsSync(reportInputs) ? read(reportInputs) : {});
  } catch { /* Keep recorded events available when a receipt input is incomplete. */ }
  const projection = projectJobMetrics({ events: snapshot.events, report });
  const tokens = Object.entries(projection.tokens).filter(([key, value]) => key.endsWith('Tokens') && typeof value === 'number').map(([, value]) => value);
  const reviewArtifacts = review?.revision === snapshot.project.revision ? review.artifacts : [];
  return {
    intake: projectIntake(snapshot, profile),
    pendingReviews: gate ? [{ reviewId: gate, gate, revision: snapshot.project.revision, artifacts: reviewArtifacts, summary: reviewArtifacts.length ? 'Review these current files before submitting your decision.' : 'Ask Claude to register the exact review files before approving.' }] : [],
    stages: (snapshot.project.stages || []).map(boardStage),
    usageStages: usage.stages.map(({ id, label, kind, tokens: stageTokens, elapsedMs, openSince }) => ({ id, label, kind, tokens: stageTokens, elapsedMs, openSince })),
    metrics: { recordedTokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) : null, tokens: projection.tokens, coverage: { tokens: projection.coverage.tokens } },
    brandProfile: snapshot.project.brandProfile || null,
    artifacts: snapshot.artifacts.map(item => boardArtifact(item, includePreviews, job)),
  };
}

const INBOX_LIMIT = 20;
const INLINE_GATES = new Set([PRICE_GATE, SAMPLE_GATE]);
const SHORT_BRIEF_FIELDS = new Set(['kind', 'objective', 'distribution', 'platforms', 'audience', 'landingPageUrl']);
const BRIEF_INLINE_LIMIT = 3;
const REVIEW_NOT_READY = 'Claude is getting this ready to show you.';

const inboxTime = value => {
  const time = Date.parse(value || '');
  return Number.isNaN(time) ? 0 : time;
};
const inboxAt = (...values) => {
  const time = values.map(inboxTime).find(Boolean);
  return time ? new Date(time).toISOString() : null;
};
const newestFirst = (a, b) => inboxTime(b.at) - inboxTime(a.at);
const plural = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`;

function openQuestionsByJob(root) {
  const byJob = new Map();
  for (const question of listQuestions({ root, status: 'open' })) {
    const key = question.jobId || null;
    if (!byJob.has(key)) byJob.set(key, []);
    byJob.get(key).push(question);
  }
  return byJob;
}

function questionItem(question, place) {
  return {
    kind: 'question', ...place, brand: question.brand || null, text: question.text, inline: true,
    questionId: question.questionId, options: Array.isArray(question.options) ? [...question.options] : [], allowText: question.allowText !== false,
    at: inboxAt(question.askedAt),
  };
}

function reviewText(dir, path) {
  try { return readFileSync(artifactFile(dir, path), 'utf8'); } catch { return null; }
}

function reviewSummary(dir, gate, paths) {
  if (gate === 'concept') {
    const path = paths.find(item => /(^|\/)concepts\.md$/i.test(item));
    const text = path ? reviewText(dir, path) : null;
    const count = text == null ? 0 : parseConcepts(text).concepts.length;
    return count ? `${plural(count, 'concept')} to choose from.` : 'The ideas are ready to read.';
  }
  if (gate === 'storyboard') {
    const boards = paths.filter(item => /(^|\/)storyboard\.md$/i.test(item)).map(item => reviewText(dir, item)).filter(text => text != null);
    const panels = boards.reduce((sum, text) => sum + parseStoryboard(text).panels.length, 0);
    if (!panels) return 'The storyboard is ready to check.';
    return boards.length > 1 ? `${plural(panels, 'panel')} across ${boards.length} storyboards.` : `${plural(panels, 'panel')} to check.`;
  }
  if (gate === 'content') {
    const posts = paths.filter(item => /(^|\/)post\.md$/i.test(item)).length;
    return posts ? `${plural(posts, 'post')} to check.` : 'The final post is ready to check.';
  }
  if (gate === 'publish') return 'Nothing is posted until you confirm.';
  if (gate === 'campaign_proposal') return 'The campaign plan is ready to read.';
  if (gate === 'campaign_activation') return 'Nothing goes live until you approve.';
  if (gate === FINDINGS_GATE) return 'The report is ready to read.';
  return REVIEW_NOT_READY;
}

function sampleRestWords(rest) {
  const parts = [];
  if (Number(rest?.image) > 0) parts.push(plural(Number(rest.image), 'image'));
  if (Number(rest?.video) > 0) parts.push(plural(Number(rest.video), 'video clip'));
  return parts.join(' and ');
}

function decisionItem({ root, snapshot, gate, review, place, dir }) {
  const revision = snapshot.project.revision;
  const current = Boolean(review && review.revision === revision && Array.isArray(review.artifacts) && review.artifacts.length);
  const item = { kind: 'decision', ...place, text: wording.gateAsk(gate), inline: INLINE_GATES.has(gate) && current, gate, revision, at: inboxAt(review?.createdAt, snapshot.status?.updatedAt) };
  if (!current) return { ...item, summary: REVIEW_NOT_READY };
  if (gate === PRICE_GATE) {
    const job = facts.jobAt(root, snapshot.project.brand, snapshot.project.jobId);
    const saved = job ? facts.readQuote(job) : null;
    if (!saved) return { ...item, inline: false, summary: REVIEW_NOT_READY };
    const totals = facts.quoteTotals(saved.quote.items);
    item.summary = `In total: ${facts.priceWords(totals)}.`;
    item.credits = totals;
  } else if (gate === SAMPLE_GATE) {
    const words = sampleRestWords(review.sample?.rest);
    item.summary = words ? `Approving lets Claude make the other ${words}.` : 'Approving lets Claude make the rest.';
  } else {
    item.summary = reviewSummary(dir, gate, review.artifacts.map(artifact => artifact.path));
  }
  if (item.inline) item.artifacts = review.artifacts.map(({ path, sha256 }) => ({ path, sha256 }));
  return item;
}

function plainNeedForInbox(text) {
  return typeof text === 'string' && text.trim() && !plainWordsProblem(text) ? text.trim() : wording.NEEDS_YOU_IN_CHAT;
}

function briefItems({ intake, place, revision, at }) {
  if (!intake) return [];
  const missing = (Array.isArray(intake.fields) ? intake.fields : []).filter(field => field.missing);
  const other = [...new Set((Array.isArray(intake.other) ? intake.other : []).map(plainNeedForInbox))];
  const total = missing.length + other.length;
  if (!total) return [];
  const base = { kind: 'brief', ...place };
  const ask = field => {
    const inline = SHORT_BRIEF_FIELDS.has(field.key);
    const item = { ...base, text: wording.briefQuestion(field.key, field.need), inline, field: field.key, input: field.input, revision, at };
    if (inline && Array.isArray(field.options)) item.choices = field.options.map(({ value, label }) => ({ value, label }));
    return item;
  };
  const allShort = missing.every(field => SHORT_BRIEF_FIELDS.has(field.key));
  if (!other.length && (missing.length === 1 || (missing.length <= BRIEF_INLINE_LIMIT && allShort))) return missing.map(ask);
  if (!missing.length && other.length === 1) return [{ ...base, text: other[0], inline: false, at }];
  return [{ ...base, text: wording.FINISH_BRIEF, inline: false, summary: `${plural(total, 'thing')} still needed.`, at }];
}

function jobInbox({ root, snapshot, gate, review, intake, questions, dir }) {
  const place = { jobId: snapshot.project.jobId, jobTitle: snapshot.project.title || null, brandName: snapshot.brand?.name || null };
  const at = inboxAt(snapshot.status?.updatedAt, snapshot.job?.createdAt);
  const items = [
    ...(questions || []).map(question => questionItem(question, place)),
    ...(gate ? [decisionItem({ root, snapshot, gate, review, place, dir })] : []),
    ...briefItems({ intake, place, revision: snapshot.project.revision, at }),
  ].sort(newestFirst);
  const state = snapshot.project.state;
  const pricedJob = state === 'STORYBOARD_APPROVED' ? facts.jobAt(root, snapshot.project.brand, snapshot.project.jobId) : null;
  const priceApproved = Boolean(pricedJob && facts.currentPriceApproval(pricedJob));
  const announcement = blockedReason(snapshot) || wording.announcement(state, { workflowId: snapshot.route?.workflowId || null, priceApproved });
  return { items, announcement };
}

function jobLine(inbox) {
  const decision = inbox.items.find(item => item.kind === 'decision');
  if (decision) return decision.text;
  const brief = inbox.items.filter(item => item.kind === 'brief');
  if (brief.length) return brief.length === 1 ? brief[0].text : wording.FINISH_BRIEF;
  if (inbox.items.some(item => item.kind === 'question')) return wording.QUESTION_WAITING;
  return inbox.announcement;
}

function jobDocumentInbox(inbox) {
  return { items: inbox.items.slice(0, INBOX_LIMIT), announcement: inbox.announcement };
}

function workspaceInbox(jobItems, looseQuestions, brandNames) {
  const loose = looseQuestions.map(question => questionItem(question, { jobId: null, jobTitle: null, brandName: question.brand ? brandNames.get(question.brand) || null : null }));
  const items = [...jobItems, ...loose].sort(newestFirst);
  return { count: items.length, items: items.slice(0, INBOX_LIMIT) };
}

export function boardStatus(snapshot, projection) {
  return {
    ...boardSummary(snapshot),
    projectionFile: projection.projectionFile,
    projectionSha256: projection.projectionSha256,
    projectionBytes: projection.projectionBytes,
    documents: projection.documents,
  };
}

export function boardSummary(snapshot) {
  return {
    workspaceId: snapshot.workspace?.workspaceId ?? null,
    setupStep: snapshot.setupStep ?? null,
    connectors: (snapshot.connectors || []).map(({ key, name, state }) => ({ key, name, state })),
    brands: (snapshot.brands || []).map(({ slug, name, onboardingStatus, readyForJobs }) => ({ slug, name, onboardingStatus, readyForJobs })),
    jobs: (snapshot.projects || []).map(project => ({
      jobId: project.jobId,
      brand: project.brandName,
      brandSlug: project.brand,
      title: project.title,
      kind: project.kind ?? null,
      kindLabel: project.kindLabel || kindLabel(project.kind),
      state: project.state,
      revision: project.revision,
      waitingOn: project.waitingOn ?? null,
    })),
    inbox: plainObject(snapshot.inbox) ? { count: snapshot.inbox.count ?? 0, items: Array.isArray(snapshot.inbox.items) ? snapshot.inbox.items : [] } : { count: 0, items: [] },
    truncated: Boolean(snapshot.truncated),
  };
}

/** The two connectors offered on the board's Connectors setup step, in setupStep order. */
export const CONNECTORS = [
  { key: 'threeecho_studio', name: '3Echo Studio', description: 'Makes the images and videos.' },
  { key: 'elevenlabs', name: 'ElevenLabs', description: 'Makes the voice-over.' },
];
const CONNECTOR_KEYS = CONNECTORS.map(connector => connector.key);

function readIntegrationsFile(root) {
  const file = readJsonFile(integrationsPath(root), {});
  return file && typeof file === 'object' && !Array.isArray(file) ? file : {};
}

function integrationProviders(file) {
  return file.providers && typeof file.providers === 'object' && !Array.isArray(file.providers) ? file.providers : {};
}

function integrationConnectorSkips(file) {
  return file.connectorSkips && typeof file.connectorSkips === 'object' && !Array.isArray(file.connectorSkips) ? file.connectorSkips : {};
}

// Record that the person chose "Skip for now" for a connector during setup. This
// only ever touches connectorSkips[provider] inside the shared integrations.json,
// through the same atomic read-modify-write helper integration_mark_connected and
// integration_probe use, so every other provider record and every other provider's
// skip is left exactly as it was. A skip is never the last word: connectorsSnapshot
// below always reports `connected` first when the provider record says so, so a
// later successful connection or probe outranks a stale skip without needing a
// separate clearing write.
function recordConnectorSkip(root, provider) {
  if (!CONNECTOR_KEYS.includes(provider)) throw new Error('Unsupported connector.');
  return updateJsonFile(
    integrationsPath(root),
    (current) => {
      const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
      const skips = { ...integrationConnectorSkips(base) };
      skips[provider] = { skipped: true, skippedAt: new Date().toISOString() };
      return { ...base, connectorSkips: skips };
    },
    { providers: {}, connectorSkips: {} },
  );
}

function pillarsConfirmedPath(root) {
  return join(root, '.social-pipeline', 'board', 'pillars-confirmed.json');
}

function readPillarsConfirmed(root, brandSlug, profileRevision) {
  const file = readJsonFile(pillarsConfirmedPath(root), {});
  const entry = file && typeof file === 'object' ? file[brandSlug] : null;
  return Boolean(entry && Number.isInteger(entry.revision) && entry.revision >= profileRevision);
}

function recordPillarsConfirmed(root, brandSlug, profile) {
  const pillars = Array.isArray(profile?.contentPillars) ? profile.contentPillars.map(item => String(item || '').trim()).filter(Boolean) : [];
  updateJsonFile(
    pillarsConfirmedPath(root),
    (current) => {
      const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
      const next = { ...base };
      if (pillars.length) next[brandSlug] = { revision: Number(profile.revision) || 0, count: pillars.length, confirmedAt: new Date().toISOString() };
      else delete next[brandSlug];
      return next;
    },
    {},
  );
}

function connectorsSnapshot(root) {
  const file = readIntegrationsFile(root);
  const providers = integrationProviders(file);
  const skips = integrationConnectorSkips(file);
  return CONNECTORS.map(({ key, name, description }) => {
    const record = providers[key];
    const connected = Boolean(record && typeof record === 'object' && record.state === 'connected');
    const skip = skips[key];
    const skipped = !connected && Boolean(skip && typeof skip === 'object' && skip.skipped);
    return { key, name, description, state: connected ? 'connected' : skipped ? 'skipped' : 'not_connected' };
  });
}

export function boardSnapshot({ root, includePreviews = false } = {}) {
  root = rootOf(root);
  const workspace = runtime.readWorkspace({ root });
  // The raw saved profile, used only to prefill intake answers (the audience and
  // which channels exist), never projected as a whole.
  const rawProfiles = new Map();
  const studioWorkspaces = readStudioWorkspaceList(root);
  const rawBrandEntries = runtime.listBrands({ root });
  const brandDirBySlug = new Map(rawBrandEntries.map(brand => [brand.slug, brand.path]));
  const brands = rawBrandEntries.map(brand => {
    let raw = null;
    try { raw = read(join(brand.path, 'brand', 'profile.json')); rawProfiles.set(brand.slug, raw); } catch { /* No saved profile yet. */ }
    const profile = boardBrandProfile(brand, includePreviews);
    const usage = stageMetrics.brandResearchUsage(brand.path, root);
    const kit = libBrandKit.projection(brand.path, { now: new Date() });
    const readyForJobs = Boolean(brand.readyForJobs);
    const pillars = Array.isArray(raw?.contentPillars) ? raw.contentPillars.map(item => String(item || '').trim()).filter(Boolean) : [];
    const pillarsConfirmed = pillars.length > 0 && readPillarsConfirmed(root, brand.slug, Number(raw?.revision) || 0);
    const brandChoice = readStudioWorkspaceChoice({ brandDir: brand.path });
    const studioWorkspace = brandChoice.workspaceId
      ? { workspaceId: brandChoice.workspaceId, name: studioWorkspaces.find(item => item.id === brandChoice.workspaceId)?.name || brandChoice.name }
      : null;
    return {id:brand.id,slug:brand.slug,name:brand.name,onboardingStatus:brand.onboardingStatus,profile,usage,kit,readyForJobs,voice:brand.voice,pillarsConfirmed,studioWorkspace};
  });
  const connectors = connectorsSnapshot(root);
  const setupStep = connectors.some(connector => connector.state !== 'connected' && connector.state !== 'skipped')
    ? 'connectors'
    : brands.some(brand => brand.readyForJobs)
      ? 'ready'
      : 'brand_onboarding';
  const questionsByJob = openQuestionsByJob(root);
  const projectEntries = runtime.listJobs({ root }).map(job => {
    const snapshot = runtime.readJobSnapshot({ root, brand:job.brand, jobId:job.jobId });
    const { gate, review } = pendingReview(root, job.brand, job.jobId, snapshot);
    const intake = projectIntake(snapshot, rawProfiles.get(job.brand) || null);
    const inbox = jobInbox({ root, snapshot, gate, review, intake, questions: questionsByJob.get(job.jobId), dir: job.path });
    const usage = jobUsage(root, job, snapshot);
    const kind = typeof snapshot.job?.kind === 'string' ? snapshot.job.kind : null;
    const report = isReportKind(kind);
    const reason = blockedReason(snapshot);
    const project = {
      jobId:snapshot.project.jobId,
      brand:snapshot.project.brand,
      brandId:snapshot.project.brandId,
      title:snapshot.project.title,
      brandName:snapshot.brand.name,
      kind,
      kindLabel:kindLabel(kind),
      state:snapshot.project.state,
      revision:snapshot.project.revision,
      nextAction:jobLine(inbox),
      blockerCount:jobBlockers(snapshot).length,
      ...(reason ? { blockedReason:reason } : {}),
      stageSummary:stageSummary(snapshot.project.stages),
      waitingOn:gate ? GATE_WORDS[gate] || null : null,
      ownershipStatus:snapshot.project.ownershipStatus,
      usage:{
        tokens:usage.tokens,
        startedAt:usage.startedAt,
        endedAt:usage.endedAt,
        running:usage.running,
        elapsedMs:usage.elapsedMs,
        openSince:usage.openSince,
        coverage:usage.coverage,
        ...(report ? {} : {generation:usage.generation}),
      },
    };
    // The local board has no artifact database, so it reads the same job document
    // straight from the snapshot, with media linked to the local preview route.
    if (includePreviews) {
      const studioWorkspace = gate === PRICE_GATE ? studioWorkspaceInfo({ root, brandDir: brandDirBySlug.get(job.brand) || null, jobDir: job.path }) : null;
      const details = jobDetails({ root, job, snapshot, gate, review, profile: rawProfiles.get(job.brand) || null, usage, includePreviews: true });
      project.document = buildJobDocument({ dir: job.path, root, workspaceId: workspace.workspaceId, project: snapshot.project, job: snapshot.job, gate, review, details, inbox: jobDocumentInbox(inbox), media: 'local', previewUrl: localMediaUrl(job), studioWorkspace });
    }
    return { project, rawEventCount: snapshot.events.length, inboxItems: inbox.items };
  });
  const projects = projectEntries.map(entry => entry.project);
  const localEventCount = projectEntries.reduce((sum,entry) => sum + entry.rawEventCount,0);
  const brandNames = new Map(runtime.listBrands({ root, includeGeneral: true }).map(brand => [brand.slug, brand.name]));
  const inbox = workspaceInbox(projectEntries.flatMap(entry => entry.inboxItems), questionsByJob.get(null) || [], brandNames);
  const projection = { schemaVersion:2, workspace:{workspaceId:workspace.workspaceId,name:basename(root),storageMode:'local'},brands,projects,inbox,connectors,setupStep,studioWorkspaces,identity:null,connection:{status:'not_configured',message:'Studio sync is parked until its API is available. Work is saved locally.',localEventCount,pendingCount:null,lastSyncAt:null},updatedAt:new Date().toISOString() };
  return includePreviews ? projection : applyProjectionBudget(projection);
}

export function boardMedia({root,brand,jobId,path,sha256}) {
  root=rootOf(root);
  const file=artifactFile(jobDirectory(root,brand,jobId),path),mimeType=MEDIA_TYPES[extname(file).toLowerCase()];
  if(!mimeType)throw new Error('This file type is not a media preview.');
  if(!/^[a-f0-9]{64}$/.test(sha256 || '') || digest(readFileSync(file))!==sha256)throw new Error('This media revision changed. Refresh the board.');
  return {file,mimeType,size:statSync(file).size};
}

function requestsDirectory(root) {
  const dir = join(root,'.social-pipeline','board','requests');
  mkdirSync(dir,{recursive:true});
  const rel = relative(realpathSync(root),realpathSync(dir));
  if (rel.startsWith('..') || /^[a-z]:/i.test(rel)) throw new Error('Request storage is outside the workspace.');
  return dir;
}

function requestFile(root,requestId) {
  if (!REQUEST_ID.test(requestId || '')) throw new Error('A valid request ID is required.');
  return join(requestsDirectory(root),`${requestId}.json`);
}

export function listBoardRequests({ root }) {
  root = rootOf(root);
  return readdirSync(requestsDirectory(root)).filter(name=>name.endsWith('.json')).map(name=>{
    const file=join(requestsDirectory(root),name),record=read(file);
    return record.status==='requested' && existsSync(`${file}.claim`)?{...record,status:'needs_reconciliation',detail:'An earlier runner claimed this request. Inspect its local effects before retrying.'}:record;
  }).filter(item=>item.status!=='applied' && item.status!=='declined');
}

export async function waitBoardRequests({root,timeoutMs=60000,signal}) {
  root=rootOf(root);
  const pending=listBoardRequests({root});
  if(pending.length)return {status:'ready',requests:pending};
  return await new Promise((resolvePromise,reject)=>{
    let watcher,timer,settled=false;
    const finish=(value,error)=>{
      if(settled)return;settled=true;clearTimeout(timer);watcher?.close();signal?.removeEventListener('abort',abort);
      if(error)reject(error);else resolvePromise(value);
    };
    const abort=()=>finish({status:'cancelled',requests:[]});
    const changed=()=>{
      try {const requests=listBoardRequests({root});if(requests.length)finish({status:'ready',requests});}
      catch(error){finish(null,error);}
    };
    watcher=watch(requestsDirectory(root),changed);
    watcher.on('error',error=>finish(null,error));
    timer=setTimeout(()=>finish({status:'pending',requests:[]}),Math.min(60000,Math.max(1,timeoutMs)));
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();else changed();
  });
}

export function reconcileBoardRequest({root,requestId,resolution,confirmedBy,evidence}) {
  root=rootOf(root);
  if(!['retry','applied'].includes(resolution) || typeof confirmedBy!=='string' || !confirmedBy.trim() || typeof evidence!=='string' || !evidence.trim()) throw new Error('Reconciliation requires a confirmed outcome and the local evidence that establishes it.');
  const file=requestFile(root,requestId),record=read(file),claim=`${file}.claim`;
  if(record.status==='applied')return record;
  if(record.status!=='needs_reconciliation' && !existsSync(claim))throw new Error('This request does not need reconciliation.');
  if(existsSync(claim)) {
    const active=read(claim);
    if(active.pid && active.pid!==process.pid && Date.now()-Date.parse(active.claimedAt)<60000) {
      try {process.kill(active.pid,0);throw new Error('The original runner is still active. Wait for it to finish.');}
      catch(error){if(error.code!=='ESRCH')throw error;}
    }
    renameSync(claim,`${claim}.closed-${randomUUID()}`);
  }
  const next={...record,status:resolution==='retry'?'requested':'applied',reconciliation:{resolution,confirmedBy,evidence,at:new Date().toISOString()}};
  const temp=`${file}.${randomUUID()}.tmp`;writeFileSync(temp,JSON.stringify(next,null,2));renameSync(temp,file);
  return next;
}

export function saveBoardRequest({ root,operation,args,source = 'artifact' }) {
  root = rootOf(root);
  if (!['submit_decision','onboard_brand','create_brand','complete_onboarding','create_job','import_inputs','continue_job','update_intake','attach_product_photo','connect_provider','skip_provider','choose_recipe','choose_studio_workspace','answer_question'].includes(operation)) throw new Error('Unsupported board request.');
  const requestId = args?.requestId || randomUUID();
  if (operation === 'create_job') createJobFields(args || {});
  if (operation === 'answer_question') validateBoardAnswer(root, args);
  const record = {requestId,operation,args:{...args,requestId},source:source === 'local' ? 'local' : 'artifact',status:'requested',createdAt:new Date().toISOString()};
  const file = requestFile(root,requestId);
  try { writeFileSync(file,JSON.stringify(record,null,2),{flag:'wx'}); }
  catch(error) {
    if(error.code!=='EEXIST') throw error;
    const prior = read(file);
    if(prior.operation!==operation || !sameRequesterData(operation,prior.args,record.args)) throw new Error('Request ID was reused with different data.');
    return prior;
  }
  return {...record,message:'Request saved locally. The running Claude session will validate and apply it.'};
}

function validateBoardAnswer(root, args) {
  if (!plainObject(args)) throw new Error('Choose an answer first.');
  return validateAnswer({ root, questionId: args.questionId, choice: args.choice, text: args.text, via: 'board' });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  return value;
}

function requesterData(operation, args) {
  if (operation !== 'create_job' || !plainObject(args)) return args;
  const { job, ...requester } = args;
  return requester;
}

function sameRequesterData(operation, left, right) {
  return JSON.stringify(canonicalJson(requesterData(operation, left))) === JSON.stringify(canonicalJson(requesterData(operation, right)));
}

// The typed job fields Claude extracted from the brief and the brand profile,
// added to a create_job request when it lands so the job routes on creation.
// Identity, owners and local file references never come from a request: a
// product photo is kept only as an http(s) link, and inputs are imported with
// pipeline_inputs_import.
const BOARD_JOB_FIELDS = ['request', 'kind', 'objective', 'distribution', 'platforms', 'deliverables', 'audience', 'evidence', 'offer', 'landingPageUrl', 'schedule', 'budget', 'account', 'requiredClaims', 'prohibitedClaims', 'specWork', 'productAsset', 'sourceRefs', 'subject'];
const webUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value.trim());
const LINK_MEDIA_TYPES = new Set(['video', 'image', 'document', 'url']);

function linkRefs(list) {
  const refs = [];
  for (const item of Array.isArray(list) ? list : []) {
    const uri = runtime.webLink(item);
    if (!uri || refs.some(ref => ref.uri === uri)) continue;
    const ref = runtime.linkSourceRef(uri);
    if (plainObject(item)) {
      if (typeof item.title === 'string' && item.title.trim()) ref.title = item.title.trim().slice(0, 200);
      if (LINK_MEDIA_TYPES.has(item.mediaType)) ref.mediaType = item.mediaType;
      if (typeof item.ownedByBrand === 'boolean') ref.ownedByBrand = item.ownedByBrand;
    }
    refs.push(ref);
  }
  return refs.slice(0, LINK_LIMIT);
}

function boardJobFields(value) {
  if (!plainObject(value)) return null;
  const job = {};
  for (const key of BOARD_JOB_FIELDS) if (value[key] !== undefined) job[key] = structuredClone(value[key]);
  if (job.productAsset !== undefined && !(webUrl(job.productAsset) || (plainObject(job.productAsset) && webUrl(job.productAsset.path)))) delete job.productAsset;
  if (job.sourceRefs !== undefined) {
    const refs = linkRefs(job.sourceRefs);
    if (refs.length) job.sourceRefs = refs;
    else delete job.sourceRefs;
  }
  return Object.keys(job).length ? job : null;
}

function createJobFields(args) {
  const job = boardJobFields(args.job) || {};
  if (args.kind !== undefined && args.kind !== null) {
    const kind = runtime.jobKindOf(args.kind);
    if (!kind || !kinds.activeKindIds().includes(kind)) throw new Error('Choose what you need: a post or campaign, research, an analysis of a post or campaign, or a video breakdown.');
    job.kind = kind;
  }
  if (args.sourceRefs !== undefined && args.sourceRefs !== null) {
    if (!Array.isArray(args.sourceRefs) || args.sourceRefs.length > LINK_LIMIT || args.sourceRefs.some(item => !runtime.webLink(item))) throw new TypeError('Each link must be a full https address.');
    const known = job.sourceRefs || [];
    const chosen = linkRefs(args.sourceRefs).map(ref => known.find(item => item.uri === ref.uri) || ref);
    const refs = [...chosen, ...known.filter(item => !chosen.some(ref => ref.uri === item.uri))].slice(0, LINK_LIMIT);
    if (refs.length) job.sourceRefs = refs;
  }
  const brand = typeof args.brand === 'string' ? args.brand.trim() : '';
  if (kinds.brandRequired(job.kind) && (!brand || runtime.isGeneralBrand(brand))) throw new Error(NEEDS_A_BRAND);
  return Object.keys(job).length ? job : null;
}

export function boardOperation({ root,operation,args = {},source = 'local' }) {
  root = rootOf(root);
  if(operation==='snapshot') return boardSnapshot({root,includePreviews:source==='local'});
  if(source!=='local') return saveBoardRequest({root,operation,args,source});
  if(operation!=='snapshot' && !REQUEST_ID.test(args.requestId || ''))throw new Error('A stable request ID is required for this action.');
  // Ownership always comes from a future authenticated Studio binding, never browser input.
  if(operation==='onboard_brand') {
    const result = runtime.onboardBrand({
      root,
      requestId: args.requestId,
      name: args.name,
      brand: args.brand,
      profile: args.profile,
      kit: args.kit,
    });
    if (result.brand?.slug) recordPillarsConfirmed(root, result.brand.slug, result.profile);
    return result;
  }
  if(operation==='create_brand') return runtime.createBrand({root,name:args.name,requestId:args.requestId});
  if(operation==='complete_onboarding') {
    const result = runtime.completeBrandOnboarding({root,brand:args.brand,profile:args.profile});
    if (result.brand?.slug) recordPillarsConfirmed(root, result.brand.slug, result.profile);
    return result;
  }
  if(operation==='create_job') {
    const job=createJobFields(args);
    const result=runtime.createJob({root,brand:args.brand,requestId:args.requestId,title:args.title,brief:args.brief,...(job?{job}:{}),ownerUserId:null,ownerEmail:null});
    const brand=result.brand||args.brand;
    // A photo never travels as a job field (boardJobFields strips a local
    // productAsset path on sight): it is attached right after creation, the
    // same local-file transit the board's other uploads use.
    const withPhoto = args.photo?.dataBase64 !== undefined || args.photo?.path
      ? runtime.attachProductPhoto({root,brand,jobId:result.jobId,path:args.photo.path,dataBase64:args.photo.dataBase64,source:args.photo.source})
      : null;
    saveBoardRequest({root,operation:'continue_job',args:{requestId:`followup-${digest(args.requestId).slice(0,40)}`,brand,jobId:result.jobId},source:'local'});
    return {...(withPhoto || result),jobId:result.jobId,brand,message:'Job saved. Your Claude session can now continue intake.'};
  }
  if(operation==='continue_job') {
    runtime.readJobSnapshot({root,brand:args.brand,jobId:args.jobId});
    return saveBoardRequest({root,operation,args:{requestId:args.requestId,brand:args.brand,jobId:args.jobId},source});
  }
  if(operation==='update_intake') {
    // The board click is the person's answer: validate it against the live job,
    // then apply it with the same runtime update pipeline_intake_update uses.
    const intake={brand:args.brand,jobId:args.jobId,expectedRevision:args.expectedRevision,patch:args.patch};
    validateIntakeUpdate({root,...intake});
    const result=runtime.updateJobIntake({root,...intake});
    // Wake the running session to carry the job on, as a new job does.
    if(result.updated!==false) saveBoardRequest({root,operation:'continue_job',args:{requestId:`followup-${digest(args.requestId).slice(0,40)}`,brand:args.brand,jobId:args.jobId},source:'local'});
    return {...result,message:'Answers saved. Your Claude session can now continue this job.'};
  }
  if(operation==='attach_product_photo') {
    const result=runtime.attachProductPhoto({root,brand:args.brand,jobId:args.jobId,expectedRevision:args.expectedRevision,path:args.photo?.path,dataBase64:args.photo?.dataBase64,source:args.photo?.source});
    saveBoardRequest({root,operation:'continue_job',args:{requestId:`followup-${digest(args.requestId).slice(0,40)}`,brand:args.brand,jobId:args.jobId},source:'local'});
    return {...result,message:`${result.job?.subject==='character'?'Character picture':'Product photo'} saved. Your Claude session can now continue this job.`};
  }
  if(operation==='import_inputs') return runtime.importLocalInputs({root,brand:args.brand,jobId:args.jobId,sourcePaths:[args.path],ownedByBrand:args.ownedByBrand===true});
  if(operation==='skip_provider') {
    if(!CONNECTOR_KEYS.includes(args.provider)) throw new Error('Unsupported connector.');
    recordConnectorSkip(root,args.provider);
    return {provider:args.provider,state:'skipped'};
  }
  if(operation==='connect_provider') {
    if(!CONNECTOR_KEYS.includes(args.provider)) throw new Error('Unsupported connector.');
    const record = integrationProviders(readIntegrationsFile(root))[args.provider];
    if(!record || record.state!=='connected') throw new Error('Connect this provider in chat and confirm it with integration_probe or integration_mark_connected before applying this request.');
    return {provider:args.provider,state:'connected'};
  }
  if(operation==='choose_recipe') {
    const result = chooseRecipe({root,brand:args.brand,jobId:args.jobId,deliverable:args.deliverable,picks:args.picks,chosenBy:'The board',via:'board',requestId:args.requestId,note:args.note});
    return {...result,message:`Copy choices saved for ${args.deliverable}.`};
  }
  if(operation==='choose_studio_workspace') {
    if(!['job','brand'].includes(args.scope)) throw new Error('Say whether this workspace choice is for the job or the brand.');
    const job = runtime.listJobs({root}).find(item=>item.jobId===args.jobId);
    if(!job) throw new Error('Job not found in this workspace.');
    const result = chooseStudioWorkspace({root,brand:job.brand,jobId:args.scope==='job' ? args.jobId : null,workspaceId:args.workspaceId});
    return {...result,message:`Studio workspace set to ${result.name || 'the chosen workspace'}.`};
  }
  if(operation==='submit_decision') {
    validateDecision({...args,root});
    return saveBoardRequest({root,operation,args,source});
  }
  if(operation==='answer_question') return saveBoardRequest({root,operation,args,source});
  throw new Error('Unsupported board operation.');
}

function safeBrandReceipt(brand) {
  if (!brand || typeof brand !== 'object') return null;
  return {
    id: brand.id || brand.brandId || null,
    slug: brand.slug || null,
    name: brand.name || null,
    onboardingStatus: brand.onboardingStatus || null,
  };
}

function safeAppliedResult(operation, result) {
  if (!result || typeof result !== 'object') return null;
  if (operation === 'onboard_brand' || operation === 'create_brand' || operation === 'complete_onboarding') {
    return { brand: safeBrandReceipt(result.brand) };
  }
  if (operation === 'create_job') return result.jobId ? { jobId: result.jobId } : null;
  if (operation === 'continue_job') return result.project?.jobId || result.jobId ? { jobId: result.project?.jobId || result.jobId } : null;
  if (operation === 'update_intake' || operation === 'attach_product_photo') return result.jobId ? { jobId: result.jobId, ...(Number.isSafeInteger(result.revision) ? { revision: result.revision } : {}) } : null;
  if (operation === 'import_inputs') return result.revisionId ? { revisionId: result.revisionId } : null;
  if (operation === 'connect_provider' || operation === 'skip_provider') {
    return typeof result.provider === 'string' && typeof result.state === 'string' ? { provider: result.provider, state: result.state } : null;
  }
  if (operation === 'choose_recipe') return result.deliverable ? { deliverable: result.deliverable } : null;
  if (operation === 'choose_studio_workspace') return result.workspaceId ? { workspaceId: result.workspaceId, scope: result.scope } : null;
  if (operation === 'answer_question') return result.questionId ? { questionId: result.questionId, status: result.status, answeredVia: result.answeredVia ?? null } : null;
  return null;
}

function declineMessage(reason) {
  return reason ? `Declined in chat. Nothing was changed. ${reason}` : 'Declined in chat. Nothing was changed.';
}

function artifactReceipt(record, { status, appliedAt, declinedAt, result, reason } = {}) {
  if (record.source !== 'artifact') return undefined;
  const receipt = { status, requestId: record.requestId };
  if (appliedAt) receipt.appliedAt = appliedAt;
  if (declinedAt) receipt.declinedAt = declinedAt;
  if (status === 'applied') {
    const safeResult = safeAppliedResult(record.operation, result);
    if (safeResult) receipt.result = safeResult;
  } else if (status === 'declined') {
    receipt.message = declineMessage(reason);
  } else {
    receipt.message = 'The local runner could not apply this request. Inspect the local request record before retrying.';
  }
  return receipt;
}

const CHOSEN_ID = /^[A-Za-z0-9_-]{1,40}$/;

function missingRecipePosts(root, brand, jobId, recipe) {
  let data;
  try { data = readJobRecipes({ root, brand, jobId }); } catch { return []; }
  const provided = plainObject(recipe) ? recipe : {};
  return Object.entries(data.deliverables || {})
    .filter(([, entry]) => entry.options && !entry.chosen)
    .map(([id]) => id)
    .filter(id => provided[id] === undefined);
}

function validateConceptRecipe(root, brand, jobId, recipe) {
  if (recipe !== undefined && (!plainObject(recipe) || Object.entries(recipe).some(([id, picks]) => !DELIVERABLE_ID.test(id) || !plainObject(picks)))) {
    throw new Error('The copy choices sent with this approval are not valid.');
  }
  const missing = missingRecipePosts(root, brand, jobId, recipe);
  if (missing.length) throw new Error(`Choose the content pillar, angle, hook, call to action and hashtags for ${missing.join(', ')} before approving.`);
  for (const [deliverable, picks] of Object.entries(recipe || {})) checkRecipePicks({ root, brand, jobId, deliverable, picks });
}

const DELIVERABLE_ID = /^D\d+$/;

const FLAG_ID = /^lf-[0-9a-f]{12}$/;
const PANEL_REF = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const PANEL_ENTRY_KEYS = new Set(['panel', 'deliverable', 'verdict', 'note']);

function validateAcceptedFlags(reviewId, acceptedFlagIds) {
  if(acceptedFlagIds===undefined) return;
  if(reviewId!=='content') throw new Error('Only the final approval can accept label check items.');
  if(!Array.isArray(acceptedFlagIds) || acceptedFlagIds.length>300 || acceptedFlagIds.some(id=>typeof id!=='string' || !FLAG_ID.test(id)) || new Set(acceptedFlagIds).size!==acceptedFlagIds.length) throw new Error('The accepted label check items are not valid.');
}

function storyboardPanels(dir, artifacts) {
  const boards = artifacts.filter(item => /(^|\/)storyboard\.md$/i.test(item.path));
  const panels = [];
  for (const item of boards) {
    const board = parseStoryboard(readFileSync(artifactFile(dir, item.path), 'utf8'));
    const deliverable = facts.canonicalDeliverable(board.ref) || facts.canonicalDeliverable(/(?:^|\/)(D\d+)\//i.exec(item.path)?.[1]) || null;
    for (const panel of board.panels) panels.push({ deliverable, panel: panel.ref });
  }
  return panels;
}

function validatePanels(dir, artifacts, panels, decision, note) {
  if(!Array.isArray(panels) || !panels.length || panels.length>200) throw new Error('The panel decisions are not valid.');
  const known = storyboardPanels(dir, artifacts);
  const seen = new Set();
  for(const entry of panels) {
    if(!plainObject(entry) || Object.keys(entry).some(key=>!PANEL_ENTRY_KEYS.has(key))) throw new Error('The panel decisions are not valid.');
    if(typeof entry.panel!=='string' || !PANEL_REF.test(entry.panel)) throw new Error('Each panel decision needs its panel, such as P1.');
    if(entry.deliverable!==undefined && (typeof entry.deliverable!=='string' || !DELIVERABLE_ID.test(entry.deliverable))) throw new Error('Each panel decision can only name its post, such as D1.');
    if(!['approve','changes'].includes(entry.verdict)) throw new Error('Each panel is either approved or has changes asked.');
    if(entry.note!==undefined && (typeof entry.note!=='string' || entry.note.length>1000)) throw new Error('A panel note must be text of at most 1000 characters.');
    const matches = known.filter(item=>item.panel===entry.panel && (entry.deliverable===undefined || item.deliverable===entry.deliverable));
    if(!matches.length) throw new Error(`${entry.deliverable ? `${entry.deliverable} ` : ''}${entry.panel} is not a panel of this storyboard.`);
    if(matches.length>1) throw new Error(`Say which post ${entry.panel} belongs to, such as D1.`);
    const key = `${matches[0].deliverable || ''}|${entry.panel}`;
    if(seen.has(key)) throw new Error(`${entry.panel} has more than one decision.`);
    seen.add(key);
  }
  if(decision==='approve' && (seen.size!==known.length || panels.some(entry=>entry.verdict!=='approve'))) throw new Error('Approve every panel before approving the storyboard.');
  if(decision==='request_changes' && !panels.some(entry=>entry.verdict==='changes') && !(typeof note==='string' && note.trim())) throw new Error('Say what should change.');
}

export function validateDecision({root,brand,jobId,revision,reviewId,artifacts,decision,chosen,credits,totals,note,recipe,panels,acceptedFlagIds}) {
  const snapshot = runtime.readJobSnapshot({root,brand,jobId});
  if(snapshot.project.revision!==revision) throw new Error('This job revision has changed. Refresh and review it again.');
  const pending = pendingReview(root,brand,jobId,snapshot);
  if(pending.gate!==reviewId) throw new Error('This review is no longer awaiting a decision.');
  if(!['approve','request_changes'].includes(decision)) throw new Error('Unsupported decision.');
  // Optional board extras: the picked option (a concept letter or panel ID), the
  // credits the board showed for a concept approval, and the person's comment.
  if(chosen!==undefined && (typeof chosen!=='string' || !CHOSEN_ID.test(chosen))) throw new Error('The chosen option is not valid.');
  if(credits!==undefined && (!Number.isInteger(credits) || credits<0)) throw new Error('The shown credits must be a whole number of zero or more.');
  if(totals!==undefined && (!plainObject(totals) || Object.keys(totals).some(key=>!facts.PROVIDERS.includes(key)) || facts.PROVIDERS.some(key=>typeof totals[key]!=='number' || !Number.isFinite(totals[key]) || totals[key]<0))) throw new Error('The shown price must list the Studio and voice credits as numbers of zero or more.');
  if(note!==undefined && (typeof note!=='string' || note.length>4000)) throw new Error('The review note must be text of at most 4000 characters.');
  if(reviewId==='concept' && decision==='approve') validateConceptRecipe(root,brand,jobId,recipe);
  validateAcceptedFlags(reviewId,acceptedFlagIds);
  if(panels!==undefined && reviewId!=='storyboard') throw new Error('Only the storyboard takes a decision per panel.');
  if(reviewId===SAMPLE_GATE && decision==='request_changes' && !(typeof note==='string' && note.trim())) throw new Error('Say what should change in the sample.');
  if(!Array.isArray(artifacts) || !artifacts.length) throw new Error('No review files are registered. Ask Claude to prepare the review.');
  const registered = reviewId===SAMPLE_GATE ? pending.review : read(reviewFile(root,brand,jobId,reviewId));
  if(!registered) throw new Error('This review is no longer awaiting a decision.');
  const identity = items => JSON.stringify(items.map(item=>[item.path,item.sha256]).sort((a,b)=>a[0].localeCompare(b[0])));
  if(registered.revision!==revision || identity(registered.artifacts)!==identity(artifacts)) throw new Error('The decision must cover the exact registered review files.');
  const dir = jobDirectory(root,brand,jobId);
  for(const artifact of artifacts) {
    if(!/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) throw new Error('A review file is missing its content hash.');
    if(digest(readFileSync(artifactFile(dir,artifact.path)))!==artifact.sha256) throw new Error('A review file has changed. Refresh and review it again.');
  }
  if(panels!==undefined) validatePanels(dir,artifacts,panels,decision,note);
  return {snapshot,dir,registered};
}

function reviewFile(root,brand,jobId,gate) {
  return join(requestsDirectory(root),`review-${digest(JSON.stringify([brand,jobId,gate]))}.record`);
}

function workflowGates(workflowId) {
  return stagesLib.isReportWorkflow(workflowId) ? [FINDINGS_GATE] : REVIEW_GATES.filter(gate => gate !== FINDINGS_GATE);
}

function assertReviewFits(gate, workflowId) {
  if (!REVIEW_GATES.includes(gate) || workflowGates(workflowId).includes(gate)) return;
  throw new Error(gate === FINDINGS_GATE ? 'This job makes posts, not a report, so it has no report to review.' : 'This job makes a report, so its one review is the report.');
}

function inferredGate(state, paths, workflowId = null) {
  const list = Array.isArray(paths) ? paths : [];
  const fits = workflowGates(workflowId);
  if (list.some(path => String(path) === REPORT_FILE) && fits.includes(FINDINGS_GATE)) return FINDINGS_GATE;
  if (list.some(path => /(^|\/)concepts\.md$/i.test(String(path)))) return 'concept';
  if (list.some(path => /(^|\/)storyboard\.md$/i.test(String(path)))) return 'storyboard';
  const nearest = facts.nearestGates(state).filter(gate => fits.includes(gate));
  return nearest.length === 1 ? nearest[0] : null;
}

function reportReviewPaths(dir) {
  if (!existsSync(join(dir, ...REPORT_FILE.split('/')))) throw new Error('Write the report to report/report.md before presenting it.');
  let stills = [];
  try {
    stills = readdirSync(join(dir, ...REPORT_STILLS_DIR.split('/')), { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.name.startsWith('.') && STILL_TYPES.has(extname(entry.name).toLowerCase()))
      .map(entry => `${REPORT_STILLS_DIR}/${entry.name}`)
      .sort();
  } catch { stills = []; }
  return [REPORT_FILE, ...stills];
}

function moveToReview(root, brand, jobId, snapshot, requested, paths) {
  const state = snapshot.project.state;
  const current = states.gateOf(state);
  const workflowId = snapshot.route?.workflowId || null;
  const gate = requested ?? current ?? inferredGate(state, paths, workflowId);
  if (!gate || !REVIEW_GATES.includes(gate)) throw new Error('Say which review this is with gate, for example concept, storyboard or content.');
  if (!current) assertReviewFits(gate, workflowId);
  if (current) {
    if (current !== gate) throw new Error(`This job is waiting on the ${GATE_WORDS[current]} decision, not the ${GATE_WORDS[gate]} one.`);
    return { gate, snapshot, moved: null };
  }
  if (NO_WALK_STATES.has(state)) throw new Error('This job is stopped or held up, so it cannot be moved to a review now.');
  const job = facts.jobAt(root, brand, jobId);
  const moved = job ? facts.moveJobTo(job, states.AWAITING_STATE[gate], { by: 'pipeline_review_present' }) : { ok: false };
  if (!moved.ok) throw new Error(`This job cannot move to the ${GATE_WORDS[gate]} review from where it is now.`);
  return { gate, snapshot: runtime.readJobSnapshot({ root, brand, jobId }), moved: { from: moved.from, to: moved.to, steps: moved.steps } };
}

export function registerBoardReview({root,brand,jobId,paths,gate:requested}) {
  root=rootOf(root);
  let snapshot=runtime.readJobSnapshot({root,brand,jobId});
  let gate;
  let moved=null;
  if(requested===SAMPLE_GATE) {
    const pending=pendingReview(root,brand,jobId,snapshot);
    if(pending.gate===SAMPLE_GATE) return pending.review;
    if(!sampleReview(root,brand,jobId,snapshot)) throw new Error('There is no sample waiting for a decision. It shows once the sample has been made and before the rest is made.');
    throw new Error('Another decision on this job comes first.');
  }
  if(requested===PRICE_GATE) {
    const job=facts.jobAt(root,brand,jobId);
    const saved=job ? facts.readQuote(job) : null;
    if(!(saved && transcriptionOnly(saved.quote.items)) && !PRICE_STATES.has(snapshot.project.state) && !REFERENCE_ART_STATES.has(snapshot.project.state)) throw new Error(PRICE_TOO_EARLY);
    if(!saved) throw new Error('Save the price with pipeline_quote_save before presenting it.');
    const refusal=priceRefusal(job,saved.quote.items);
    if(refusal) throw new Error(refusal);
    const pending=facts.pricePending(job);
    if(!pending.media && !pending.transcription) throw new Error('This price is already approved, so there is nothing new to present.');
    gate=PRICE_GATE;
    paths=[facts.FACT_FILES.quote];
  } else {
    const current=states.gateOf(snapshot.project.state);
    const workflowId=snapshot.route?.workflowId || null;
    const aimed=requested ?? current ?? inferredGate(snapshot.project.state,paths,workflowId);
    if(aimed && !current) assertReviewFits(aimed,workflowId);
    if(aimed===FINDINGS_GATE && (!current || current===FINDINGS_GATE)) paths=reportReviewPaths(jobDirectory(root,brand,jobId));
    if(!Array.isArray(paths) || !paths.length || new Set(paths).size!==paths.length) throw new Error('Provide the complete, unique list of files for this review.');
    ({gate,snapshot,moved}=moveToReview(root,brand,jobId,snapshot,requested ?? null,paths));
  }
  const dir=jobDirectory(root,brand,jobId);
  const artifacts=paths.map(path=>{const bytes=readFileSync(artifactFile(dir,path));return {path,sha256:digest(bytes),bytes:bytes.length};});
  const record={brand,jobId,gate,revision:snapshot.project.revision,artifacts,createdAt:new Date().toISOString()};
  writeFileSync(reviewFile(root,brand,jobId,gate),JSON.stringify(record,null,2));
  return moved ? {...record,moved} : record;
}

function claimBoardRequest(file) {
  try {
    writeFileSync(`${file}.claim`,JSON.stringify({pid:process.pid,claimedAt:new Date().toISOString()}),{flag:'wx'});
    return null;
  } catch(error) {
    if(error.code!=='EEXIST') throw error;
    const current = read(file);
    if(current.status==='applied') return current;
    return {...current,message:'This request is already being handled.'};
  }
}

export function applyBoardRequest({root,requestId,confirmedBy}) {
  root=rootOf(root);
  if(typeof confirmedBy!=='string' || !confirmedBy.trim()) throw new Error('Confirm the requester before applying this artifact request.');
  const file=requestFile(root,requestId),record=read(file);
  if(record.status==='applied')return record;
  if(record.status!=='requested' || record.operation==='submit_decision')throw new Error('Use the decision handler for approvals.');
  // Intake answers are checked against the live job before the claim, so a stale
  // or invalid answer leaves the request unclaimed and nothing written: decline it
  // with the reason and the board shows the current questions again.
  if(record.operation==='update_intake') validateIntakeUpdate({root,brand:record.args?.brand,jobId:record.args?.jobId,expectedRevision:record.args?.expectedRevision,patch:record.args?.patch});
  if(record.operation==='create_job') createJobFields(record.args || {});
  if(record.operation==='answer_question') validateBoardAnswer(root,record.args);
  const claimed=claimBoardRequest(file);
  if(claimed) return claimed;
  let result;
  try { result=record.operation==='continue_job'
    ? runtime.readJobSnapshot({root,brand:record.args.brand,jobId:record.args.jobId})
    : record.operation==='answer_question'
      ? answerQuestion({root,questionId:record.args.questionId,choice:record.args.choice,text:record.args.text,via:'board',requestId:record.requestId})
      : boardOperation({root,operation:record.operation,args:record.args,source:'local'}); }
  catch(error) {
    const next = {
      ...record,
      status: 'needs_reconciliation',
      detail: error.message,
      artifactReceipt: artifactReceipt(record, { status: 'needs_reconciliation' }),
    };
    writeFileSync(file,JSON.stringify(next,null,2));
    throw error;
  }
  const appliedAt = new Date().toISOString();
  const next={
    ...record,
    status:'applied',
    confirmedBy,
    result,
    appliedAt,
    artifactReceipt: artifactReceipt(record, { status: 'applied', appliedAt, result }),
  };
  writeFileSync(file,JSON.stringify(next,null,2));
  return next;
}

export function declineBoardRequest({root,requestId,confirmedBy,reason}) {
  root=rootOf(root);
  if(typeof confirmedBy!=='string' || !confirmedBy.trim()) throw new Error('Confirm the requester before declining this request.');
  const file=requestFile(root,requestId),record=read(file);
  if(record.status==='declined')return record;
  if(record.status==='applied')throw new Error('This request was already applied and cannot be declined.');
  if(existsSync(`${file}.claim`))throw new Error('An earlier runner claimed this request. Reconcile it before declining.');
  if(record.status!=='requested' && record.status!=='needs_reconciliation')throw new Error('Only a requested or needs_reconciliation request can be declined.');
  const trimmedReason = typeof reason==='string' ? reason.trim().slice(0,500) : '';
  const declinedAt = new Date().toISOString();
  const next={
    ...record,
    status:'declined',
    declinedAt,
    confirmedBy,
    ...(trimmedReason ? {reason:trimmedReason} : {}),
    artifactReceipt: artifactReceipt(record, {status:'declined', declinedAt, reason:trimmedReason || undefined}),
  };
  const temp=`${file}.${randomUUID()}.tmp`;writeFileSync(temp,JSON.stringify(next,null,2));renameSync(temp,file);
  return next;
}

export function applyBoardDecision({root,requestId,confirmedBy,maxCredits}) {
  root = rootOf(root);
  if(typeof confirmedBy!=='string' || !confirmedBy.trim()) throw new Error('The runner must identify the person who confirmed this decision.');
  const file = requestFile(root,requestId), record = read(file);
  if(record.status==='applied') return record;
  if(record.status!=='requested' || record.operation!=='submit_decision') throw new Error('This request is not a pending decision.');
  const args = record.args;
  const validated = validateDecision({...args,root});
  if(args.reviewId===PRICE_GATE) return applyPriceDecision({root,file,record,args,validated,confirmedBy});
  if(args.reviewId===SAMPLE_GATE) return applySampleDecision({file,record,args,validated,confirmedBy});
  if(args.reviewId==='concept' && args.decision==='approve' && (!Number.isInteger(maxCredits) || maxCredits<0)) throw new Error('Concept approval needs the spending limit the user selected.');
  // A board approval is at the amount the board showed, never another figure.
  if(args.reviewId==='concept' && args.decision==='approve' && Number.isInteger(args.credits) && maxCredits!==args.credits) throw new Error(`Approve this concept at the ${args.credits} credits the board showed.`);
  const labelCheck = args.reviewId==='content' && args.decision==='approve'
    ? assertContentQc({root,job:{brand:validated.snapshot.brand?.slug || args.brand,jobId:args.jobId},files:args.artifacts,acceptedFlagIds:Array.isArray(args.acceptedFlagIds) ? args.acceptedFlagIds : []})
    : null;
  // Claim before invoking the legacy two-write approval command. A crash is reconciled, never replayed blindly.
  const claimed = claimBoardRequest(file);
  if(claimed) return claimed;
  if(args.reviewId==='concept' && args.decision==='approve' && plainObject(args.recipe)) {
    for(const [deliverable,picks] of Object.entries(args.recipe)) {
      chooseRecipe({root,brand:validated.snapshot.brand.slug,jobId:args.jobId,deliverable,picks,chosenBy:confirmedBy,via:'board',requestId:record.requestId,note:args.note});
    }
  }
  const comment = args.reviewId==='storyboard' ? storyboardComment(args) : args.note || '';
  const command = [join(runtime.runtimeConstants.pipelineRoot,'scripts','record-approval.js'),validated.snapshot.brand.slug,args.jobId,args.reviewId,args.decision==='approve'?'approve':'change','--by',confirmedBy,'--comment',comment,'--channel','file','--root',root];
  command.push('--expect-revision',String(args.revision),'--expected-artifacts',JSON.stringify(args.artifacts.map(({path,sha256})=>({path,sha256}))));
  if(Number.isInteger(maxCredits)) command.push('--max-credits',String(maxCredits));
  if(typeof args.chosen==='string' && CHOSEN_ID.test(args.chosen)) command.push('--chosen',args.chosen);
  command.push(...args.artifacts.map(item=>'./'+item.path));
  const result = spawnSync(process.execPath,command,{cwd:root,encoding:'utf8',windowsHide:true,shell:false,timeout:30000,env:{...process.env,SOCIAL_PIPELINE_ROOT:root}});
  const appliedAt = new Date().toISOString();
  const status = result.status===0?'applied':'needs_reconciliation';
  const reopened = result.status===0 && args.reviewId===FINDINGS_GATE && args.decision!=='approve' ? reopenReport(root,validated.snapshot.brand.slug,args.jobId) : null;
  const next = {...record,status,confirmedBy,actorUserId:null,ownershipStatus:'unbound',appliedAt,detail:result.error?.message || result.stderr || result.stdout,...(labelCheck?.required ? {labelCheck:{checkedAt:labelCheck.checkedAt,accepted:labelCheck.accepted}} : {}),...(reopened ? {reopened} : {}),artifactReceipt:artifactReceipt(record,{status,appliedAt})};
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp,JSON.stringify(next,null,2));renameSync(temp,file);
  if(result.status!==0) throw new Error('The decision needs reconciliation. Inspect the request and local approval before retrying.');
  return next;
}

function reopenReport(root, brand, jobId) {
  const job = facts.jobAt(root, brand, jobId);
  const moved = job ? facts.moveJobTo(job, 'REPORT_DRAFTING', { by: 'pipeline_decision_apply' }) : { ok: false };
  return moved.ok ? { from: moved.from, to: moved.to } : null;
}

function storyboardComment(args) {
  const note = typeof args.note==='string' ? args.note.trim() : '';
  const changes = (Array.isArray(args.panels) ? args.panels : []).filter(entry=>entry?.verdict==='changes')
    .map(entry=>`${entry.deliverable ? `${entry.deliverable} ` : ''}${entry.panel}: ${typeof entry.note==='string' && entry.note.trim() ? entry.note.trim() : 'change this panel'}`);
  return [note,...changes].filter(Boolean).join('\n');
}

function applySampleDecision({file,record,args,validated,confirmedBy}) {
  const sample = validated.registered;
  const [shown] = sample.artifacts;
  const approve = args.decision==='approve';
  const note = typeof args.note==='string' ? args.note.trim().slice(0,4000) : '';
  const claimed = claimBoardRequest(file);
  if(claimed) return claimed;
  const decidedAt = new Date().toISOString();
  const saved = {key:sample.sample.key,file:shown.path,sha256:shown.sha256,decision:approve?'approve':'changes',decidedAt,by:confirmedBy,requestId:record.requestId};
  mkdirSync(join(validated.dir,'approvals'),{recursive:true});
  writeJsonAtomic(join(validated.dir,...SAMPLE_DECISION_FILE.split('/')),saved);
  const decision = {decision:args.decision,note,decidedBy:confirmedBy,decidedAt,requestId:record.requestId,sample:saved};
  const summary = approve ? 'Sample approved' : `Changes asked on the sample${note ? `: ${note}` : ''}`;
  const event = pipelineEvents.makeEvent(args.jobId,'decision.recorded',decidedAt,{type:'gate',id:SAMPLE_GATE},{gate:SAMPLE_GATE,decision:args.decision,note:summary},{jobId:args.jobId,brandId:validated.snapshot.brand?.id,requestId:record.requestId,source:'local'});
  appendFileSync(join(validated.dir,'events.jsonl'),`${JSON.stringify(event)}\n`);
  const next = {...record,status:'applied',confirmedBy,actorUserId:null,ownershipStatus:'unbound',appliedAt:decidedAt,decision,artifactReceipt:artifactReceipt(record,{status:'applied',appliedAt:decidedAt})};
  writeJsonAtomic(file,next);
  return next;
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2));
  renameSync(temp, file);
}

// A price decision has no pipeline gate to move: it is recorded on the price
// review (which stops it being pending) and as a decision event on the job, and
// the media stage reads it as the explicit yes, or the changes to make, before
// any credit is spent.
function applyPriceDecision({root,file,record,args,validated,confirmedBy}) {
  const approve = args.decision==='approve';
  const job = facts.jobAt(root,args.brand,args.jobId);
  const current = job ? facts.readQuote(job) : null;
  if(!current) throw new Error('This price is no longer saved. Ask Claude to save and present it again.');
  const shown = args.artifacts.find(item=>item.path===facts.FACT_FILES.quote);
  if(!shown || shown.sha256!==current.fileSha256) throw new Error('The price changed after it was shown. Refresh and review it again.');
  const totals = facts.quoteTotals(current.quote.items);
  if(approve && !facts.sameTotals(args.totals,totals)) throw new Error(`Approve this price at the total the board shows: ${facts.priceWords(totals)}.`);
  const claimed = claimBoardRequest(file);
  if(claimed) return claimed;
  const decidedAt = new Date().toISOString();
  const note = typeof args.note==='string' ? args.note.trim().slice(0,4000) : '';
  const pending = facts.pricePending(job);
  const partOf = list => list.filter(item=>item && facts.isTranscriptionItem(item)===false);
  const round = (scope,quoteSha,list) => facts.writePriceApproval(job,{...(scope?{scope}:{}),quoteSha,decision:approve?'approved':'changes_requested',totals:facts.quoteTotals(list),approvedAt:approve?decidedAt:null,by:confirmedBy,decidedAt,requestId:record.requestId,...(note?{note}:{})});
  const written = [];
  if(pending.media) written.push(round(null,current.sha256,partOf(current.quote.items)));
  if(pending.transcription) written.push(round(facts.TRANSCRIPTION_SCOPE,current.transcriptionSha,current.quote.items.filter(item=>item && facts.isTranscriptionItem(item))));
  if(!written.length) written.push(round(null,current.sha256,partOf(current.quote.items)));
  const saved = written[0];
  const decision = {decision:args.decision,totals,note,decidedBy:confirmedBy,decidedAt,requestId:record.requestId,approval:saved.n};
  const reviewPath = reviewFile(root,args.brand,args.jobId,PRICE_GATE);
  writeJsonAtomic(reviewPath,{...read(reviewPath),decision});
  const summary = approve ? `Price approved: ${facts.priceWords(totals)}` : `Changes asked on the price${note ? `: ${note}` : ''}`;
  const event = pipelineEvents.makeEvent(args.jobId,'decision.recorded',decidedAt,{type:'gate',id:PRICE_GATE},{gate:PRICE_GATE,decision:args.decision,totals,approval:saved.n,note:summary},{jobId:args.jobId,brandId:validated.snapshot.brand?.id,requestId:record.requestId,source:'local'});
  appendFileSync(join(validated.dir,'events.jsonl'),`${JSON.stringify(event)}\n`);
  const next = {...record,status:'applied',confirmedBy,actorUserId:null,ownershipStatus:'unbound',appliedAt:decidedAt,decision,artifactReceipt:artifactReceipt(record,{status:'applied',appliedAt:decidedAt})};
  writeJsonAtomic(file,next);
  return next;
}

export function saveJobQuote({root,brand,jobId,items,drop}) {
  root=rootOf(root);
  jobDirectory(root,brand,jobId);
  const job=facts.jobAt(root,brand,jobId);
  if(!job) throw new Error('Job not found in this workspace.');
  const refusal=priceRefusal(job,facts.buildQuote(job,items,{drop}).quote.items);
  if(refusal) throw new Error(refusal);
  const saved=facts.saveQuote(job,items,{drop});
  const outstanding=facts.pricePending(job);
  const approved=!outstanding.media && !outstanding.transcription;
  const count=saved.quote.items.length;
  const words=facts.priceWords(saved.quote.totals);
  return {
    saved:true,
    changed:saved.changed,
    items:count,
    alreadyMade:saved.made,
    dropped:saved.dropped,
    totals:saved.quote.totals,
    approved,
    message:approved
      ? `This price is already approved: ${words}. Nothing new needs approval.`
      : `Saved the price: ${words} for ${count} item${count===1?'':'s'}. Present it with pipeline_review_present and gate price, then wait for approval before making anything.`,
  };
}

const LANDING_NEXT = Object.freeze({
  [facts.THREE_ECHO]: {
    making: item => `${item.item} is still being made. Check it with wait_for_job${item.providerJobId ? ` for job ${item.providerJobId}` : ''}; it is saved automatically when it finishes.`,
    save: item => `Call get_asset for ${item.assetIds?.length ? item.assetIds.join(', ') : 'its output'}; ${item.item} is saved automatically.`,
    not_made: item => `${item.item} could not be made. Make it again with the same job key.`,
  },
  [facts.ELEVEN_LABS]: {
    making: item => `${item.item} is still being made. Check the voice run again; it is saved automatically when it finishes.`,
    save: item => `Check the voice run for ${item.item} again for a fresh link; it is saved automatically.`,
    not_made: item => `${item.item} could not be made. Make it again with the same job tag.`,
  },
});

function landingNote(item) {
  if (item.status === 'landed') return 'Saved.';
  if (item.reason === 'not_started') return 'Not made yet.';
  if (item.reason === 'making') return 'Still being made.';
  if (item.reason === 'waiting_to_save') return 'Made, not saved yet.';
  if (item.reason === 'not_made') return 'It could not be made.';
  return item.note || (item.status === 'expired' ? 'The download link expired before the file was saved.' : 'The file could not be downloaded.');
}

function landingNext(item) {
  const say = LANDING_NEXT[item.provider] || LANDING_NEXT[facts.THREE_ECHO];
  if (item.status === 'landed' || item.reason === 'not_started') return null;
  if (item.reason === 'making') return say.making(item);
  if (item.reason === 'not_made') return say.not_made(item);
  return say.save(item);
}

export async function landGeneration({root,brand,jobId,now=Date.now(),attempts=2,backoffMs=500}) {
  root=rootOf(root);
  jobDirectory(root,brand,jobId);
  const job=facts.jobAt(root,brand,jobId);
  if(!job) throw new Error('Job not found in this workspace.');
  if(!facts.readQuote(job)) return {items:[],counts:{landed:0,pending:0,failed:0,expired:0},retried:[],next:[],message:'There is no saved price for this job yet, so nothing is due to be made.'};
  const retried=[];
  for(const group of facts.landingReport(job,{now}).retry) {
    const outcome=await landOutputs({root:job.root,brand:job.brand,jobId:job.jobId,key:group.key,provider:group.provider,providerJobId:group.providerJobId,outputs:group.outputs,links:group.links},{attempts,backoffMs});
    for(const entry of outcome.landed) retried.push({item:facts.itemLabel(entry.key),assetId:entry.assetId,result:'landed'});
    for(const entry of outcome.failed) retried.push({item:facts.itemLabel(entry.key),assetId:entry.assetId,result:entry.reason==='expired'?'expired':'failed'});
  }
  try { repairPromotions(job); } catch {}
  const report=facts.landingReport(job,{now});
  const items=report.items.map(item=>({item:item.item,kind:item.kind,provider:item.provider,status:item.status,note:landingNote(item),...(item.files?{files:item.files}:{}),...(item.assetIds?.length?{assetIds:item.assetIds}:{})}));
  const counts={landed:0,pending:0,failed:0,expired:0};
  for(const item of report.items) counts[item.status]+=1;
  const next=report.items.map(landingNext).filter(Boolean);
  const total=report.items.length;
  const parts=[`${counts.landed} of ${total} item${total===1?'':'s'} saved`];
  if(counts.pending) parts.push(`${counts.pending} still to come`);
  if(counts.failed) parts.push(`${counts.failed} failed`);
  if(counts.expired) parts.push(`${counts.expired} with an expired link`);
  return {items,counts,retried,next,...(report.promotionNote?{unpromoted:report.unpromoted,promotionNote:report.promotionNote}:{}),message:`${parts.join(', ')}.${report.promotionNote?` ${report.promotionNote}`:''}`};
}
