/**
 * The combine step: after the clips are joined, ONE card with three rows says what goes on the joined video.
 *
 *   Music      From your library · Upload a track · Make with ElevenLabs (priced) · None
 *   Voice-over From your library · Upload your recording · Make with ElevenLabs from the script (priced) · None
 *   Captions   From the voice-over words · From the script words · None
 *
 * The person's picks are saved with the cut approval in approvals/finishing.json (finishing.mjs) as `combine`. A pick from the
 * library is resolved at once into the job (media/music/choice.json, media/voice/choice.json). An upload or a "Make with
 * ElevenLabs" pick waits for the Director: upload through a board question that asks for the file, make after the price click. When
 * ElevenLabs makes several takes they are shown side by side on a board question and the pick is recorded here.
 * finish-video.py then mixes the chosen music (ducked under the voice-over) and voice-over and draws the chosen captions.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';

import * as facts from './facts.mjs';
import { ELEVEN_LABS_LICENCE, addToLibrary, findItem, libraryBrands, listLibrary } from './library.mjs';
import { chooseMusic, readChoice as readMusicChoice } from './music.mjs';
import { askQuestion } from './questions.mjs';
import { FINISHING_FILE, musicTrack, transcriptSaved, writeFinishingRecord } from './finishing.mjs';
import { renameReplacing } from '../lib/rename.mjs';

export const COMBINE_ROWS = Object.freeze({
  music: Object.freeze([
    Object.freeze({ id: 'library', label: 'From your library' }),
    Object.freeze({ id: 'upload', label: 'Upload a track' }),
    Object.freeze({ id: 'make', label: 'Make with ElevenLabs', priced: true }),
    Object.freeze({ id: 'none', label: 'None' }),
  ]),
  voice: Object.freeze([
    Object.freeze({ id: 'library', label: 'From your library' }),
    Object.freeze({ id: 'upload', label: 'Upload your recording' }),
    Object.freeze({ id: 'make', label: 'Make with ElevenLabs from the script', priced: true }),
    Object.freeze({ id: 'none', label: 'None' }),
  ]),
  captions: Object.freeze([
    Object.freeze({ id: 'voice', label: 'From the voice-over words' }),
    Object.freeze({ id: 'script', label: 'From the script words' }),
    Object.freeze({ id: 'none', label: 'None' }),
  ]),
});
const LISTED_LIMIT = 60;

const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const writeJson = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); const tmp = `${file}.tmp`; writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`); renameReplacing(tmp, file); };

// ---------------------------------------------------------------- the job's voice-over choice (the music one is music.mjs)
export const voiceChoicePath = jobDir => join(jobDir, 'media', 'voice', 'choice.json');
export const readVoiceChoice = jobDir => { const value = readJson(voiceChoicePath(jobDir)); return value && typeof value === 'object' ? value : null; };
export const takesPath = (jobDir, kind) => join(jobDir, 'media', kind, 'takes', 'takes.json');

/** The voice-over file named by media/voice/choice.json, or null (the same rule finish-video.py uses). */
export function voiceTrack(jobDir) {
  const choice = readVoiceChoice(jobDir);
  if (!choice || choice.source === 'none' || !choice.file) return null;
  return [choice.file, join(jobDir, choice.file), join(jobDir, 'media', 'voice', choice.file)].find(path => existsSync(path)) || null;
}

function safeFileName(file) {
  const ext = extname(file).toLowerCase();
  const stem = basename(file, extname(file)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'voice';
  return `${stem}${ext}`;
}

function writeVoiceChoice(jobDir, choice) {
  writeJson(voiceChoicePath(jobDir), { ...choice, chosenAt: new Date().toISOString() });
}

function chooseVoice({ root, job, id, why }) {
  if (id === 'none') { writeVoiceChoice(job.dir, { source: 'none', title: null, file: null, sha256: null, licence: null, why: why || 'No voice-over for this video.' }); return { none: true }; }
  if (id === 'pending') { writeVoiceChoice(job.dir, { source: 'pending', title: null, file: null, sha256: null, licence: null, why: why || 'Waiting for the voice-over.' }); return { pending: true }; }
  const found = findItem({ root, id, kind: 'voice' });
  if (!found) throw new Error(`No voice-over with id ${id} in the library.`);
  const dir = join(job.dir, 'media', 'voice');
  mkdirSync(dir, { recursive: true });
  const name = safeFileName(found.item.file.replace(/^v-[0-9a-f]{8}-/, ''));
  copyFileSync(found.file, join(dir, name));
  writeVoiceChoice(job.dir, { source: 'library', title: found.item.title, file: `media/voice/${name}`, sha256: found.item.sha256, licence: found.item.licence, why: why || 'Chosen for this video.' });
  return { id: found.item.id, title: found.item.title };
}

function pendingMusic(job, why) {
  mkdirSync(join(job.dir, 'media', 'music'), { recursive: true });
  writeJson(join(job.dir, 'media', 'music', 'choice.json'), { source: 'pending', title: null, file: null, sha256: null, licence: null, why: why || 'Waiting for the music.', chosenAt: new Date().toISOString() });
}

// ---------------------------------------------------------------- what the storyboard already answered
/** The storyboard's front matter answer { enabled, voice } for voice-over, or null when it was not asked. */
export function storyboardVoiceOver(jobDir) {
  let names = [];
  try { names = readdirSync(join(jobDir, 'drafts'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); } catch { return null; }
  for (const name of names) {
    let raw = '';
    try { raw = readFileSync(join(jobDir, 'drafts', name, 'storyboard.md'), 'utf8'); } catch { continue; }
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    if (!front) continue;
    const field = key => new RegExp(`^${key}:\\s*(.*)$`, 'mi').exec(front[1])?.[1].replace(/#.*$/, '').trim().replace(/^["']|["']$/g, '') ?? '';
    const answer = field('voice_over').toLowerCase();
    if (['yes', 'true'].includes(answer)) return { enabled: true, voice: field('voice') || null };
    if (['no', 'false'].includes(answer)) return { enabled: false, voice: null };
  }
  return null;
}

/**
 * What each row starts on. Voice-over follows the storyboard's answer (yes: make it with ElevenLabs from the script; no, or not
 * asked: none). Music starts on the track the job already has, else none. Captions follow the voice: from the voice-over words
 * when there is a voice-over or a transcript of the cut, else none. Nothing here spends anything: making is priced and clicked.
 */
export function combineDefaults(job) {
  const answer = storyboardVoiceOver(job.dir);
  const music = readMusicChoice(job.dir);
  const hasMusic = music && music.source !== 'none' && music.source !== 'pending' && music.file;
  const voiceOn = Boolean(answer?.enabled);
  const transcript = existsSync(join(job.root, 'imports', 'transcripts')) && facts.cutSet(job).panels.some(panel => existsSync(join(job.root, 'imports', 'transcripts', `${panel.sha256}.json`)));
  return {
    music: hasMusic ? { source: 'library', id: null, title: music.title || null } : { source: 'none' },
    voice: voiceOn ? { source: 'make' } : { source: 'none' },
    captions: { source: voiceOn || transcript ? 'voice' : 'none' },
  };
}

// ---------------------------------------------------------------- the card's data (the job document's `combine`)
const shortItem = item => ({ id: item.id, title: item.title, licence: item.licence, brand: item.brand, brands: item.brands, origin: item.origin });

/** What the board draws for the combine card; null when the joined video is not there to combine yet. */
export function combineSection({ root, brand, jobId }) {
  const job = facts.jobAt(root, brand, jobId);
  if (!job || !facts.reviewSet(job, 'cut').panels.length) return null;
  const answer = storyboardVoiceOver(job.dir);
  const library = { music: listLibrary({ root, kind: 'music' }).items.slice(0, LISTED_LIMIT).map(shortItem), voice: listLibrary({ root, kind: 'voice' }).items.slice(0, LISTED_LIMIT).map(shortItem) };
  return {
    brand,
    rows: { music: COMBINE_ROWS.music, voice: COMBINE_ROWS.voice, captions: COMBINE_ROWS.captions },
    defaults: combineDefaults(job),
    voiceOver: answer,
    library,
    brands: libraryBrands(root),
    ...(facts.finishingRecord(job)?.combine ? { chosen: facts.finishingRecord(job).combine } : {}),
  };
}

// ---------------------------------------------------------------- the picks
const SOURCES = Object.freeze({ music: ['library', 'upload', 'make', 'none'], voice: ['library', 'upload', 'make', 'none'], captions: ['voice', 'script', 'none'] });

/** A combine object checked and cleaned, with library ids that must exist. Missing rows take the defaults. Throws a plain message. */
export function normaliseCombine({ root, job, combine }) {
  if (!combine || typeof combine !== 'object' || Array.isArray(combine)) throw new Error('Pick what to add for music, voice-over and captions.');
  const defaults = combineDefaults(job);
  const out = {};
  for (const row of ['music', 'voice', 'captions']) {
    const given = combine[row] === undefined ? defaults[row] : combine[row];
    const source = typeof given === 'string' ? given : given?.source;
    if (!SOURCES[row].includes(source)) throw new Error(`Pick one of: ${COMBINE_ROWS[row].map(option => option.label).join(', ')} for ${row === 'voice' ? 'the voice-over' : row}.`);
    if (row === 'captions' || source === 'none' || source === 'upload' || source === 'make') { out[row] = { source }; continue; }
    const id = typeof given === 'object' && typeof given.id === 'string' ? given.id.trim() : '';
    if (!id) throw new Error(`Pick a ${row === 'voice' ? 'voice-over' : 'track'} from the library, or another choice.`);
    if (!findItem({ root, id, kind: row === 'voice' ? 'voice' : 'music' })) throw new Error(`That ${row === 'voice' ? 'voice-over' : 'track'} is not in the library.`);
    out[row] = { source, id };
  }
  return out;
}

/** The legacy choice id for a combine pick: voice-over needs 'combine'; otherwise captions and music map as before. */
export function combineChoice(combine) {
  const captions = combine.captions.source !== 'none';
  const music = combine.music.source !== 'none';
  const voice = combine.voice.source !== 'none';
  if (voice) return 'combine';
  return captions && music ? 'both' : captions ? 'captions' : music ? 'music' : 'skip';
}

export const combineFlags = combine => ({ captions: combine.captions.source !== 'none', music: combine.music.source !== 'none', voice: combine.voice.source !== 'none' });

/** Put the library picks into the job and mark the rest as waiting. Returns the picks as stored, with titles. */
export function applyCombine({ root, job, combine, why }) {
  const stored = { ...combine };
  if (combine.music.source === 'none') chooseMusic({ root, brand: job.brand, jobId: job.jobId, id: 'none', why });
  else if (combine.music.source === 'library') { const picked = chooseMusic({ root, brand: job.brand, jobId: job.jobId, id: combine.music.id, why }); stored.music = { ...combine.music, title: picked.title }; }
  else pendingMusic(job, why);
  if (combine.voice.source === 'none') chooseVoice({ root, job, id: 'none', why });
  else if (combine.voice.source === 'library') { const picked = chooseVoice({ root, job, id: combine.voice.id, why }); stored.voice = { ...combine.voice, title: picked.title }; }
  else chooseVoice({ root, job, id: 'pending', why });
  return stored;
}

/** What is still to do after the picks, as plain steps for the Director (and whether anything is). */
export function combineNextSteps(job, combine) {
  const steps = [];
  const code = job.jobId;
  if (combine.music.source === 'upload') steps.push('Music: ask the person for the track with pipeline_board_ask (wantsUpload type audio), then pipeline_combine_set {row: "music", source: "upload", path}.');
  if (combine.music.source === 'make') steps.push(`Music: price it (creative_generate_in_flow with node_type "music", an eleven_music model, a prompt from the brief and estimate_only true, generations_count 1), save one price item {provider elevenLabs, kind music, key ${code}-D1-M1-v1, the estimateId} with pipeline_quote_save and show the price: the person must click it on the board. Only after the approval make it with the same call without estimate_only, then pipeline_combine_takes {kind: "music", files}. Never make music any other way.`);
  if (combine.voice.source === 'upload') steps.push('Voice-over: ask the person for the recording with pipeline_board_ask (wantsUpload type audio), then pipeline_combine_set {row: "voice", source: "upload", path}.');
  if (combine.voice.source === 'make') steps.push(`Voice-over: price the script read aloud with creative_generate_speech (estimate_only true, generations_count 2 or 3 so the person gets takes to pick from), save a voice price item {provider elevenLabs, kind voice, key ${code}-D1-VO1-v1, generationsCount} with pipeline_quote_save; the person clicks the price on the board. After the approval make it, then pipeline_combine_takes {kind: "voice", files}, which shows the takes side by side.`);
  if (combine.captions.source === 'voice' && combine.voice.source !== 'none') steps.push('Captions: once the voice-over is chosen, transcribe it (media_transcribe on the voice-over file, or creative_transcribe_audio after its price) so the captions use its real words; without a transcript they use the script wording and you must say so.');
  return steps;
}

// ---------------------------------------------------------------- changing one row after the approval
function readRecord(job) {
  const record = facts.finishingRecord(job);
  if (!record) throw new Error('The joined video is not approved with a finishing choice yet, so there is nothing to change. The board card records it with the approval.');
  return record;
}

function saveRecord(job, record) {
  writeJson(join(job.dir, ...FINISHING_FILE.split('/')), record);
}

/** The record with its combine picks and the flags finish-video.py reads, rebuilt from the picks. */
export function withCombine(record, combine, by) {
  const flags = combineFlags(combine);
  return { ...record, choice: combineChoice(combine), captions: flags.captions, music: flags.music, voice: flags.voice, combine, ...(by ? { by } : {}) };
}

function takesFor(job, kind) {
  const list = readJson(takesPath(job.dir, kind));
  return Array.isArray(list) ? list : [];
}

/**
 * Settle one row of the combine card after the approval: a library item, an uploaded file (put in the library, tagged with the
 * brand), a take that ElevenLabs made (by its label, such as "Take 2"), none, or the captions' source.
 */
export async function setCombineRow({ root, job, row, source, id, take, path, title, licence, why }) {
  if (!['music', 'voice', 'captions'].includes(row)) throw new Error('The rows are music, voice and captions.');
  const record = readRecord(job);
  if (!SOURCES[row].includes(source)) throw new Error(`Pick one of: ${SOURCES[row].join(', ')}.`);
  const combine = { ...(record.combine || combineDefaults(job)) };
  let message = '';
  if (row === 'captions') {
    combine.captions = { source };
    message = source === 'none' ? 'No captions.' : source === 'voice' ? 'Captions from the voice-over words.' : 'Captions from the script words.';
  } else {
    const kind = row === 'voice' ? 'voice' : 'music';
    const choose = itemId => (row === 'music' ? chooseMusic({ root, brand: job.brand, jobId: job.jobId, id: itemId, why }) : chooseVoice({ root, job, id: itemId, why }));
    if (source === 'none') { choose('none'); combine[row] = { source }; message = `No ${row === 'voice' ? 'voice-over' : 'music'}.`; }
    else if (source === 'library') {
      if (!id) throw new Error('Say which library item.');
      const picked = choose(id);
      combine[row] = { source, id, title: picked.title };
      message = `Using ${picked.title}.`;
    } else if (source === 'upload') {
      if (!path) throw new Error('Give the absolute path of the audio file the person uploaded.');
      const { item } = await addToLibrary({ root, kind, path, brand: job.brand, title, licence, origin: 'upload', addedFrom: `job:${job.jobId}` });
      const picked = choose(item.id);
      combine[row] = { source, id: item.id, title: picked.title };
      message = `Using ${picked.title} (added to the library, tagged ${job.brand}).`;
    } else {
      if (!take) { if (row === 'music') pendingMusic(job, why); else chooseVoice({ root, job, id: 'pending', why }); combine[row] = { source }; message = 'Waiting for ElevenLabs to make it.'; }
      else {
        const found = takesFor(job, kind).find(entry => entry.label.toLowerCase() === String(take).trim().toLowerCase());
        if (!found) throw new Error(`There is no ${take} for the ${row === 'voice' ? 'voice-over' : 'music'}. The takes are: ${takesFor(job, kind).map(entry => entry.label).join(', ') || 'none yet'}.`);
        const picked = choose(found.libraryId);
        combine[row] = { source, id: found.libraryId, title: picked.title, take: found.label };
        message = `Using ${found.label}.`;
      }
    }
  }
  saveRecord(job, withCombine(record, combine, record.by));
  const open = combineNextSteps(job, combine).filter(step => !/^Captions/.test(step) || row !== 'captions');
  const waiting = ['music', 'voice'].filter(name => ['upload', 'make'].includes(combine[name].source) && !combine[name].id);
  return { recorded: true, row, combine, message: `${message}${waiting.length ? ` Still waiting: ${waiting.join(' and ')}.` : ' Run finish-video.py when every row is settled.'}`, waiting, next: waiting.length ? open.filter(step => waiting.some(name => step.toLowerCase().startsWith(name === 'voice' ? 'voice' : 'music'))) : [] };
}

// ---------------------------------------------------------------- takes made by ElevenLabs
/**
 * Save the takes ElevenLabs made (audio files) into the job and the workspace library (licence "made with ElevenLabs", tagged with
 * the brand). One take is used straight away. Several are shown side by side on a board question so the person picks one.
 */
export async function registerTakes({ root, job, kind, files, text }) {
  if (!['voice', 'music'].includes(kind)) throw new Error('Takes are for voice or music.');
  if (!Array.isArray(files) || !files.length) throw new Error('Give the audio files ElevenLabs made.');
  const record = readRecord(job);
  const row = kind;
  if (!record.combine?.[row] || record.combine[row].source !== 'make') throw new Error(`The ${kind === 'voice' ? 'voice-over' : 'music'} row is not set to Make with ElevenLabs, so there are no takes to register.`);
  const dir = join(job.dir, 'media', kind, 'takes');
  mkdirSync(dir, { recursive: true });
  const takes = [];
  for (const [index, input] of files.entries()) {
    const source = isAbsolute(String(input)) ? String(input) : join(job.dir, ...String(input).split('/'));
    if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Take ${index + 1} could not be found.`);
    const label = `Take ${index + 1}`;
    const name = `take-${index + 1}${extname(source).toLowerCase()}`;
    if (source !== join(dir, name)) copyFileSync(source, join(dir, name));
    const { item } = await addToLibrary({ root, kind, path: join(dir, name), brand: job.brand, title: `${kind === 'voice' ? 'Voice-over' : 'Music'} ${label} (${job.jobId})`, licence: ELEVEN_LABS_LICENCE, origin: 'elevenlabs', addedFrom: `job:${job.jobId}` });
    takes.push({ label, file: `media/${kind}/takes/${name}`, libraryId: item.id, sha256: item.sha256 });
  }
  writeJson(takesPath(job.dir, kind), takes);
  if (takes.length === 1) {
    const done = await setCombineRow({ root, job, row, source: 'make', take: takes[0].label, why: 'The only take ElevenLabs made.' });
    return { takes: takes.map(({ label, file }) => ({ label, file })), chosen: takes[0].label, ...done };
  }
  const question = askQuestion({
    root, brand: job.brand, jobId: job.jobId,
    text: text || `Which ${kind === 'voice' ? 'voice-over' : 'music'} take do you want? Listen to them side by side.`,
    takes: takes.map(({ label, file }) => ({ label, file })), allowText: false,
  });
  return {
    takes: takes.map(({ label, file }) => ({ label, file })), questionId: question.questionId,
    message: `The ${takes.length} takes are saved and shown side by side on the board. Make the review copies viewable first (pipeline_review_copies_prepare, upload what it returns, write the board), then wait for the answer. The answer is a take label: record it with pipeline_combine_set {row: "${row}", source: "make", take: "Take 2"}.`,
  };
}

// ---------------------------------------------------------------- recording the card's picks with the cut approval
/** Record the combine card's picks (from the board approval, or pipeline_finishing_choice with combine). */
export function recordCombine({ job, combine, by }) {
  const picks = normaliseCombine({ root: job.root, job, combine });
  const flags = combineFlags(picks);
  const choice = combineChoice(picks);
  const stored = applyCombine({ root: job.root, job, combine: picks });
  writeFinishingRecord({ job, choice, parts: { captions: flags.captions, music: flags.music }, extra: { voice: flags.voice, combine: stored }, by });
  const noTrack = flags.music && !musicTrack(job.dir);
  const waiting = ['music', 'voice'].filter(row => ['upload', 'make'].includes(stored[row].source));
  const steps = combineNextSteps(job, stored);
  const base = {
    recorded: true, choice, captions: flags.captions, music: flags.music, musicTrack: flags.music ? !noTrack : null, transcript: flags.captions ? transcriptSaved(job) : null,
    voice: flags.voice, voiceTrack: flags.voice ? Boolean(voiceTrack(job.dir)) : null, combine: stored, waiting, next: steps,
  };
  const finish = 'run finish-video.py (it mixes the music under the voice-over and draws the captions chosen) and present the rough cut (pipeline_review_present with gate cut).';
  if (waiting.length) {
    return { ...base, message: `Saved. ${waiting.map(row => (row === 'voice' ? 'The voice-over' : 'The music')).join(' and ')} still need${waiting.length === 1 ? 's' : ''} to be uploaded or made before finishing. Never make music or voice any other way. ${steps.join(' ')} Then ${finish}` };
  }
  if (choice === 'skip') {
    return { ...base, message: facts.onscreenPlanned(job) ? 'Saved. Nothing else is added, but the joined video is plain and the post has on-screen text: run finish-video.py now; it draws only that text. Then present the rough cut (pipeline_review_present with gate cut).' : 'Saved. Nothing is added: the joined video is the rough cut as it is, so finish-video.py is not needed. Present the rough cut (pipeline_review_present with gate cut) once the clips are joined.' };
  }
  return { ...base, message: `Saved. ${steps.join(' ')} ${steps.length ? 'Then ' : 'Now '}${finish}`.replace(/\s+/g, ' ') };
}
