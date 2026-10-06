import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FetchFailure, GENERATED_MEDIA_MAX_BYTES, boundedFetch } from '../social/backends/web.mjs';
import { ELEVEN_LABS, appendLanded, finishMediaIfLanded, isFetchableUrl, isLanded, jobAt, parseJobKey, readLanded, readRecords, THREE_ECHO } from './facts.mjs';

const SELF = fileURLToPath(import.meta.url);
const MIME_EXTENSIONS = Object.freeze({
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/flac': 'flac', 'audio/webm': 'weba',
});
const EXPIRED_STATUSES = new Set([400, 401, 403, 404, 410]);
const CLAIM_STALE_MS = 10 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const FINISH_RETRY_BUDGET_MS = 40 * 1000;
const FINISH_RETRY_BACKOFF_MS = 500;
const FINISH_RETRY_BACKOFF_CAP_MS = 3000;

export const LANDING_NOTES = Object.freeze({
  [THREE_ECHO]: {
    expired: 'The download link expired before the file was saved. Fetch a fresh link with get_asset and it is saved automatically.',
    failed: 'The file could not be downloaded. Fetch a fresh link with get_asset and it is saved automatically.',
  },
  [ELEVEN_LABS]: {
    expired: 'The voice file link expired before the file was saved. Check the run again for a fresh link and it is saved automatically.',
    failed: 'The voice file could not be downloaded. Check the run again for a fresh link and it is saved automatically.',
  },
});

const safePart = value => String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'output';
const pause = ms => new Promise(done => setTimeout(done, ms));

export function spawnLander(task) {
  const payload = Buffer.from(JSON.stringify(task), 'utf8').toString('base64url');
  const child = spawn(process.execPath, [SELF, '--task', payload], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
  return child.pid ?? null;
}

export function extensionFor(mimeType, filename) {
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXTENSIONS[mime]) return MIME_EXTENSIONS[mime];
  const fromName = extname(String(filename || '')).slice(1).toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return 'bin';
}

export function landingPath(key, assetId, outputs, extension) {
  const parsed = parseJobKey(key);
  if (!parsed) return `drafts/outputs/${safePart(assetId)}.${extension}`;
  const list = Array.isArray(outputs) ? outputs : [];
  const index = list.indexOf(assetId);
  const suffix = list.length > 1 ? (index > 0 ? `-${index + 1}` : index < 0 ? `-${safePart(assetId)}` : '') : '';
  return `drafts/${parsed.deliverable}/${parsed.item}-v${parsed.version}${suffix}.${extension}`;
}

export function promotedPath(key, extension) {
  const parsed = parseJobKey(key);
  return parsed ? `media/${parsed.deliverable}/${parsed.item}.${extension}` : null;
}

function isHighestVersion(job, parsed) {
  return !readLanded(job).some(entry => entry.type === 'landed' && entry.file && entry.deliverable === parsed.deliverable &&
    entry.panel === parsed.item && Number(entry.version) > parsed.version);
}

function slotFiles(dir, item) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter(name => name.startsWith(`${item}.`) && /^[A-Za-z0-9]+$/.test(name.slice(item.length + 1)) && isFile(join(dir, name)));
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

const fileHash = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function manifestFileFor(job, parsed) {
  try {
    const manifest = JSON.parse(readFileSync(join(job.dir, 'drafts', parsed.deliverable, 'generation-manifest.json'), 'utf8'));
    const hit = (Array.isArray(manifest?.items) ? manifest.items : []).find(entry => typeof entry?.file === 'string' && basename(entry.file, extname(entry.file)) === parsed.item);
    return hit ? hit.file : null;
  } catch {
    return null;
  }
}

const IMAGE_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const sameFormat = (a, b) => a === b || (['jpg', 'jpeg'].includes(a) && ['jpg', 'jpeg'].includes(b));
const hasFfmpeg = () => spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true }).status === 0;

function convertToTemp(job, dir, item, source, targetExt) {
  const temp = join(dir, `${item}.${randomUUID()}.part.${targetExt}`);
  const done = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(job.dir, ...source.split('/')), '-frames:v', '1', temp], { stdio: 'ignore', windowsHide: true });
  if (done.status === 0 && existsSync(temp)) return temp;
  rmSync(temp, { force: true });
  return null;
}

function promoteFile(job, parsed, key, source) {
  const extension = extname(source).slice(1).toLowerCase();
  const manifestFile = manifestFileFor(job, parsed);
  const wanted = manifestFile ? extname(manifestFile).slice(1).toLowerCase() : null;
  const dir = join(job.dir, 'media', parsed.deliverable);
  mkdirSync(dir, { recursive: true });
  let targetExt = extension;
  let temp = null;
  let converted = false;
  try {
    if (wanted && wanted !== extension) {
      if (sameFormat(wanted, extension)) {
        targetExt = wanted;
      } else if (IMAGE_FORMATS.has(wanted) && IMAGE_FORMATS.has(extension) && hasFfmpeg()) {
        temp = convertToTemp(job, dir, parsed.item, source, wanted);
        if (temp) {
          targetExt = wanted;
          converted = true;
        }
      }
    }
    const promoted = promotedPath(key, targetExt);
    const target = join(job.dir, ...promoted.split('/'));
    if (!temp) {
      temp = `${target}.${randomUUID()}.part`;
      copyFileSync(join(job.dir, ...source.split('/')), temp);
    }
    const promotedSha256 = fileHash(temp);
    const promotedBytes = statSync(temp).size;
    const moved = [];
    for (const name of slotFiles(dir, parsed.item)) {
      const own = name.slice(parsed.item.length + 1);
      if (own === targetExt && fileHash(join(dir, name)) === promotedSha256) continue;
      let k = 1;
      while (existsSync(join(dir, `${parsed.item}-r${k}.${own}`))) k++;
      const to = `${parsed.item}-r${k}.${own}`;
      renameSync(join(dir, name), join(dir, to));
      moved.push([name, to]);
    }
    try {
      renameSync(temp, target);
    } catch (error) {
      for (const [from, to] of moved.reverse()) {
        try {
          renameSync(join(dir, to), join(dir, from));
        } catch {
          continue;
        }
      }
      throw error;
    }
    return {
      promoted,
      archived: moved.length ? `media/${parsed.deliverable}/${moved[moved.length - 1][1]}` : null,
      promotedSha256,
      promotedBytes,
      ...(converted ? { converted: extension } : {}),
      ...(manifestFile && manifestFile !== promoted ? { manifestFile } : {}),
    };
  } catch (error) {
    if (temp) rmSync(temp, { force: true });
    throw error;
  }
}

const describe = error => (error?.code ? `${error.code} ${error.syscall || ''}`.trim() : String(error?.message || error).slice(0, 300));

function promote(job, task, parsed, file) {
  const none = { promoted: null, archived: null };
  if (!parsed || !isHighestVersion(job, parsed)) return none;
  const list = Array.isArray(task.outputs) ? task.outputs : [];
  if (list.length > 1 && list.indexOf(task.assetId) > 0) return none;
  if (!promotedPath(task.key, extname(file).slice(1))) return none;
  try {
    return promoteFile(job, parsed, task.key, file);
  } catch (error) {
    return { ...none, promoteError: describe(error) };
  }
}

const isPrimary = entry => basename(entry.file) === `${entry.panel}-v${entry.version}${extname(entry.file)}`;

export function repairPromotions(job) {
  const landed = readLanded(job);
  const slots = new Map();
  for (const entry of landed) {
    if (entry.type !== 'landed' || typeof entry.file !== 'string' || !entry.file || !entry.deliverable || !entry.panel) continue;
    if (!existsSync(join(job.dir, ...entry.file.split('/')))) continue;
    const id = `${entry.deliverable}/${entry.panel}`;
    slots.set(id, [...(slots.get(id) || []), entry]);
  }
  const repaired = [];
  for (const entries of slots.values()) {
    const top = Math.max(...entries.map(entry => Number(entry.version) || 0));
    const entry = entries.filter(candidate => (Number(candidate.version) || 0) === top && isPrimary(candidate)).pop();
    if (!entry) continue;
    const parsed = parseJobKey(entry.key);
    if (!parsed) continue;
    const dir = join(job.dir, 'media', parsed.deliverable);
    const older = entries.filter(candidate => (Number(candidate.version) || 0) < top);
    const shas = candidate => [candidate.sha256, candidate.promotedSha256, ...landed.filter(record => record.type === 'promoted' && record.assetId === candidate.assetId).map(record => record.promotedSha256)].filter(Boolean);
    const sizes = candidate => [candidate.bytes, candidate.promotedBytes, ...landed.filter(record => record.type === 'promoted' && record.assetId === candidate.assetId).map(record => record.promotedBytes)].filter(Number.isFinite);
    const currentShas = new Set(shas(entry));
    const olderShas = new Set(older.flatMap(shas));
    const knownSizes = new Set([entry, ...older].flatMap(sizes));
    let due = true;
    for (const name of slotFiles(dir, parsed.item)) {
      let size;
      try {
        size = statSync(join(dir, name)).size;
      } catch {
        continue;
      }
      if (!knownSizes.has(size)) {
        due = false;
        continue;
      }
      let sha256;
      try {
        sha256 = fileHash(join(dir, name));
      } catch {
        continue;
      }
      if (currentShas.has(sha256)) {
        due = false;
        break;
      }
      if (!olderShas.has(sha256)) due = false;
    }
    if (!due) continue;
    const base = { key: entry.key, deliverable: entry.deliverable, panel: entry.panel, version: entry.version, assetId: entry.assetId };
    try {
      const done = promoteFile(job, parsed, entry.key, entry.file);
      repaired.push(appendLanded(job, { type: 'promoted', ...base, ...done }));
    } catch (error) {
      const promoteError = describe(error);
      const last = landed.filter(record => record.type === 'promote_failed' && record.assetId === entry.assetId).pop();
      if (last?.promoteError !== promoteError) appendLanded(job, { type: 'promote_failed', ...base, promoteError });
    }
  }
  return repaired;
}

function claim(job, assetId) {
  const file = join(job.dir, 'generation', `.landing-${safePart(assetId)}`);
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => {
        try {
          unlinkSync(file);
        } catch {
          return;
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') return null;
      try {
        if (Date.now() - statSync(file).mtimeMs < CLAIM_STALE_MS) return null;
        unlinkSync(file);
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function download(url, { attempts, backoffMs }) {
  if (!isFetchableUrl(url)) return { ok: false, reason: 'download_failed', status: null };
  let last = { ok: false, reason: 'download_failed', status: null };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // boundedFetch follows redirects by hand and checks every hop, and its resolved
      // address, against the private network policy; the body is capped in size.
      const response = await boundedFetch(url, { raw: true, timeoutMs: DOWNLOAD_TIMEOUT_MS, maxBytes: GENERATED_MEDIA_MAX_BYTES, headers: { Accept: '*/*' } });
      if (response.truncated) return { ok: false, reason: 'download_failed', status: response.status };
      if (response.ok) {
        const contentType = response.content_type;
        const bytes = response.buffer;
        if (bytes.length && !/^text\/html/i.test(contentType)) return { ok: true, bytes, contentType };
        last = { ok: false, reason: 'download_failed', status: response.status };
      } else if (EXPIRED_STATUSES.has(response.status)) {
        return { ok: false, reason: 'expired', status: response.status };
      } else {
        last = { ok: false, reason: 'download_failed', status: response.status };
      }
    } catch (error) {
      last = { ok: false, reason: 'download_failed', status: null };
      if (error instanceof FetchFailure && error.code !== 'timed_out' && error.code !== 'network') return last;
    }
    if (attempt < attempts) await pause(backoffMs * attempt);
  }
  return last;
}

function finalCreditsFor(job, providerJobId) {
  const settled = readRecords(job).filter(record => record.type === 'result' && record.providerJobId === providerJobId &&
    record.finalCredits !== null && record.finalCredits !== undefined && Number.isFinite(Number(record.finalCredits)));
  return settled.length ? Number(settled[settled.length - 1].finalCredits) : null;
}

async function finishMediaWithRetry(job) {
  try {
    repairPromotions(job);
  } catch {}
  const deadline = Date.now() + FINISH_RETRY_BUDGET_MS;
  let last = null;
  for (let attempt = 1; ; attempt++) {
    try {
      last = finishMediaIfLanded(job);
    } catch {
      last = null;
    }
    if (!last || last.ok) return last;
    if (Date.now() >= deadline) return last;
    await pause(Math.min(FINISH_RETRY_BACKOFF_MS * attempt, FINISH_RETRY_BACKOFF_CAP_MS));
  }
}

export async function landOutputs(task, { attempts = 3, backoffMs = 1500 } = {}) {
  const job = jobAt(task?.root, task?.brand, task?.jobId);
  const outcome = { landed: [], failed: [], skipped: [] };
  if (!job) return outcome;
  const parsed = parseJobKey(task.key);
  const provider = task.provider || THREE_ECHO;
  for (const link of Array.isArray(task.links) ? task.links : []) {
    if (!link?.assetId || !link?.url) continue;
    const release = claim(job, link.assetId);
    if (!release) {
      outcome.skipped.push(link.assetId);
      continue;
    }
    try {
      if (isLanded(job, link.assetId)) {
        outcome.skipped.push(link.assetId);
        continue;
      }
      const got = await download(link.url, { attempts, backoffMs });
      const base = {
        key: parsed?.key ?? task.key ?? null,
        deliverable: parsed?.deliverable ?? null,
        panel: parsed?.item ?? null,
        version: parsed?.version ?? null,
        provider,
        providerJobId: task.providerJobId ?? null,
        assetId: link.assetId,
      };
      if (!got.ok) {
        outcome.failed.push(appendLanded(job, {
          type: 'failed', ...base, reason: got.reason, httpStatus: got.status,
          note: (LANDING_NOTES[provider] || LANDING_NOTES[THREE_ECHO])[got.reason === 'expired' ? 'expired' : 'failed'],
        }));
        continue;
      }
      const mimeType = String(link.mimeType || got.contentType || '').split(';')[0].trim() || null;
      const file = landingPath(task.key, link.assetId, task.outputs, extensionFor(mimeType, link.filename));
      const target = join(job.dir, ...file.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.${randomUUID()}.part`;
      writeFileSync(temp, got.bytes);
      renameSync(temp, target);
      const sha256 = createHash('sha256').update(got.bytes).digest('hex');
      const promotion = promote(job, { ...task, assetId: link.assetId }, parsed, file);
      outcome.landed.push(appendLanded(job, {
        type: 'landed', ...base, file,
        sha256,
        bytes: got.bytes.length,
        mimeType,
        ...promotion,
        finalCredits: finalCreditsFor(job, task.providerJobId) ?? task.finalCredits ?? null,
      }));
    } finally {
      release();
    }
  }
  try {
    outcome.state = await finishMediaWithRetry(job);
  } catch {
    outcome.state = null;
  }
  return outcome;
}

function isMain() {
  if (!process.argv[1]) return false;
  const key = value => (process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value));
  return key(process.argv[1]) === key(SELF);
}

if (isMain()) {
  const at = process.argv.indexOf('--task');
  let task = null;
  try {
    task = JSON.parse(Buffer.from(String(process.argv[at + 1] || ''), 'base64url').toString('utf8'));
  } catch {
    task = null;
  }
  if (!task) process.exit(0);
  landOutputs(task).catch(() => null).finally(() => process.exit(0));
}
