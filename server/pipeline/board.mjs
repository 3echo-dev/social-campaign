import { randomUUID, createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, realpathSync, statSync, renameSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as runtime from './runtime.mjs';
import { projectJobMetrics } from '../studio/metrics.mjs';
import { integrationsPath } from '../lib/paths.mjs';
import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import { UserFacingError } from '../lib/errors.mjs';
import { buildJobDocument, parseConcepts, parseQuote, parseStoryboard, postInboxItems, postingKitSection, postingLine, publishStatusSection } from './job-document.mjs';
import * as facts from './facts.mjs';
import { answerQuestion, listQuestions, plainWordsProblem, validateAnswer } from './questions.mjs';
import { landOutputs, repairPromotions } from './land-outputs.mjs';
import { copiesMissingFor, isReviewMediaPath, reviewUrlFor } from './review-copies.mjs';
import { assertContentQc } from './label-qc.mjs';
import { FIELDS as RECIPE_FIELDS, checkRecipePicks, chooseRecipe, readJobRecipes } from './recipe.mjs';
import { chooseStudioWorkspace, readStudioWorkspaceChoice, readStudioWorkspaceList, studioWorkspaceReach, studioWorkspaceInfo } from './studio-workspace.mjs';
import { brandPublishingInfo, chooseMetricoolBrand, isMetricoolQuestion, metricoolBrandReady, metricoolConnected, readMetricoolBrands, reconcileMetricoolChoices, reconcileMetricoolChoicesQuietly } from './metricool.mjs';
import { hasPublishApproval, latestPublishApproval, readApprovedIntent } from './media-host.mjs';
import { attemptState, deliveryReference, projectPublishStatus, readAttempts, resolveAmbiguous, withCloseLock, withSendLock } from './publish-attempts.mjs';
import { agentName, gateAuthor, jobAgentLine, lastChangeAt, onboardingAgents, openHelpers, rosterOf, stuckFor } from './agent-box.mjs';
import { agentLabel, readAgentLines } from './agent-log.mjs';
import { PENDING_LIMIT, isPending, messageId, messageTextProblem, readAgentMessages, saveAgentMessage } from './agent-messages.mjs';
import { PUBLISH_INTENT_FILE, anythingSent, buildPublishIntent, checkPostTime, checkPostType, checkPublishRoute, choosePublishRoute, evaluatePublishPlan, plannedBeforeMetricool, publishContext, readPublishIntent, savePostTime, savePostType, suppliedChecks, withPublishIntent } from './publish-intent.mjs';

const states = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-states.js'));
const campaignReport = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-campaign-report.js'));
const stageMetrics = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-stage-metrics.js'));
const libBrandKit = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-brand-kit.js'));
const pipelineEvents = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-events.js'));
const kinds = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-kinds.js'));
const stagesLib = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-stages.js'));
const wording = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-wording.js'));
const deliverableRules = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-deliverable.js'));
const handoffRules = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-handoff-validation.js'));
const REQUEST_ID = /^[a-zA-Z0-9_-]{8,100}$/;
// TODO(B1): handoff.mjs is written in parallel (handoffState(job) -> { status, line } | null). Until it lands the board works without it.
let handoffLib = null;
try { handoffLib = await import('./handoff.mjs'); } catch { /* no hand-off module yet: no offer, no status line */ }
const catalogueLib = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot,'scripts','lib-catalogue.js'));
const POST_OR_CAMPAIGN = 'Post or campaign';
// The words for each kind (the short label on a job card, the pipeline's own name) come from the pipeline catalogue, so a new
// kind needs no constant here. Built on first use and kept: the registries only change with a plugin update, which restarts the server.
// A catalogue that does not line up is a build failure the tests catch; if one ever shipped, the board still shows, with plain labels.
let kindWords = null;
function kindWordsOf() {
  if (kindWords) return kindWords;
  try { kindWords = catalogueLib.kindIndex(); } catch { kindWords = {}; }
  return kindWords;
}
const LINK_LIMIT = 20;
const NEEDS_A_BRAND = 'A post or campaign needs a brand. Choose one, or onboard a new one.';

// The words on a job's state badge: the label lib-states gives the state ("Posting", "Delivered"), except the two that speak in the first
// person ("before I can carry on"), which read as the board's own plain words, and the few that are a whole sentence, which are shortened. An unknown state has none, and the board shows its name.
const BADGE_OVERRIDES = Object.freeze({
  UNSUPPORTED: 'Not supported yet', BLOCKED: 'Held up',
  // Labels of a whole sentence are shortened so the badge stays one line.
  INTAKE_PENDING: 'Waiting for details', RESEARCH_RUNNING: 'Researching', CONCEPT_APPROVED: 'Concept picked', STORYBOARD_APPROVED: 'Storyboard approved',
  AWAITING_PUBLISH_APPROVAL: 'Confirm posting', AWAITING_REPORT_REVIEW: 'Review the report', PROPOSAL_APPROVED: 'Plan approved', ACTIVATION_APPROVED: 'Approved to go live',
});
export function badgeLabel(state) {
  if (BADGE_OVERRIDES[state]) return BADGE_OVERRIDES[state];
  return states.exists(state) ? states.label(state) : '';
}

export function kindLabel(kind) {
  const id = runtime.jobKindOf(kind);
  return (id && kindWordsOf()[id]?.label) || POST_OR_CAMPAIGN;
}

function isReportKind(kind) {
  const entry = kinds.kindOf(kind);
  return Boolean(entry && entry.status === 'active' && entry.makesContent === false);
}
const digest = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));

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

function boardBrandProfile(brand) {
  let profile;
  try { profile = read(join(brand.path, 'brand', 'profile.json')); } catch { return null; }
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

function boardArtifact(artifact) {
  return { path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes, kind: artifact.kind };
}

// Intake questions the board can answer inline. The keys are the job fields
// route-job.js names in route.missingFields (rule 1 reports schema paths such as
// "audience.description", rules 2 and 3 add "deliverables (at least one)",
// "budget" and "landingPageUrl"); intakeFieldKey maps each one to the top-level
// field the form asks about. Anything else stays a plain blocker for chat.
const PLATFORM_LABELS = Object.freeze({ facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X', threads: 'Threads', youtube: 'YouTube' });
const option = ([value, label]) => ({ value, label });
let kindChoices = null;
const kindOptions = () => (kindChoices ??= Object.freeze(Object.entries(kindWordsOf()).filter(([, words]) => !words.report).map(([kind, words]) => option([kind, words.name]))));
export const INTAKE_OPTIONS = Object.freeze({
  // The pipelines that make or post content, named as the catalogue names them, so a new kind is offered here with no list to edit.
  // Built on first use, not when this file loads, so a catalogue problem never stops the board from starting.
  get kind() { return kindOptions(); },
  objective: Object.freeze([['awareness', 'Awareness'], ['engagement', 'Engagement'], ['traffic', 'Website traffic'], ['leads', 'Leads'], ['sales', 'Sales'], ['app_installs', 'App installs'], ['retention', 'Retention']].map(option)),
  distribution: Object.freeze([['organic', 'Organic'], ['paid', 'Paid'], ['both', 'Organic and paid']].map(option)),
  format: Object.freeze([['static_image', 'Image'], ['carousel', 'Carousel'], ['brand_video', 'Brand video'], ['ugc', 'UGC video'], ['motion_graphic', 'Motion graphic'], ['text_only', 'Text only']].map(option)),
});
// The post types each platform offers, as the board's per-deliverable choice. The rules live in
// lib-deliverable.js so the router, the read path and this form agree on them. A carousel is left
// out while its discipline cannot be made; it appears here on its own once the registry says so.
export function intakePlacements() {
  return Object.fromEntries(deliverableRules.placementPlatforms().map(platform => [
    platform,
    deliverableRules.offeredPlacementsFor(platform).map(value => {
      const noun = deliverableRules.PLACEMENT_NOUNS[value];
      return option([value, noun[0].toUpperCase() + noun.slice(1)]);
    }),
  ]));
}
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

// route-job.js rule 1c: a deliverable with no post type, or a post type it cannot be. The words in
// the brackets are already plain; the path in front is what maps it back to the deliverables question.
const placementSentence = words => (/[?.]$/.test(words) ? words : `${words}.`);
const PLAIN_NEEDS = Object.freeze([
  [/^platform:\s*([a-z]+)/i, hit => `${PLATFORM_LABELS[hit[1].toLowerCase()] || 'That platform'} is not supported yet. Choose Facebook, Instagram or TikTok.`],
  [/^(?:creativeDiscipline|discipline):/i, () => 'One of the formats is not supported yet. Choose a different format.'],
  [/^(?:kind|workflow):/i, () => 'This type of content is not supported yet. Choose a different type.'],
  [/^the product photo at .+, which is not there$/i, () => 'The product photo could not be found. Add it again.'],
  [/^the character picture at .+, which is not there$/i, () => 'The character picture could not be found. Add it again.'],
  [/^the file .+, which is not there$/i, () => 'A file named in the brief could not be found. Add it again.'],
  [deliverableRules.PLACEMENT_ENTRY, hit => placementSentence(deliverableRules.placementEntryWords(hit[0]))],
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
  return (Array.isArray(job.deliverables) ? job.deliverables : []).map((item, index) => [item, index]).filter(([item]) => plainObject(item)).filter(([item]) => PLATFORMS_V1.includes(item.platform)).slice(0, 20).map(([item, index]) => {
    const extra = {};
    if (Array.isArray(item.aspectRatios)) extra.aspectRatios = item.aspectRatios.filter(ratio => ASPECT_RATIOS.has(ratio));
    if (item.durationSeconds === null || plainObject(item.durationSeconds)) extra.durationSeconds = item.durationSeconds;
    if (typeof item.locale === 'string' && item.locale.length <= 20) extra.locale = item.locale;
    if (typeof item.talkingCharacter === 'boolean') extra.talkingCharacter = item.talkingCharacter;
    return {
      id: typeof item.id === 'string' && /^D\d+$/.test(item.id) ? item.id : null,
      // How the router's post type entries point at this one: its id, or its position when it has none.
      ref: typeof item.id === 'string' && item.id ? item.id : `[${index}]`,
      platform: item.platform,
      count: Number.isInteger(item.count) && item.count >= 1 ? item.count : 1,
      format: INTAKE_OPTIONS.format.some(entry => entry.value === item.creativeDiscipline) ? item.creativeDiscipline : '',
      // The post type this deliverable already has, or the one an older job can only be.
      placement: deliverableRules.derivePlacement(item) || '',
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
  let deliverablesOtherwise = false;
  for (const item of [...(route.missingFields || []), ...(route.missing || [])]) {
    const text = typeof item === 'string' ? item : JSON.stringify(item);
    if (sourceQuestion(text)) { source = sourceQuestion(text); missing.add('links'); continue; }
    const head = text.replace(/\s*\(.*\)\s*$/, '').split(/[.[]/)[0].trim();
    if (INTAKE_NEVER_ASKED.has(head)) continue;
    const key = intakeFieldKey(item);
    if (key === 'deliverables' && !deliverableRules.placementEntryRef(item)) deliverablesOtherwise = true;
    if (key) missing.add(key);
    else if (plainNeed(item)) other.push(plainNeed(item));
  }
  const knownPlatforms = (Array.isArray(job.platforms) ? job.platforms : []).filter(name => PLATFORMS_V1.includes(name));
  if (missing.has('deliverables') && !knownPlatforms.length) missing.add('platforms');
  // What the router said about each deliverable's post type, in words, to show under that row.
  const placementNotes = {};
  for (const item of [...(route.missingFields || []), ...(route.missing || [])]) {
    const ref = deliverableRules.placementEntryRef(item);
    // A question about a missing post type is a hint; anything else is a rule the choice breaks.
    if (ref) {
      const words = deliverableRules.placementEntryWords(item);
      placementNotes[ref] = { text: placementSentence(words), kind: words.endsWith('?') ? 'ask' : 'conflict' };
    }
  }
  const blockedOn = BLOCKED_STATES.has(snapshot.project?.state) || snapshot.status?.blockedOn === wording.QUESTION_BLOCKED_ON ? null : snapshot.status?.blockedOn;
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
      // Paid-only work has its own placements, so it is asked for no post type: no choices, no mark.
      if (deliverableRules.asksForPlacement(job)) field.placements = intakePlacements();
      if (Object.keys(placementNotes).length) {
        field.notes = placementNotes;
        // When only the post type is missing, that is all the Inbox asks about.
        if (!deliverablesOtherwise) field.question = Object.values(placementNotes).map(note => note.text).join(' ');
      }
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
        onlyKeys(item, ['id', 'platform', 'count', 'creativeDiscipline', 'placement', 'ugcSource', 'talkingCharacter', 'aspectRatios', 'durationSeconds', 'locale'], 'deliverables');
        if (typeof item.id !== 'string' || !/^D\d+$/.test(item.id) || ids.has(item.id)) throw new TypeError('Each format needs a distinct id such as D1.');
        ids.add(item.id);
        if (!PLATFORMS_V1.includes(item.platform)) throw new TypeError(`Each format needs a platform from ${PLATFORMS_V1.join(', ')}.`);
        if (!Number.isInteger(item.count) || item.count < 1 || item.count > 100) throw new TypeError('Each quantity must be a whole number from 1 to 100.');
        if (!INTAKE_OPTIONS.format.some(entry => entry.value === item.creativeDiscipline)) throw new TypeError('Each format must be a supported format.');
        if (item.creativeDiscipline === 'ugc' ? item.ugcSource !== 'ai' : item.ugcSource !== undefined) throw new TypeError('UGC formats are AI generated; only a UGC format carries ugcSource ai.');
        if (item.placement !== undefined && !deliverableRules.placementBelongs(item.platform, item.placement)) throw new TypeError(`Choose a post type that ${PLATFORM_LABELS[item.platform] || item.platform} has: ${deliverableRules.placementChoices(item.platform)}.`);
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
  const metricoolBrands = readMetricoolBrands(root);
  const metricoolOn = metricoolConnected(root);
  const stuckCtx = stuckContext(root);
  return runtime.listJobs({ root }).filter(job => !jobIds || jobIds.includes(job.jobId)).map(job => {
    const snapshot = withOpenQuestions(runtime.readJobSnapshot({ root, brand: job.brand, jobId: job.jobId }), questionsByJob.get(job.jobId));
    const { gate, review } = pendingReview(root, job.brand, job.jobId, snapshot);
    const reviewUrl = ({ sha256 }) => reviewUrlFor(root, { brand: job.brand, jobId: job.jobId, sourceSha: sha256 });
    const studioWorkspace = gate === PRICE_GATE || gate === 'publish' ? studioWorkspaceInfo({ root, brandDir: brandDirBySlug.get(job.brand) || null, jobDir: job.path }) : null;
    const details = jobDetails({ root, job, snapshot, gate, review, profile: profileOf(job.brand), usage: jobUsage(root, job, snapshot) });
    const inbox = jobDocumentInbox(jobInbox({ root, snapshot, gate, review, intake: details.intake, questions: questionsByJob.get(job.jobId), dir: job.path }));
    const brandDir = brandDirBySlug.get(job.brand) || null;
    const publish = gate === 'publish' ? publishContext({ root, brandDir, jobDir: job.path, jobRoute: snapshot.job?.publishRoute, channels: profileOf(job.brand)?.channels, brands: metricoolBrands, connected: metricoolOn }) : null;
    // The card is ready only when approval would accept it: the same fresh build and live checks decide both.
    if (publish) {
      publish.handoffOnly = plannedBeforeMetricool(snapshot);
      try { publish.evaluation = evaluatePublishPlan({ root, brand: job.brand, jobId: job.jobId, measure: 'display' }); }
      catch { publish.evaluation = { ready: false, changed: false, reason: REVIEW_NOT_READY, checks: null }; }
    }
    const document = buildJobDocument({ dir: job.path, root, workspaceId, project: snapshot.project, job: snapshot.job, gate, review, details, inbox, reviewUrl, thumbDir: thumbnailDirectory(root), studioWorkspace, publish, handoffOnly: plannedBeforeMetricool(snapshot), agents: { snapshot, requests: stuckCtx.requests.get(job.jobId) || [], retriedAt: stuckCtx.retriedAt(job), blockedLine: blockedReason(snapshot) } });
    if (gate === 'content' && document.review && kinds.suppliesMedia(snapshot.job?.kind)) suppliedCardChecks(document.review, { root, brand: job.brand, jobId: job.jobId });
    return { jobId: job.jobId, brand: job.brand, terminal: states.isTerminal(snapshot.project.state), document };
  });
}

// The final-post card of a post made from supplied files shows the checks on each post (the same ones approval runs) and no
// label check: that check is skipped for the person's own finished files, so its "not checked yet" must never hold the card.
function suppliedCardChecks(review, { root, brand, jobId }) {
  delete review.labelCheck;
  try {
    const checked = suppliedChecks({ root, brand, jobId, measure: 'display' });
    review.checks = { ready: checked.ready, posts: Object.entries(checked.posts).map(([id, list]) => ({ id, label: checked.labels?.[id] || null, checks: list.map(item => ({ ok: item.ok, text: item.text })) })) };
  } catch {
    review.checks = { ready: false, posts: [], reason: REVIEW_NOT_READY };
  }
}

function rawBrandProfile(brandDir) {
  if (!brandDir) return null;
  try { return read(join(brandDir, 'brand', 'profile.json')); } catch { return null; }
}

function jobUsage(root, job, snapshot) {
  return stageMetrics.jobUsage(job.path, root, { createdAt: snapshot.job?.createdAt });
}

function jobBlockers(snapshot) {
  // "Your answer to a question" is the open question itself, already shown as a question, not a missing field.
  return [snapshot.status.blockedOn === wording.QUESTION_BLOCKED_ON ? null : snapshot.status.blockedOn, ...(snapshot.route?.blockers || snapshot.route?.missingFields || snapshot.route?.missing || [])].filter(value => value && value !== 'Nothing').map(plainNeed).filter(Boolean);
}

const BLOCKED_STATES = new Set(['BLOCKED', 'ESCALATED']);

function blockedReason(snapshot) {
  if (!BLOCKED_STATES.has(snapshot.project.state)) return null;
  const said = plainNeed(snapshot.status?.blockedOn);
  if (!said || plainWordsProblem(said)) return null;
  const reason = wording.blockedReason(said);
  return reason && !plainWordsProblem(reason) ? reason : null;
}

// A stage goes to the board with its plan rows in plain words: the row's short name and summary line, who has it, its status,
// and the files it makes (shown only as titles of files the job already lists). The raw task text of a plan row never goes.
function boardTask(task) {
  if (!plainObject(task)) return null;
  const outputs = String(task.artifact ?? '').split(',').map(part => part.replace(/`/g, '').trim()).filter(Boolean).slice(0, 8);
  return {
    name: String(task.label || '').trim() || 'Step',
    ...(task.line ? { line: String(task.line) } : {}),
    agent: String(task.agent ?? '').replace(/`/g, '').trim() || null,
    ...(String(task.gate ?? '').replace(/`/g, '').trim() ? { gate: String(task.gate).replace(/`/g, '').trim() } : {}),
    status: task.status || 'pending',
    ...(task.gateStatus ? { gateStatus: task.gateStatus } : {}),
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.doneAt ? { doneAt: task.doneAt } : {}),
    ...(outputs.length ? { outputs } : {}),
  };
}

function boardStage(stage) {
  if (!plainObject(stage)) return stage;
  const { tasks, ...rest } = stage;
  const list = Array.isArray(tasks) ? tasks.map(boardTask).filter(Boolean) : [];
  return list.length ? { ...rest, tasks: list } : rest;
}

const SETTLED_STAGE_STATUSES = new Set(['complete', 'pending', 'cancelled']);

function stageSummary(stages) {
  const list = Array.isArray(stages) ? stages : [];
  const current = list.find(stage => plainObject(stage) && !SETTLED_STAGE_STATUSES.has(stage.status));
  return { done: list.filter(stage => plainObject(stage) && stage.status === 'complete').length, total: list.length, current: current?.label || null };
}

/**
 * While the Director has a question open on a job, the job is waiting on the person, not moving on: the first stage that is not
 * finished shows as waiting (the same status a decision uses), its running steps wait too, and the next action and "blocked on"
 * line say it is the person's answer. Returns the snapshot unchanged when there is nothing to show; never edits the one it is given.
 */
export function withOpenQuestions(snapshot, open) {
  if (!Array.isArray(open) || !open.length) return snapshot;
  const state = snapshot.project?.state;
  if (states.isTerminal(state) || BLOCKED_STATES.has(state) || states.gateOf(state)) return snapshot;
  let marked = false;
  const stages = (snapshot.project.stages || []).map(stage => {
    if (marked || !plainObject(stage) || stage.status === 'complete' || stage.status === 'cancelled') return stage;
    marked = true;
    if (stage.status !== 'running' && stage.status !== 'pending') return stage;
    return { ...stage, status: 'waiting', tasks: (stage.tasks || []).map(task => task?.status === 'running' ? { ...task, status: 'waiting' } : task) };
  });
  const status = { ...(snapshot.status || {}), nextAction: wording.QUESTION_NEXT_ACTION };
  return { ...snapshot, project: { ...snapshot.project, stages }, status };
}

const PRICE_LIST_STAGES = new Set(['pricing-the-media', 'your-approval-of-the-price']);

// The price list (pricing/quote.json) outlives the review that showed it: once the price is approved the pending review is gone, so the
// pricing step and the price decision carry the same itemised quote the review drew, and the pricing step the time it took.
export function withPriceList(stages, jobPath) {
  if (!jobPath || !stages.some(stage => PRICE_LIST_STAGES.has(stage?.id))) return stages;
  const job = { dir: jobPath };
  const saved = facts.readQuote(job);
  if (!saved) return stages;
  const made = new Set(facts.readRecords(job).filter(record => record.type === 'create').map(record => facts.canonicalJobKey(record.key)).filter(Boolean));
  const estimates = facts.readEstimates(job);
  const quote = parseQuote(saved.quote, { made, estimates });
  if (!quote.items.length) return stages;
  const times = estimates.map(entry => entry?.at).filter(at => typeof at === 'string' && Number.isFinite(Date.parse(at))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return stages.map(stage => {
    if (stage?.id === 'pricing-the-media') {
      const timed = !stage.tasks?.length && times.length && stage.status === 'complete';
      return { ...stage, quote, ...(timed ? { startedAt: times[0], doneAt: times[times.length - 1] } : {}) };
    }
    if (stage?.id === 'your-approval-of-the-price' && Array.isArray(stage.gates)) return { ...stage, gates: stage.gates.map(entry => (entry?.gate === PRICE_GATE ? { ...entry, quote } : entry)) };
    return stage;
  });
}

function jobDetails({ root, job, snapshot, gate, review, profile, usage }) {
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
    stages: withPriceList((snapshot.project.stages || []).map(boardStage), job.path),
    usageStages: usage.stages.map(({ id, label, kind, tokens: stageTokens, elapsedMs, openSince }) => ({ id, label, kind, tokens: stageTokens, elapsedMs, openSince })),
    metrics: { recordedTokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) : null, tokens: projection.tokens, coverage: { tokens: projection.coverage.tokens } },
    brandProfile: snapshot.project.brandProfile || null,
    artifacts: snapshot.artifacts.map(item => boardArtifact(item)),
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

function openQuestionsByJob(root, { readOnly = false } = {}) {
  const byJob = new Map();
  for (const question of listQuestions({ root, status: 'open', readOnly })) {
    const key = question.jobId || null;
    if (!byJob.has(key)) byJob.set(key, []);
    byJob.get(key).push(question);
  }
  return byJob;
}

const NEEDS_ANSWER_IN_CHAT = 'Answer Claude in the chat';

function questionItem(question, place) {
  if (question.inChat) return { kind: 'question', ...place, brand: question.brand || null, text: question.text, inline: false, inChat: true, need: NEEDS_ANSWER_IN_CHAT, questionId: question.questionId, options: [], allowText: false, at: inboxAt(question.askedAt) };
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
  if (gate === 'publish') return 'Nothing goes out until you approve.';
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

export function briefItems({ intake, place, revision, at }) {
  if (!intake) return [];
  const missing = (Array.isArray(intake.fields) ? intake.fields : []).filter(field => field.missing);
  const other = [...new Set((Array.isArray(intake.other) ? intake.other : []).map(plainNeedForInbox))];
  const total = missing.length + other.length;
  if (!total) return [];
  const base = { kind: 'brief', ...place };
  const ask = field => {
    const inline = SHORT_BRIEF_FIELDS.has(field.key);
    const item = { ...base, text: field.question || wording.briefQuestion(field.key, field.need), inline, field: field.key, input: field.input, revision, at };
    if (inline && Array.isArray(field.options)) item.choices = field.options.map(({ value, label }) => ({ value, label }));
    return item;
  };
  const allShort = missing.every(field => SHORT_BRIEF_FIELDS.has(field.key));
  if (!other.length && (missing.length === 1 || (missing.length <= BRIEF_INLINE_LIMIT && allShort))) return missing.map(ask);
  if (!missing.length && other.length === 1) return [{ ...base, text: other[0], inline: false, at }];
  return [{ ...base, text: wording.FINISH_BRIEF, inline: false, summary: `${plural(total, 'thing')} still needed.`, at }];
}

// What the posts of a job say about it, read from the status list and the posting kit: the Inbox items the person is needed
// for, and the line that heads the job while the posts are out. The lines only apply once the plan is approved; a finished job
// says so (COMPLETE only) instead of "ready for you to post". Never throws.
function postingState(dir, state, jobId, place, at) {
  const none = { items: [], line: null };
  if (!dir) return none;
  try {
    const status = publishStatusSection(dir, Date.now());
    const kit = postingKitSection(dir, null, Date.now(), state);
    const closed = state === 'COMPLETE';
    const items = postInboxItems({ status, kit, jobId, closed }).map(item => ({ ...item, ...place, at }));
    const line = postingLine({ status, kit, state, marked: Object.keys(handoffRules.readPersonPosts(dir)).length > 0 });
    return { items, line };
  } catch {
    return none;
  }
}

// The Post-production round trip (handoff.mjs): the job's hand-off status and the plain line for it, or null. Never throws.
function handoffOf(dir, project) {
  if (!dir || typeof handoffLib?.handoffState !== 'function') return null;
  try {
    const state = handoffLib.handoffState({ dir, path: dir, jobDir: dir, jobId: project?.jobId, brand: project?.brand });
    return state && typeof state.status === 'string' ? { status: state.status, line: typeof state.line === 'string' ? state.line : '' } : null;
  } catch { return null; }
}

const HANDOFF_OFFER_TEXT = 'Send this to Post-production for a full edit, or finish it here?';
const HANDOFF_RETURN_TEXT = 'The edit is released. Bring the final video back?';
// Owned by the Director (no `from`), and like every item here it counts as needing the person.
function handoffItems(handoff, place, at) {
  if (handoff?.status === 'suggested') return [{ kind: 'handoff_offer', ...place, text: HANDOFF_OFFER_TEXT, inline: false, at }];
  if (handoff?.status === 'released') return [{ kind: 'handoff_return', ...place, text: HANDOFF_RETURN_TEXT, inline: false, at }];
  return [];
}

function jobInbox({ root, snapshot, gate, review, intake, questions, dir }) {
  const place = { jobId: snapshot.project.jobId, jobTitle: snapshot.project.title || null, brandName: snapshot.brand?.name || null };
  const at = inboxAt(snapshot.status?.updatedAt, snapshot.job?.createdAt);
  const posting = postingState(dir, snapshot.project.state, snapshot.project.jobId, place, at);
  const handoff = handoffOf(dir, snapshot.project);
  const items = [
    ...(questions || []).map(question => questionItem(question, place)),
    ...(gate ? [decisionItem({ root, snapshot, gate, review, place, dir })] : []),
    ...briefItems({ intake, place, revision: snapshot.project.revision, at }),
    ...posting.items,
    ...handoffItems(handoff, place, at),
  ].sort(newestFirst);
  const state = snapshot.project.state;
  const pricedJob = state === 'STORYBOARD_APPROVED' ? facts.jobAt(root, snapshot.project.brand, snapshot.project.jobId) : null;
  const priceApproved = Boolean(pricedJob && facts.currentPriceApproval(pricedJob));
  const held = state === 'INTAKE_PENDING' && snapshot.job?.pipelineUnsure === true;
  const withPost = handoff?.status === 'sent' && handoff.line ? handoff.line : null;
  const announcement = blockedReason(snapshot) || posting.line || withPost || (held ? 'Waiting for one answer from you.' : null) || wording.announcement(state, { workflowId: snapshot.route?.workflowId || null, priceApproved });
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

/**
 * The few files the Inbox helpers read for one job, and nothing else. Unlike readJobSnapshot it
 * never lists or hashes the job's artifacts, so it stays cheap when a job holds large media.
 */
function lightSnapshot(job) {
  const dir = job.dir || job.path || job.jobDir;
  const readJsonOr = (name, fallback) => {
    try { return JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { return fallback; }
  };
  let text = '';
  try { text = readFileSync(join(dir, 'status.md'), 'utf8'); } catch { /* a job with no status file shows no detail */ }
  const find = name => text.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*\`?([^\`\\r\\n]*)\`?`, 'i'))?.[1]?.trim() || null;
  const data = readJsonOr('job.json', {});
  const state = job.state || find('Current state') || 'UNKNOWN';
  const revision = Number.isSafeInteger(job.revision) ? job.revision : 0;
  return {
    project: { jobId: job.jobId, brand: job.brand, title: data.title || job.jobId, state, revision },
    brand: { name: null },
    job: plainObject(data) ? data : {},
    route: readJsonOr('route.json', null),
    plan: existsSync(join(dir, 'plan.md')) ? {} : null,
    status: { state, revision, blockedOn: find('Blocked on'), updatedAt: find('Last updated') },
  };
}

/** The open questions by job, read without creating anything. Build it once and pass it to every personWaiting call. */
export function openQuestionsForWaiting(root) {
  return openQuestionsByJob(rootOf(root), { readOnly: true });
}

/**
 * What the person is needed for on this job, worded as the board shows it, or null when
 * nobody is waiting. Built from the same pieces as the Inbox (reviews and price checks,
 * open questions, brief fields, blockers), so the stop hook and the board cannot disagree.
 * Pass the map from openQuestionsForWaiting when asking about several jobs.
 */
export function personWaiting(root, job, { questions = null } = {}) {
  root = rootOf(root);
  const snapshot = lightSnapshot(job);
  const state = snapshot.project.state;
  if (states.isTerminal(state)) return null;
  const { gate, review } = pendingReview(root, job.brand, job.jobId, snapshot);
  const open = (questions || openQuestionsForWaiting(root)).get(job.jobId);
  const inbox = jobInbox({ root, snapshot, gate, review, intake: projectIntake(snapshot, null), questions: open, dir: job.dir || job.path });
  // A post waiting for the person (the kit to post, an answer to give) keeps the stop hook waiting; a job Claude is closing does not.
  const item = inbox.items.find(entry => !entry.closing);
  if (item) return { kind: item.kind, gate: item.gate || null, reason: item.text };
  const blocker = blockedReason(snapshot);
  if (blocker) return { kind: 'blocker', gate: null, reason: blocker };
  if (BLOCKED_STATES.has(state) && jobBlockers(snapshot).length) return { kind: 'blocker', gate: null, reason: inbox.announcement };
  if (state === 'HANDOFF_READY') return { kind: 'handoff', gate: null, reason: inbox.announcement };
  return null;
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

/** The connectors offered on the board's Connectors setup step, in setupStep order. An optional one never holds the setup step back. */
export const CONNECTORS = [
  { key: 'threeecho_studio', name: '3Echo Studio', description: 'Makes the images and videos.' },
  { key: 'elevenlabs', name: 'ElevenLabs', description: 'Makes the voice-over.' },
  { key: 'metricool', name: 'Metricool', description: 'Schedules your posts to Facebook, Instagram and TikTok.', optional: true },
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

// The person pressed Continue on the first setup's Connectors step. Every connector that is not connected yet is skipped for
// now, so it reads Skipped on the Connectors page and can still be connected from there later.
function recordConnectorsContinue(root) {
  const states = connectorsSnapshot(root);
  const skipped = states.filter(connector => connector.state === 'not_connected').map(connector => connector.key);
  for (const provider of skipped) recordConnectorSkip(root, provider);
  updateJsonFile(
    integrationsPath(root),
    (current) => ({ ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}), connectorsReviewedAt: new Date().toISOString() }),
    { providers: {}, connectorSkips: {} },
  );
  return { state: 'continued', skipped };
}

function connectorsSnapshot(root) {
  const file = readIntegrationsFile(root);
  const providers = integrationProviders(file);
  const skips = integrationConnectorSkips(file);
  return CONNECTORS.map(({ key, name, description, optional }) => {
    const record = providers[key];
    const connected = Boolean(record && typeof record === 'object' && record.state === 'connected');
    const skip = skips[key];
    const skipped = !connected && Boolean(skip && typeof skip === 'object' && skip.skipped);
    const card = { key, name, description, state: connected ? 'connected' : skipped ? 'skipped' : 'not_connected' };
    if (optional) card.optional = true;
    if (key === 'metricool') card.brandCount = readMetricoolBrands(root).length;
    return card;
  });
}

export function boardSnapshot({ root } = {}) {
  root = rootOf(root);
  const workspace = runtime.readWorkspace({ root });
  // The raw saved profile, used only to prefill intake answers (the audience and
  // which channels exist), never projected as a whole.
  const rawProfiles = new Map();
  const studioWorkspaces = readStudioWorkspaceList(root);
  const metricoolBrands = readMetricoolBrands(root);
  const metricoolOn = metricoolConnected(root);
  const rawBrandEntries = runtime.listBrands({ root });
  const brands = rawBrandEntries.map(brand => {
    let raw = null;
    try { raw = read(join(brand.path, 'brand', 'profile.json')); rawProfiles.set(brand.slug, raw); } catch { /* No saved profile yet. */ }
    const profile = boardBrandProfile(brand);
    const usage = stageMetrics.brandResearchUsage(brand.path, root);
    const kit = libBrandKit.projection(brand.path, { now: new Date() });
    const readyForJobs = Boolean(brand.readyForJobs);
    const pillars = Array.isArray(raw?.contentPillars) ? raw.contentPillars.map(item => String(item || '').trim()).filter(Boolean) : [];
    const pillarsConfirmed = pillars.length > 0 && readPillarsConfirmed(root, brand.slug, Number(raw?.revision) || 0);
    const brandChoice = readStudioWorkspaceChoice({ brandDir: brand.path });
    const studioWorkspace = brandChoice.workspaceId
      ? { workspaceId: brandChoice.workspaceId, name: studioWorkspaces.find(item => item.id === brandChoice.workspaceId)?.name || brandChoice.name }
      : null;
    const publishing = brandPublishingInfo({ brandDir: brand.path, channels: raw?.channels, brands: metricoolBrands, connected: metricoolOn });
    // The agents behind onboarding (the Director and the Researcher), shown on the Brand onboarding page until the brand is ready.
    const agents = !readyForJobs || usage.status === 'running' ? onboardingAgents({ brandDir: brand.path, brandName: brand.name, usage, onboardingStatus: brand.onboardingStatus, readyForJobs }) : null;
    return {id:brand.id,slug:brand.slug,name:brand.name,onboardingStatus:brand.onboardingStatus,profile,usage,kit,readyForJobs,voice:brand.voice,pillarsConfirmed,studioWorkspace,publishing,...(agents ? { agents } : {})};
  });
  const connectors = connectorsSnapshot(root);
  const questionsByJob = openQuestionsByJob(root);
  const stuckCtx = stuckContext(root);
  const projectEntries = runtime.listJobs({ root }).map(job => {
    const snapshot = withOpenQuestions(runtime.readJobSnapshot({ root, brand:job.brand, jobId:job.jobId }), questionsByJob.get(job.jobId));
    const { gate, review } = pendingReview(root, job.brand, job.jobId, snapshot);
    const intake = projectIntake(snapshot, rawProfiles.get(job.brand) || null);
    const inbox = jobInbox({ root, snapshot, gate, review, intake, questions: questionsByJob.get(job.jobId), dir: job.path });
    const usage = jobUsage(root, job, snapshot);
    const kind = typeof snapshot.job?.kind === 'string' ? snapshot.job.kind : null;
    const report = isReportKind(kind);
    const reason = blockedReason(snapshot);
    const agentLines = readAgentLines(job.path);
    const agentLine = jobAgentLine({ dir: job.path, snapshot, lines: agentLines });
    const stuck = stuckFor({ dir: job.path, snapshot, inboxItems: inbox.items, requests: stuckCtx.requests.get(job.jobId) || [], retriedAt: stuckCtx.retriedAt(job), blockedLine: reason, lines: agentLines });
    // The agent that wrote the work behind a decision, so "Needs you" can say who it is from.
    const inboxItems = inbox.items.map(item => {
      const from = item.kind === 'decision' ? gateAuthor(snapshot.plan?.rows, item.gate) : null;
      return from ? { ...item, from, fromName: agentName(from) } : item;
    });
    const handoffState = handoffOf(job.path, snapshot.project);
    const project = {
      jobId:snapshot.project.jobId,
      brand:snapshot.project.brand,
      brandId:snapshot.project.brandId,
      title:snapshot.project.title,
      brandName:snapshot.brand.name,
      kind,
      kindLabel:kindLabel(kind),
      ...(kind && runtime.kindReasonOf(snapshot.job?.kindReason) ? { kindReason:runtime.kindReasonOf(snapshot.job.kindReason) } : {}),
      state:snapshot.project.state,
      stateLabel:badgeLabel(snapshot.project.state),
      revision:snapshot.project.revision,
      nextAction:jobLine(inbox),
      blockerCount:jobBlockers(snapshot).length,
      ...(reason ? { blockedReason:reason } : {}),
      ...(agentLine ? { agentLine } : {}),
      ...(stuck ? { stuck } : {}),
      ...(handoffState ? { handoff: handoffState } : {}),
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
    return { project, rawEventCount: snapshot.events.length, inboxItems };
  });
  const projects = projectEntries.map(entry => entry.project);
  const localEventCount = projectEntries.reduce((sum,entry) => sum + entry.rawEventCount,0);
  const brandNames = new Map(runtime.listBrands({ root, includeGeneral: true }).map(brand => [brand.slug, brand.name]));
  const inbox = workspaceInbox(projectEntries.flatMap(entry => entry.inboxItems), questionsByJob.get(null) || [], brandNames);
  // A new workspace (no brand and no job yet) opens on the Connectors step until the person presses Continue there, so they
  // see what is connected even when every connector already answers. After that, only a required connector that is neither
  // connected nor skipped brings the step back.
  const firstRun = !readIntegrationsFile(root).connectorsReviewedAt && !brands.length && !projectEntries.length;
  const setupStep = firstRun || connectors.some(connector => !connector.optional && connector.state !== 'connected' && connector.state !== 'skipped')
    ? 'connectors'
    : brands.some(brand => brand.readyForJobs)
      ? 'ready'
      : 'brand_onboarding';
  const projection = { schemaVersion:2, workspace:{workspaceId:workspace.workspaceId,name:basename(root),storageMode:'local'},brands,projects,inbox,connectors,setupStep,studioWorkspaces,metricoolBrands:metricoolBrands.map(({id,label,timezone})=>({id,label,timezone})),identity:null,connection:{status:'not_configured',message:'Studio sync is parked until its API is available. Work is saved locally.',localEventCount,pendingCount:null,lastSyncAt:null},updatedAt:new Date().toISOString() };
  return applyProjectionBudget(projection);
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

// The board stamps each request with the viewer's opaque artifact user id. It is optional (older pages send
// none) and kept only when it is a short printable token; it records who clicked and authorizes nothing.
const REQUESTER_ID = /^[\x21-\x7e]{1,200}$/;
const requesterIdOf = by => (typeof by === 'string' && REQUESTER_ID.test(by) ? by : null);

export function saveBoardRequest({ root,operation,args,source = 'artifact',by = null }) {
  root = rootOf(root);
  if (!['submit_decision','onboard_brand','create_brand','complete_onboarding','create_job','import_inputs','continue_job','update_intake','attach_product_photo','connect_provider','skip_provider','connectors_continue','choose_recipe','choose_studio_workspace','choose_metricool_brand','choose_publish_route','choose_post_type','choose_post_time','resolve_post','mark_posted','answer_question','agent_message','retry_step',...HANDOFF_OPERATIONS].includes(operation)) throw new Error('Unsupported board request.');
  const requestId = args?.requestId || randomUUID();
  if (operation === 'choose_metricool_brand') validateMetricoolChoice(root, args);
  if (operation === 'choose_publish_route') validatePublishRoute(root, args);
  if (operation === 'choose_post_type') validatePostType(root, args);
  if (operation === 'choose_post_time') validatePostTime(root, args);
  if (operation === 'resolve_post') checkResolvePost(root, args);
  if (operation === 'mark_posted') checkMarkPosted(root, args);
  if (operation === 'agent_message') checkAgentMessage(root, args);
  if (operation === 'retry_step') checkRetryStep(root, args);
  if (HANDOFF_OPERATIONS.includes(operation)) checkHandoffRequest(root, operation, args);
  if (operation === 'create_job') createJobFields(args, root);
  if (operation === 'answer_question') validateBoardAnswer(root, args);
  const record = {requestId,operation,args:{...(operation === 'create_job' ? withoutPhoto(args) : args),requestId},source:source === 'local' ? 'local' : 'artifact',status:'requested',createdAt:new Date().toISOString(),...(requesterIdOf(by) ? {by:requesterIdOf(by)} : {})};
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

// The deliverable the way the person sees it ("the Instagram Reel"), never its id.
function deliverableNameOf(root,args) {
  try {
    const spec = deliverableRules.withDerivedPlacements(runtime.readJobSnapshot({root,brand:args.brand,jobId:args.jobId}).job);
    const match = (spec.deliverables||[]).find(item=>item && item.id===args.deliverable);
    return match ? deliverableRules.describe(spec,match) : 'this post';
  } catch { return 'this post'; }
}

function validateMetricoolChoice(root, args) {
  if (!plainObject(args) || typeof args.brand !== 'string' || !args.brand.trim()) throw new Error('Say which brand this is for.');
  if (!runtime.listBrands({ root }).some(item => item.slug === args.brand.trim())) throw new Error('This brand could not be found.');
  if (!metricoolBrandReady(root, args.brand)) throw new Error('Finish this brand\'s profile before choosing where its posts go.');
  if (typeof args.blogId !== 'string' || !readMetricoolBrands(root).some(item => item.id === args.blogId.trim())) throw new Error('Choose one of the Metricool brands shown.');
}

// The board adds the workspace it belongs to to every request; that and the route choice are all a request may carry.
const PUBLISH_ROUTE_FIELDS = new Set(['requestId', 'brand', 'jobId', 'route', 'workspaceId']);

function validatePublishRoute(root, args) {
  if (!plainObject(args) || typeof args.brand !== 'string' || !args.brand.trim()) throw new Error('Say which brand this is for.');
  if (Object.keys(args).some(key => !PUBLISH_ROUTE_FIELDS.has(key))) throw new Error('This request carries more than a route choice, so it was not accepted.');
  if (args.workspaceId !== undefined && args.workspaceId !== runtime.readWorkspace({ root }).workspaceId) throw new Error('This request belongs to another workspace, so it was not accepted.');
  if (typeof args.jobId !== 'string' || !args.jobId.trim()) throw new Error('Say which job this is for.');
  checkPublishRoute({ root, brand: args.brand.trim(), jobId: args.jobId.trim(), route: args.route });
}

// The kind of post for a deliverable that never had one: exactly these fields and the workspace the board belongs to.
const POST_TYPE_FIELDS = new Set(['requestId', 'brand', 'jobId', 'deliverable', 'placement', 'workspaceId']);

function validatePostType(root, args) {
  if (!plainObject(args) || typeof args.brand !== 'string' || !args.brand.trim()) throw new Error('Say which brand this is for.');
  if (Object.keys(args).some(key => !POST_TYPE_FIELDS.has(key))) throw new Error('This request carries more than a post type choice, so it was not accepted.');
  if (args.workspaceId !== undefined && args.workspaceId !== runtime.readWorkspace({ root }).workspaceId) throw new Error('This request belongs to another workspace, so it was not accepted.');
  if (typeof args.jobId !== 'string' || !args.jobId.trim()) throw new Error('Say which job this is for.');
  checkPostType({ root, brand: args.brand.trim(), jobId: args.jobId.trim(), deliverable: args.deliverable, placement: args.placement });
}

// The posting time for one post, or for every post when `deliverable` is left out: exactly these fields and the workspace the board belongs to.
const POST_TIME_FIELDS = new Set(['requestId', 'brand', 'jobId', 'deliverable', 'dateTime', 'workspaceId']);

function validatePostTime(root, args) {
  if (!plainObject(args) || typeof args.brand !== 'string' || !args.brand.trim()) throw new Error('Say which brand this is for.');
  if (Object.keys(args).some(key => !POST_TIME_FIELDS.has(key))) throw new Error('This request carries more than a posting time choice, so it was not accepted.');
  if (args.workspaceId !== undefined && args.workspaceId !== runtime.readWorkspace({ root }).workspaceId) throw new Error('This request belongs to another workspace, so it was not accepted.');
  if (typeof args.jobId !== 'string' || !args.jobId.trim()) throw new Error('Say which job this is for.');
  checkPostTime({ root, brand: args.brand.trim(), jobId: args.jobId.trim(), deliverable: args.deliverable, dateTime: args.dateTime });
}

// ---------------------------------------------------------------------------
// Agent Box requests: a message to an agent, and "Try again" on a stuck job
// ---------------------------------------------------------------------------

// Exactly these fields and the workspace the board belongs to, nothing else and nothing missing.
const AGENT_MESSAGE_FIELDS = new Set(['requestId', 'brand', 'jobId', 'agent', 'text', 'workspaceId']);
const RETRY_STEP_FIELDS = new Set(['requestId', 'brand', 'jobId', 'workspaceId']);
const MESSAGE_COMMENT_CHARS = 80;
const RETRY_MEMORY = 100;
const retriesFile = root => join(root, '.social-pipeline', 'board', 'stuck-retries.json');

function validateJobRequest(root, args, fields, what) {
  if (!plainObject(args)) throw new Error('Say which job this is for.');
  const keys = Object.keys(args);
  if (keys.some(key => !fields.has(key)) || [...fields].some(key => !keys.includes(key))) throw new Error(`This request is not shaped like ${what}, so it was not accepted.`);
  if (args.workspaceId !== runtime.readWorkspace({ root }).workspaceId) throw new Error('This request belongs to another workspace, so it was not accepted.');
  if (typeof args.brand !== 'string' || !args.brand.trim() || typeof args.jobId !== 'string' || !args.jobId.trim()) throw new Error('Say which job this is for.');
  const job = facts.jobAt(root, args.brand.trim(), args.jobId.trim());
  if (!job) throw new Error('That job could not be found for that brand.');
  return job;
}

/**
 * A message to an agent, checked as it is now, before anything is claimed or saved: the job is open, the agent is on its roster, the
 * text is 1 to 1000 plain characters, and the agent has fewer than 20 messages waiting (a message already saved for this request passes,
 * so a replay is answered the way the first try was). Returns the job and its roster.
 */
function checkAgentMessage(root, args) {
  const job = validateJobRequest(root, args, AGENT_MESSAGE_FIELDS, 'a message to an agent');
  if (typeof args.agent !== 'string' || typeof args.text !== 'string' || typeof args.requestId !== 'string') throw new Error('Choose who the message is for and write it first.');
  if (facts.isFinishedState(job.state)) throw new Error('This job is finished, so it can no longer take messages.');
  const snapshot = runtime.readJobSnapshot({ root, brand: job.brand, jobId: job.jobId });
  const roster = rosterOf({ rows: snapshot.plan?.rows, route: snapshot.route });
  if (!roster.includes(args.agent)) throw new Error('That agent is not part of this job.');
  const problem = messageTextProblem(args.text);
  if (problem) throw new Error(problem);
  const id = messageId(args.requestId);
  const saved = readAgentMessages(job.dir, args.agent);
  if (!saved.some(message => message.id === id) && saved.filter(message => isPending(message, args.agent)).length >= PENDING_LIMIT) {
    throw new Error(`${PENDING_LIMIT} messages are already waiting for the ${agentLabel(args.agent)}. They will be passed on at its next step.`);
  }
  return { job, roster };
}

function readRequestRecords(root) {
  const dir = join(root, '.social-pipeline', 'board', 'requests');
  let names = [];
  try { names = readdirSync(dir).filter(name => name.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const name of names) {
    try { const record = read(join(dir, name)); if (plainObject(record)) out.push(record); } catch { /* an unreadable record is skipped */ }
  }
  return out;
}

/** What the stuck check needs from the workspace: each job's board requests that need reconciliation, and when "Try again" was last used. */
function stuckContext(root) {
  const requests = new Map();
  for (const record of readRequestRecords(root)) {
    const jobId = record.args?.jobId;
    if (record.status !== 'needs_reconciliation' || typeof jobId !== 'string') continue;
    if (!requests.has(jobId)) requests.set(jobId, []);
    requests.get(jobId).push({ at: record.createdAt ?? null, detail: typeof record.detail === 'string' ? record.detail : null });
  }
  const saved = readJsonFile(retriesFile(root), {});
  const jobs = plainObject(saved?.jobs) ? saved.jobs : {};
  const retriedAt = job => {
    const at = Date.parse(jobs[`${job.brand}/${job.jobId}`]?.at ?? '');
    return Number.isFinite(at) ? at : null;
  };
  return { requests, retriedAt };
}

function recordRetry(root, job) {
  updateJsonFile(retriesFile(root), current => {
    const jobs = plainObject(current?.jobs) ? current.jobs : {};
    jobs[`${job.brand}/${job.jobId}`] = { at: new Date().toISOString() };
    const kept = Object.entries(jobs).sort((a, b) => String(a[1]?.at).localeCompare(String(b[1]?.at))).slice(-RETRY_MEMORY);
    return { v: 1, jobs: Object.fromEntries(kept) };
  }, {});
}

/**
 * The stuck jobs among `jobs` (as listJobs gives them), by "brand/jobId", each with what stuckFor says. Built from the same light
 * snapshot as personWaiting, so the stop hook never reads media. Pass the map from openQuestionsForWaiting when asking about several jobs.
 */
export function stuckJobs(root, jobs, { questions = null } = {}) {
  root = rootOf(root);
  const context = stuckContext(root);
  const open = questions || openQuestionsForWaiting(root);
  const out = new Map();
  for (const job of jobs) {
    try {
      const snapshot = lightSnapshot(job);
      if (states.isTerminal(snapshot.project.state)) continue;
      const dir = job.dir || job.path || job.jobDir;
      const { gate, review } = pendingReview(root, job.brand, job.jobId, snapshot);
      const inbox = jobInbox({ root, snapshot, gate, review, intake: projectIntake(snapshot, null), questions: open.get(job.jobId), dir });
      const lines = readAgentLines(dir);
      const stuck = stuckFor({ dir, snapshot, inboxItems: inbox.items, requests: context.requests.get(job.jobId) || [], retriedAt: context.retriedAt(job), blockedLine: blockedReason(snapshot), lines });
      // `activeAt` (ms) is the job's last sign of life, for the stop hook's "recent activity" rule.
      if (stuck) out.set(`${job.brand}/${job.jobId}`, { ...stuck, activeAt: lastChangeAt({ dir, updatedAt: snapshot.status?.updatedAt, lines }) });
    } catch { /* a job that cannot be read is not reported as stuck */ }
  }
  return out;
}

/**
 * "Try again" checked as it is now, before anything is claimed or saved: the job is stuck for a reason on our side, the retry has not
 * been used yet, and no other retry for this job is waiting. Returns the job and what is stuck.
 */
function checkRetryStep(root, args) {
  const job = validateJobRequest(root, args, RETRY_STEP_FIELDS, 'a retry');
  const stuck = stuckJobs(root, [job]).get(`${job.brand}/${job.jobId}`);
  if (!stuck || stuck.kind !== 'internal') throw new Error('Nothing on our side needs trying again.');
  if (!stuck.canRetry) throw new Error(stuck.retry === 'trying' ? 'Claude is already trying this again.' : "It didn't work again. The details are saved for our team. There's nothing you need to do.");
  const waiting = readRequestRecords(root).find(record => record.operation === 'retry_step' && record.status === 'requested' && record.args?.jobId === job.jobId && record.args?.brand === job.brand && record.requestId !== args.requestId);
  if (waiting) throw new Error('Claude is already trying this again.');
  return { job, stuck };
}

// ---------------------------------------------------------------------------
// Post-production round trip requests. Applying one only records the request; the send-to-post skill does the work.
// ---------------------------------------------------------------------------

const HANDOFF_OPERATIONS = ['handoff_send', 'handoff_decline', 'handoff_return'];
const HANDOFF_FIELDS = new Set(['requestId', 'brand', 'jobId', 'workspaceId']);
// The hand-off status each request needs the job to be in.
const HANDOFF_NEEDS = Object.freeze({ handoff_send: 'suggested', handoff_decline: 'suggested', handoff_return: 'released' });
const HANDOFF_DONE = Object.freeze({
  handoff_send: 'Sending this to Post-production.',
  handoff_decline: 'Finishing this one here.',
  handoff_return: 'Bringing the final video back.',
});

function checkHandoffRequest(root, operation, args) {
  const job = validateJobRequest(root, args, HANDOFF_FIELDS, 'a Post-production choice');
  const state = handoffOf(job.dir, { jobId: job.jobId, brand: job.brand });
  if (state?.status !== HANDOFF_NEEDS[operation]) throw new Error(operation === 'handoff_return' ? 'There is no released edit to bring back right now.' : 'There is no Post-production offer waiting on this job.');
  return job;
}

// A post's own request from the status list or the posting kit. Like a route choice it carries exactly its own fields
// and the workspace the board belongs to, nothing else.
const POST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const RESOLVE_POST_FIELDS = new Set(['requestId', 'brand', 'jobId', 'postId', 'answer', 'lid', 'workspaceId']);
const MARK_POSTED_FIELDS = new Set(['requestId', 'brand', 'jobId', 'postId', 'link', 'workspaceId']);
const MARK_POSTED_LINK_WORDS = `The link has to be a full https address of at most ${handoffRules.PERSON_LINK_LIMIT} characters.`;
const SELF_BY = 'The board';

function validatePostRequest(root, args, fields, what) {
  if (!plainObject(args) || typeof args.brand !== 'string' || !args.brand.trim()) throw new Error('Say which brand this is for.');
  if (Object.keys(args).some(key => !fields.has(key))) throw new Error(`This request carries more than ${what}, so it was not accepted.`);
  if (args.workspaceId !== undefined && args.workspaceId !== runtime.readWorkspace({ root }).workspaceId) throw new Error('This request belongs to another workspace, so it was not accepted.');
  if (typeof args.jobId !== 'string' || !args.jobId.trim()) throw new Error('Say which job this is for.');
  if (typeof args.postId !== 'string' || !POST_ID.test(args.postId)) throw new Error('Say which post this is for.');
  const brand = args.brand.trim();
  const jobId = args.jobId.trim();
  return { brand, jobId, dir: jobDirectory(root, brand, jobId) };
}

/**
 * The answer to "Is this post in Metricool?" checked against the log as it is now, before anything is claimed or saved:
 * the post has to be waiting for the answer, and "It is not in Metricool" is only taken once the wait has passed (the
 * same rule resolveAmbiguous applies when it records it). An answer already recorded for this request passes, so a
 * replay is answered the way the first try was.
 */
function checkResolvePost(root, args, now = Date.now()) {
  const { dir } = validatePostRequest(root, args, RESOLVE_POST_FIELDS, 'an answer about one post');
  if (args.answer !== 'in_metricool' && args.answer !== 'not_in_metricool') throw new Error('Say whether the post is in Metricool.');
  if (typeof args.lid !== 'string' || !args.lid || args.lid.length > 200) throw new Error('Say which attempt this answer is for.');
  const requestId = typeof args.requestId === 'string' ? args.requestId.slice(0, 200) : '';
  if (requestId && readAttempts(dir).some(entry => entry.post === args.postId && entry.source === 'person' && entry.requestId === requestId)) return;
  const intent = readPublishIntent(dir);
  const row = intent ? projectPublishStatus({ jobDir: dir, intent, now })?.posts.find(post => post.id === args.postId) : null;
  if (!row || row.status !== 'needs_check') throw new Error('This post is not waiting for your answer.');
  if (row.lid !== args.lid) throw new Error('This post changed after you were asked. Look at the board again and answer for what it shows now.');
  if (args.answer === 'not_in_metricool' && row.checkAfter) throw new Error(`Metricool may still be saving this post. Check again after ${row.checkAfter.text}.`);
}

// Why a post of a Metricool plan is not the person's to post, or null when Claude handed it over and nothing for it is open or sent.
function notHandedOver(state) {
  if (state.pending) return 'An earlier send for this post has no known result, so it may already be in Metricool.';
  if (state.sent) return 'This post already went to Metricool, so it is changed there.';
  if (!state.handedOver) return 'This post is not waiting for you to post it.';
  return null;
}

/**
 * "Mark as posted" checked before it is saved: the post is in the approved plan, the link (when there is one) is a plain https
 * address, and the post is one the person posts: any post of an "I'll post it myself" plan, or, on a Metricool plan, a post Claude
 * handed over (a post that went out is changed in Metricool, and one Claude may still send is not the person's yet).
 */
function checkMarkPosted(root, args) {
  const { dir } = validatePostRequest(root, args, MARK_POSTED_FIELDS, 'a post marked as posted');
  if (args.link !== undefined && (typeof args.link !== 'string' || (args.link.trim() && !handoffRules.validPersonLink(args.link)))) throw new Error(MARK_POSTED_LINK_WORDS);
  const approved = readApprovedIntent(dir);
  if (!approved.ok) throw new Error(approved.reason);
  const intent = approved.document;
  if (!(intent.posts || []).some(post => post?.id === args.postId)) throw new Error('This post is not part of the approved posting plan.');
  if (intent.route !== 'self' && !handoffRules.readPersonPosts(dir)[args.postId]) {
    const problem = notHandedOver(attemptState(readAttempts(dir), args.postId));
    if (problem) throw new Error(problem);
  }
  return { dir, intent };
}

/**
 * The person says they posted one post from the posting kit. The mark is recorded in publish/posted.json (source 'person',
 * when, and the link they gave) under the job's send lock, the file that freezes the plan, and it stays there however often
 * the hand-off package is rebuilt. When that settles every post (each one sent through Metricool or marked) the job is closed
 * with closePublishedJob. A mark is kept even when closing fails; the answer then says the job was not closed, and marking
 * again, or pipeline_publish_close, finishes it.
 */
export function markPostedOnBoard({ root, brand, jobId, postId, link, requestId = null }) {
  root = rootOf(root);
  const { dir } = checkMarkPosted(root, { brand, jobId, postId, ...(link !== undefined ? { link } : {}) });
  const job = facts.jobAt(root, brand.trim(), jobId.trim());
  if (!job) throw new Error('Job not found in this workspace.');
  const state = facts.readJobState(dir).state;
  if (!['PUBLISH_APPROVED', 'HANDOFF_READY', 'COMPLETE'].includes(state)) throw new Error('The posting plan has to be approved before a post can be marked as posted.');
  withSendLock(root, job.brand, job.jobId, () => {
    if (handoffRules.readPersonPosts(dir)[postId]) return;
    // Read again under the lock: a post of a Metricool plan is the person's only while it is handed over and nothing is open or sent.
    if (readApprovedIntent(dir).document?.route !== 'self') {
      const problem = notHandedOver(attemptState(readAttempts(dir, { strict: true }), postId));
      if (problem) throw new Error(problem);
    }
    handoffRules.recordPersonPost(dir, { postId, link, requestId });
  });
  const closing = closePublishedJob({ root, brand: job.brand, jobId: job.jobId });
  const after = handoffRules.readPersonPosts(dir);
  return { brand: job.brand, jobId: job.jobId, postId, marked: Object.keys(after).length, total: closing.total, allMarked: closing.settled, closed: closing.closed };
}

/**
 * Close a job whose posts are all out: each one sent through Metricool or marked as posted by the person. One idempotent
 * step, safe to call again after a failure part-way through, under the job's send lock: the hand-off package is (re)built when
 * it is missing or does not validate, the job moves to HANDOFF_READY when it is at PUBLISH_APPROVED, the delivery record is
 * written with the Metricool references and the person's marks, and complete-job.js completes the job. Returns
 * `{ closed, settled, total, state, reference?, reason? }`; `closed` is false (with a plain `reason`) while any post is
 * neither sent nor marked, or when a step could not be done. Never throws for either.
 */
export function closePublishedJob({ root, brand, jobId }) {
  root = rootOf(root);
  const job = facts.jobAt(root, String(brand || '').trim(), String(jobId || '').trim());
  if (!job) throw new Error('This job could not be found.');
  const dir = job.dir;
  const stateNow = () => facts.readJobState(dir).state;
  let plan = { total: 0, settled: false };
  let entered = false;
  const report = extra => ({ closed: false, settled: plan.settled, total: plan.total, state: stateNow(), ...extra });
  // What the plan and the logs say right now, read under the send lock: whether every post is out, and the reference to complete with.
  const look = () => withSendLock(root, job.brand, job.jobId, () => {
    const approved = readApprovedIntent(dir);
    if (!approved.ok) return { reason: approved.reason };
    const intent = approved.document;
    const posts = Array.isArray(intent.posts) ? intent.posts : [];
    const marks = handoffRules.readPersonPosts(dir);
    const entries = readAttempts(dir);
    const open = posts.filter(post => !marks[post.id] && !attemptState(entries, post.id).sent);
    plan = { total: posts.length, settled: posts.length > 0 && !open.length };
    if (!posts.length) return { reason: 'This plan has no posts.' };
    if (open.length) return { reason: `${open.length === 1 ? '1 post is' : `${open.length} posts are`} not sent or marked as posted yet.` };
    const reference = intent.route === 'self' ? handoffRules.SELF_DELIVERY_REF : deliveryReference({ jobDir: dir, intent, marks });
    if (!reference) return { reason: 'A post has no record of being sent.' };
    // The first delivery is the earliest of the sends and the marks.
    const times = [...Object.values(marks).map(mark => mark.at), ...posts.map(post => attemptState(entries, post.id).sent?.at)].filter(at => Number.isFinite(Date.parse(at))).sort();
    return { reference, at: times[0] || null };
  });
  const script = name => join(runtime.runtimeConstants.pipelineRoot, 'scripts', name);
  const run = (name, args) => spawnSync(process.execPath, [script(name), job.brand, job.jobId, ...args, '--root', root], { cwd: root, encoding: 'utf8', windowsHide: true, shell: false, timeout: 60000, env: { ...process.env, SOCIAL_PIPELINE_ROOT: root } });
  try {
    // One close at a time. The build and the completion run under the close lock alone: the send lock is held only for the checks and the delivery write.
    return withCloseLock(root, job.brand, job.jobId, () => {
      entered = true;
      const first = look();
      if (first.reason) return report({ reason: first.reason });
      if (stateNow() === 'COMPLETE') return report({ closed: true, already: true });
      if (!['PUBLISH_APPROVED', 'HANDOFF_READY'].includes(stateNow())) return report({ reason: 'This job is not at the step where it can be closed.' });
      try {
        const valid = () => handoffRules.validateHandoff(dir, { brand: job.brand, jobId: job.jobId }).ok;
        if (!valid() && (run('build-handoff.js', []).status !== 0 || !valid())) return report({ reason: 'The hand-off package could not be built.' });
        if (stateNow() === 'PUBLISH_APPROVED' && !facts.moveJobTo(job, 'HANDOFF_READY', { by: SELF_BY }).ok) return report({ reason: 'The job could not be moved on.' });
        // Read again before the delivery is written: a send or a mark may have landed while the package was built. A delivery
        // record left by an earlier try may name another reference, so while the job is open it is written again.
        const last = look();
        if (last.reason) return report({ reason: last.reason });
        withSendLock(root, job.brand, job.jobId, () => {
          rmSync(join(dir, ...handoffRules.DELIVERY_REL.split('/')), { force: true });
          handoffRules.recordPublishedDelivery(dir, { brand: job.brand, jobId: job.jobId, by: SELF_BY, deliveryRef: last.reference, at: last.at });
        });
        const done = run('complete-job.js', ['--delivery-ref', last.reference, '--by', SELF_BY]);
        // A completion that reported a failure but did finish (the state moved) is a close.
        if (done.status !== 0 && stateNow() !== 'COMPLETE') return report({ reason: 'The job could not be completed.', reference: last.reference });
        return report({ closed: stateNow() === 'COMPLETE', reference: last.reference });
      } catch (error) {
        return report({ reason: String(error.message || 'The job could not be closed.').slice(0, 300) });
      }
    });
  } catch (error) {
    // Only a close lock that cannot be taken means another close is running; anything else is said as it is.
    return report({ reason: entered ? String(error.message || 'The job could not be closed.').slice(0, 300) : 'Another close of this job is running. Try again in a moment.' });
  }
}

/**
 * When a job is waiting on the posting decision, register that decision again so it holds the plan as it is now:
 * the person then approves exactly the plan they see. An earlier approval of the old plan stays stale.
 */
function representPublishGate(root, brand, jobId) {
  const waiting = states.gateOf(runtime.readJobSnapshot({ root, brand, jobId }).project.state) === 'publish';
  const record = waiting ? readReviewRecord(root, brand, jobId, 'publish') : null;
  const paths = Array.isArray(record?.artifacts) ? record.artifacts.map(item => item?.path).filter(path => typeof path === 'string') : [];
  if (paths.length) registerBoardReview({ root, brand, jobId, paths });
  return paths.length > 0;
}

/**
 * Choose how a job's posts go out (Metricool schedule, draft or post now, or the person posts it) and rebuild the
 * posting plan for it, presenting the decision again when it is open. Only while nothing is approved or sent.
 */
export function choosePublishRouteOnBoard({ root, brand, jobId, route }) {
  root = rootOf(root);
  const result = choosePublishRoute({ root, brand, jobId, route });
  return { ...result, presented: representPublishGate(root, result.brand, result.jobId) };
}

/**
 * Save the post type of a deliverable that never had one (a job planned before 0.8) and rebuild the posting plan with it,
 * presenting the posting decision again when it is open, so the person approves exactly the plan they see. Only at the
 * posting decision with nothing approved or sent, only where the stored type is missing, and only to a type the
 * deliverable can be made into. The board request and the chat tool both use this function.
 */
export function choosePostType({ root, brand, jobId, deliverable, placement }) {
  root = rootOf(root);
  const result = savePostType({ root, brand, jobId, deliverable, placement });
  return { ...result, presented: representPublishGate(root, result.brand, result.jobId) };
}

/**
 * Save the posting time chosen on the card for one post (or, with no deliverable, for every post in one write) and rebuild the posting plan with it, presenting the posting decision
 * again when it is open, so the person approves exactly the plan they see. Only at the posting decision with nothing approved or
 * sent, and only for a time at least five minutes ahead in the plan's zone. The board request and the chat tool both use this function.
 */
export function choosePostTime({ root, brand, jobId, deliverable, dateTime }) {
  root = rootOf(root);
  const result = savePostTime({ root, brand, jobId, deliverable, dateTime });
  return { ...result, presented: representPublishGate(root, result.brand, result.jobId) };
}

/**
 * Bring one job's posting plan up to date after something it is built from changed (a workspace, a Metricool brand):
 * when it has a plan and no approval is in force the plan is rebuilt, and an open posting decision is presented again
 * with it, so the person approves exactly the plan they see. A job with an approval in force is left alone. Never
 * throws: the plan is rebuilt when it is next presented.
 */
function refreshPlan(root, job) {
  if (!existsSync(join(job.path, ...PUBLISH_INTENT_FILE.split('/'))) || hasPublishApproval(job.path)) return;
  try {
    buildPublishIntent({ root, brand: job.brand, jobId: job.jobId });
    representPublishGate(root, job.brand, job.jobId);
  } catch { /* The plan is rebuilt when it is next presented. */ }
}

/** Refresh the plan of every job of a brand (see refreshPlan). */
export function refreshPlansForBrand(root, brand) {
  root = rootOf(root);
  for (const job of runtime.listJobs({ root, brand })) refreshPlan(root, job);
}

/**
 * Choose the 3echo workspace for a job, or as the brand default, and then bring the posting plans it reaches up to
 * date. The board request, the chat tool and every other caller use this one function. The choice is saved first.
 */
export function chooseStudioWorkspaceForJobs({ root, brand, jobId = null, workspaceId }) {
  root = rootOf(root);
  const result = chooseStudioWorkspace({ root, brand, jobId, workspaceId });
  for (const job of studioWorkspaceReach({ root, brand, jobId })) refreshPlan(root, job);
  return result;
}

/**
 * Choose the Metricool brand a plugin brand posts through, and then bring the posting plans of that brand's jobs up
 * to date, so a plan never names a Metricool brand that is no longer the choice. The board request and the chat tool
 * both use this function.
 */
export function chooseMetricoolBrandForJobs({ root, brand, blogId }) {
  root = rootOf(root);
  const result = chooseMetricoolBrand({ root, brand, blogId });
  refreshPlansForBrand(root, result.brand);
  return result;
}

const SENT_FROZEN = "Some posts already went to Metricool, so this plan can't change. A post Claude cannot send is handed over to you in the posting kit on the board, and the ones that went out are changed in Metricool.";
const MARKED_FROZEN = "Some posts are already marked as posted, so this plan can't change. Post the rest from the posting kit.";

/**
 * Take an approved posting plan back to the posting decision, only while nothing was sent: the job must be at
 * PUBLISH_APPROVED and the send log empty in both the job and its copy. The approval stays recorded but is
 * withdrawn by a later decision of its own, so it no longer counts for uploads or sends. Then the plan is rebuilt and
 * presented again. Once anything went to Metricool it refuses in plain words.
 */
export function reopenPublishPlan({ root, brand, jobId }) {
  root = rootOf(root);
  const id = String(jobId || '').trim();
  const job = runtime.listJobs({ root, brand }).find(item => item.jobId === id);
  if (!job) throw new Error('This job could not be found.');
  // The check, the withdrawal and the move back run under the lock every reservation takes, so a send cannot be reserved
  // between the check that nothing was sent and the state move. The rebuild and the presenting happen after it.
  withSendLock(root, job.brand, job.jobId, () => {
  if (anythingSent(job.path)) throw new Error(readPublishIntent(job.path)?.route === 'self' ? MARKED_FROZEN : SENT_FROZEN);
  const state = runtime.readJobSnapshot({ root, brand: job.brand, jobId: job.jobId }).project.state;
  if (state === 'AWAITING_PUBLISH_APPROVAL') throw new Error('This posting plan is already open for changes.');
  const approval = latestPublishApproval(job.path);
  if (state !== 'PUBLISH_APPROVED' || approval?.decision !== 'approved') throw new Error('Only a posting plan that was approved and not yet sent can be reopened.');

  const dir = join(job.path, 'approvals');
  const rounds = readdirSync(dir).filter(name => /^publish-\d+\.json$/.test(name)).map(name => Number(name.slice('publish-'.length, -'.json'.length)));
  const round = Math.max(0, ...rounds) + 1;
  const file = join(dir, `publish-${round}.json`);
  const withdrawn = {
    schemaVersion: '1.0', approvalId: `publish-${round}`, jobId: job.jobId, brand: job.brand, gate: 'publish', round,
    decision: 'changes_requested', edited: false,
    artifacts: Array.isArray(approval.artifacts) && approval.artifacts.length ? approval.artifacts : [],
    decidedBy: 'pipeline_publish_reopen', decidedAt: new Date().toISOString(), channel: 'file',
    comment: 'The posting plan was reopened before anything was sent.', supersedes: approval.approvalId || null,
  };
  writeJsonAtomic(file, withdrawn);
  const moved = facts.moveJobTo(facts.jobAt(root, job.brand, job.jobId), 'AWAITING_PUBLISH_APPROVAL', { by: 'pipeline_publish_reopen' });
  if (!moved.ok) {
    rmSync(file, { force: true });
    throw new Error('The job could not be taken back to the posting decision.');
  }
  });
  buildPublishIntent({ root, brand: job.brand, jobId: job.jobId });
  return { brand: job.brand, jobId: job.jobId, reopened: true, presented: representPublishGate(root, job.brand, job.jobId) };
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
const BOARD_JOB_FIELDS = ['request', 'kind', 'kindReason', 'objective', 'distribution', 'platforms', 'deliverables', 'audience', 'evidence', 'offer', 'landingPageUrl', 'schedule', 'budget', 'account', 'requiredClaims', 'prohibitedClaims', 'specWork', 'productAsset', 'sourceRefs', 'subject', 'caption', 'aiMade', 'pipelineUnsure'];
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
  // A caption stays exactly as the person wrote it; whether their files were made with AI is a yes or a no. Anything else is dropped.
  if (job.caption !== undefined && !(typeof job.caption === 'string' && job.caption.trim())) delete job.caption;
  if (job.aiMade !== undefined && typeof job.aiMade !== 'boolean') delete job.aiMade;
  // Only a plain true holds a job for the pipeline question; anything else is dropped.
  if (job.pipelineUnsure !== undefined && job.pipelineUnsure !== true) delete job.pipelineUnsure;
  // The one line Claude saves when it picks the kind: a short plain sentence, kept only when it is one.
  if (job.kindReason !== undefined) {
    const reason = runtime.kindReasonOf(job.kindReason);
    if (reason) job.kindReason = reason;
    else delete job.kindReason;
  }
  if (job.productAsset !== undefined && !(webUrl(job.productAsset) || (plainObject(job.productAsset) && webUrl(job.productAsset.path)))) delete job.productAsset;
  if (job.sourceRefs !== undefined) {
    const refs = linkRefs(job.sourceRefs);
    if (refs.length) job.sourceRefs = refs;
    else delete job.sourceRefs;
  }
  return Object.keys(job).length ? job : null;
}

// A new job request carries exactly these fields. A product photo never travels with it (a request can never carry a
// local path), so `photo` is dropped on the way in; anything else is refused before the request is saved or claimed.
const CREATE_JOB_FIELDS = new Set(['requestId', 'workspaceId', 'title', 'brief', 'brand', 'brandName', 'sourceRefs', 'kind', 'job']);
const TITLE_LIMIT = 200;
const BRIEF_LIMIT = 6000;
const withoutPhoto = args => (plainObject(args) ? Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'photo')) : args);

function kindNames() {
  const names = Object.values(kindWordsOf()).map(entry => entry.name);
  return `Choose what you need${names.length ? `: ${names.join(', ')}` : ''}.`;
}

// Everything a new job request must satisfy, checked before it is saved or claimed so a bad one is refused cleanly and never
// left stuck: the exact fields, this workspace, the sizes, a kind that is offered, links that are https, and a brand that
// exists and, when the kind needs one, is ready. Returns the typed job fields to create the job with.
function createJobFields(args, root) {
  if (!plainObject(args)) throw new Error('This request has nothing in it, so it was not accepted.');
  if (Object.keys(args).some(key => key !== 'photo' && !CREATE_JOB_FIELDS.has(key))) throw new Error('This request carries more than a new job, so it was not accepted.');
  if (args.workspaceId !== undefined && args.workspaceId !== runtime.readWorkspace({ root }).workspaceId) throw new Error('This request belongs to another workspace, so it was not accepted.');
  for (const [key, limit] of [['title', TITLE_LIMIT], ['brief', BRIEF_LIMIT]]) {
    if (args[key] === undefined) continue;
    if (typeof args[key] !== 'string') throw new TypeError(`The ${key} must be text.`);
    if (args[key].length > limit) throw new Error(`Keep the ${key} to ${limit} characters or fewer.`);
  }
  if (args.brand !== undefined && args.brand !== null && typeof args.brand !== 'string') throw new TypeError('The brand must be text.');
  const job = boardJobFields(args.job) || {};
  // The pipeline is always chosen: by Claude in the job fields, or by the request itself. It is normalised and written back.
  const raw = job.kind ?? args.kind;
  const kind = raw === undefined || raw === null ? null : runtime.jobKindOf(raw);
  if (!kind || !kinds.activeKindIds().includes(kind)) throw new Error(kindNames());
  job.kind = kind;
  // The reason belongs to the kind it was written for: when the request names another kind, it no longer applies.
  if (job.kindReason !== undefined && args.kind !== undefined && args.kind !== null && runtime.jobKindOf(args.kind) !== kind) delete job.kindReason;
  if (args.sourceRefs !== undefined && args.sourceRefs !== null) {
    if (!Array.isArray(args.sourceRefs) || args.sourceRefs.length > LINK_LIMIT || args.sourceRefs.some(item => !runtime.webLink(item))) throw new TypeError('Each link must be a full https address.');
    const known = job.sourceRefs || [];
    const chosen = linkRefs(args.sourceRefs).map(ref => known.find(item => item.uri === ref.uri) || ref);
    const refs = [...chosen, ...known.filter(item => !chosen.some(ref => ref.uri === item.uri))].slice(0, LINK_LIMIT);
    if (refs.length) job.sourceRefs = refs;
  }
  const brand = typeof args.brand === 'string' ? args.brand.trim() : '';
  const named = brand && !runtime.isGeneralBrand(brand);
  if (kinds.brandRequired(kind) && !named) throw new Error(NEEDS_A_BRAND);
  if (named) {
    const found = runtime.listBrands({ root }).find(item => item.slug === brand || item.id === brand || item.brandId === brand);
    if (!found) throw new Error('Choose one of your brands, or onboard a new one.');
    if (kinds.brandRequired(kind) && !found.readyForJobs) {
      throw new Error(found.onboardingStatus !== 'complete'
        ? `Complete brand onboarding before starting a job for ${found.name}.`
        : `Review the logo, colours and fonts for ${found.name} on the board and click Save and continue before starting a job.`);
    }
  }
  return job;
}

export function boardOperation({ root,operation,args = {},source = 'local' }) {
  root = rootOf(root);
  if(operation==='snapshot') return boardSnapshot({root});
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
    reconcileMetricoolChoicesQuietly({root});
    return result;
  }
  if(operation==='create_brand') return runtime.createBrand({root,name:args.name,requestId:args.requestId});
  if(operation==='complete_onboarding') {
    const result = runtime.completeBrandOnboarding({root,brand:args.brand,profile:args.profile});
    if (result.brand?.slug) recordPillarsConfirmed(root, result.brand.slug, result.profile);
    reconcileMetricoolChoicesQuietly({root});
    return result;
  }
  if(operation==='create_job') {
    const job=createJobFields(args,root);
    const result=runtime.createJob({root,brand:args.brand,requestId:args.requestId,title:args.title,brief:args.brief,...(job?{job}:{}),ownerUserId:null,ownerEmail:null});
    const brand=result.brand||args.brand;
    saveBoardRequest({root,operation:'continue_job',args:{requestId:`followup-${digest(args.requestId).slice(0,40)}`,brand,jobId:result.jobId},source:'local'});
    return {...result,jobId:result.jobId,brand,message:'Job saved. Your Claude session can now continue intake.'};
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
    const result=runtime.attachProductPhoto({root,brand:args.brand,jobId:args.jobId,expectedRevision:args.expectedRevision,path:args.photo?.path,dataBase64:args.photo?.dataBase64,source:args.photo?.source,ownedByBrand:args.photo?.ownedByBrand});
    saveBoardRequest({root,operation:'continue_job',args:{requestId:`followup-${digest(args.requestId).slice(0,40)}`,brand:args.brand,jobId:args.jobId},source:'local'});
    return {...result,message:`${result.job?.subject==='character'?'Character picture':'Product photo'} saved. Your Claude session can now continue this job.`};
  }
  if(operation==='import_inputs') return runtime.importLocalInputs({root,brand:args.brand,jobId:args.jobId,sourcePaths:[args.path],ownedByBrand:args.ownedByBrand===true,usedInPost:args.usedInPost===true});
  if(operation==='skip_provider') {
    if(!CONNECTOR_KEYS.includes(args.provider)) throw new Error('Unsupported connector.');
    recordConnectorSkip(root,args.provider);
    return {provider:args.provider,state:'skipped'};
  }
  if(operation==='connectors_continue') return recordConnectorsContinue(root);
  if(operation==='connect_provider') {
    if(!CONNECTOR_KEYS.includes(args.provider)) throw new Error('Unsupported connector.');
    const record = integrationProviders(readIntegrationsFile(root))[args.provider];
    if(!record || record.state!=='connected') throw new Error('Connect this provider in chat and confirm it with integration_probe or integration_mark_connected before applying this request.');
    return {provider:args.provider,state:'connected'};
  }
  if(operation==='choose_recipe') {
    const result = chooseRecipe({root,brand:args.brand,jobId:args.jobId,deliverable:args.deliverable,picks:args.picks,chosenBy:'The board',via:'board',requestId:args.requestId,note:args.note});
    return {...result,message:`Copy choices saved for ${deliverableNameOf(root,args)}.`};
  }
  if(operation==='choose_studio_workspace') {
    if(!['job','brand'].includes(args.scope)) throw new Error('Say whether this workspace choice is for the job or the brand.');
    const job = runtime.listJobs({root}).find(item=>item.jobId===args.jobId);
    if(!job) throw new Error('Job not found in this workspace.');
    const result = chooseStudioWorkspaceForJobs({root,brand:job.brand,jobId:args.scope==='job' ? args.jobId : null,workspaceId:args.workspaceId});
    return {...result,message:`Studio workspace set to ${result.name || 'the chosen workspace'}.`};
  }
  if(operation==='choose_metricool_brand') {
    validateMetricoolChoice(root,args);
    const result = chooseMetricoolBrandForJobs({root,brand:args.brand.trim(),blogId:args.blogId.trim()});
    return {...result,message:`Posts for ${result.brandName} now go out through Metricool, brand ${result.label}.`};
  }
  if(operation==='choose_publish_route') {
    validatePublishRoute(root,args);
    const result = choosePublishRouteOnBoard({root,brand:args.brand.trim(),jobId:args.jobId.trim(),route:args.route});
    return {...result,message:`Posts for this job: ${result.label}.`};
  }
  if(operation==='choose_post_type') {
    validatePostType(root,args);
    const result = choosePostType({root,brand:args.brand.trim(),jobId:args.jobId.trim(),deliverable:args.deliverable,placement:args.placement});
    return {...result,message:`Post type saved: ${result.label}.`};
  }
  if(operation==='choose_post_time') {
    validatePostTime(root,args);
    const result = choosePostTime({root,brand:args.brand.trim(),jobId:args.jobId.trim(),deliverable:args.deliverable,dateTime:args.dateTime});
    return {...result,message:`Posting time saved: ${result.when}.`};
  }
  if(operation==='resolve_post') {
    checkResolvePost(root,args);
    const result = resolveAmbiguous({root,brand:args.brand.trim(),jobId:args.jobId.trim(),postId:args.postId,answer:args.answer,requestId:args.requestId,lid:args.lid});
    return {...result,jobId:args.jobId.trim(),postId:args.postId,message:result.outcome==='sent' ? 'Saved: this post is in Metricool.' : 'Saved: this post is not in Metricool, so it can be sent again.'};
  }
  if(operation==='mark_posted') {
    const result = markPostedOnBoard({root,brand:args.brand,jobId:args.jobId,postId:args.postId,...(typeof args.link==='string' && args.link.trim() ? {link:args.link.trim()} : {}),requestId:args.requestId});
    return {...result,message:result.allMarked ? (result.closed ? 'Every post is marked as posted, so this job is finished.' : 'Every post is marked as posted. Claude will finish closing the job.') : 'Marked as posted.'};
  }
  if(operation==='agent_message') {
    const { job, roster } = checkAgentMessage(root,args);
    const saved = saveAgentMessage({root,brand:job.brand,jobId:job.jobId,agent:args.agent,text:args.text,requestId:args.requestId,roster});
    const said = args.text.replace(/\s+/g,' ').trim().slice(0,MESSAGE_COMMENT_CHARS);
    return {jobId:saved.jobId,agent:saved.agent,messageId:saved.messageId,message:`Message for the ${agentLabel(saved.agent)}: "${said}".`};
  }
  if(operation==='retry_step') {
    const { job, stuck } = checkRetryStep(root,args);
    recordRetry(root,job);
    // The team's copy: the retry goes into the job's events. The failure itself stays in agents.jsonl and in the request records.
    const retriedAt = new Date().toISOString();
    appendFileSync(join(job.dir,'events.jsonl'),`${JSON.stringify(pipelineEvents.makeEvent(job.jobId,'retry.recorded',retriedAt,{type:'job',id:job.jobId},{reason:'stuck_internal',attempt:1,status:'requested',since:stuck.since},{jobId:job.jobId,source:'local'}))}\n`);
    return {jobId:job.jobId,brand:job.brand,retry:{reason:stuck.reason,since:stuck.since},message:'Trying this step again.'};
  }
  if(HANDOFF_OPERATIONS.includes(operation)) {
    // Records the request only: the send-to-post skill reads it and does the work.
    const job = checkHandoffRequest(root,operation,args);
    return {jobId:job.jobId,brand:job.brand,handoff:operation.replace('handoff_',''),message:HANDOFF_DONE[operation]};
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
  if (operation === 'connectors_continue') return result.state === 'continued' ? { state: result.state, skipped: result.skipped } : null;
  if (operation === 'choose_recipe') return result.deliverable ? { deliverable: result.deliverable } : null;
  if (operation === 'choose_studio_workspace') return result.workspaceId ? { workspaceId: result.workspaceId, scope: result.scope } : null;
  if (operation === 'choose_metricool_brand') return result.blogId ? { brand: result.brand, blogId: result.blogId } : null;
  if (operation === 'choose_publish_route') return result.route ? { jobId: result.jobId, route: result.route } : null;
  if (operation === 'choose_post_type') return result.deliverable ? { jobId: result.jobId, deliverable: result.deliverable, placement: result.placement } : null;
  if (operation === 'choose_post_time') return result.dateTime ? { jobId: result.jobId, ...(result.deliverable ? { deliverable: result.deliverable } : {}), dateTime: result.dateTime } : null;
  if (operation === 'resolve_post') return result.postId ? { jobId: result.jobId, postId: result.postId, outcome: result.outcome } : null;
  if (operation === 'mark_posted') return result.postId ? { jobId: result.jobId, postId: result.postId, allMarked: result.allMarked, closed: result.closed } : null;
  if (operation === 'agent_message') return result.messageId ? { jobId: result.jobId, agent: result.agent, messageId: result.messageId } : null;
  if (operation === 'retry_step') return result.jobId ? { jobId: result.jobId } : null;
  if (HANDOFF_OPERATIONS.includes(operation)) return result.jobId ? { jobId: result.jobId } : null;
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
  // The posting plan is approved only while a fresh look at everything still passes and still matches the plan shown.
  if(reviewId==='publish' && decision==='approve') {
    const verdict=evaluatePublishPlan({root,brand:snapshot.brand?.slug || brand,jobId});
    if(!verdict.ready) throw new Error(verdict.reason || 'Fix the items on the posting card first.');
  }
  // A post made from files the person supplied is approved only while every check on its posts passes, run fresh now.
  if(reviewId==='content' && decision==='approve' && kinds.suppliesMedia(snapshot.job?.kind)) {
    const verdict=suppliedChecks({root,brand:snapshot.brand?.slug || brand,jobId});
    if(!verdict.ready) throw new Error(`Fix these first: ${Object.values(verdict.posts).flat().find(item=>!item.ok)?.text || 'a check on the final post has not passed.'}`);
  }
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

function postFilePaths(dir) {
  try {
    return readdirSync(join(dir, 'drafts'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^D\d+$/.test(entry.name) && existsSync(join(dir, 'drafts', entry.name, 'post.md')))
      .map(entry => `drafts/${entry.name}/post.md`)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  } catch { return []; }
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

/**
 * A review is never presented while a helper is still working on the job: the helper may still be writing the very file the
 * person is about to read, and a file that changes after it was shown locks the person's pick. The agent log (agents.jsonl,
 * written by the agent-run hook) says who is still working. A helper with no end line that started more than HELPER_WAIT_MS ago is
 * taken as lost and does not block. The Director that presents is not a helper. Nothing is checked when the log is missing.
 */
function assertNoHelperRunning(root,brand,jobId) {
  let working;
  try { working=openHelpers(readAgentLines(jobDirectory(root,brand,jobId))); } catch { return; }
  if(!working.length) return;
  const names=[...new Set(working.map(run=>agentLabel(run.agent)))];
  const who=names.length===1 ? `the ${names[0]}` : `the ${names.slice(0,-1).join(', ')} and ${names[names.length-1]}`;
  throw new UserFacingError(`${who.charAt(0).toUpperCase()+who.slice(1)} ${names.length===1 ? 'is' : 'are'} still working on this job, so this review is not ready to show. Wait for ${names.length===1 ? 'it' : 'them'} to hand back, then present this review again.`,{
    code:'helper_running',
    fix:'Do not present while a helper is running. Wait for its hand-back, which arrives by itself, then call this again.',
    details:{agents:working.map(run=>run.agent)},
  });
}

/** A review is not presented while the Director's own question on the job is still open: the person's answer may change what the review shows. */
function assertNoQuestionOpen(root,jobId) {
  let open;
  try { open=openQuestionsByJob(root,{readOnly:true}).get(jobId); } catch { return; }
  if(!open?.length) return;
  throw new UserFacingError(`You asked the person ${open.length===1 ? 'a question' : `${open.length} questions`} on this job that ${open.length===1 ? 'is' : 'are'} still waiting for an answer, so this review is not ready to show. Wait for the answer, then present this review again.`,{
    code:'question_open',
    fix:'Do not present or write the brief while a question on this job is open. Wait for the answer (it arrives by itself), then continue.',
    details:{questions:open.map(question=>question.questionId)},
  });
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
    assertNoHelperRunning(root,brand,jobId);
    assertNoQuestionOpen(root,jobId);
    // Post-production comes before the final approval: never ask for both at once, and never ask while the edit is away.
    if(aimed==='content') {
      const job=facts.jobAt(root,brand,jobId);
      const handoff=job && typeof handoffLib?.handoffState==='function' ? handoffLib.handoffState(job) : null;
      if(handoff?.status==='suggested') throw new Error('Ask the Post-production question first: call pipeline_handoff_post_status and ask it once. Ask for the final approval after the person answers.');
      if(handoff?.status==='sent' || handoff?.status==='released') throw new Error('The video is with Post-production. Ask for the final approval once the edit is back.');
    }
    if(aimed===FINDINGS_GATE && (!current || current===FINDINGS_GATE)) paths=reportReviewPaths(jobDirectory(root,brand,jobId));
    // The final post of a job made from supplied files needs no list: it is every post file, and the supplied files are added below.
    if((!Array.isArray(paths) || !paths.length) && aimed==='content' && kinds.suppliesMedia(snapshot.job?.kind)) paths=postFilePaths(jobDirectory(root,brand,jobId));
    if(!Array.isArray(paths) || !paths.length || new Set(paths).size!==paths.length) throw new Error('Provide the complete, unique list of files for this review.');
    // The person's approval of the posting decision covers the posting plan by its hash, so the plan is built from
    // the current drafts and schedule every time the decision is presented, and is always one of its files. It is
    // built before the job moves, so a plan that cannot be built leaves the job where it was.
    if(aimed==='publish') paths=withPublishIntent({root,brand,jobId,paths});
    // The final approval of a post made from supplied files covers every file the person gave, whatever the caller listed, so the posting plan can always be built from it.
    if(aimed==='content' && kinds.suppliesMedia(snapshot.job?.kind)) paths=[...paths,...(Array.isArray(snapshot.job?.suppliedMedia) ? snapshot.job.suppliedMedia : []).map(item=>item?.path).filter(path=>typeof path==='string' && !paths.includes(path))];
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

// A board answer is saved as given. When it answers the Metricool brand question, the brand it
// picked is applied to that plugin brand right away; a failure there never undoes the answer, and
// the next pipeline_metricool_brands_save applies it again.
function answeredQuestion(root,record) {
  const question=answerQuestion({root,questionId:record.args.questionId,choice:record.args.choice,text:record.args.text,via:'board',requestId:record.requestId});
  if(isMetricoolQuestion(question)) {
    try { reconcileMetricoolChoices({root}); if(question.brand) refreshPlansForBrand(root,question.brand); } catch { /* Applied on the next save of the Metricool brands. */ }
  }
  return question;
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
  if(record.operation==='create_job') createJobFields(record.args, root);
  if(record.operation==='answer_question') validateBoardAnswer(root,record.args);
  // A post answer or mark that cannot be taken yet (the wait has not passed, the post is not waiting) is checked before the
  // claim, so the request stays unclaimed and can be declined with the reason.
  if(record.operation==='resolve_post') checkResolvePost(root,record.args);
  if(record.operation==='mark_posted') checkMarkPosted(root,record.args);
  if(record.operation==='agent_message') checkAgentMessage(root,record.args);
  if(record.operation==='retry_step') checkRetryStep(root,record.args);
  if(HANDOFF_OPERATIONS.includes(record.operation)) checkHandoffRequest(root,record.operation,record.args);
  const claimed=claimBoardRequest(file);
  if(claimed) return claimed;
  let result;
  try { result=record.operation==='continue_job'
    ? runtime.readJobSnapshot({root,brand:record.args.brand,jobId:record.args.jobId})
    : record.operation==='answer_question'
      ? answeredQuestion(root,record)
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
  // The label and brand-mark check is skipped for a post made from the person's own finished files: they approve those as they are.
  const labelCheck = args.reviewId==='content' && args.decision==='approve' && !kinds.suppliesMedia(validated.snapshot.job?.kind)
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
  const next = {...record,status,confirmedBy,actorUserId:requesterIdOf(record.by),ownershipStatus:'unbound',appliedAt,detail:result.error?.message || result.stderr || result.stdout,...(labelCheck?.required ? {labelCheck:{checkedAt:labelCheck.checkedAt,accepted:labelCheck.accepted}} : {}),...(reopened ? {reopened} : {}),artifactReceipt:artifactReceipt(record,{status,appliedAt})};
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
  const next = {...record,status:'applied',confirmedBy,actorUserId:requesterIdOf(record.by),ownershipStatus:'unbound',appliedAt:decidedAt,decision,artifactReceipt:artifactReceipt(record,{status:'applied',appliedAt:decidedAt})};
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
  const next = {...record,status:'applied',confirmedBy,actorUserId:requesterIdOf(record.by),ownershipStatus:'unbound',appliedAt:decidedAt,decision,artifactReceipt:artifactReceipt(record,{status:'applied',appliedAt:decidedAt})};
  writeJsonAtomic(file,next);
  return next;
}

export function saveJobQuote({root,brand,jobId,items,drop}) {
  root=rootOf(root);
  jobDirectory(root,brand,jobId);
  const job=facts.jobAt(root,brand,jobId);
  if(!job) throw new Error('Job not found in this workspace.');
  if(kinds.suppliesMedia(readJsonFile(join(job.dir,'job.json'),{})?.kind)) throw new Error('This post is made from files you already have, so nothing is made and there is no price to approve.');
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
    not_made: item => `${item.item} could not be made and cost nothing. 3Echo returns the same failed job for the same job key, so ask the person on the board and in chat whether to try it again; on yes, call pipeline_generation_retry.`,
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
