import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UserFacingError } from '../lib/errors.mjs';
import * as runtime from './runtime.mjs';

const require = createRequire(import.meta.url);
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts');
const rules = require(join(SCRIPTS, 'lib-recipe.js'));
const brandVoice = require(join(SCRIPTS, 'lib-brand-voice.js'));
const profiles = require(join(SCRIPTS, 'lib-brand-profile.js'));
const capabilities = require(join(SCRIPTS, 'lib-research-capabilities.js'));

export const FIELDS = rules.FIELDS;
export const OPTIONS_FILE = rules.OPTIONS_FILE;
export const RECIPE_FILE = rules.RECIPE_FILE;
export const HISTORY_FILE = 'recipe-history.jsonl';

const LABEL_MAX = 80;
const REASON_MAX = 240;
const ANGLE_MAX = 200;
const HOOK_MAX = 200;
const LINE_MAX = 200;
const NOTE_MAX = 1000;
const WHO_MAX = 200;
const EVIDENCE_MAX = 5;
const ID_PREFIX = Object.freeze({ pillar: 'pillar', angle: 'angle', hookFamily: 'hook', cta: 'cta', hashtags: 'tags' });
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const DELIVERABLE = /^D\d+$/;
const VIA = new Set(['board', 'chat']);
const REQUEST_ID = /^[A-Za-z0-9_-]{8,160}$/;

const now = () => new Date().toISOString();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const words = field => rules.FIELD_WORDS[field];

function invalid(message, details) {
  return new UserFacingError(message, { code: 'invalid_input', ...(details ? { details } : {}) });
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}-${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, file);
}

function resolveBrand(root, brand) {
  const value = String(brand || '').trim();
  if (!value) throw invalid('Say which brand this job belongs to.');
  const entry = runtime.listBrands({ root }).find(item => item.slug === value || item.id === value || item.brandId === value);
  if (!entry) throw new UserFacingError('This brand could not be found.', { code: 'brand_not_found' });
  return entry;
}

function deliverableRows(job) {
  return Array.isArray(job?.deliverables) ? job.deliverables.filter(row => row && typeof row.id === 'string') : [];
}

export function jobContext({ root, brand, jobId, deliverable }) {
  const entry = resolveBrand(root, brand);
  const id = String(jobId || '').trim();
  if (!SAFE_ID.test(id)) throw invalid('Say which job this is for.');
  const dir = join(entry.path, 'jobs', id);
  const job = readJson(join(dir, 'job.json'));
  if (!job) throw new UserFacingError('This job could not be found.', { code: 'job_missing' });
  const context = { root, brand: entry, jobId: id, dir, job };
  if (deliverable === undefined) return context;
  const name = String(deliverable || '').trim();
  if (!DELIVERABLE.test(name)) throw invalid('Name the post as D1, D2 and so on.');
  const rows = deliverableRows(job);
  const row = rows.find(item => item.id === name);
  if (rows.length && !row) throw invalid(`This job has no ${name}; its posts are ${rows.map(item => item.id).join(', ')}.`);
  const platform = String(row?.platform || (Array.isArray(job.platforms) && job.platforms.length === 1 ? job.platforms[0] : '') || '').toLowerCase();
  return { ...context, deliverable: name, platform, draftDir: join(dir, 'drafts', name) };
}

function text(value, label, max, problems, { required = true } = {}) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    if (required) problems.push(`${label} is missing.`);
    return '';
  }
  if (typeof value !== 'string') {
    problems.push(`${label} must be text.`);
    return '';
  }
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (/[\r\n]/.test(value.trim())) problems.push(`${label} must be one line.`);
  if (trimmed.length > max) problems.push(`${label} must be at most ${max} characters.`);
  return trimmed;
}

function evidenceItem(context, raw, label, problems) {
  if (typeof raw !== 'string' || !raw.trim()) {
    problems.push(`${label} has an empty evidence entry.`);
    return null;
  }
  const value = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) {
    try {
      return { kind: 'link', url: capabilities.publicUrl(value, 'Evidence') };
    } catch {
      problems.push(`${label} cites "${value}", which is not a public web link.`);
      return null;
    }
  }
  const [filePart, ...anchorParts] = value.replace(/\\/g, '/').split('#');
  const relativePath = filePart.replace(/^\.\//, '');
  const anchor = anchorParts.join('#').trim() || null;
  const inBrand = relativePath.startsWith('brand/');
  if (!inBrand && !relativePath.startsWith('research/')) {
    problems.push(`${label} cites "${value}"; cite a research file in this job (research/...), a brand file (brand/...) or a public link.`);
    return null;
  }
  let absolute;
  try {
    absolute = capabilities.assignedPath(inBrand ? context.brand.path : context.dir, relativePath, 'Evidence');
  } catch {
    problems.push(`${label} cites "${value}", which is outside this job.`);
    return null;
  }
  let isFile = false;
  try { isFile = statSync(absolute).isFile(); } catch { isFile = false; }
  if (!isFile) {
    problems.push(`${label} cites "${relativePath}", which does not exist yet.`);
    return null;
  }
  return anchor ? { kind: 'file', path: relativePath, anchor } : { kind: 'file', path: relativePath };
}

function evidenceList(context, value, label, problems) {
  if (!Array.isArray(value) || !value.length) {
    problems.push(`${label} needs evidence: a research file in this job or a public link.`);
    return [];
  }
  if (value.length > EVIDENCE_MAX) problems.push(`${label} can cite at most ${EVIDENCE_MAX} pieces of evidence.`);
  return value.slice(0, EVIDENCE_MAX).map(item => evidenceItem(context, item, label, problems)).filter(Boolean);
}

function brandPillars(profile) {
  const list = Array.isArray(profile?.contentPillars) ? profile.contentPillars : [];
  return list.map(item => String(item || '').trim()).filter(Boolean);
}

function matchPillar(pillars, value) {
  const key = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return pillars.find(item => item.replace(/\s+/g, ' ').trim().toLowerCase() === key) || null;
}

function fieldPayload(field, raw, context, label, problems, { written = false } = {}) {
  if (field === 'pillar') {
    const value = text(raw.pillar, `${label} pillar`, 60, problems);
    if (!value) return null;
    const known = matchPillar(context.pillars, value);
    if (!known && !written) {
      problems.push(`${label} uses "${value}", which is not one of the brand's content pillars (${context.pillars.join(', ') || 'none saved'}).`);
      return null;
    }
    return { pillar: known || value, inBrandPillars: Boolean(known) };
  }
  if (field === 'angle') {
    const value = text(raw.angle, `${label} angle`, ANGLE_MAX, problems);
    return value ? { angle: value } : null;
  }
  if (field === 'hookFamily') {
    const family = text(raw.family, `${label} family`, 40, problems);
    const mechanism = text(raw.mechanism, `${label} mechanism`, 60, problems);
    const example = text(raw.example, `${label} example hook`, HOOK_MAX, problems, { required: !written });
    if (!family || !mechanism) return null;
    const hookProblems = rules.checkHook({ family, mechanism, text: example }, context.families);
    if (hookProblems.length) {
      problems.push(...hookProblems.map(problem => `${label}: ${problem}`));
      return null;
    }
    return example ? { family, mechanism, example } : { family, mechanism };
  }
  if (field === 'cta') {
    const style = text(raw.style, `${label} style`, 40, problems);
    const line = text(raw.line, `${label} line`, LINE_MAX, problems, { required: style !== 'none' });
    if (!style) return null;
    const ctaProblems = rules.ctaProblems(style, context.platform);
    if (ctaProblems.length) {
      problems.push(...ctaProblems.map(problem => `${label}: ${problem}`));
      return null;
    }
    return { style, line };
  }
  if (field === 'hashtags') {
    const checked = rules.checkTags(raw.tags);
    if (checked.problems.length) {
      problems.push(...checked.problems.map(problem => `${label}: ${problem}`));
      return null;
    }
    return { tags: checked.tags };
  }
  return null;
}

function identity(field, payload) {
  if (field === 'pillar') return payload.pillar.toLowerCase();
  if (field === 'angle') return payload.angle.toLowerCase();
  if (field === 'hookFamily') return payload.family;
  if (field === 'cta') return `${payload.style}|${String(payload.line || '').toLowerCase()}`;
  return payload.tags.map(tag => tag.toLowerCase()).sort().join(' ');
}

function writtenLabel(field, payload) {
  if (field === 'pillar') return payload.pillar;
  if (field === 'angle') return payload.angle;
  if (field === 'hookFamily') return payload.example || `${payload.family} ${payload.mechanism.replace(/_/g, ' ')}`;
  if (field === 'cta') return payload.line || 'No call to action';
  return payload.tags.length ? payload.tags.join(' ') : 'No hashtags';
}

function validationContext(context) {
  const profile = profiles.read(context.brand.path);
  return { ...context, profile, pillars: brandPillars(profile), families: rules.hookFamilies() };
}

function validateField(field, list, context, problems) {
  const name = words(field);
  const min = field === 'pillar' ? Math.min(rules.MIN_OPTIONS, Math.max(1, context.pillars.length)) : rules.MIN_OPTIONS;
  if (!Array.isArray(list)) {
    problems.push(`Give ${rules.MIN_OPTIONS} or ${rules.MAX_OPTIONS} ${name} options.`);
    return [];
  }
  if (list.length < min || list.length > rules.MAX_OPTIONS) {
    problems.push(min === rules.MIN_OPTIONS
      ? `Give ${rules.MIN_OPTIONS} or ${rules.MAX_OPTIONS} ${name} options; there are ${list.length}.`
      : `Give 1 to ${rules.MAX_OPTIONS} ${name} options; there are ${list.length}.`);
  }
  const options = [];
  const labels = new Set();
  const identities = new Set();
  list.slice(0, rules.MAX_OPTIONS).forEach((raw, index) => {
    const label = `${name[0].toUpperCase()}${name.slice(1)} option ${index + 1}`;
    if (!plain(raw)) {
      problems.push(`${label} must be an object.`);
      return;
    }
    const before = problems.length;
    const shown = text(raw.label, `${label} label`, LABEL_MAX, problems);
    const reason = text(raw.reason, `${label} reason`, REASON_MAX, problems);
    const evidence = evidenceList(context, raw.evidence, label, problems);
    const payload = fieldPayload(field, raw, context, label, problems);
    if (problems.length !== before || !payload) return;
    const labelKey = shown.toLowerCase();
    const key = identity(field, payload);
    if (labels.has(labelKey)) problems.push(`${label} repeats the label "${shown}".`);
    if (identities.has(key)) problems.push(`${label} offers the same ${name} as an earlier option.`);
    labels.add(labelKey);
    identities.add(key);
    options.push({ id: `${ID_PREFIX[field]}-${index + 1}`, label: shown, reason, evidence, ...payload });
  });
  return options;
}

function historyAppend(draftDir, entry) {
  mkdirSync(draftDir, { recursive: true });
  appendFileSync(join(draftDir, HISTORY_FILE), `${JSON.stringify(entry)}\n`, 'utf8');
}

function assertVoice(context) {
  const status = brandVoice.voiceComplete(profiles.read(context.brand.path));
  if (!status.complete) {
    throw new UserFacingError(`The brand voice isn't finished yet, so no copy choices can be offered. ${status.reasons.join(' ')}`, {
      code: 'brand_voice_incomplete',
      details: { missing: status.missing, reasons: status.reasons },
    });
  }
  return brandVoice.write(context.brand.path);
}

export function saveRecipeOptions({ root, brand, jobId, deliverable, options, replace = false }) {
  const base = jobContext({ root, brand, jobId, deliverable });
  const voice = assertVoice(base);
  const context = validationContext(base);
  if (!plain(options)) throw invalid(`Give the options for ${context.deliverable} as one list per field: ${FIELDS.join(', ')}.`);
  const unknown = Object.keys(options).filter(key => !FIELDS.includes(key));
  const problems = unknown.map(key => `"${key}" is not a recipe field; the fields are ${FIELDS.join(', ')}.`);
  const fields = {};
  for (const field of FIELDS) fields[field] = validateField(field, options[field], context, problems);
  if (problems.length) {
    throw invalid(`The recipe options for ${context.deliverable} need fixing. ${[...new Set(problems)].join(' ')}`, { problems: [...new Set(problems)] });
  }
  const optionsFile = join(context.draftDir, OPTIONS_FILE);
  const recipeFile = join(context.draftDir, RECIPE_FILE);
  const existingRecipe = readJson(recipeFile);
  if (existingRecipe && replace !== true) {
    throw new UserFacingError(`A recipe is already chosen for ${context.deliverable}. Offer new options only when the person wants to choose again, and pass replace.`, { code: 'recipe_already_chosen' });
  }
  const previous = readJson(optionsFile);
  const record = {
    version: 1,
    jobId: context.jobId,
    brand: context.brand.slug,
    deliverable: context.deliverable,
    platform: context.platform || null,
    revision: (Number(previous?.revision) || 0) + 1,
    savedAt: now(),
    brandProfileRevision: Number(context.profile?.revision) || 0,
    brandPillars: context.pillars,
    fields,
  };
  writeJsonAtomic(optionsFile, record);
  if (existingRecipe) {
    historyAppend(context.draftDir, { event: 'recipe_replaced', at: record.savedAt, optionsRevision: record.revision, recipe: existingRecipe });
    rmSync(recipeFile, { force: true });
  }
  return {
    deliverable: context.deliverable,
    platform: record.platform,
    revision: record.revision,
    file: `drafts/${context.deliverable}/${OPTIONS_FILE}`,
    replacedRecipe: Boolean(existingRecipe),
    voice: { complete: true, file: 'brand/brand-voice.md', version: voice.version },
    fields: Object.fromEntries(FIELDS.map(field => [field, fields[field].map(option => ({ id: option.id, label: option.label }))])),
  };
}

function resolvePick(field, pick, optionsRecord, context, problems) {
  const name = words(field);
  const label = `The ${name}`;
  if (!plain(pick)) {
    problems.push(`${label} pick must name an option or give a written-in choice.`);
    return null;
  }
  const hasOption = pick.option !== undefined;
  const hasWritten = pick.written !== undefined;
  if (hasOption === hasWritten) {
    problems.push(`${label} pick must name exactly one option or one written-in choice.`);
    return null;
  }
  if (hasOption) {
    const option = (optionsRecord.fields?.[field] || []).find(item => item.id === pick.option);
    if (!option) {
      const ids = (optionsRecord.fields?.[field] || []).map(item => item.id).join(', ');
      problems.push(`${label} pick "${pick.option}" is not one of the offered options (${ids}).`);
      return null;
    }
    const { id, ...rest } = option;
    return { source: 'option', option: id, ...rest };
  }
  if (!plain(pick.written)) {
    problems.push(`${label} written-in choice must be an object.`);
    return null;
  }
  const payload = fieldPayload(field, pick.written, context, `${label} written-in choice`, problems, { written: true });
  if (!payload) return null;
  return { source: 'written', label: writtenLabel(field, payload), ...payload };
}

function postBlock(fields) {
  return {
    pillar: fields.pillar.pillar,
    angle: fields.angle.angle,
    hook_family: fields.hookFamily.family,
    hook_mechanism: fields.hookFamily.mechanism,
    cta_style: fields.cta.style,
    cta_line: fields.cta.line || '',
    hashtags: [...fields.hashtags.tags],
  };
}

export function checkRecipePicks({ root, brand, jobId, deliverable, picks }) {
  const base = jobContext({ root, brand, jobId, deliverable });
  const context = validationContext(base);
  const optionsRecord = readJson(join(context.draftDir, OPTIONS_FILE));
  if (!optionsRecord) {
    throw new UserFacingError(`There are no recipe options for ${context.deliverable} yet. Offer the options before asking for a choice.`, { code: 'recipe_options_missing' });
  }
  if (!plain(picks) || !Object.keys(picks).length) throw invalid(`Say what was chosen for ${context.deliverable}.`);
  const existing = readJson(join(context.draftDir, RECIPE_FILE));
  const current = existing && existing.optionsRevision === optionsRecord.revision ? existing : null;
  const problems = Object.keys(picks).filter(key => !FIELDS.includes(key)).map(key => `"${key}" is not a recipe field; the fields are ${FIELDS.join(', ')}.`);
  const fields = {};
  for (const field of FIELDS) {
    if (picks[field] !== undefined) {
      const resolved = resolvePick(field, picks[field], optionsRecord, context, problems);
      if (resolved) fields[field] = resolved;
    } else if (current?.fields?.[field]) {
      fields[field] = current.fields[field];
    } else {
      problems.push(`Pick the ${words(field)} for ${context.deliverable}.`);
    }
  }
  if (problems.length) {
    throw invalid(`The recipe choice for ${context.deliverable} needs fixing. ${[...new Set(problems)].join(' ')}`, { problems: [...new Set(problems)] });
  }
  return { context, optionsRecord, current, fields };
}

export function chooseRecipe({ root, brand, jobId, deliverable, picks, chosenBy, via, requestId, note }) {
  const problems = [];
  const who = text(chosenBy, 'Who chose', WHO_MAX, problems);
  if (!VIA.has(via)) problems.push('Say whether the choice came from the board or from chat.');
  if (requestId !== undefined && requestId !== null && (typeof requestId !== 'string' || !REQUEST_ID.test(requestId))) problems.push('The board request id is not valid.');
  if (via === 'board' && !requestId) problems.push('A choice from the board carries its board request id.');
  const noteText = note === undefined || note === null ? '' : text(note, 'The note', NOTE_MAX, problems, { required: false });
  if (problems.length) throw invalid(problems.join(' '));
  const { context, optionsRecord, current, fields } = checkRecipePicks({ root, brand, jobId, deliverable, picks });
  const existing = readJson(join(context.draftDir, RECIPE_FILE));
  const record = {
    version: 1,
    jobId: context.jobId,
    brand: context.brand.slug,
    deliverable: context.deliverable,
    platform: context.platform || null,
    revision: (Number(existing?.revision) || 0) + 1,
    optionsRevision: optionsRecord.revision,
    chosenAt: now(),
    chosenBy: who,
    via,
    requestId: requestId || null,
    note: noteText || null,
    changed: FIELDS.filter(field => picks[field] !== undefined),
    fields,
    post: postBlock(fields),
  };
  writeJsonAtomic(join(context.draftDir, RECIPE_FILE), record);
  if (existing) historyAppend(context.draftDir, { event: 'recipe_rechosen', at: record.chosenAt, previous: existing });
  return {
    deliverable: record.deliverable,
    revision: record.revision,
    file: `drafts/${record.deliverable}/${RECIPE_FILE}`,
    keptFromBefore: current ? FIELDS.filter(field => picks[field] === undefined) : [],
    recipe: Object.fromEntries(FIELDS.map(field => [field, { source: fields[field].source, option: fields[field].option || null, label: fields[field].label }])),
    post: record.post,
  };
}

export function readJobRecipes({ root, brand, jobId }) {
  const context = jobContext({ root, brand, jobId });
  const draftsDir = join(context.dir, 'drafts');
  const ids = new Set(deliverableRows(context.job).map(row => row.id));
  if (existsSync(draftsDir)) {
    for (const name of readdirSync(draftsDir)) if (DELIVERABLE.test(name)) ids.add(name);
  }
  const out = {};
  for (const id of [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const draftDir = join(draftsDir, id);
    const options = readJson(join(draftDir, OPTIONS_FILE));
    const recipe = readJson(join(draftDir, RECIPE_FILE));
    out[id] = {
      options,
      recipe,
      chosen: Boolean(recipe && options && recipe.optionsRevision === options.revision),
    };
  }
  return { jobId: context.jobId, voice: brandVoice.readStatus(context.brand.path), deliverables: out };
}
