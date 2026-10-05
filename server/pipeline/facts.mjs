import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_CREDITS_EACH } from '../generation/estimate.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { defaultWorkspaceRoot, expandUserPath, globalConfigDir, globalConfigPath, workspaceConfigPath } from '../lib/paths.mjs';
import {
  ELEVEN_LABS_MEDIA, FACT_FILE_DENY, NO_JOB_DENY, NO_JOB_WARNING, SPEND_DENY, THREE_ECHO_SPENDERS, VOICE_ESTIMABLE, VOICE_SPENDERS,
  asObject, isFactFile, toolBase,
} from './spend-tools.mjs';

export { IMAGE_CREDITS_EACH };
export {
  ELEVEN_LABS_MEDIA, FACT_FILE_DENY, NO_JOB_DENY, NO_JOB_WARNING, SPEND_DENY, THREE_ECHO_SPENDERS, VOICE_ESTIMABLE, VOICE_SPENDERS,
  asObject, isFactFile, toolBase,
};

const require = createRequire(import.meta.url);
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts');
const lib = name => require(join(SCRIPTS, name));

export const THREE_ECHO = 'threeEcho';
export const ELEVEN_LABS = 'elevenLabs';
export const PROVIDERS = Object.freeze([THREE_ECHO, ELEVEN_LABS]);

const THREE_ECHO_TOOLS = new Set([
  'list_workspaces', 'get_workspace_capabilities', 'estimate_video_job', 'create_image_job', 'create_video_job',
  'wait_for_job', 'get_job', 'get_job_result', 'get_asset', 'fetch_asset_bytes', 'import_asset_from_url', 'cancel_job',
]);
export const THREE_ECHO_RESULTS = Object.freeze(['wait_for_job', 'get_job_result', 'get_asset']);
export const THREE_ECHO_ESTIMATE = 'estimate_video_job';
const VOICE_DEFAULT_GENERATIONS = 4;
const EPSILON = 1e-6;

export const FACT_FILES = Object.freeze({
  records: 'generation/records.jsonl',
  landed: 'generation/landed.jsonl',
  estimates: 'pricing/estimates.jsonl',
  quote: 'pricing/quote.json',
});

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const finite = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);

export function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function providerOf(base) {
  if (THREE_ECHO_TOOLS.has(base)) return THREE_ECHO;
  if (String(base).startsWith('creative_')) return ELEVEN_LABS;
  return null;
}

export function parseToolResponse(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return parseToolResponse(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const block of value) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        const parsed = parseToolResponse(block.text, depth + 1);
        if (parsed) return parsed;
      }
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  if (value.isError === true) return null;
  if (value.structuredContent && typeof value.structuredContent === 'object') return value.structuredContent;
  if (Array.isArray(value.content) && !Object.keys(value).some(key => !['content', 'isError', '_meta'].includes(key))) {
    return parseToolResponse(value.content, depth + 1);
  }
  return value;
}

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const SLASH_KEY = /^([^/\s]+)\/(D\d+)\/([A-Za-z][A-Za-z0-9_-]*)(?:\/v(\d+))?$/i;
const DASH_KEY = /^(.+)-(D\d+)-([A-Za-z][A-Za-z0-9_]*)(?:-v(\d+))?$/;
const CONTEXT_TAG = /(?:^|[^A-Za-z0-9_])job:([A-Za-z0-9][A-Za-z0-9._/-]*)/i;

const validJobId = value => typeof value === 'string' && JOB_ID.test(value) && !value.includes('..');

export function canonicalDeliverable(value) {
  const hit = /^D0*(\d+)$/i.exec(String(value ?? '').trim());
  return hit ? 'D' + Number(hit[1]) : null;
}

export function canonicalItem(value) {
  const raw = String(value ?? '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(raw) || /^v\d+$/i.test(raw)) return null;
  const hit = /^([A-Za-z]+)0*(\d+)$/.exec(raw);
  return hit ? hit[1].toUpperCase() + Number(hit[2]) : raw;
}

export function formatJobKey({ jobId, deliverable, item, panel, version = 1 } = {}) {
  const d = canonicalDeliverable(deliverable);
  const p = canonicalItem(item ?? panel);
  const v = Number(version);
  if (!validJobId(jobId) || !d || !p || !Number.isSafeInteger(v) || v < 1) return null;
  return `${jobId}-${d}-${p}-v${v}`;
}

export function parseJobKey(value) {
  const raw = String(value ?? '').trim();
  const hit = SLASH_KEY.exec(raw) || DASH_KEY.exec(raw);
  if (!hit || !validJobId(hit[1])) return null;
  const deliverable = canonicalDeliverable(hit[2]);
  const item = canonicalItem(hit[3]);
  const version = hit[4] === undefined ? 1 : Number(hit[4]);
  if (!deliverable || !item || !Number.isSafeInteger(version) || version < 1) return null;
  return { jobId: hit[1], deliverable, item, version, key: formatJobKey({ jobId: hit[1], deliverable, item, version }) };
}

export const canonicalJobKey = value => parseJobKey(value)?.key ?? null;
export const jobKey = formatJobKey;

export function parseContextTag(value) {
  const raw = String(value ?? '');
  const hit = CONTEXT_TAG.exec(raw);
  if (!hit) return null;
  const token = hit[1].replace(/[._/-]+$/, '');
  const full = parseJobKey(token);
  if (full) return full;
  if (!validJobId(token)) return null;
  const words = raw.slice(hit.index + hit[0].length).split(/[\s,;|]+/).map(word => word.replace(/[.:]+$/, '')).filter(Boolean);
  let deliverable = null;
  let item = null;
  let version = 1;
  if (canonicalDeliverable(words[0])) {
    deliverable = canonicalDeliverable(words[0]);
    if (canonicalItem(words[1])) {
      item = canonicalItem(words[1]);
      const v = /^v(\d+)$/i.exec(words[2] || '');
      if (v && Number(v[1]) >= 1) version = Number(v[1]);
    }
  }
  return {
    jobId: token,
    deliverable,
    item,
    version: item ? version : null,
    key: deliverable && item ? formatJobKey({ jobId: token, deliverable, item, version }) : null,
  };
}

export function callTag(toolInput) {
  const input = asObject(toolInput);
  if (typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()) {
    const parsed = parseJobKey(input.idempotencyKey);
    return parsed ? { ...parsed, via: 'key' } : { via: 'key', jobId: null, deliverable: null, item: null, version: null, key: null };
  }
  if (typeof input.context === 'string') {
    const parsed = parseContextTag(input.context);
    if (parsed) return { ...parsed, via: 'context' };
  }
  return null;
}

const PRICE_FAMILY = Object.freeze({ estimate_video_job: 'create_video_job' });
const PRICE_IGNORED = new Set(['estimate_only', 'context', 'idempotencyKey', 'workspaceId', 'flow_id', 'view_state_id']);
const PRICE_IGNORED_BY_FAMILY = Object.freeze({ create_video_job: new Set(['prompt']) });

export function priceKey(toolName, input) {
  const family = PRICE_FAMILY[toolBase(toolName)] || toolBase(toolName);
  const skip = PRICE_IGNORED_BY_FAMILY[family];
  const fields = {};
  for (const [name, value] of Object.entries(asObject(input))) {
    if (PRICE_IGNORED.has(name) || (skip && skip.has(name)) || value === null || value === undefined) continue;
    if (Array.isArray(value) && !value.length) continue;
    fields[name] = name === 'assetIds' && Array.isArray(value) ? value.map(String).sort() : value;
  }
  return 'pk-' + sha256(stableStringify({ tool: family, fields })).slice(0, 24);
}

function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function within(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  if (process.platform === 'win32' && /^[a-z]:/i.test(rel)) return false;
  return rel === '' || (!rel.startsWith('..') && !/^[\\/]/.test(rel));
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function homePointerFolder() {
  try {
    return dirname(globalConfigDir());
  } catch {
    return null;
  }
}

function isPointerShape(config) {
  return Boolean(config && typeof config === 'object' && (Array.isArray(config.known_workspaces) || Array.isArray(config.project_workspaces)));
}

function isWorkspaceRoot(dir) {
  const home = homePointerFolder();
  if (home && samePath(dir, home)) return false;
  if (existsSync(workspaceConfigPath(dir))) return !isPointerShape(readJson(workspaceConfigPath(dir)));
  const pipeline = readJson(join(dir, '.social-pipeline', 'config.json'));
  if (!pipeline || typeof pipeline !== 'object' || typeof pipeline.workspaceId !== 'string' || !pipeline.workspaceId.trim()) return false;
  const configured = typeof pipeline.root === 'string' ? pipeline.root.trim() : '';
  return configured === '.' || samePath(resolve(dir, configured || '.'), dir);
}

function pipelineRoot(dir) {
  if (!dir) return null;
  const config = readJson(join(dir, '.social-pipeline', 'config.json'));
  if (!config || typeof config !== 'object') return null;
  if (config.storage?.mode && config.storage.mode !== 'local') return null;
  return resolve(dir);
}

export function resolveWorkspaceRoot(cwd) {
  const override = process.env.SOCIAL_CAMPAIGN_WORKSPACE;
  if (override && override.trim()) return pipelineRoot(expandUserPath(override));
  const target = cwd ? resolve(cwd) : null;
  if (!target) return null;
  let pointer = null;
  try {
    pointer = readJson(globalConfigPath());
  } catch {
    pointer = null;
  }
  const bindings = Array.isArray(pointer?.project_workspaces) ? pointer.project_workspaces : [];
  const binding = bindings
    .filter(entry => entry && typeof entry.projectRoot === 'string' && typeof entry.workspaceRoot === 'string' && within(entry.projectRoot, target))
    .sort((a, b) => resolve(b.projectRoot).length - resolve(a.projectRoot).length)[0];
  if (binding && existsSync(binding.workspaceRoot)) return pipelineRoot(binding.workspaceRoot);
  const home = homePointerFolder();
  for (let dir = target; ; dir = dirname(dir)) {
    if (!(home && samePath(dir, home)) && isWorkspaceRoot(dir)) return pipelineRoot(dir);
    if (dirname(dir) === dir) break;
  }
  const child = join(target, basename(defaultWorkspaceRoot()));
  if (!samePath(child, target) && isWorkspaceRoot(child)) return pipelineRoot(child);
  return null;
}

const STATE_LINE = /\*\*Current state:\*\*\s*`?([A-Z_]+)`?/;
const REVISION_LINE = /\*\*Revision:\*\*\s*`?(\d+)`?/i;
const safeName = value => typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\\/]/.test(value) && value !== '.' && value !== '..';

export function readJobState(dir) {
  try {
    const status = readFileSync(join(dir, 'status.md'), 'utf8');
    const revision = (status.match(REVISION_LINE) || [])[1];
    return { state: (status.match(STATE_LINE) || [])[1] || null, revision: revision === undefined ? 0 : Number(revision) };
  } catch {
    return { state: null, revision: null };
  }
}

export function jobAt(root, brand, jobId) {
  if (!root || !safeName(brand) || !safeName(jobId)) return null;
  const dir = join(resolve(root), 'workspaces', brand, 'jobs', jobId);
  if (!existsSync(join(dir, 'status.md'))) return null;
  return { root: resolve(root), brand, jobId, dir, ...readJobState(dir) };
}

export function jobFromDir(dir) {
  const at = resolve(String(dir || '.'));
  return jobAt(resolve(at, '..', '..', '..', '..'), basename(dirname(dirname(at))), basename(at));
}

export function findJob(root, jobId) {
  if (!root || !safeName(jobId)) return null;
  let brands = [];
  try {
    brands = readdirSync(join(root, 'workspaces'), { withFileTypes: true });
  } catch {
    return null;
  }
  for (const brand of brands) {
    if (!brand.isDirectory() || brand.name.startsWith('.')) continue;
    const job = jobAt(root, brand.name, jobId);
    if (job) return job;
  }
  return null;
}

export function listJobs(root) {
  const out = [];
  let brands = [];
  try {
    brands = readdirSync(join(root, 'workspaces'), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const brand of brands) {
    if (!brand.isDirectory() || brand.name.startsWith('.')) continue;
    let jobs = [];
    try {
      jobs = readdirSync(join(root, 'workspaces', brand.name, 'jobs'), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of jobs) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const job = jobAt(root, brand.name, entry.name);
      if (job) out.push(job);
    }
  }
  return out;
}

const rootArgv = root => ['--root', resolve(root)];

export function readSessionBinding(root, sessionId) {
  if (!root || !sessionId) return null;
  try {
    const binding = lib('lib-session.js').read(String(sessionId), rootArgv(root));
    return binding && !binding.invalid ? { brand: binding.brand, jobId: binding.jobId } : null;
  } catch {
    return null;
  }
}

/** Every saved session binding as [{ref, own, at}]: the job, whether it is this session's, and when it was last touched. */
export function sessionBindings(root, sessionId = null) {
  if (!root) return [];
  try {
    const sessions = lib('lib-session.js');
    const own = sessionId ? basename(sessions.file(String(sessionId), rootArgv(root)) || '', '.json') : null;
    return sessions.list(rootArgv(root)).map(binding => ({ ref: `${binding.brand}/${binding.jobId}`, own: binding.key === own, at: Date.parse(binding.touchedAt || binding.selectedAt || '') }));
  } catch {
    return [];
  }
}

export function writeSessionBinding({ root, sessionId, brand, jobId } = {}) {
  if (!root || !sessionId || !safeName(brand) || !safeName(jobId)) return null;
  const current = readSessionBinding(root, sessionId);
  if (current && current.brand === brand && current.jobId === jobId) {
    try {
      lib('lib-session.js').touch(String(sessionId), rootArgv(root));
    } catch {
      // the binding itself is unchanged; only the "still here" time could not be saved
    }
    return current;
  }
  const saved = lib('lib-session.js').bind(String(sessionId), brand, jobId, rootArgv(root));
  return { brand: saved.brand, jobId: saved.jobId };
}

export function isFinishedState(state) {
  try {
    return Boolean(state) && lib('lib-states.js').isTerminal(state);
  } catch {
    return false;
  }
}

// The same test as the legacy guard: a .social-pipeline/config.json at the folder or any parent of it.
export function inPipelineWorkspace(cwd) {
  if (!cwd) return false;
  for (let dir = resolve(String(cwd)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.social-pipeline', 'config.json'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

export function resolveJobForCall({ cwd, sessionId, toolInput, root: givenRoot } = {}) {
  const root = givenRoot ? resolve(givenRoot) : resolveWorkspaceRoot(cwd);
  if (!root) return null;
  const tag = callTag(toolInput);
  if (tag && tag.jobId) {
    const job = findJob(root, tag.jobId);
    if (job) return { ...job, via: tag.via, tag };
  }
  const bound = readSessionBinding(root, sessionId);
  if (bound) {
    const job = jobAt(root, bound.brand, bound.jobId);
    if (job && !isFinishedState(job.state)) return { ...job, via: 'session', tag };
  }
  return null;
}

export function itemKeyFor(job) {
  const tag = job?.tag;
  return tag && tag.jobId === job.jobId && tag.key ? tag.key : null;
}

const factFile = (job, name) => join(job.dir, ...FACT_FILES[name].split('/'));

function appendLine(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  const entry = { at: new Date().toISOString(), ...record };
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

function readLines(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) out.push(value);
    } catch {
      continue;
    }
  }
  return out;
}

export const appendRecord = (job, record) => appendLine(factFile(job, 'records'), record);
export const readRecords = job => readLines(factFile(job, 'records'));
export const appendLanded = (job, record) => appendLine(factFile(job, 'landed'), record);
export const readLanded = job => readLines(factFile(job, 'landed'));
export const readEstimates = job => readLines(factFile(job, 'estimates'));

export function appendEstimate(job, record) {
  const at = record.at || new Date().toISOString();
  const estimateId = record.estimateId || 'est-' + sha256(stableStringify({ ...record, at })).slice(0, 16);
  return appendLine(factFile(job, 'estimates'), { at, estimateId, ...record });
}

export function latestEstimate(job, key) {
  const found = readEstimates(job).filter(entry => entry.priceKey === key && finite(entry.credits) !== null);
  return found.length ? found[found.length - 1] : null;
}

export function isLanded(job, assetId) {
  return readLanded(job).some(entry => entry.type === 'landed' && entry.assetId === assetId && entry.file &&
    existsSync(join(job.dir, ...String(entry.file).split('/'))));
}

export function readQuote(job) {
  let bytes;
  try {
    bytes = readFileSync(factFile(job, 'quote'));
  } catch {
    return null;
  }
  let quote;
  try {
    quote = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (!quote || typeof quote !== 'object' || !Array.isArray(quote.items)) return null;
  const fileSha256 = sha256(bytes);
  const spoken = quote.items.filter(isTranscriptionItem);
  if (!spoken.length) return { quote, sha256: fileSha256, fileSha256, transcriptionSha: null };
  const render = list => JSON.stringify({ items: list, totals: quoteTotals(list) }, null, 2) + '\n';
  return {
    quote,
    sha256: sha256(render(quote.items.filter(item => !isTranscriptionItem(item)))),
    fileSha256,
    transcriptionSha: sha256(render(spoken)),
  };
}

export function quoteItem(quote, key) {
  const wanted = canonicalJobKey(key);
  if (!wanted || !Array.isArray(quote?.items)) return null;
  return quote.items.find(item => item && canonicalJobKey(item.key) === wanted) || null;
}

export function currentPriceApproval(job) {
  const current = readQuote(job);
  if (!current) return null;
  let names = [];
  try {
    names = readdirSync(join(job.dir, 'pricing'));
  } catch {
    return null;
  }
  const numbered = names
    .map(name => ({ name, hit: /^approval-(\d+)\.json$/.exec(name) }))
    .filter(entry => entry.hit)
    .map(entry => ({ name: entry.name, n: Number(entry.hit[1]) }))
    .sort((a, b) => b.n - a.n);
  for (const entry of numbered) {
    const approval = readJson(join(job.dir, 'pricing', entry.name));
    if (!approval || typeof approval !== 'object' || approval.scope === TRANSCRIPTION_SCOPE || approval.quoteSha !== current.sha256) continue;
    if (approval.decision !== 'approved') return null;
    return { n: entry.n, file: `pricing/${entry.name}`, approval, quote: current.quote, quoteSha: current.sha256 };
  }
  return null;
}

export const TRANSCRIPTION_SCOPE = 'transcription';

export function currentTranscriptionApproval(job) {
  const current = readQuote(job);
  if (!current?.transcriptionSha) return null;
  let names = [];
  try {
    names = readdirSync(join(job.dir, 'pricing'));
  } catch {
    return null;
  }
  const numbered = names
    .map(name => ({ name, hit: /^approval-(\d+)\.json$/.exec(name) }))
    .filter(entry => entry.hit)
    .map(entry => ({ name: entry.name, n: Number(entry.hit[1]) }))
    .sort((a, b) => b.n - a.n);
  for (const entry of numbered) {
    const approval = readJson(join(job.dir, 'pricing', entry.name));
    if (!approval || typeof approval !== 'object' || approval.scope !== TRANSCRIPTION_SCOPE || approval.quoteSha !== current.transcriptionSha) continue;
    if (approval.decision !== 'approved') return null;
    return { n: entry.n, file: `pricing/${entry.name}`, approval, quote: current.quote, quoteSha: current.transcriptionSha };
  }
  return null;
}

export function pricePending(job) {
  const current = readQuote(job);
  if (!current) return { media: false, transcription: false };
  const media = current.quote.items.some(item => item && !isTranscriptionItem(item));
  return {
    media: media && !currentPriceApproval(job),
    transcription: Boolean(current.transcriptionSha) && !currentTranscriptionApproval(job),
  };
}

export function approvedTotal(price, provider) {
  const fromApproval = finite(price?.approval?.totals?.[provider]);
  if (fromApproval !== null) return fromApproval;
  const fromQuote = finite(price?.quote?.totals?.[provider]);
  return fromQuote === null ? 0 : fromQuote;
}

const RELEASED_BILLING = new Set(['released', 'refunded', 'voided', 'cancelled', 'canceled']);
const RELEASED_STATUS = new Set(['failed', 'cancelled', 'canceled']);

export function creditsCommitted(job, scope = null) {
  const calls = new Map();
  const entry = id => {
    if (!calls.has(id)) calls.set(id, { provider: null, reserved: null, final: null, released: false, spoken: false });
    return calls.get(id);
  };
  for (const record of readRecords(job)) {
    if (!record.providerJobId || !PROVIDERS.includes(record.provider)) continue;
    const call = entry(record.providerJobId);
    call.provider = record.provider;
    if (record.type === 'create') call.spoken = isTranscriptionItem(record.key);
    if (record.type === 'create' && finite(record.reservedCredits) !== null) call.reserved = finite(record.reservedCredits);
    if (record.type === 'result') {
      if (finite(record.finalCredits) !== null) call.final = finite(record.finalCredits);
      if (RELEASED_BILLING.has(String(record.billingStatus || '').toLowerCase()) || RELEASED_STATUS.has(String(record.status || '').toLowerCase())) call.released = true;
    }
  }
  for (const record of readLanded(job)) {
    if (record.type !== 'landed' || !record.providerJobId || !calls.has(record.providerJobId)) continue;
    const call = calls.get(record.providerJobId);
    if (call.final === null && finite(record.finalCredits) !== null) call.final = finite(record.finalCredits);
  }
  const totals = { [THREE_ECHO]: 0, [ELEVEN_LABS]: 0 };
  for (const call of calls.values()) {
    if (!call.provider) continue;
    if (scope === TRANSCRIPTION_SCOPE && !call.spoken) continue;
    if (scope === 'media' && call.spoken) continue;
    totals[call.provider] += call.final !== null ? call.final : call.released ? 0 : call.reserved || 0;
  }
  return totals;
}

const FINGERPRINT_GATES = [...lib('lib-states.js').GATE_IDS, 'report', 'price'];

function statEntries(base, rel, out) {
  let entries = [];
  try {
    entries = readdirSync(join(base, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) statEntries(base, child, out);
    else if (entry.isFile()) {
      try {
        const info = statSync(join(base, child));
        out.push(`${child}\t${info.size}\t${info.mtimeMs}`);
      } catch {
        continue;
      }
    }
  }
}

export function reviewRecordFile(root, brand, jobId, gate) {
  return join(root, '.social-pipeline', 'board', 'requests', `review-${sha256(JSON.stringify([brand, jobId, gate]))}.record`);
}

export function factsFingerprint(job) {
  const lines = [];
  try {
    const info = statSync(join(job.dir, 'status.md'));
    lines.push(`status.md\t${info.size}\t${info.mtimeMs}`);
  } catch {
    lines.push('status.md\tmissing');
  }
  for (const folder of ['pricing', 'generation', 'approvals', 'messages']) statEntries(job.dir, folder, lines);
  try {
    const info = statSync(join(job.dir, 'agents.jsonl'));
    lines.push(`agents.jsonl\t${info.size}\t${info.mtimeMs}`);
  } catch {}
  try {
    const info = statSync(join(job.dir, 'validation', 'label-check.json'));
    lines.push(`validation/label-check.json\t${info.size}\t${info.mtimeMs}`);
  } catch {}
  for (const gate of FINGERPRINT_GATES) {
    try {
      const info = statSync(reviewRecordFile(job.root, job.brand, job.jobId, gate));
      lines.push(`review:${gate}\t${info.size}\t${info.mtimeMs}`);
    } catch {
      continue;
    }
  }
  return sha256(lines.sort().join('\n'));
}

const CHAIN_AVOID = new Set(['BLOCKED', 'ESCALATED', 'CANCELLED', 'CHANGES_REQUESTED', 'COMPLETE']);

export function legalChain(from, to) {
  const states = lib('lib-states.js');
  if (!states.exists(from) || !states.exists(to)) return null;
  if (from === to) return [];
  const approved = new Set(Object.values(states.APPROVED_STATE || {}));
  const passable = id => !states.isGate(id) && !approved.has(id) && !CHAIN_AVOID.has(id) && !states.isRetired(id);
  const seen = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift();
    for (const next of states.get(at).next || []) {
      if (seen.has(next) || !states.canMove(at, next)) continue;
      seen.set(next, at);
      if (next === to) {
        const path = [to];
        for (let step = at; step !== from; step = seen.get(step)) path.unshift(step);
        return path;
      }
      if (passable(next)) queue.push(next);
    }
  }
  return null;
}

export function moveJobTo(job, target, { by = 'pipeline' } = {}) {
  const { state: from } = readJobState(job.dir);
  if (!from) return { ok: false, from: null, to: target, steps: [], note: 'The job state could not be read.' };
  if (from === target) return { ok: true, from, to: target, steps: [], note: 'Already there.' };
  const steps = legalChain(from, target);
  if (!steps) return { ok: false, from, to: target, steps: [], note: `No legal move from ${from} to ${target}.` };
  const { advance } = lib('lib-advance.js');
  let at = from;
  for (const step of steps) {
    const moved = advance(job.dir, step, { by, expectState: at });
    if (!moved.ok) return { ok: false, from, to: target, steps, failedAt: step, note: String(moved.out || '').slice(0, 400) };
    at = step;
  }
  return { ok: true, from, to: target, steps };
}

export const REFERENCE_ART_STATES = Object.freeze(['BRIEF_READY', 'CONCEPTS_DRAFTED', 'CONCEPT_APPROVED']);
const MEDIA_START_STATES = new Set(['STORYBOARD_APPROVED', 'MEDIA_READY']);
const REFERENCE_ITEM = /^R\d+$/;

export function isReferenceItem(value) {
  if (value && typeof value === 'object') return REFERENCE_ITEM.test(String(canonicalItem(value.panel ?? parseJobKey(value.key)?.item) || ''));
  return REFERENCE_ITEM.test(String(parseJobKey(value)?.item || canonicalItem(value) || ''));
}

const TRANSCRIPTION_ITEM = /^TR\d+$/;

export function isTranscriptionItem(value) {
  if (value && typeof value === 'object') {
    if (value.kind === 'transcription') return true;
    return TRANSCRIPTION_ITEM.test(String(canonicalItem(value.panel ?? parseJobKey(value.key)?.item) || ''));
  }
  return TRANSCRIPTION_ITEM.test(String(parseJobKey(value)?.item || canonicalItem(value) || ''));
}

const STAGE_LOG_HEADER = /\| Timestamp \| From \| To \| By \| Note \|\r?\n\|[-| ]+\|\r?\n/;
const STORYBOARD_PASSED = new Set(['STORYBOARD_APPROVED', 'MEDIA_GENERATING', 'MEDIA_READY']);
const APPROVAL_UNCERTAIN = new Set(['CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED']);

function stageLog(job) {
  let raw = '';
  try {
    raw = readFileSync(join(job.dir, 'status.md'), 'utf8');
  } catch {
    return [];
  }
  const head = STAGE_LOG_HEADER.exec(raw);
  if (!head) return [];
  const rows = [];
  for (const line of raw.slice(head.index + head[0].length).split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) break;
    const to = (line.split('|').map(cell => cell.trim())[3] || '').replace(/`/g, '');
    if (lib('lib-states.js').exists(to)) rows.push(to);
  }
  return rows;
}

export function storyboardApproved(job) {
  const { state } = readJobState(job.dir);
  const ids = lib('lib-states.js').ids();
  const approvedAt = ids.indexOf('STORYBOARD_APPROVED');
  const at = ids.indexOf(state);
  if (!state || approvedAt < 0 || at < 0) return false;
  if (STORYBOARD_PASSED.has(state)) return true;
  if (at > approvedAt && !APPROVAL_UNCERTAIN.has(state)) return true;
  let approved = false;
  for (const to of stageLog(job)) {
    if (to === 'STORYBOARD_APPROVED') approved = true;
    else if (ids.indexOf(to) < approvedAt) approved = false;
  }
  return approved;
}

export function referenceArtOnly(job) {
  const { state } = readJobState(job.dir);
  const ids = lib('lib-states.js').ids();
  const at = ids.indexOf(state);
  if (at < 0) return false;
  if (at < ids.indexOf('STORYBOARD_APPROVED') || APPROVAL_UNCERTAIN.has(state)) return !storyboardApproved(job);
  return false;
}

export function mediaStartDue(state, job = null) {
  if (!state) return false;
  if (state === 'CHANGES_REQUESTED') return Boolean(job) && storyboardApproved(job);
  return MEDIA_START_STATES.has(state);
}

export function startMediaIfDue(job) {
  const { state } = readJobState(job.dir);
  if (!mediaStartDue(state, job)) return null;
  const moved = moveJobTo(job, 'MEDIA_GENERATING');
  appendRecord(job, { type: 'state', reason: 'first paid call', ...moved });
  return moved;
}

export function allQuotedItemsLanded(job) {
  const current = readQuote(job);
  const items = (current?.quote?.items || []).filter(item => item && canonicalJobKey(item.key) && !isReferenceItem(item) && !isTranscriptionItem(item));
  if (!items.length) return false;
  const landed = new Set(readLanded(job).filter(entry => entry.type === 'landed').map(entry => canonicalJobKey(entry.key)).filter(Boolean));
  return items.every(item => landed.has(canonicalJobKey(item.key)));
}

export function finishMediaIfLanded(job) {
  if (!allQuotedItemsLanded(job)) return null;
  const { state } = readJobState(job.dir);
  if (state !== 'MEDIA_GENERATING') return null;
  const moved = moveJobTo(job, 'MEDIA_READY');
  appendRecord(job, { type: 'state', reason: 'every quoted item landed', ...moved });
  return moved;
}

export function findGenerationOwner(root, { providerJobId, assetId, sessionIds } = {}, preferred = null) {
  const sessions = (Array.isArray(sessionIds) ? sessionIds : []).map(text).filter(Boolean);
  if (!root || (!providerJobId && !assetId && !sessions.length)) return null;
  const seen = new Set();
  const jobs = [];
  if (preferred?.dir) {
    jobs.push(preferred);
    seen.add(resolve(preferred.dir));
  }
  for (const job of listJobs(root)) {
    if (seen.has(resolve(job.dir)) || !existsSync(factFile(job, 'records'))) continue;
    jobs.push(job);
  }
  for (const job of jobs) {
    const records = readRecords(job);
    let id = providerJobId || null;
    if (!id && assetId) {
      const holder = [...records].reverse().find(record => Array.isArray(record.outputAssetIds) && record.outputAssetIds.includes(assetId));
      id = holder?.providerJobId || null;
    }
    if (!id && sessions.length) {
      const run = [...records].reverse().find(record => record.type === 'create' && record.provider === ELEVEN_LABS &&
        (sessions.includes(record.providerJobId) || (Array.isArray(record.sessionIds) && record.sessionIds.some(session => sessions.includes(session)))));
      id = run?.providerJobId || null;
    }
    if (!id) continue;
    const create = records.find(record => record.type === 'create' && record.providerJobId === id);
    if (!create) continue;
    const results = records.filter(record => record.type === 'result' && record.providerJobId === id);
    return { job, providerJobId: id, create, result: results.length ? results[results.length - 1] : null };
  }
  return null;
}

const URL_KEYS = new Set(['mediaUrl', 'downloadUrl', 'signedUrl']);

export function isFetchableUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function mediaLinks(value) {
  const out = [];
  const seen = new Set();
  const walk = (node, inherited, parentKey, depth) => {
    if (depth > 10 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, inherited, parentKey, depth + 1);
      return;
    }
    const asset = node.asset && typeof node.asset === 'object' && !Array.isArray(node.asset) ? node.asset : {};
    const here = {
      assetId: text(node.assetId) || text(node.asset_id) || text(asset.assetId) || inherited.assetId || null,
      mimeType: text(node.mimeType) || text(asset.mimeType) || inherited.mimeType || null,
      filename: text(node.filename) || text(asset.filename) || inherited.filename || null,
      expiresAt: text(node.expiresAt) || inherited.expiresAt || null,
    };
    for (const [key, child] of Object.entries(node)) {
      if (typeof child !== 'string') continue;
      if ((URL_KEYS.has(key) || (key === 'url' && parentKey === 'media')) && isFetchableUrl(child) && !seen.has(child)) {
        seen.add(child);
        out.push({ url: child, ...here });
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (child && typeof child === 'object') walk(child, here, key, depth + 1);
    }
  };
  walk(value, {}, null, 0);
  return out;
}

export const VOICE_RESULTS = Object.freeze(['creative_get_flow_run_status', 'creative_show_flow_results']);
const DONE_STATUSES = new Set(['completed', 'complete', 'succeeded', 'success', 'done', 'finished', 'ready']);
const FAILED_STATUSES = new Set(['failed', 'failure', 'error', 'errored', 'cancelled', 'canceled']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'opus', 'weba']);
const NOT_AUDIO_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp4', 'mov', 'html', 'htm', 'json']);
const VOICE_URL_PRIORITY = ['download_url', 'downloadUrl', 'audio_url', 'audioUrl', 'output_url', 'outputUrl', 'file_url', 'fileUrl',
  'media_url', 'mediaUrl', 'signed_url', 'signedUrl', 'url', 'preview_url', 'previewUrl'];
const NOT_OUTPUT_URL = /flow|canvas|app|thumb|image|poster|waveform|view|page/i;
const CREDIT_FIELDS = ['credits_used', 'creditsUsed', 'credits_charged', 'charged_credits', 'cost_credits', 'credits', 'total_credits'];

export const voiceRunFinished = data => Boolean(data && (data.all_completed === true || data.has_failures === true));

function firstFinite(node, names) {
  for (const name of names) {
    const value = finite(node?.[name]);
    if (value !== null) return value;
  }
  return null;
}

function isAudioLink(link) {
  let path;
  try {
    path = new URL(link.url).pathname;
  } catch {
    return false;
  }
  if (/\/app\//i.test(path)) return false;
  const mime = String(link.mimeType || '').toLowerCase();
  if (mime.startsWith('audio/')) return true;
  if (/^(image|video|text)\//.test(mime)) return false;
  const extension = extname(path).slice(1).toLowerCase();
  return AUDIO_EXTENSIONS.has(extension) || !NOT_AUDIO_EXTENSIONS.has(extension);
}

function urlRank(key) {
  const at = VOICE_URL_PRIORITY.indexOf(key);
  return at < 0 ? VOICE_URL_PRIORITY.length : at;
}

export function voiceOutputs(data) {
  const list = Array.isArray(data?.generations) ? data.generations : [];
  const run = text(data?.session_id) || (Array.isArray(data?.session_ids) ? text(data.session_ids[0]) : null) || 'run';
  return list.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry)).map((entry, index) => {
    const status = String(entry.status || entry.state || '').trim().toLowerCase() || null;
    const found = [];
    const walk = (node, inherited, depth) => {
      if (!node || typeof node !== 'object' || depth > 4) return;
      if (Array.isArray(node)) {
        for (const child of node) walk(child, inherited, depth + 1);
        return;
      }
      const here = {
        mimeType: text(node.mime_type) || text(node.mimeType) || text(node.content_type) || text(node.contentType) || inherited.mimeType,
        requiresAuth: node.requires_auth === true || node.requiresAuth === true || inherited.requiresAuth,
        filename: text(node.filename) || text(node.file_name) || inherited.filename,
        expiresAt: text(node.expires_at) || text(node.expiresAt) || inherited.expiresAt,
      };
      for (const [key, value] of Object.entries(node)) {
        if (typeof value !== 'string' || !/^https?:/i.test(value)) continue;
        if (!(/(^|_)url$/i.test(key) || /Url$/.test(key)) || NOT_OUTPUT_URL.test(key.replace(/_?url$/i, ''))) continue;
        found.push({ key, url: value, ...here });
      }
      for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value, here, depth + 1);
    };
    walk(entry, { mimeType: null, requiresAuth: false, filename: null, expiresAt: null }, 0);
    const link = found.filter(isAudioLink).sort((a, b) => urlRank(a.key) - urlRank(b.key))[0] || null;
    const failed = FAILED_STATUSES.has(status);
    const usable = Boolean(link && !link.requiresAuth && isFetchableUrl(link.url));
    return {
      id: text(entry.generation_id) || text(entry.generationId) || text(entry.asset_id) || text(entry.assetId) || text(entry.id) ||
        text(entry.output_id) || `${text(entry.session_id) || run}-${index + 1}`,
      status,
      ok: !failed && (DONE_STATUSES.has(status) || (!status && Boolean(link))),
      failed,
      url: usable ? link.url : null,
      blocked: Boolean(link && !usable),
      mimeType: link?.mimeType || text(entry.mime_type) || text(entry.mimeType) || null,
      filename: link?.filename || null,
      expiresAt: link?.expiresAt || null,
      credits: firstFinite(entry, CREDIT_FIELDS),
    };
  });
}

export function voiceRunCredits(data, outputs = voiceOutputs(data)) {
  const each = outputs.map(output => output.credits).filter(value => value !== null);
  if (each.length) return each.reduce((sum, value) => sum + value, 0);
  return firstFinite(data, CREDIT_FIELDS);
}

function voiceGenerations(base, input) {
  if (base !== 'creative_generate_speech') return null;
  const n = finite(input.generations_count);
  return n === null ? VOICE_DEFAULT_GENERATIONS : n;
}

function sampleKeyFor(job, quote) {
  const items = Array.isArray(quote?.items) ? quote.items : [];
  const marked = items.find(entry => entry && entry.provider === THREE_ECHO && entry.sample === true && !isReferenceItem(entry));
  if (marked) return canonicalJobKey(marked.key);
  const first = readRecords(job).find(record => record.type === 'create' && record.provider === THREE_ECHO && !isReferenceItem(record.key));
  return first ? canonicalJobKey(first.key) : null;
}

function sampleApproved(job, key) {
  const approval = readJson(join(job.dir, 'approvals', 'sample.json'));
  if (!approval || typeof approval !== 'object' || approval.decision !== 'approve' || canonicalJobKey(approval.key) !== key) return false;
  const landed = readLanded(job).filter(entry => entry.type === 'landed' && canonicalJobKey(entry.key) === key);
  const latest = landed[landed.length - 1];
  return Boolean(latest && latest.sha256 && approval.sha256 === latest.sha256);
}

// Nothing shows that 3Echo returns the saved job for a repeated idempotencyKey, so a second create on a key
// that was made, or is being made, could be billed again. A create that ended released with no outputs
// (failed or cancelled) made nothing, so its key can be tried again; a redo is a new version with its own price.
function earlierCreateState(job, key) {
  const records = readRecords(job);
  const creates = records.filter(record => record.type === 'create' && record.provider === THREE_ECHO && canonicalJobKey(record.key) === key);
  if (!creates.length) return null;
  const landedKey = readLanded(job).some(entry => entry.type === 'landed' && canonicalJobKey(entry.key) === key);
  let state = null;
  for (const create of creates) {
    const results = records.filter(record => record.type === 'result' && record.providerJobId === create.providerJobId);
    const result = results.length ? results[results.length - 1] : null;
    const status = String(result?.status || '').toLowerCase();
    const outputs = Array.isArray(result?.outputAssetIds) ? result.outputAssetIds : [];
    if (result && RELEASED_STATUS.has(status) && !outputs.length && !landedKey) continue;
    if (landedKey || outputs.length || status === 'succeeded') return 'made';
    state = 'making';
  }
  return state;
}

export function spendDecision(job, toolName, toolInput) {
  const base = toolBase(toolName);
  const input = asObject(toolInput);
  const deny = reason => ({ allow: false, reason });
  if (ELEVEN_LABS_MEDIA.includes(base)) return deny(SPEND_DENY.elevenLabsMedia);
  const provider = providerOf(base);
  if (!THREE_ECHO_SPENDERS.includes(base) && !VOICE_SPENDERS.includes(base)) return { allow: true, cost: 0 };
  const transcription = base === 'creative_transcribe_audio';
  if (transcription && isFinishedState(readJobState(job.dir).state)) return deny(SPEND_DENY.jobFinished);
  const price = transcription ? currentTranscriptionApproval(job) : currentPriceApproval(job);
  if (!price) return deny(SPEND_DENY.noApproval);
  const key = itemKeyFor(job);
  if (!key) return deny(SPEND_DENY.noItem);
  const item = quoteItem(price.quote, key);
  if (!item) return deny(SPEND_DENY.notInQuote);
  if (transcription !== isTranscriptionItem(item)) return deny(SPEND_DENY.mismatch);
  if (!transcription && referenceArtOnly(job)) {
    if (provider === ELEVEN_LABS) return deny(SPEND_DENY.voiceTooEarly);
    if (base !== 'create_image_job' || item.kind !== 'image' || !isReferenceItem(item)) return deny(SPEND_DENY.videoTooEarly);
  }
  if (THREE_ECHO_SPENDERS.includes(base) && !isReferenceItem(item)) {
    const slots = new Set((price.quote.items || []).filter(entry => entry && entry.provider === THREE_ECHO && !isReferenceItem(entry)).map(entry => `${entry.deliverable}/${entry.panel}`));
    if (slots.size > 1) {
      const sample = sampleKeyFor(job, price.quote);
      if (sample && key !== sample && !sampleApproved(job, sample)) return deny(SPEND_DENY.sampleLock);
    }
  }
  if (item.provider && item.provider !== provider) return deny(SPEND_DENY.mismatch);
  if (provider === THREE_ECHO && item.kind && item.kind !== (base === 'create_image_job' ? 'image' : 'video')) return deny(SPEND_DENY.mismatch);
  if (provider === THREE_ECHO) {
    const earlier = earlierCreateState(job, key);
    if (earlier) return { allow: false, reason: earlier === 'making' ? SPEND_DENY.stillMaking : SPEND_DENY.alreadyMade, key, provider, repeat: true };
  }
  let cost = null;
  if (base === 'create_image_job') cost = IMAGE_CREDITS_EACH;
  else if (base === 'create_video_job') {
    const estimate = latestEstimate(job, priceKey(base, input));
    if (!estimate) return deny(SPEND_DENY.videoNoEstimate);
    cost = finite(estimate.credits);
  } else {
    const generations = voiceGenerations(base, input);
    const allowed = finite(item.generationsCount) ?? 1;
    if (generations !== null && generations !== allowed) return deny(SPEND_DENY.oneAtATime);
    const estimate = latestEstimate(job, priceKey(base, input));
    if (estimate) cost = finite(estimate.credits);
    else if (VOICE_ESTIMABLE.includes(base)) return deny(SPEND_DENY.voiceNoEstimate);
    else cost = finite(item.credits);
    if (cost === null) return deny(SPEND_DENY.voiceNoEstimate);
  }
  const itemCredits = finite(item.credits);
  if (itemCredits !== null && cost > itemCredits + EPSILON) return deny(SPEND_DENY.itemOver);
  const committed = creditsCommitted(job, transcription ? TRANSCRIPTION_SCOPE : 'media')[provider] || 0;
  if (committed + cost > approvedTotal(price, provider) + EPSILON) return deny(SPEND_DENY.overBudget);
  return { allow: true, cost, key, provider };
}

export const QUOTE_KINDS = Object.freeze({ [THREE_ECHO]: Object.freeze(['image', 'video']), [ELEVEN_LABS]: Object.freeze(['voice', 'transcription']) });
export const LINKS_RECORD = 'links';
const roundCredits = value => Math.round(value * 1e6) / 1e6;
const APPROVAL_NAME = /^approval-(\d+)\.json$/;

export function quoteTotals(items) {
  const totals = { [THREE_ECHO]: 0, [ELEVEN_LABS]: 0 };
  for (const item of Array.isArray(items) ? items : []) {
    const credits = finite(item?.credits);
    if (credits !== null && PROVIDERS.includes(item.provider)) totals[item.provider] += credits;
  }
  return { [THREE_ECHO]: roundCredits(totals[THREE_ECHO]), [ELEVEN_LABS]: roundCredits(totals[ELEVEN_LABS]) };
}

export function sameTotals(a, b) {
  return PROVIDERS.every(provider => {
    const left = finite(a?.[provider]);
    const right = finite(b?.[provider]);
    return left !== null && right !== null && Math.abs(left - right) <= EPSILON;
  });
}

const creditText = value => String(roundCredits(value));

export function priceWords(totals) {
  const parts = [];
  const studio = finite(totals?.[THREE_ECHO]) || 0;
  const voice = finite(totals?.[ELEVEN_LABS]) || 0;
  if (studio > 0) parts.push(`${creditText(studio)} Studio credit${studio === 1 ? '' : 's'}`);
  if (voice > 0) parts.push(`${creditText(voice)} voice credit${voice === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' and ') : 'no credits';
}

export function itemLabel(value) {
  const parsed = typeof value === 'string' ? parseJobKey(value) : value;
  if (!parsed?.deliverable) return 'This item';
  return `${parsed.deliverable} ${parsed.item || parsed.panel}${Number(parsed.version) > 1 ? ` v${parsed.version}` : ''}`;
}

function estimateChoices(estimates, provider, key) {
  const mine = estimates.filter(entry => entry.provider === provider && entry.estimateId && finite(entry.credits) !== null);
  const matching = mine.filter(entry => canonicalJobKey(entry.key) === key);
  const list = (matching.length ? matching : mine).slice(-5);
  if (!list.length) return '';
  return ` Saved estimates: ${list.map(entry => `${entry.estimateId} (${creditText(finite(entry.credits))} credits${entry.key ? `, ${itemLabel(entry.key)}` : ''})`).join('; ')}.`;
}

function quoteItemFrom(job, raw, index, estimates) {
  const at = `Item ${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${at} is not a price item.`);
  const parsed = parseJobKey(raw.key);
  if (!parsed) throw new Error(`${at} needs a job key such as ${job.jobId}-D1-P1-v1.`);
  if (parsed.jobId !== job.jobId) throw new Error(`${at} belongs to another job.`);
  const label = itemLabel(parsed);
  if (raw.deliverable !== undefined && canonicalDeliverable(raw.deliverable) !== parsed.deliverable) throw new Error(`${label}: the deliverable does not match its key.`);
  if (raw.panel !== undefined && canonicalItem(raw.panel) !== parsed.item) throw new Error(`${label}: the panel does not match its key.`);
  if (!PROVIDERS.includes(raw.provider)) throw new Error(`${label}: the provider must be threeEcho or elevenLabs.`);
  if (!QUOTE_KINDS[raw.provider].includes(raw.kind)) {
    throw new Error(`${label}: ${raw.provider === THREE_ECHO ? '3Echo Studio makes the images and video clips' : 'ElevenLabs is used for voice and transcription only'}.`);
  }
  if ((raw.kind === 'transcription') !== isTranscriptionItem(parsed.key)) throw new Error(`${label}: a transcription is keyed TR, such as ${job.jobId}-D1-TR1-v1, and only a transcription is.`);
  if (isReferenceItem(parsed.key) && raw.kind !== 'image') throw new Error(`${label}: the prefix R is for reference pictures only, so a ${raw.kind === 'video' ? 'video clip' : 'voice line'} needs another key, such as S1.`);
  const credits = finite(raw.credits);
  if (credits === null || credits < 0) throw new Error(`${label}: the credits must be a number of zero or more.`);
  if (raw.sample !== undefined && raw.sample !== true && raw.sample !== false) throw new Error(`${label}: sample must be true or false.`);
  const item = { key: parsed.key, provider: raw.provider, kind: raw.kind, deliverable: parsed.deliverable, panel: parsed.item, version: parsed.version, credits };
  if (raw.sample === true && !isReferenceItem(item)) item.sample = true;
  if (raw.kind === 'image') {
    if (Math.abs(credits - IMAGE_CREDITS_EACH) > EPSILON) throw new Error(`${label}: a 3Echo image costs ${IMAGE_CREDITS_EACH} credit.`);
    return item;
  }
  const what = raw.kind === 'video' ? 'video clip' : raw.kind === 'transcription' ? 'transcription' : 'voice line';
  const how = raw.kind === 'video' ? 'Price it with estimate_video_job' : raw.kind === 'transcription' ? 'Price it with creative_transcribe_audio and estimate_only' : 'Price it with the voice tool and estimate_only';
  const estimateId = text(raw.estimateId);
  if (!estimateId) throw new Error(`${label}: this ${what} needs its captured estimate. ${how}, then pass the estimateId.${estimateChoices(estimates, raw.provider, parsed.key)}`);
  const estimate = estimates.find(entry => entry.estimateId === estimateId);
  if (!estimate || estimate.provider !== raw.provider) throw new Error(`${label}: no captured estimate matches this ${what}. ${how} again.${estimateChoices(estimates, raw.provider, parsed.key)}`);
  const estimated = finite(estimate.credits);
  if (estimated === null || Math.abs(estimated - credits) > EPSILON) throw new Error(`${label}: its estimate is ${estimated === null ? 'not priced' : `${creditText(estimated)} credits`}, not ${creditText(credits)}.`);
  item.estimateId = estimateId;
  if (raw.kind === 'voice') {
    const recorded = finite(estimate.details?.generationsCount);
    const given = raw.generationsCount === undefined || raw.generationsCount === null ? null : finite(raw.generationsCount);
    if (given !== null && (!Number.isInteger(given) || given < 1)) throw new Error(`${label}: the number of versions must be a whole number of one or more.`);
    if (given !== null && recorded !== null && given !== recorded) throw new Error(`${label}: its estimate was for ${recorded} versions, not ${given}.`);
    item.generationsCount = given ?? recorded ?? 1;
  }
  return item;
}

export function buildQuote(job, input, { drop = [] } = {}) {
  const list = Array.isArray(input) ? input : [];
  const dropList = Array.isArray(drop) ? drop : [];
  if (!list.length && !dropList.length) throw new InvalidInputError('List at least one item to price.');
  const estimates = readEstimates(job);
  const incoming = new Map();
  list.forEach((raw, index) => {
    const item = quoteItemFrom(job, raw, index, estimates);
    const seen = incoming.get(item.key);
    if (seen && stableStringify(seen) !== stableStringify(item)) throw new InvalidInputError(`${itemLabel(item)} is listed twice with different details. List it once.`);
    incoming.set(item.key, item);
  });
  // Made or still being made, the same as the spend guard sees it: a create whose 3Echo job failed or was cancelled made nothing.
  const made = new Set(readRecords(job).filter(record => record.type === 'create' && (record.provider !== THREE_ECHO || earlierCreateState(job, canonicalJobKey(record.key)))).map(record => canonicalJobKey(record.key)).filter(Boolean));
  const dropped = new Set();
  for (const raw of dropList) {
    const parsed = parseJobKey(raw);
    if (!parsed || parsed.jobId !== job.jobId) throw new InvalidInputError(`${String(raw)} is not an item of this job.`);
    if (made.has(parsed.key)) throw new InvalidInputError(`${itemLabel(parsed)} is already made, so it stays in the price.`);
    if (incoming.has(parsed.key)) throw new InvalidInputError(`${itemLabel(parsed)} cannot be added and dropped at once.`);
    dropped.add(parsed.key);
  }
  const byKey = new Map();
  for (const old of readQuote(job)?.quote?.items || []) {
    const key = canonicalJobKey(old?.key);
    if (!key || dropped.has(key)) continue;
    const next = incoming.get(key);
    const oldCredits = finite(old.credits);
    if (next && made.has(key) && (next.provider !== old.provider || next.kind !== old.kind || oldCredits === null || Math.abs(next.credits - oldCredits) > EPSILON)) {
      throw new InvalidInputError(`${itemLabel(key)} is already made, so its price cannot change. A redo needs its own version, such as v${(parseJobKey(key)?.version || 1) + 1}.`);
    }
    byKey.set(key, next || { ...old, key });
  }
  for (const [key, item] of incoming) byKey.set(key, item);
  const items = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  const sampled = new Set();
  for (const item of items) {
    if (item.sample !== true || isReferenceItem(item)) continue;
    if (sampled.has(item.deliverable)) throw new InvalidInputError(`${itemLabel(item.key)}: ${item.deliverable} already has a sample item. Only one item per deliverable can be the sample.`, { fix: 'Mark one item per post as the sample: the hero picture when the clips start from the storyboard pictures, otherwise the hero clip.' });
    sampled.add(item.deliverable);
  }
  return { quote: { items, totals: quoteTotals(items) }, made: items.filter(item => made.has(item.key)).length, dropped: dropped.size };
}

export function saveQuote(job, input, options = {}) {
  const { quote, made, dropped } = buildQuote(job, input, options);
  const bytes = JSON.stringify(quote, null, 2) + '\n';
  const file = factFile(job, 'quote');
  let previous = null;
  try {
    previous = readFileSync(file, 'utf8');
  } catch {
    previous = null;
  }
  const changed = previous !== bytes;
  if (changed) {
    mkdirSync(dirname(file), { recursive: true });
    const temp = join(dirname(file), `.quote-${process.pid}-${Date.now()}.tmp`);
    writeFileSync(temp, bytes, 'utf8');
    renameSync(temp, file);
  }
  return { quote, sha256: sha256(bytes), changed, made, dropped };
}

export function listPriceApprovals(job) {
  let names = [];
  try {
    names = readdirSync(join(job.dir, 'pricing'));
  } catch {
    return [];
  }
  return names
    .map(name => ({ name, hit: APPROVAL_NAME.exec(name) }))
    .filter(entry => entry.hit)
    .map(entry => ({ n: Number(entry.hit[1]), file: `pricing/${entry.name}`, approval: readJson(join(job.dir, 'pricing', entry.name)) }))
    .filter(entry => entry.approval && typeof entry.approval === 'object' && !Array.isArray(entry.approval))
    .sort((a, b) => a.n - b.n);
}

export function latestApprovedPrice(job) {
  const approved = listPriceApprovals(job).filter(entry => entry.approval.decision === 'approved' && entry.approval.scope !== TRANSCRIPTION_SCOPE);
  return approved.length ? approved[approved.length - 1] : null;
}

export function writePriceApproval(job, record) {
  const dir = join(job.dir, 'pricing');
  mkdirSync(dir, { recursive: true });
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    names = [];
  }
  const first = names.reduce((max, name) => Math.max(max, Number(APPROVAL_NAME.exec(name)?.[1] || 0)), 0) + 1;
  for (let n = first; n < first + 50; n++) {
    const approval = { n, ...record };
    try {
      writeFileSync(join(dir, `approval-${n}.json`), JSON.stringify(approval, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      return { n, file: `pricing/approval-${n}.json`, approval };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('The price decision could not be saved. Try again.');
}

export function generationCredits(job) {
  const spent = creditsCommitted(job);
  const latest = latestApprovedPrice(job);
  const approved = provider => (latest ? finite(latest.approval.totals?.[provider]) : null);
  return {
    threeEchoCredits: { spent: roundCredits(spent[THREE_ECHO]), approved: approved(THREE_ECHO) },
    elevenLabsCredits: { spent: roundCredits(spent[ELEVEN_LABS]), approved: approved(ELEVEN_LABS) },
  };
}

export function appendLinks(job, { provider, key, providerJobId, outputs, links } = {}) {
  const usable = (Array.isArray(links) ? links : []).filter(link => link && text(link.assetId) && isFetchableUrl(link.url))
    .map(link => ({ assetId: link.assetId, url: link.url, mimeType: link.mimeType ?? null, filename: link.filename ?? null, expiresAt: link.expiresAt ?? null }));
  if (!usable.length) return null;
  return appendRecord(job, { type: LINKS_RECORD, provider: provider || THREE_ECHO, key: key ?? null, providerJobId: providerJobId ?? null, outputs: Array.isArray(outputs) ? outputs : [], links: usable });
}

const existsIn = (job, file) => Boolean(file) && existsSync(join(job.dir, ...String(file).split('/')));

export function landingReport(job, { now = Date.now() } = {}) {
  const items = (readQuote(job)?.quote?.items || []).filter(item => item && canonicalJobKey(item.key) && !isTranscriptionItem(item));
  const records = readRecords(job);
  const landed = readLanded(job);
  const saved = landed.filter(entry => entry.type === 'landed' && existsIn(job, entry.file));
  const savedAssets = new Set(saved.map(entry => entry.assetId).filter(Boolean));
  const report = items.map(item => {
    const key = canonicalJobKey(item.key);
    const base = { key, item: itemLabel(key), kind: item.kind || null, provider: item.provider || null };
    const files = saved.filter(entry => canonicalJobKey(entry.key) === key).map(entry => entry.file);
    if (files.length) return { ...base, status: 'landed', files };
    const creates = records.filter(record => record.type === 'create' && canonicalJobKey(record.key) === key);
    if (!creates.length) return { ...base, status: 'pending', reason: 'not_started' };
    const create = creates[creates.length - 1];
    const results = records.filter(record => record.type === 'result' && record.providerJobId === create.providerJobId);
    const result = results.length ? results[results.length - 1] : null;
    const outputs = Array.isArray(result?.outputAssetIds) ? result.outputAssetIds : [];
    const status = String(result?.status || '').toLowerCase();
    const at = { ...base, providerJobId: create.providerJobId || null };
    if (result && RELEASED_STATUS.has(status) && !outputs.length) return { ...at, status: 'failed', reason: 'not_made' };
    const failures = landed.filter(entry => entry.type === 'failed' && (canonicalJobKey(entry.key) === key || outputs.includes(entry.assetId)) && !savedAssets.has(entry.assetId));
    const failure = failures.length ? failures[failures.length - 1] : null;
    if (failure) return { ...at, status: failure.reason === 'expired' ? 'expired' : 'failed', reason: 'download', assetIds: [failure.assetId].filter(Boolean), note: failure.note || null };
    if (outputs.length) return { ...at, status: 'pending', reason: 'waiting_to_save', assetIds: outputs.filter(id => !savedAssets.has(id)) };
    return { ...at, status: 'pending', reason: 'making' };
  });
  const retry = [];
  const refusedSince = (assetId, since) => landed.some(entry => entry.type === 'failed' && entry.reason === 'expired' && entry.assetId === assetId && String(entry.at || '') >= String(since || ''));
  for (const record of records) {
    if (record.type !== LINKS_RECORD || !Array.isArray(record.links)) continue;
    const links = record.links.filter(link => link && link.assetId && !savedAssets.has(link.assetId) && isFetchableUrl(link.url) &&
      !(Number.isFinite(Date.parse(link.expiresAt || '')) && Date.parse(link.expiresAt) <= now) && !refusedSince(link.assetId, record.at));
    if (!links.length) continue;
    const known = retry.find(entry => entry.providerJobId === record.providerJobId && entry.provider === record.provider);
    if (known) {
      for (const link of links) if (!known.links.some(existing => existing.assetId === link.assetId)) known.links.push(link);
      continue;
    }
    retry.push({ provider: record.provider || THREE_ECHO, key: record.key ?? null, providerJobId: record.providerJobId ?? null, outputs: Array.isArray(record.outputs) ? record.outputs : [], links: [...links] });
  }
  const promotion = unpromotedSlots(landed);
  return {
    items: report,
    retry,
    unpromoted: promotion,
    promotionNote: promotion.length ? `Saved, but not yet copied into the media folder: ${promotion.join(', ')} (the file may be open in another app).` : null,
  };
}

function unpromotedSlots(landed) {
  const state = new Map();
  const slots = new Map();
  for (const entry of landed) {
    if (!entry.assetId) continue;
    if (entry.type === 'landed' && entry.file) {
      state.set(entry.assetId, entry.promoted || !entry.promoteError ? 'ok' : 'failed');
      if (entry.deliverable && entry.panel) {
        const id = `${entry.deliverable}/${entry.panel}`;
        const held = slots.get(id);
        if (!held || (Number(entry.version) || 0) >= held.version) slots.set(id, { version: Number(entry.version) || 0, assetId: entry.assetId, label: itemLabel({ deliverable: entry.deliverable, item: entry.panel }) });
      }
    } else if (entry.type === 'promoted') {
      state.set(entry.assetId, 'ok');
    } else if (entry.type === 'promote_failed') {
      state.set(entry.assetId, 'failed');
    }
  }
  return [...slots.values()].filter(slot => state.get(slot.assetId) === 'failed').map(slot => slot.label);
}

export function nearestGates(from) {
  const states = lib('lib-states.js');
  if (!states.exists(from)) return [];
  const approved = new Set(Object.values(states.APPROVED_STATE || {}));
  const passable = id => !states.isGate(id) && !approved.has(id) && !CHAIN_AVOID.has(id) && !states.isRetired(id);
  const seen = new Set([from]);
  let level = [from];
  while (level.length) {
    const found = new Set();
    const next = [];
    for (const at of level) {
      for (const id of states.get(at).next || []) {
        if (seen.has(id) || !states.canMove(at, id)) continue;
        seen.add(id);
        if (states.isGate(id)) found.add(states.gateOf(id));
        else if (passable(id)) next.push(id);
      }
    }
    if (found.size) return [...found];
    level = next;
  }
  return [];
}
