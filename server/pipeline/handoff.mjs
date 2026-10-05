// The optional round trip to Post-production (Production Studio's post pipeline, or the older Creative Studio Post).
//
// Exports other modules call (B2: projection and board; B3: the send-to-post skill and its tools):
//   postAvailable({ home? })        true when Post-production is installed (production-studio@* or the older creative-studio-post@*).
//   detectPost({ home? })           { plugin, key, startSkill } or null; plugin is 'production-studio' or 'creative-studio-post'.
//   shouldSuggest(job, { home? })   true for a job never offered before, with Post-production installed, whose video clips are made
//                                   and stitched. `job` is { dir } | { path } | the job folder.
//   handoffState(job, { home? })    { status, line } or null (nothing to show: no record and nothing due, or declined).
//                                   status is 'suggested' | 'sent' | 'released' | 'returned'; line is one plain sentence.
//                                   First call for a due job records 'suggested' (so the offer is made once); a 'sent' job reads
//                                   the Studio job read-only and is marked 'released' here when Studio reports RELEASED or COMPLETE.
//                                   Offer on the board when status is 'suggested'; offer the return when it is 'released'.
//   handoffSent(jobDir)             true while the job is with Post-production (status 'sent'): waiting, not stuck, not Claude's turn.
//   readHandoff(jobDir)             the raw <job>/handoff/post.json, or null.
//   prepareHandoff / recordStarted / handoffStatus / returnHandoff / declineHandoff   what the pipeline_handoff_post_* tools run.
//   readStudioStatus(studioJobDir)  the Studio status reader, read-only.
//
// <job>/handoff/post.json: { status: 'suggested'|'declined'|'sent'|'released'|'returned', plugin, packDir, deliverable,
//   studio: { jobId, jobDir }, suggestedAt, declinedAt, sentAt, releasedAt, returnedAt, finalFile, finalSha256 }.
//
// THE PACK (decided by reading post's own scripts, no Studio change):
// Post's router (route-job.js) wants a release folder (script.md, storyboard.json, concept-breakdown.xlsx, storyboard/v<n>/P*.png)
// and a footage folder. Its footageSource "generated" path is the one that fits Social's already made clips:
//   - generate-clips.js 'brief' marks a panel whose clip is already in footage/generated/<panelId>.mp4 as "provided": used as it is,
//     never generated, never charged. So pre-placed clips cause no regeneration.
//   - sequence-first-cut.py cuts a generated job by panel id (by_panel): one cut per clip named after its panel, whole clip, no
//     CLIP frame matching, so no torch or transformers install is needed and the cut is exact.
//   - a generated job needs no call sheets; concept-breakdown.xlsx is still required (only origin footage-repurpose skips it), so it
//     is written here with openpyxl.
// The shot-footage path would need CLIP matching against panel pictures and call sheets, and the repurpose path would claim an origin
// that is not true, so "generated, every panel provided" is the simplest path that works. Clips are renumbered P01, P02 ... in cut
// order (one Studio panel per clip, so a beat split into two clips still gets one panel each).
// Layout: <home>/3echo/handoffs/<jobId>/{release/, shoot/footage/generated/, .social-campaign/handoff.json}.

import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UserFacingError } from '../lib/errors.mjs';
import { appendRecord, jobAt, moveJobTo, readJobState } from './facts.mjs';

const require = createRequire(import.meta.url);
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts');
const deliverables = require(join(SCRIPTS, 'lib-deliverable.js'));

export const HANDOFF_FILE = join('handoff', 'post.json');
export const RECORD_SCHEMA = '3echo-handoff/1';
// The state a job is in while its clips are made and its checks have not finished: when a person can still choose to send it out.
export const SUGGEST_STATES = Object.freeze(['MEDIA_READY', 'DRAFTS_READY', 'VALIDATED', 'AWAITING_CONTENT_APPROVAL']);
// Post-production's own shapes.
const POST_RATIOS = new Map([['16:9', [1920, 1080]], ['9:16', [1080, 1920]], ['1:1', [1080, 1080]], ['4:5', [1080, 1350]], ['2.39:1', [2048, 858]]]);
const VIDEO_FILE = /\.(mp4|mov|m4v)$/i;

const PLUGINS = Object.freeze([
  { plugin: 'production-studio', pattern: /^production-studio@/, startSkill: 'production-studio:new-post-project' },
  { plugin: 'creative-studio-post', pattern: /^creative-studio-post@/, startSkill: 'creative-studio-post:new-post-project' },
]);

// Local JSON helpers: ../lib/json.mjs pulls in node:sqlite, whose warning must not reach the hooks that read this module.
function readJsonFile(file, fallback) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value === null || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}
`);
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
const fwd = value => String(value).split(sep).join('/');
const nowIso = () => new Date().toISOString();

function dirOf(job) {
  if (typeof job === 'string') return job;
  return text(job?.dir) || text(job?.path);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function detectPost({ home = homedir() } = {}) {
  const installed = readJsonFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), null);
  const plugins = installed && typeof installed === 'object' && installed.plugins && typeof installed.plugins === 'object' ? installed.plugins : {};
  const keys = Object.keys(plugins).filter(key => (Array.isArray(plugins[key]) ? plugins[key].length > 0 : Boolean(plugins[key])));
  for (const entry of PLUGINS) {
    const key = keys.find(name => entry.pattern.test(name));
    if (key) return { plugin: entry.plugin, key, startSkill: entry.startSkill };
  }
  return null;
}

export const postAvailable = (options = {}) => detectPost(options) !== null;

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export function readHandoff(jobDir) {
  const record = readJsonFile(join(jobDir, HANDOFF_FILE), null);
  return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
}

function writeHandoff(jobDir, patch) {
  const base = readHandoff(jobDir) || {
    status: null, plugin: null, packDir: null, deliverable: null, studio: { jobId: null, jobDir: null },
    suggestedAt: null, declinedAt: null, sentAt: null, releasedAt: null, returnedAt: null, finalFile: null, finalSha256: null,
  };
  const next = { ...base, ...patch, studio: { ...base.studio, ...(patch.studio || {}) } };
  writeJsonFile(join(jobDir, HANDOFF_FILE), next);
  return next;
}

export const handoffSent = jobDir => {
  try {
    return Boolean(jobDir) && readHandoff(jobDir)?.status === 'sent';
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// What a made video job holds
// ---------------------------------------------------------------------------

function fileSize(file) {
  try {
    const info = statSync(file);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

/** The first video deliverable whose every clip is on disk and whose stitched cut exists: { id, deliverable, clips } or null. */
function madeVideo(dir) {
  const job = readJsonFile(join(dir, 'job.json'), null);
  const list = Array.isArray(job?.deliverables) ? job.deliverables : [];
  for (const deliverable of list) {
    if (deliverables.KIND_OF_DISCIPLINE[deliverable?.creativeDiscipline] !== 'video' || !text(deliverable.id)) continue;
    const id = deliverable.id;
    const manifest = readJsonFile(join(dir, 'drafts', id, 'generation-manifest.json'), null);
    const items = Array.isArray(manifest?.items) ? manifest.items : [];
    const videos = items.filter(item => item?.kind === 'video' && text(item.file));
    if (!videos.length) continue;
    const byStem = new Map(videos.map(item => [basename(item.file, extname(item.file)), item]));
    const order = Array.isArray(manifest?.stitch?.order) && manifest.stitch.order.length ? manifest.stitch.order : [...byStem.keys()];
    const clips = [];
    for (const stem of order) {
      const item = byStem.get(stem);
      const abs = item ? join(dir, ...item.file.split('/')) : null;
      if (!abs || !fileSize(abs)) {
        clips.length = 0;
        break;
      }
      const picture = items.find(other => other?.kind === 'image' && other.panel === item.panel && text(other.file) && fileSize(join(dir, ...other.file.split('/'))));
      clips.push({
        panel: item.panel ?? null, file: abs, rel: item.file, prompt: text(item.prompt),
        seconds: Number.isFinite(Number(item.durationSeconds)) ? Number(item.durationSeconds) : null,
        dialogue: text(item.dialogue?.line), picture: picture ? join(dir, ...picture.file.split('/')) : null,
      });
    }
    if (!clips.length) continue;
    if (!fileSize(join(dir, 'media', id, 'final.mp4'))) continue;
    return { id, deliverable, clips };
  }
  return null;
}

// Post-production's sound step shortlists three music tracks and cannot pass its picture and sound sign-off without one
// chosen, so a video is only offered when the brand's music shelf has three tracks to send with it. The job's own
// chosen track goes first. A job folder sits at <brand>/jobs/<id>, so the brand folder is two levels up.
export const POST_MUSIC_TRACKS = 3;
function postMusic(dir) {
  const shelf = join(dirname(dirname(dir)), 'music');
  const index = readJsonFile(join(shelf, 'index.json'), []);
  const tracks = (Array.isArray(index) ? index : []).map(entry => (text(entry?.file) ? join(shelf, basename(entry.file)) : null)).filter(file => file && fileSize(file));
  const chosen = readJsonFile(join(dir, 'media', 'music', 'choice.json'), null);
  const mine = text(chosen?.file) ? join(dir, ...chosen.file.split('/')) : null;
  const list = mine && fileSize(mine) ? [mine] : [];
  const seen = new Set(list.map(file => basename(file)));
  for (const file of tracks) if (!seen.has(basename(file))) { seen.add(basename(file)); list.push(file); }
  return list;
}

export function shouldSuggest(job, options = {}) {
  try {
    const dir = dirOf(job);
    if (!dir || readHandoff(dir)) return false;
    const { state } = readJobState(dir);
    if (!SUGGEST_STATES.includes(state)) return false;
    if (!postAvailable(options)) return false;
    if (postMusic(dir).length < POST_MUSIC_TRACKS) return false;
    return madeVideo(dir) !== null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The Studio status reader (read-only)
// ---------------------------------------------------------------------------

const WITH_POST = 'With Post-production: ';
const STUDIO_LINES = Object.freeze({
  INTAKE_PENDING: 'getting started',
  PLANNED: 'getting started',
  INGESTED: 'sorting the clips',
  CUT_DRAFTED: 'first cut',
  BGM_PROPOSED: 'choosing the music',
  BGM_CHOSEN: 'choosing the music',
  VO_PLACED: 'sound and mix',
  SYNCED: 'sound and mix',
  REVIEWED: 'checking picture and sound',
  AWAITING_GATE_A: 'picture and audio sign-off waiting',
  GATE_A_PASSED: 'finishing touches',
  FINISHING: 'finishing touches',
  PACKAGED: 'final package ready, release waiting',
  AWAITING_GATE_B: 'delivery sign-off waiting',
  RELEASED: 'delivery released',
  COMPLETE: 'delivery released',
  CHANGES_REQUESTED: 'making changes',
  BLOCKED: 'waiting on something',
  ESCALATED: 'waiting on something',
});

function approvedGates(studioDir) {
  const latest = new Map();
  let names = [];
  try {
    names = readdirSync(join(studioDir, 'approvals')).filter(name => name.endsWith('.json'));
  } catch {
    return new Set();
  }
  for (const name of names) {
    const record = readJsonFile(join(studioDir, 'approvals', name), null);
    const gate = text(record?.gate);
    if (!gate) continue;
    const round = Number.isFinite(Number(record.round)) ? Number(record.round) : 0;
    if (!latest.has(gate) || round >= latest.get(gate).round) latest.set(gate, { round, decision: record.decision });
  }
  return new Set([...latest].filter(([, value]) => value.decision === 'approved').map(([gate]) => gate));
}

export function readStudioStatus(studioJobDir) {
  const dir = text(studioJobDir) ? resolve(studioJobDir) : null;
  if (!dir || !existsSync(dir)) return { found: false, state: null, released: false, line: `${WITH_POST}I cannot see its folder right now` };
  let state = null;
  try {
    state = (readFileSync(join(dir, 'status.md'), 'utf8').match(/\*\*Current state:\*\*\s*`?([A-Z_]+)`?/) || [])[1] || null;
  } catch {
    state = null;
  }
  const studioJob = readJsonFile(join(dir, 'job.json'), null);
  const approved = approvedGates(dir);
  if (!state) state = approved.has('B') ? 'RELEASED' : approved.has('A') ? 'GATE_A_PASSED' : null;
  if (state === 'CANCELLED') return { found: true, state, jobId: text(studioJob?.jobId), released: false, line: 'Post-production stopped this job' };
  const released = state === 'RELEASED' || state === 'COMPLETE';
  return { found: true, state, jobId: text(studioJob?.jobId), released, line: `${WITH_POST}${STUDIO_LINES[state] || 'getting started'}` };
}

// ---------------------------------------------------------------------------
// handoffState
// ---------------------------------------------------------------------------

const LINES = Object.freeze({
  suggested: 'Post-production can give this video a full edit. Send it there, or finish it here?',
  released: 'Post-production has released the edit. Ready to bring the final video back.',
  returned: 'The final video is back from Post-production.',
});

export function handoffState(job, options = {}) {
  try {
    const dir = dirOf(job);
    if (!dir) return null;
    let record = readHandoff(dir);
    if (!record) {
      if (!shouldSuggest(job, options)) return null;
      record = writeHandoff(dir, { status: 'suggested', suggestedAt: nowIso() });
    }
    if (record.status === 'suggested') return { status: 'suggested', line: LINES.suggested };
    if (record.status === 'returned') return { status: 'returned', line: LINES.returned };
    if (record.status === 'released') return { status: 'released', line: LINES.released };
    if (record.status === 'sent') {
      const studio = readStudioStatus(record.studio?.jobDir);
      if (studio.released) {
        writeHandoff(dir, { status: 'released', releasedAt: nowIso() });
        return { status: 'released', line: LINES.released };
      }
      return { status: 'sent', line: studio.line };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The pack
// ---------------------------------------------------------------------------

function sha256Sync(file) {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1 << 20);
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

function walkFiles(base, dir = base, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(base, full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function run(binary, args) {
  return spawnSync(binary, args, { encoding: 'utf8', windowsHide: true });
}

function probeSeconds(file) {
  const done = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const value = Number(String(done.stdout || '').trim());
  return done.status === 0 && Number.isFinite(value) && value > 0 ? value : null;
}

function findPython() {
  const names = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  let anyPython = false;
  for (const name of names) {
    const probe = run(name, ['-c', 'import sys; print(1)']);
    if (probe.status !== 0) continue;
    anyPython = true;
    if (run(name, ['-c', 'import openpyxl']).status === 0) return { name, anyPython };
  }
  return { name: null, anyPython };
}

const EXCEL_REFUSAL = 'Post-production needs a small spreadsheet helper that is missing on this computer, so I cannot send this video yet.';

const BREAKDOWN_SCRIPT = [
  'import json, sys',
  'from openpyxl import Workbook',
  'data = json.load(open(sys.argv[1], encoding="utf-8"))',
  'wb = Workbook()',
  'ws = wb.active',
  'ws.title = "Concept breakdown"',
  'ws.append(["Panel", "Scene", "What happens", "Seconds", "Clip"])',
  'for r in data["rows"]:',
  '    ws.append([r["panel"], r["scene"], r["caption"], r["seconds"], r["clip"]])',
  'wb.save(sys.argv[2])',
].join('\n');

function firstSentence(value, limit = 140) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const cut = (clean.match(/^.*?[.!?](?=\s|$)/) || [clean])[0];
  return cut.length > limit ? `${cut.slice(0, limit - 1).trim()}...` : cut;
}

export function prepareHandoff({ root, brand, jobId, home = homedir() } = {}) {
  const job = jobAt(root, brand, jobId);
  if (!job) throw new UserFacingError('I cannot find that job.');
  const found = detectPost({ home });
  if (!found) throw new UserFacingError('Post-production is not installed on this computer, so this video finishes here.');
  const record = readHandoff(job.dir);
  if (record && ['sent', 'released', 'returned'].includes(record.status)) {
    throw new UserFacingError(record.status === 'returned' ? 'This video already came back from Post-production.' : 'This video is already with Post-production.');
  }
  const made = madeVideo(job.dir);
  if (!made) throw new UserFacingError('The video is not finished being made yet, so there is nothing to send.');
  const data = readJsonFile(join(job.dir, 'job.json'), {});
  const ratioWanted = text(made.deliverable.aspectRatios?.[0]);
  const ratio = POST_RATIOS.has(ratioWanted) ? ratioWanted : null;
  if (!ratio) throw new UserFacingError('Post-production does not take this video shape yet, so this video finishes here.');
  const music = postMusic(job.dir);
  if (music.length < POST_MUSIC_TRACKS) throw new UserFacingError(`Post-production needs ${POST_MUSIC_TRACKS} music tracks to choose from, and this brand has ${music.length}. Add music to the brand, or finish this video here.`);
  const python = findPython();
  if (!python.name) throw new UserFacingError(EXCEL_REFUSAL, { fix: python.anyPython ? 'Install the Python package openpyxl, then try again.' : 'Install Python and its openpyxl package, then try again.' });

  const pack = join(resolve(home), '3echo', 'handoffs', jobId);
  const release = join(pack, 'release');
  const shoot = join(pack, 'shoot');
  const generated = join(shoot, 'footage', 'generated');
  const frames = join(release, 'storyboard', 'v1');
  rmSync(pack, { recursive: true, force: true });
  for (const folder of [frames, generated, join(pack, '.social-campaign')]) mkdirSync(folder, { recursive: true });

  const title = text(data.title) || text(job.title) || jobId;
  const [width, height] = POST_RATIOS.get(ratio);
  const panels = [];
  const rows = [];
  const script = [`# ${title}`, ''];
  let total = 0;
  made.clips.forEach((clip, index) => {
    const n = index + 1;
    const id = `P${String(n).padStart(2, '0')}`;
    copyFileSync(clip.file, join(generated, `${id}${extname(clip.file).toLowerCase() === '.mov' ? '.mov' : '.mp4'}`));
    const seconds = probeSeconds(clip.file) ?? clip.seconds ?? 5;
    total += seconds;
    let picture = clip.picture;
    let pictureName = picture ? `${id}${extname(picture).toLowerCase()}` : `${id}.png`;
    if (picture) copyFileSync(picture, join(frames, pictureName));
    else {
      const frame = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (seconds / 2).toFixed(2), '-i', clip.file, '-frames:v', '1', join(frames, pictureName)]);
      if (frame.status !== 0) throw new UserFacingError('I could not make a picture for one scene, so I cannot send this video yet.');
    }
    const caption = firstSentence(clip.prompt) || `Scene ${n}`;
    panels.push({ id, scene: n, storyOrder: n, caption, durationSec: Math.round(seconds * 100) / 100, file: `storyboard/v1/${pictureName}` });
    rows.push({ panel: id, scene: n, caption, seconds: Math.round(seconds * 100) / 100, clip: basename(clip.file) });
    script.push(`Scene ${n}: ${caption}${clip.dialogue ? ` VO: "${clip.dialogue}"` : ''}`);
  });
  writeFileSync(join(release, 'script.md'), `${script.join('\n')}\n`);
  // The music and any voice-over go where Post-production's ingest looks for them: audio/bgm and audio/vo.
  const bgm = join(shoot, 'audio', 'bgm');
  mkdirSync(bgm, { recursive: true });
  for (const file of music) copyFileSync(file, join(bgm, basename(file)));
  const manifest = readJsonFile(join(job.dir, 'drafts', made.id, 'generation-manifest.json'), {});
  const takes = (Array.isArray(manifest?.voiceover) ? manifest.voiceover : []).map(line => (text(line?.file) ? join(job.dir, ...line.file.split('/')) : null)).filter(file => file && fileSize(file));
  if (takes.length) {
    const vo = join(shoot, 'audio', 'vo');
    mkdirSync(vo, { recursive: true });
    for (const file of takes) copyFileSync(file, join(vo, basename(file)));
  }
  writeFileSync(join(release, 'storyboard.json'), `${JSON.stringify({ schemaVersion: '1.0', title, client: brand, width, height, panels }, null, 2)}\n`);

  const input = join(tmpdir(), `social-campaign-breakdown-${process.pid}-${Date.now()}.json`);
  writeFileSync(input, JSON.stringify({ rows }));
  const made_xlsx = run(python.name, ['-c', BREAKDOWN_SCRIPT, input, join(release, 'concept-breakdown.xlsx')]);
  rmSync(input, { force: true });
  if (made_xlsx.status !== 0) throw new UserFacingError(EXCEL_REFUSAL, { fix: 'Install the Python package openpyxl, then try again.' });

  // The cut as Social has it, for pacing only: Post-production keeps it beside the release as its reference cut.
  const cut = join(job.dir, 'media', made.id, 'final.mp4');
  copyFileSync(cut, join(release, 'reference-cut.mp4'));

  const files = walkFiles(pack).filter(file => !fwd(relative(pack, file)).startsWith('.social-campaign/'))
    .map(file => ({ path: fwd(relative(pack, file)), sha256: sha256Sync(file), bytes: statSync(file).size }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const deliverableId = made.id;
  writeFileSync(join(pack, '.social-campaign', 'handoff.json'), `${JSON.stringify({
    schema: RECORD_SCHEMA, from: 'social-campaign', to: found.plugin, brand, title, jobId, deliverable: deliverableId, files,
    returnTo: { jobDir: job.dir, deliverable: deliverableId, file: `media/${deliverableId}/final.mp4` }, createdAt: nowIso(),
  }, null, 2)}\n`);

  const duration = Math.min(900, Math.max(5, Math.round(total)));
  const audioLed = made.deliverable.talkingCharacter === true;
  const args = {
    client: brand, title, footageFolder: shoot, releaseFolder: release, aspectRatio: ratio, deliverableDurationSec: duration,
    audioLed, footageSource: 'generated', referenceCutPath: join(release, 'reference-cut.mp4'),
  };
  // Post-production works in its own folder, never in this workspace: both use workspaces/<name>/, so a shared folder would mix
  // Studio clients with Social brands. Its scripts take --root first, then CREATIVE_STUDIO_POST_ROOT.
  const studioRoot = resolve(process.env.CREATIVE_STUDIO_POST_ROOT || join(resolve(home), '3echo', 'production-studio'));
  mkdirSync(join(studioRoot, 'workspaces'), { recursive: true });
  writeHandoff(job.dir, { status: 'suggested', plugin: found.plugin, packDir: pack, deliverable: deliverableId, suggestedAt: record?.suggestedAt || nowIso(), declinedAt: null });
  return {
    ok: true, plugin: found.plugin, startSkill: found.startSkill, packDir: pack, studioRoot, args,
    startArguments: `--client "${brand}" --title "${title}" --drive-folder "${shoot}" --pre-release "${release}" --aspect-ratio ${ratio} --deliverable-duration-sec ${duration} --audio-led ${audioLed} --footage-source generated --reference-cut-path "${args.referenceCutPath}"`,
    next: `Run the start skill with these arguments, running every Post-production script with --root "${studioRoot}" (or CREATIVE_STUDIO_POST_ROOT set to it), never in this workspace; then record the Post-production job it makes with the started tool.`,
  };
}

// ---------------------------------------------------------------------------
// Started, status, decline
// ---------------------------------------------------------------------------

function need(root, brand, jobId) {
  const job = jobAt(root, brand, jobId);
  if (!job) throw new UserFacingError('I cannot find that job.');
  return job;
}

export function recordStarted({ root, brand, jobId, studioJobId, studioJobDir } = {}) {
  const job = need(root, brand, jobId);
  const record = readHandoff(job.dir);
  if (!record || !record.packDir) throw new UserFacingError('Nothing has been prepared for Post-production yet.');
  if (['released', 'returned'].includes(record.status)) throw new UserFacingError('This video is already past that step.');
  if (!text(studioJobId) || !text(studioJobDir) || !existsSync(resolve(studioJobDir))) throw new UserFacingError('I cannot find the Post-production job that was started.');
  const next = writeHandoff(job.dir, { status: 'sent', sentAt: nowIso(), studio: { jobId: studioJobId, jobDir: resolve(studioJobDir) } });
  return { ok: true, status: next.status, line: readStudioStatus(next.studio.jobDir).line };
}

export function handoffStatus({ root, brand, jobId, home } = {}) {
  const job = need(root, brand, jobId);
  const state = handoffState(job, home ? { home } : {});
  const nextStep = { suggested: 'offer', sent: 'wait', released: 'offer_return', returned: 'continue' };
  if (!state) return { status: null, line: null, next: 'none' };
  return { ...state, next: nextStep[state.status] };
}

export function declineHandoff({ root, brand, jobId } = {}) {
  const job = need(root, brand, jobId);
  const record = readHandoff(job.dir);
  if (record?.status === 'returned') throw new UserFacingError('This video already came back from Post-production.');
  writeHandoff(job.dir, { status: 'declined', declinedAt: nowIso() });
  return { ok: true, status: 'declined', line: 'Okay, this video finishes here.' };
}

// ---------------------------------------------------------------------------
// The return
// ---------------------------------------------------------------------------

const SKIP_FOLDERS = new Set(['footage', 'proxies', 'references', 'refs', 'preview', 'previews', 'node_modules', '.git', 'audio', 'plates']);

function newestExport(studioDir) {
  let best = null;
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 4 && !SKIP_FOLDERS.has(entry.name.toLowerCase())) walk(full, depth + 1);
      } else if (entry.isFile() && VIDEO_FILE.test(entry.name) && !/proxy|preview/i.test(entry.name)) {
        const mtime = statSync(full).mtimeMs;
        if (!best || mtime > best.mtime) best = { file: full, mtime };
      }
    }
  };
  walk(studioDir, 0);
  return best?.file ?? null;
}

export function returnHandoff({ root, brand, jobId, filePath = null } = {}) {
  const job = need(root, brand, jobId);
  let record = readHandoff(job.dir);
  if (record?.status === 'sent' && readStudioStatus(record.studio?.jobDir).released) record = writeHandoff(job.dir, { status: 'released', releasedAt: nowIso() });
  if (!record || record.status !== 'released') {
    throw new UserFacingError(record?.status === 'returned' ? 'The final video is already back.' : 'Post-production has not released the edit yet.');
  }
  const source = text(filePath) ? resolve(filePath) : newestExport(resolve(record.studio?.jobDir || '.'));
  if (!source || !fileSize(source) || !VIDEO_FILE.test(source)) {
    throw new UserFacingError('I cannot find the final video yet. Export it in Post-production, or tell me where it is.');
  }
  const looksVideo = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', source]);
  if (looksVideo.status === 0 && !/video/.test(looksVideo.stdout || '')) throw new UserFacingError('That file is not a video, so I did not bring it in.');

  const deliverable = record.deliverable || 'D1';
  const folder = join(job.dir, 'media', deliverable);
  const target = join(folder, 'final.mp4');
  const part = join(folder, `final.${process.pid}.part.mp4`);
  mkdirSync(folder, { recursive: true });
  try {
    if (/\.(mp4|m4v)$/i.test(source)) copyFileSync(source, part);
    else {
      const converted = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', part]);
      if (converted.status !== 0) throw new UserFacingError('I could not read that video, so I did not bring it in.');
    }
    const before = join(folder, 'final-before-post.mp4');
    if (existsSync(target) && !existsSync(before)) renameSync(target, before);
    renameSync(part, target);
  } finally {
    rmSync(part, { force: true });
  }
  const finalSha256 = sha256Sync(target);
  writeHandoff(job.dir, { status: 'returned', returnedAt: nowIso(), finalFile: `media/${deliverable}/final.mp4`, finalSha256 });
  try {
    appendRecord(job, { type: 'handoff', status: 'returned', file: `media/${deliverable}/final.mp4`, sha256: finalSha256, at: nowIso() });
  } catch { /* the record is a courtesy */ }
  // The new video changes what the logo and label check and the final approval must cover, so a job already past the checks goes back to them.
  let moved = null;
  const { state } = readJobState(job.dir);
  if (['VALIDATED', 'AWAITING_CONTENT_APPROVAL'].includes(state)) moved = moveJobTo(job, 'DRAFTS_READY', { by: 'handoff' });
  return {
    ok: true, status: 'returned', file: `media/${deliverable}/final.mp4`, finalSha256, moved,
    next: moved && !moved.ok
      ? 'Run the logo and label check on the new video again, then the final approval. The job could not step back to its checks by itself.'
      : 'Run the logo and label check on the new video, then the final approval.',
  };
}
