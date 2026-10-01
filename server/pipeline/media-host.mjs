/**
 * Local media to the person's own 3echo Studio workspace, without the bytes passing through the model.
 *
 * The model asks 3echo for a signed upload session (create_asset_upload_session), the plugin PUTs the
 * file straight to the signed storage URL (uploadHosted), and the model then tells 3echo the upload is
 * done (complete_asset_upload) and passes the app link back (linkHosted). This module is those plugin steps.
 *
 * It is the one place where a model-supplied URL and a model-supplied path meet a network write, and the
 * storage bucket is shared by every 3echo customer, so every check runs before the first byte is sent:
 *  - the workspace id must be the 3echo workspace the person approved in the post plan (studioWorkspace.id),
 *    never the current choice file, which the model can change: otherwise the file could be sent to someone
 *    else's workspace with their signed URL;
 *  - the URL is pinned to the 3echo bucket for that workspace and this asset, and only one header is sent:
 *    Content-Type, equal to the type found in the file's own bytes;
 *  - the file is an image or video of at most 100 MB, inside this job's media/ or handoff/ folder, opened
 *    once and re-verified so a swapped link cannot redirect the read;
 *  - the job has a post plan and the file is named in it.
 * A refusal is a plain sentence. Tests inject the allowed origin through `options`; the tools never pass it.
 *
 * The post plan this module trusts is publish/intent.json, and only while the person's approval covers it:
 * the job's latest publish-gate approval (approvals/publish-<round>.json, read the way check-approval.js reads
 * it) must be "approved" and list publish/intent.json with the sha256 the file has now. The model can
 * write the file, but not the approval, so a forged or edited plan is refused. The posting kit for "I'll post it
 * myself" is a projection of the same approved intent and is not a trust source.
 *
 * What the intent must hold (M2 writes it; write exactly this much):
 *   { "studioWorkspace": { "id": "<3echo workspace id>", "name": "<name>" },
 *     "posts": [ { "media": [ { "path": "media/D1/final.mp4", "sha256": "<64 hex>" } ] } ] }
 * `studioWorkspace` is what the person approved and is required. `path` is relative to the job folder.
 * Every media entry needs its `sha256`, and the file on disk must still match it.
 */

import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import { sniffMagic } from '../media/mime.mjs';
import { ELEVEN_LABS, jobFromDir, readLanded, readRecords } from './facts.mjs';

export const HOSTED_MEDIA_FILE = 'publish/hosted-media.json';
export const PUBLISH_INTENT_FILE = 'publish/intent.json';
export const PUBLISH_GATE = 'publish';
/** 3echo's documented per-file limit. */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export const UPLOAD_ORIGIN = 'https://storage.googleapis.com';
export const UPLOAD_BUCKET_PATH = '/agentc_platform_production_bucket/3echo';
export const APP_ORIGIN = 'https://agentc.3echo.ai';

const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const UPLOAD_IDLE_MS = 90 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const FILE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

class Refusal extends Error {
  constructor(code, reason) {
    super(reason);
    this.code = code;
  }
}

const refuse = (code, reason) => new Refusal(code, reason);
const text = value => (typeof value === 'string' ? value.trim() : '');
const sameKey = value => (process.platform === 'win32' ? value.toLowerCase() : value);

function inside(parent, child) {
  const rel = relative(sameKey(parent), sameKey(child));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** `given` must be a plain id equal to the workspace the approved plan names. */
function pinWorkspace(planWorkspaceId, given) {
  const id = text(given);
  if (!TOKEN.test(id)) throw refuse('bad_workspace', 'The workspace id is not valid.');
  if (id !== planWorkspaceId) throw refuse('wrong_workspace', 'That is not the 3echo workspace in the approved post plan, so nothing was sent.');
  return planWorkspaceId;
}

function pinAsset(given) {
  const id = text(given);
  if (!TOKEN.test(id)) throw refuse('bad_asset', 'The asset id is not valid.');
  return id;
}

/** The upload URL, checked against the raw text before any parser can normalise a trick away. */
export function checkUploadUrl(rawUrl, { workspaceId, assetId }, { allowedOrigin = UPLOAD_ORIGIN, bucketPath = UPLOAD_BUCKET_PATH } = {}) {
  const raw = typeof rawUrl === 'string' ? rawUrl : '';
  if (!raw || CONTROL.test(raw) || /\s/.test(raw) || raw.includes('\\')) throw refuse('bad_url', 'The upload address is not a plain web address.');
  if (!TOKEN.test(workspaceId)) throw refuse('bad_workspace', 'The workspace id is not valid.');
  if (!TOKEN.test(assetId)) throw refuse('bad_asset', 'The asset id is not valid.');
  const origin = new URL(allowedOrigin);
  if (!raw.startsWith('https://') && origin.protocol === 'https:') throw refuse('not_https', 'The upload address must be a secure (https) address.');
  const base = `${origin.protocol}//${origin.host}`;
  if (!raw.startsWith(`${base}/`)) throw refuse('wrong_host', 'The upload address is not 3echo\'s storage, so nothing was sent.');
  if (raw.includes('#')) throw refuse('bad_url', 'The upload address is not a plain web address.');
  const rest = raw.slice(base.length);
  const query = rest.indexOf('?');
  const path = query === -1 ? rest : rest.slice(0, query);
  if (path.includes('%')) throw refuse('encoded_path', 'The upload address hides part of its path, so nothing was sent.');
  const prefix = `${bucketPath}/workspaces/${workspaceId}/assets/${assetId}/`;
  if (!path.startsWith(prefix)) throw refuse('wrong_path', 'The upload address does not belong to this workspace and asset, so nothing was sent.');
  const file = path.slice(prefix.length);
  if (!FILE_SEGMENT.test(file) || file.includes('..')) throw refuse('wrong_path', 'The upload address does not point at a single file in this asset, so nothing was sent.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw refuse('bad_url', 'The upload address is not a plain web address.');
  }
  if (url.origin !== origin.origin || url.username || url.password || url.pathname !== path) throw refuse('wrong_host', 'The upload address is not 3echo\'s storage, so nothing was sent.');
  return url;
}

/** Exactly one header, Content-Type, equal to the type found in the file's own bytes. */
export function checkUploadHeaders(headers, { mime }) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw refuse('bad_headers', 'The upload headers are missing.');
  const names = Object.keys(headers);
  if (names.length !== 1 || names[0].toLowerCase() !== 'content-type') {
    throw refuse('bad_headers', 'The upload must send exactly one header, Content-Type, so nothing was sent.');
  }
  const value = headers[names[0]];
  if (typeof value !== 'string' || CONTROL.test(value) || value.trim().toLowerCase() !== mime) {
    throw refuse('bad_headers', 'The upload Content-Type does not match the file, so nothing was sent.');
  }
  return { [names[0]]: value.trim() };
}

/** The app link 3echo returns for an asset, byte for byte. */
export function checkAppUrl(value, { workspaceId, assetId }) {
  const expected = `${APP_ORIGIN}/assets/${assetId}?workspaceId=${workspaceId}`;
  if (typeof value !== 'string' || value !== expected) {
    throw refuse('bad_app_url', `The app link must be exactly the 3echo link for this asset: ${expected}`);
  }
  return expected;
}

function head(fd) {
  const buffer = Buffer.alloc(16);
  const read = readSync(fd, buffer, 0, 16, 0);
  return buffer.subarray(0, read);
}

function sha256Of(fd, size) {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let position = 0;
  while (position < size) {
    const read = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
    if (!read) break;
    hash.update(buffer.subarray(0, read));
    position += read;
  }
  return hash.digest('hex');
}

const SHA256 = /^[0-9a-f]{64}$/i;

function namedMedia(document) {
  const entries = [];
  for (const post of Array.isArray(document?.posts) ? document.posts : []) entries.push(...(Array.isArray(post?.media) ? post.media : []));
  return entries;
}

/** The latest record of a gate by round, `{ record, file }`, or null. Unreadable or roundless records read as none. */
function latestRecord(jobDir, gate) {
  const dir = join(jobDir, 'approvals');
  let names = [];
  try {
    names = readdirSync(dir).filter(name => name.startsWith(`${gate}-`) && name.endsWith('.json'));
  } catch {
    return null;
  }
  const records = [];
  for (const name of names) {
    const file = join(dir, name);
    const record = readJsonFile(file, null);
    const round = Number(record?.round ?? name.slice(gate.length + 1, -5));
    if (!record || typeof record !== 'object' || !Number.isFinite(round)) return null;
    records.push({ record, round, file });
  }
  records.sort((a, b) => a.round - b.round);
  return records.length ? records[records.length - 1] : null;
}

/** The latest publish-gate approval record, by round, or null. Unreadable records read as no approval. */
export function latestPublishApproval(jobDir) {
  return latestRecord(jobDir, PUBLISH_GATE)?.record ?? null;
}

/** When a decision was recorded: its own time ("2026-10-01 20:00 +08:00", to the minute), else the file's. */
function decidedMs(entry) {
  const said = Date.parse(String(entry.record.decidedAt || '').replace(' ', 'T').replace(/ ([+-]\d\d:\d\d)$/, '$1'));
  return Number.isFinite(said) ? said : null;
}

function mtimeMs(entry) {
  try { return statSync(entry.file).mtimeMs; } catch { return 0; }
}

/**
 * The job's post plan while the person's latest publish approval still covers it: `{ ok: true, document, sha256 }`, or
 * `{ ok: false, code, reason }` in plain words (no_plan, intent_unreadable, not_approved, plan_changed). The Metricool
 * send guard (publish-guard.mjs) uses this same check, so a plan is trusted the same way for uploads and for posts.
 */
export function readApprovedIntent(jobDir) {
  try {
    return { ok: true, ...approvedIntent(jobDir) };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, code: error.code, reason: error.message };
    throw error;
  }
}

function approvedIntent(jobDir) {
  const planFile = join(jobDir, ...PUBLISH_INTENT_FILE.split('/'));
  if (!existsSync(planFile)) throw refuse('no_plan', 'Prepare the post plan first.');
  let bytes;
  try {
    bytes = readFileSync(planFile);
  } catch {
    throw refuse('intent_unreadable', "The job's post plan could not be read, so nothing was sent.");
  }
  const approval = latestPublishApproval(jobDir);
  const covered = approval?.decision === 'approved' && Array.isArray(approval.artifacts)
    ? approval.artifacts.find(item => item?.path === PUBLISH_INTENT_FILE)
    : null;
  if (!covered) throw refuse('not_approved', 'Approve the post plan first.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (typeof covered.sha256 !== 'string' || covered.sha256.toLowerCase() !== sha256) {
    throw refuse('plan_changed', 'The post plan changed after you approved it.');
  }
  // The final post approved again after this approval replaces it: the old plan is never uploaded or sent.
  if (!hasPublishApproval(jobDir)) throw refuse('not_approved', 'The final post was approved again after you approved this plan, so approve the post plan again first.');
  let document = null;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    document = null;
  }
  if (!document || typeof document !== 'object') throw refuse('intent_unreadable', "The job's post plan could not be read, so nothing was sent.");
  return { document, sha256 };
}

/**
 * Whether a publish approval is in force for this job: the person's latest publish-gate decision is an approval, and
 * the final post has not been approved again since (reworking the final post and approving it again is how a job
 * with an approved plan gets a new one). When two decisions are in the same minute, the files' times decide, and a
 * tie leaves the approval in force.
 */
export function hasPublishApproval(jobDir) {
  const publish = latestRecord(jobDir, PUBLISH_GATE);
  if (publish?.record.decision !== 'approved') return false;
  const content = latestRecord(jobDir, 'content');
  if (!content) return true;
  const [then, now] = [decidedMs(publish), decidedMs(content)];
  if (then !== null && now !== null && then !== now) return then > now;
  return mtimeMs(publish) >= mtimeMs(content);
}

/**
 * The file must be named, with its sha256, in the approved publish intent. Returns the 3echo workspace id the
 * approved plan names.
 */
function checkNamed(jobDir, realFile, sha256) {
  const { document } = approvedIntent(jobDir);
  const entries = namedMedia(document);
  if (entries.some(entry => !entry || typeof entry.path !== 'string' || !SHA256.test(entry.sha256 || ''))) {
    throw refuse('no_media_hash', "The post plan does not record a fingerprint for every file, so nothing was sent.");
  }
  let named = false;
  for (const entry of entries) {
    let real;
    try {
      real = realpathSync(resolve(jobDir, entry.path));
    } catch {
      continue;
    }
    if (sameKey(real) !== sameKey(realFile)) continue;
    if (entry.sha256.toLowerCase() !== sha256) throw refuse('changed_since_plan', 'This file changed after the post plan was made, so nothing was sent.');
    named = true;
  }
  if (!named) throw refuse('not_in_plan', "This file is not part of the job's post plan, so nothing was sent.");
  const id = text(document.studioWorkspace?.id);
  if (!TOKEN.test(id)) throw refuse('no_plan_workspace', 'The approved post plan does not name a 3echo workspace.');
  return id;
}

/** Everything about the file, checked. The caller must close `fd` unless a stream took it over. */
function openGuarded(jobDir, rawPath, { maxBytes, hooks = {} }) {
  const given = text(rawPath);
  if (!given || given.includes('\0')) throw refuse('bad_path', 'Say which file in the job to upload.');
  let realJob;
  try {
    realJob = realpathSync(resolve(jobDir));
  } catch {
    throw refuse('bad_job', 'This job\'s folder could not be found.');
  }
  const target = resolve(realJob, given);
  let realFile;
  try {
    realFile = realpathSync(target);
  } catch {
    throw refuse('missing_file', 'That file does not exist in this job.');
  }
  if (!inside(join(realJob, 'media'), realFile) && !inside(join(realJob, 'handoff'), realFile)) {
    throw refuse('outside_job', 'Only files in this job\'s media or handoff folder can be uploaded.');
  }
  let fd;
  try {
    fd = openSync(realFile, 'r');
  } catch {
    throw refuse('missing_file', 'That file could not be opened.');
  }
  try {
    // The path may have been swapped for a link between the check and the open: it must still be the same file.
    let again = null;
    let onDisk = null;
    try {
      again = (hooks.realpathAgain ?? realpathSync)(target);
      onDisk = (hooks.stat ?? statSync)(realFile, { bigint: true });
    } catch {
      again = null;
    }
    const opened = fstatSync(fd, { bigint: true });
    if (again === null || sameKey(again) !== sameKey(realFile) || onDisk.dev !== opened.dev || onDisk.ino !== opened.ino) {
      throw refuse('file_changed', 'That file changed while it was being checked, so nothing was sent.');
    }
    if (!opened.isFile()) throw refuse('not_a_file', 'That is not a file.');
    const size = Number(opened.size);
    if (size === 0) throw refuse('empty_file', 'That file is empty.');
    if (size > maxBytes) throw refuse('too_big', `That file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
    const magic = sniffMagic(head(fd));
    if (!magic || (magic.kind !== 'image' && magic.kind !== 'video')) throw refuse('not_media', 'Only images and videos can be uploaded.');
    const sha256 = sha256Of(fd, size);
    const planWorkspaceId = checkNamed(realJob, realFile, sha256);
    return { fd, size, kind: magic.kind, mime: magic.mime, sha256, realFile, planWorkspaceId };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function hostedFile(jobDir) {
  return join(jobDir, ...HOSTED_MEDIA_FILE.split('/'));
}

/** The record of uploads. Missing is empty; present but unreadable fails closed rather than being overwritten. */
function readHosted(jobDir) {
  const file = hostedFile(jobDir);
  if (!existsSync(file)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw refuse('hosted_unreadable', 'The record of uploaded media could not be read, so nothing was changed. Ask for help before uploading again.');
  }
  return parsed;
}

function record(jobDir, sha256, entry) {
  readHosted(jobDir);
  updateJsonFile(hostedFile(jobDir), current => ({ ...current, [sha256]: entry }), {});
}

/** The workspace a generation was started in, from its create record, or null for records that predate it. */
function generationWorkspace(job, providerJobId) {
  if (!providerJobId) return null;
  const created = readRecords(job).find(entry => entry.type === 'create' && entry.providerJobId === providerJobId);
  return text(created?.workspaceId) || text(created?.inputs?.workspaceId) || null;
}

/**
 * An earlier upload in the plan's workspace, or a generated file landed from a 3echo job in that workspace.
 * A generation whose create record has no workspace (older jobs) is returned with workspaceId null: the
 * caller must confirm it with get_asset in the plan's workspace before reusing it.
 */
export function hostedAssetBySha(jobDir, sha256, planWorkspaceId) {
  const hosted = readHosted(jobDir)[sha256];
  if (hosted?.assetId && hosted.workspaceId === planWorkspaceId) return { assetId: hosted.assetId, workspaceId: planWorkspaceId, appUrl: hosted.appUrl ?? null, source: 'hosted' };
  const job = jobFromDir(jobDir);
  if (!job) return null;
  const landed = readLanded(job);
  const promoted = new Map();
  for (const entry of landed) if (entry.type === 'promoted' && entry.assetId && !entry.converted) promoted.set(entry.assetId, [...(promoted.get(entry.assetId) || []), entry.promotedSha256]);
  for (const entry of landed) {
    if (entry.type !== 'landed' || !entry.assetId || entry.provider === ELEVEN_LABS) continue;
    const shas = [entry.sha256, ...(entry.converted ? [] : [entry.promotedSha256]), ...(promoted.get(entry.assetId) || [])].filter(Boolean);
    if (!shas.includes(sha256)) continue;
    const made = generationWorkspace(job, entry.providerJobId);
    if (made && made !== planWorkspaceId) continue;
    return { assetId: entry.assetId, workspaceId: made, appUrl: null, source: 'generated' };
  }
  return null;
}

/** Wraps a step so a refusal becomes `{ ok: false, code, reason }` and anything else still throws. */
async function guarded(step) {
  try {
    return await step();
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, code: error.code, reason: error.message };
    throw error;
  }
}

/**
 * Is this file's content already in the 3echo workspace named by the approved post plan, from an earlier
 * upload recorded in publish/hosted-media.json or a generated file landed from a 3echo job (matched by
 * sha256, so an edited file is not mistaken for the original; a converted copy is not the asset's bytes
 * either)? When it is not, the answer carries what create_asset_upload_session needs: the plan's
 * workspaceId, mime, bytes and filename. Sends nothing.
 */
export function lookupHosted({ jobDir, path }, options = {}) {
  return guarded(async () => {
    // The 3echo size limit is for uploading only: a file already hosted is found whatever its size.
    const file = openGuarded(jobDir, path, { maxBytes: options.maxBytes ?? Infinity, hooks: options.hooks });
    closeSync(file.fd);
    const found = hostedAssetBySha(jobDir, file.sha256, file.planWorkspaceId);
    const details = { mime: file.mime, bytes: file.size, filename: basename(file.realFile) };
    if (found) return { ok: true, hosted: true, sha256: file.sha256, planWorkspaceId: file.planWorkspaceId, ...details, ...found };
    return { ok: true, hosted: false, sha256: file.sha256, workspaceId: file.planWorkspaceId, ...details };
  });
}

/** The same lookup for callers inside the plugin: the asset, or null (including when the file is refused). */
export async function hostedAssetFor(jobDir, filePath, options = {}) {
  const result = await lookupHosted({ jobDir, path: filePath }, options);
  return result.ok && result.hosted ? { assetId: result.assetId, workspaceId: result.workspaceId, appUrl: result.appUrl, source: result.source } : null;
}

/** Streams the open file to the URL. The read stream takes over `fd` and closes it when it ends or is destroyed. */
function put(url, headers, { fd, size, timeoutMs, idleMs }) {
  return new Promise((done, fail) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const hash = createHash('sha256');
    const body = createReadStream(null, { fd, start: 0, end: size - 1 });
    let settled = false;
    let req = null;
    let overall = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      body.destroy();
      if (error) {
        req?.destroy();
        fail(error);
      } else {
        done(value);
      }
    };
    body.on('data', chunk => hash.update(chunk));
    body.on('error', error => finish(error));
    try {
      req = send(url, { method: 'PUT', headers: { ...headers, 'Content-Length': String(size) }, agent: false });
    } catch (error) {
      finish(error);
      return;
    }
    req.setTimeout(idleMs, () => finish(new Error('The upload stalled.')));
    overall = setTimeout(() => finish(new Error('The upload took too long.')), timeoutMs);
    req.on('error', error => finish(error));
    req.on('response', response => {
      const chunks = [];
      response.on('data', chunk => chunks.length < 8 && chunks.push(chunk));
      response.on('error', error => finish(error));
      response.on('end', () => finish(null, { status: response.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 2000), sha256: hash.digest('hex') }));
    });
    body.pipe(req);
  });
}

function failureReason(result) {
  const status = result.status;
  const code = (result.body.match(/<Code>([A-Za-z]+)<\/Code>/) || [])[1];
  if (status === 403 || status === 400 || status === 401) {
    return `3echo's storage turned the upload down${code ? ` (${code})` : ''}. The upload link may have expired after 15 minutes: ask 3echo for a new upload session and try once more.`;
  }
  if (status >= 300 && status < 400) return '3echo\'s storage tried to send the upload somewhere else, so it was stopped.';
  return `3echo's storage could not take the file${status ? ` (status ${status})` : ''}. Ask 3echo for a new upload session and try again.`;
}

/** The streamed upload. `options` is for tests and is never reachable from the tool. */
export function uploadHosted({ jobDir, path, uploadUrl, headers, assetId, workspaceId }, options = {}) {
  return guarded(async () => {
    const asset = pinAsset(assetId);
    const file = openGuarded(jobDir, path, { maxBytes: options.maxBytes ?? MAX_MEDIA_BYTES, hooks: options.hooks });
    let owned = false;
    try {
      const chosen = pinWorkspace(file.planWorkspaceId, workspaceId);
      const earlier = readHosted(jobDir)[file.sha256];
      if (earlier?.assetId && earlier.workspaceId === chosen && earlier.assetId !== asset) {
        return { ok: true, reused: true, assetId: earlier.assetId, workspaceId: chosen, appUrl: earlier.appUrl ?? null, bytes: file.size, sha256: file.sha256 };
      }
      const url = checkUploadUrl(uploadUrl, { workspaceId: chosen, assetId: asset }, options);
      const sent = checkUploadHeaders(headers, { mime: file.mime });
      let result;
      owned = true;
      try {
        result = await put(url, sent, { fd: file.fd, size: file.size, timeoutMs: options.timeoutMs ?? UPLOAD_TIMEOUT_MS, idleMs: options.idleMs ?? UPLOAD_IDLE_MS });
      } catch (error) {
        return { ok: false, code: 'upload_failed', reason: `The upload did not finish (${String(error?.message || error).slice(0, 120)}). Ask 3echo for a new upload session and try again.` };
      }
      if (result.status < 200 || result.status >= 300) return { ok: false, code: 'upload_rejected', status: result.status, reason: failureReason(result) };
      if (result.sha256 !== file.sha256) return { ok: false, code: 'changed_while_uploading', reason: 'The file changed while it was being uploaded, so it was not recorded. Try again once it is finished.' };
      record(jobDir, file.sha256, { assetId: asset, workspaceId: chosen, appUrl: null, uploadedAt: new Date().toISOString() });
      return { ok: true, assetId: asset, workspaceId: chosen, bytes: file.size, sha256: file.sha256 };
    } finally {
      if (!owned) closeSync(file.fd);
    }
  });
}

/** After complete_asset_upload: attach the asset's app link to the file recorded by the upload. */
export function linkHosted({ jobDir, path, workspaceId, assetId, appUrl }, options = {}) {
  return guarded(async () => {
    const asset = pinAsset(assetId);
    const file = openGuarded(jobDir, path, { maxBytes: options.maxBytes ?? Infinity, hooks: options.hooks });
    closeSync(file.fd);
    const chosen = pinWorkspace(file.planWorkspaceId, workspaceId);
    const entry = readHosted(jobDir)[file.sha256];
    if (!entry || entry.assetId !== asset || entry.workspaceId !== chosen) throw refuse('not_uploaded', 'This file was not uploaded as that asset, so the app link was not saved.');
    const link = checkAppUrl(appUrl, { workspaceId: chosen, assetId: asset });
    record(jobDir, file.sha256, { ...entry, appUrl: link });
    return { ok: true, assetId: asset, workspaceId: chosen, appUrl: link, sha256: file.sha256 };
  });
}
