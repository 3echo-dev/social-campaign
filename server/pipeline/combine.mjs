/**
 * The combine step: after the clips are joined, ONE card with three rows says what goes on the joined video.
 *
 *   Music      From your library · Upload a track · Make with ElevenLabs (priced; it may carry a `mood`) · None
 *   Voice-over From your library · Upload your recording · Make with ElevenLabs from the script (priced) · None
 *   Captions   From the voice-over words · From the script words · None (the subtitles; they also take a `style`, word or line)
 *
 * The voice-over "make" pick may carry the ElevenLabs voice the person chose (`voiceId`, `voiceName`), and the music "make" pick the
 * mood (`mood`: warm, upbeat, calm or minimal): recording either never makes anything, both stay priced with the storyboard. The
 * voices on offer are saved by the Director in library/voices.json.
 *
 * A tap on one part of the sound before the sound plan is answered (a word of the brief) is the person's pick for that part only. It is
 * kept apart (approvals/sound-picks.json, finishing.mjs), does not count as the sound plan, and is carried into the plan when it is
 * recorded: the parts the person did not name are never recorded as chosen.
 *
 * The person's picks are saved with the cut approval in approvals/finishing.json (finishing.mjs) as `combine`. A pick from the
 * library is resolved at once into the job (media/music/choice.json, media/voice/choice.json). An upload or a "Make with
 * ElevenLabs" pick waits for the Director: upload through a board question that asks for the file, make after the price click. When
 * ElevenLabs makes several takes they are shown side by side on a board question and the pick is recorded here.
 * finish-video.py then mixes the chosen music (ducked under the voice-over) and voice-over and draws the chosen captions.
 *
 * A voice-over already made and paid for on the job (a take saved from it, a voice that landed under a voice key, or a voice-over
 * chosen from those) is offered free: a "make" pick never asks to price another one. A new one is asked for only when none exists or
 * the pick says `fresh: true`, and then under the next free version of the voice key, never one that was already used.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';

import * as facts from './facts.mjs';
import { ELEVEN_LABS_LICENCE, addToLibrary, findItem, libraryBrands, libraryDir, listLibrary, readAll as readLibraryItems } from './library.mjs';
import { chooseMusic, readChoice as readMusicChoice } from './music.mjs';
import { askQuestion } from './questions.mjs';
import { FINISHING_FILE, SOUND_ROWS, SUGGESTED_MESSAGE, clearSoundPicks, isSuggestion, madeByPerson, musicTrack, readSoundPicks, soundQuestionAnswered, transcriptSaved, writeFinishingRecord, writeSoundPicks } from './finishing.mjs';
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

/** The mood a made music track can be asked for. */
export const MUSIC_MOODS = Object.freeze(['warm', 'upbeat', 'calm', 'minimal']);

/** How the subtitles are cut: one or two words at a time, or whole lines. A look, not a row choice, so the card's labels above stay as they are. */
export const CAPTION_STYLES = Object.freeze([
  Object.freeze({ id: 'word', label: 'Word by word' }),
  Object.freeze({ id: 'line', label: 'One line' }),
]);

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

/** The item names a voice-over is made under (VO1, VO2, ...); music and pictures use other names. */
const VOICE_ITEM = /^VO\d+$/;

/** Every voice key the job has already used, newest version first: a key that was created or landed is spent. */
function usedVoiceKeys(job) {
  const found = new Map();
  for (const entry of [...facts.readRecords(job), ...facts.readLanded(job)]) {
    if (!entry || entry.provider !== facts.ELEVEN_LABS || typeof entry.key !== 'string') continue;
    const parsed = facts.parseJobKey(entry.key);
    if (parsed && VOICE_ITEM.test(parsed.item)) found.set(parsed.key, parsed);
  }
  return [...found.values()].sort((a, b) => b.version - a.version);
}

/** The key a new voice-over is priced and made under: the next free version of VO1, so a spent key is never reused. */
export function nextVoiceKey(job) {
  const used = usedVoiceKeys(job);
  const deliverable = used[0]?.deliverable || 'D1';
  const version = used.reduce((top, entry) => Math.max(top, entry.version), 0) + 1;
  return facts.jobKey({ jobId: job.jobId, deliverable, item: 'VO1', version }) || `${job.jobId}-D1-VO1-v${version}`;
}

/** The files of the newest voice that landed under a voice key (paths relative to the job folder), or null. Landing is the paid result. */
function landedVoice(job) {
  const landed = facts.readLanded(job).filter(entry => entry && entry.type === 'landed' && entry.provider === facts.ELEVEN_LABS && typeof entry.file === 'string' && typeof entry.key === 'string' &&
    existsSync(join(job.dir, ...entry.file.split('/'))));
  const withKey = landed.map(entry => ({ entry, parsed: facts.parseJobKey(entry.key) })).filter(({ parsed }) => parsed && VOICE_ITEM.test(parsed.item));
  if (!withKey.length) return null;
  const newest = Math.max(...withKey.map(({ parsed }) => parsed.version));
  const files = [...new Set(withKey.filter(({ parsed }) => parsed.version === newest).map(({ entry }) => entry.file))];
  return { version: newest, files, sha256: new Set(withKey.map(({ entry }) => entry.sha256).filter(Boolean)) };
}

/** The takes already saved from a made voice-over, with their files present, or []. */
function savedVoiceTakes(job) {
  return takesFor(job, 'voice').filter(take => take && typeof take.label === 'string' && typeof take.file === 'string' && existsSync(join(job.dir, ...take.file.split('/'))));
}

/**
 * The voice-over this job already uses that was made on it: media/voice/choice.json names a library file whose bytes are one of the job's
 * own saved takes or landed voice files. { id, title, take, file } (id and take only when they can be told), or null. A voice-over picked
 * from the library that came from another job, or one the person recorded, is not this.
 */
export function settledMadeVoice(job) {
  const choice = readVoiceChoice(job.dir);
  if (!choice || choice.source !== 'library' || !choice.sha256 || !voiceTrack(job.dir)) return null;
  const own = savedVoiceTakes(job).find(take => take.sha256 === choice.sha256);
  if (!own && !landedVoice(job)?.sha256.has(choice.sha256)) return null;
  const item = (own?.libraryId && findItem({ root: job.root, id: own.libraryId, kind: 'voice' })?.item) || readLibraryItems(job.root).find(entry => entry.kind === 'voice' && entry.sha256 === choice.sha256) || null;
  return { id: item?.id || null, title: choice.title || item?.title || null, take: own?.label || null, file: choice.file };
}

/** What the job already holds of a made voice-over ({ settled, takes, landed }), or null when nothing was made. */
export function madeVoice(job) {
  const settled = settledMadeVoice(job);
  const takes = savedVoiceTakes(job);
  const landed = landedVoice(job);
  return settled || takes.length || landed ? { settled, takes, landed } : null;
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
 * when there is a voice-over or a transcript of the cut, else none. A row the person picked on its own earlier starts on that pick.
 * Nothing here spends anything: making is priced and clicked.
 */
export function combineDefaults(job) {
  const answer = storyboardVoiceOver(job.dir);
  const music = readMusicChoice(job.dir);
  const hasMusic = music && music.source !== 'none' && music.source !== 'pending' && music.file;
  const voiceOn = Boolean(answer?.enabled);
  const transcript = existsSync(join(job.root, 'imports', 'transcripts')) && facts.cutSet(job).panels.some(panel => existsSync(join(job.root, 'imports', 'transcripts', `${panel.sha256}.json`)));
  const started = {
    music: hasMusic ? { source: 'library', id: null, title: music.title || null } : { source: 'none' },
    voice: voiceOn ? { source: 'make' } : { source: 'none' },
    captions: { source: voiceOn || transcript ? 'voice' : 'none' },
  };
  // A row the person already picked (a tap on the brief, before the sound plan was answered) starts on that pick.
  const picks = readSoundPicks(job);
  return { music: picks.music ?? started.music, voice: picks.voice ?? started.voice, captions: picks.captions ?? started.captions };
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

const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VOICE_NAME_LIMIT = 80;

/** The shape (9:16, 4:5, 1:1 or 16:9) the job's first deliverable asks for, or null when it names none. */
export function jobShape(job) {
  const spec = readJson(join(job.dir, 'job.json'));
  const ratios = (Array.isArray(spec?.deliverables) ? spec.deliverables : []).map(item => (Array.isArray(item?.aspectRatios) ? item.aspectRatios[0] : null));
  return ratios.find(ratio => typeof ratio === 'string' && ratio) || null;
}

/** The subtitle look nothing was picked for: word by word on a 9:16 video, one line on every other shape. */
export const defaultCaptionStyle = shape => (shape === '9:16' ? 'word' : 'line');

/** The look the subtitles will have: the style picked, else the shape's default. null when the picks hold no subtitles. */
export function captionStyleOf(job, captions) {
  if (!captions || captions.source === 'none') return null;
  return CAPTION_STYLES.some(style => style.id === captions.style) ? captions.style : defaultCaptionStyle(jobShape(job));
}

/** The picks already recorded for the job (a suggestion made before the person answered does not count), or {}. */
const recordedCombine = job => { const picks = facts.finishingRecord(job)?.combine; return picks && typeof picks === 'object' && !Array.isArray(picks) ? picks : {}; };

/** What a row keeps of the pick recorded before it when the new pick does not name it: the subtitle style, the music mood, the ElevenLabs voice. */
function carried(kept, row) {
  if (!kept || typeof kept !== 'object') return {};
  if (row === 'captions') return kept.source !== 'none' && CAPTION_STYLES.some(style => style.id === kept.style) ? { style: kept.style } : {};
  if (row === 'music') return kept.source === 'make' && MUSIC_MOODS.includes(kept.mood) ? { mood: kept.mood } : {};
  return kept.source === 'make' && kept.voiceId ? { voiceId: kept.voiceId, ...(kept.voiceName ? { voiceName: kept.voiceName } : {}) } : {};
}

const hasText = value => value !== undefined && value !== null && value !== '';
const isPlain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** `style` of a subtitles pick: absent stays absent (the shape decides), word or line is kept, anything else is refused. */
function captionFields(given) {
  const style = typeof given === 'object' ? given.style : undefined;
  if (style === undefined || style === null || style === '') return {};
  if (!CAPTION_STYLES.some(entry => entry.id === style)) throw new Error('Pick word by word or one line for the subtitles.');
  return { style };
}

/** `mood` of a "make with ElevenLabs" music pick: absent stays absent, warm, upbeat, calm or minimal is kept, anything else is refused. */
function musicFields(given) {
  const mood = typeof given === 'object' ? given.mood : undefined;
  if (mood === undefined || mood === null || mood === '') return {};
  if (!MUSIC_MOODS.includes(mood)) throw new Error(`Pick ${MUSIC_MOODS.slice(0, -1).join(', ')} or ${MUSIC_MOODS.at(-1)} for the music mood.`);
  return { mood };
}

/** `voiceId` and `voiceName` of a "make with ElevenLabs" voice-over pick: both absent, or an id as the voice list gave it with an optional name. */
function voiceFields(given) {
  if (typeof given !== 'object' || (given.voiceId === undefined && given.voiceName === undefined)) return {};
  const id = typeof given.voiceId === 'string' ? given.voiceId.trim() : '';
  if (!VOICE_ID.test(id)) throw new Error('Give the voice id exactly as the voice list returned it, along with the voice name.');
  if (given.voiceName === undefined || given.voiceName === null || given.voiceName === '') return { voiceId: id };
  if (typeof given.voiceName !== 'string') throw new Error('The voice name must be text.');
  const name = given.voiceName.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length > VOICE_NAME_LIMIT) throw new Error(`Keep the voice name under ${VOICE_NAME_LIMIT} characters.`);
  return name ? { voiceId: id, voiceName: name } : { voiceId: id };
}

/**
 * A row given without its source changes only the fields it names, on the pick kept before it. A field that has no meaning on that
 * pick takes the source it needs, so it is never dropped silently: a subtitle style over no subtitles turns them on (from the
 * voice-over words when the video has a voice-over, else from the script words), a music mood over any other music asks for a made
 * track, and an ElevenLabs voice over any other voice-over asks for a made one.
 */
function mergedRow(row, kept, given, hasVoiceOver) {
  const merged = { ...kept, ...given };
  if (row === 'captions' && hasText(given.style) && merged.source === 'none') return { ...merged, source: hasVoiceOver ? 'voice' : 'script' };
  if (row === 'voice' && (hasText(given.voiceId) || hasText(given.voiceName)) && merged.source !== 'make') return { source: 'make', voiceId: given.voiceId, voiceName: given.voiceName, ...(given.fresh === true ? { fresh: true } : {}) };
  if (row === 'voice' && given.fresh === true && merged.source !== 'make') return { source: 'make', fresh: true };
  if (row === 'music' && hasText(given.mood) && merged.source !== 'make') return { source: 'make', mood: given.mood };
  return merged;
}

/**
 * A voice-over "make" pick, whole. It keeps the voice named (or the one kept before) and the take already chosen for it: the chosen
 * take's id, title and label stay through every later recording, so recording the card again never sends the voice back to waiting.
 * A voice-over this job already made and settled is picked up the same way when the record lost it. `fresh: true` asks for a new one:
 * it drops the chosen take and the pick waits for a new voice (priced, under the next free key). Naming a different voice than the one
 * made is a request for a new one too.
 */
function voiceMakePick({ root, job, kept, given }) {
  const named = voiceFields(given);
  const keptMake = isPlain(kept) && kept.source === 'make' ? kept : null;
  const sameVoice = !named.voiceId || (Boolean(keptMake?.voiceId) && named.voiceId === keptMake.voiceId);
  const asked = isPlain(given) && given.fresh !== undefined ? given.fresh === true : Boolean(keptMake?.fresh && !keptMake.id);
  const out = { source: 'make', ...(named.voiceId ? named : carried(kept, 'voice')) };
  if (asked || (named.voiceId && keptMake?.id && !sameVoice)) return { ...out, fresh: true };
  const takeOf = entry => ({ id: entry.id, ...(entry.title ? { title: entry.title } : {}), ...(entry.take ? { take: entry.take } : {}) });
  if (sameVoice && keptMake?.id && findItem({ root, id: keptMake.id, kind: 'voice' })) return { ...out, ...takeOf(keptMake) };
  const settled = sameVoice ? settledMadeVoice(job) : null;
  return settled?.id ? { ...out, ...takeOf(settled) } : out;
}

/**
 * A combine object checked and cleaned, with library ids that must exist. A row left out keeps what is recorded for the job (the
 * person's own earlier pick of that row, else the defaults, when nothing is), and a row given without its source changes only the
 * fields it names, so one pick never undoes another. `rows` limits the result to those rows (a pick of one part on its own).
 * Throws a plain message.
 */
export function normaliseCombine({ root, job, combine, rows = SOUND_ROWS }) {
  if (!combine || typeof combine !== 'object' || Array.isArray(combine)) throw new Error('Pick what to add for music, voice-over and captions.');
  const defaults = combineDefaults(job);
  const recorded = recordedCombine(job);
  const out = {};
  // Whether the video has a voice-over once these picks are in: the voice row as given here, else as kept.
  const hasVoiceOver = () => {
    const kept = recorded.voice ?? defaults.voice;
    const now = combine.voice === undefined ? kept : typeof combine.voice === 'string' ? { source: combine.voice } : isPlain(combine.voice) ? mergedRow('voice', kept, combine.voice, false) : kept;
    return now?.source !== 'none';
  };
  for (const row of SOUND_ROWS.filter(name => rows.includes(name))) {
    const kept = recorded[row] ?? defaults[row];
    let given = combine[row] === undefined ? kept : combine[row];
    if (isPlain(given) && given.source === undefined) given = mergedRow(row, kept, given, row === 'captions' && hasVoiceOver());
    const source = typeof given === 'string' ? given : given?.source;
    if (!SOURCES[row].includes(source)) throw new Error(`Pick one of: ${COMBINE_ROWS[row].map(option => option.label).join(', ')} for ${row === 'voice' ? 'the voice-over' : row === 'captions' ? 'the subtitles' : row}.`);
    if (row === 'captions') { out[row] = source === 'none' ? { source } : { source, ...carried(kept, 'captions'), ...captionFields(given) }; continue; }
    if (source === 'make' && row === 'voice') { out[row] = voiceMakePick({ root, job, kept, given }); continue; }
    if (source === 'make' && row === 'music') { const named = musicFields(given); out[row] = { source, ...(named.mood ? named : carried(kept, 'music')) }; continue; }
    if (source === 'none' || source === 'upload' || source === 'make') { out[row] = { source }; continue; }
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
  else if (combine.voice.source === 'make' && combine.voice.id) { const picked = chooseVoice({ root, job, id: combine.voice.id, why }); stored.voice = { ...combine.voice, title: picked.title }; }
  else if (combine.voice.source === 'library') { const picked = chooseVoice({ root, job, id: combine.voice.id, why }); stored.voice = { ...combine.voice, title: picked.title }; }
  else chooseVoice({ root, job, id: 'pending', why });
  return stored;
}

/**
 * The Director's step for a "make with ElevenLabs" voice-over, or null when nothing is left to do (a made voice-over is chosen already).
 * A voice-over already made and paid for on the job is saved or chosen for free; only a pick with `fresh` true, or a job where none was
 * made, is priced, under the next free voice key.
 */
function voiceMakeStep(job, voice) {
  if (!voice.fresh) {
    if (voice.id) return null;
    const made = madeVoice(job);
    if (made?.settled) return null;
    const newOne = ' If the person asks for a new voice-over instead, record the voice row again with fresh true.';
    if (made?.takes.length) return `Voice-over: a voice-over was already made and paid for on this job and its takes are saved (${made.takes.map(take => take.label).join(', ')}). Do not price or make another. Once the person has picked one, record it with pipeline_combine_set {row: "voice", source: "make", take: "<label>"}; a take question may still be open on the board.${newOne}`;
    if (made?.landed) return `Voice-over: a voice-over was already made and paid for on this job (${made.landed.files.join(', ')}). Do not price or make another. Save it with pipeline_combine_takes {kind: "voice", files: [${made.landed.files.map(file => `"${file}"`).join(', ')}]}, which costs nothing and shows the takes side by side when there are several.${newOne}`;
  }
  const picked = voice.voiceId ? ` Use the voice the person picked${voice.voiceName ? `, ${voice.voiceName}` : ''}, as voice_id ${voice.voiceId}; it is recorded already, so do not pick another.` : '';
  return `Voice-over: price the script read aloud with creative_generate_speech (estimate_only true, generations_count 2 or 3 so the person gets takes to pick from), save a voice price item {provider elevenLabs, kind voice, key ${nextVoiceKey(job)}, generationsCount} with pipeline_quote_save; the person clicks the price on the board.${picked} After the approval make it, then pipeline_combine_takes {kind: "voice", files}, which shows the takes side by side.`;
}

/** What is still to do after the picks, as plain steps for the Director (and whether anything is). */
export function combineNextSteps(job, combine) {
  const steps = [];
  const code = job.jobId;
  if (combine.music.source === 'upload') steps.push('Music: ask the person for the track with pipeline_board_ask (wantsUpload type audio), then pipeline_combine_set {row: "music", source: "upload", path}.');
  if (combine.music.source === 'make') steps.push(`Music: price it (creative_generate_in_flow with node_type "music", an eleven_music model, a prompt from the brief${combine.music.mood ? ` in a ${combine.music.mood} mood` : ''} and estimate_only true, generations_count 1), save one price item {provider elevenLabs, kind music, key ${code}-D1-M1-v1, the estimateId} with pipeline_quote_save and show the price: the person must click it on the board. Only after the approval make it with the same call without estimate_only, then pipeline_combine_takes {kind: "music", files}. Never make music any other way.`);
  if (combine.voice.source === 'upload') steps.push('Voice-over: ask the person for the recording with pipeline_board_ask (wantsUpload type audio), then pipeline_combine_set {row: "voice", source: "upload", path}.');
  if (combine.voice.source === 'make') { const step = voiceMakeStep(job, combine.voice); if (step) steps.push(step); }
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
  const before = combine[row];
  let message = '';
  if (row === 'captions') {
    combine.captions = { source, ...(source === 'none' ? {} : carried(before, 'captions')) };
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
      // A voice-over this job already made and chose stays in use unless the person asked for a new one.
      const settled = row === 'voice' && !take && !before?.fresh ? settledMadeVoice(job) : null;
      if (settled?.id) { combine[row] = { source, id: settled.id, ...(settled.title ? { title: settled.title } : {}), ...(settled.take ? { take: settled.take } : {}), ...carried(before, row) }; message = 'The voice-over already made is in use.'; }
      else if (!take) { if (row === 'music') pendingMusic(job, why); else chooseVoice({ root, job, id: 'pending', why }); combine[row] = { source, ...carried(before, row), ...(row === 'voice' && before?.fresh ? { fresh: true } : {}) }; message = 'Waiting for ElevenLabs to make it.'; }
      else {
        const found = takesFor(job, kind).find(entry => entry.label.toLowerCase() === String(take).trim().toLowerCase());
        if (!found) throw new Error(`There is no ${take} for the ${row === 'voice' ? 'voice-over' : 'music'}. The takes are: ${takesFor(job, kind).map(entry => entry.label).join(', ') || 'none yet'}.`);
        const picked = choose(found.libraryId);
        combine[row] = { source, id: found.libraryId, title: picked.title, take: found.label, ...carried(before, row) };
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
    const { item } = await addToLibrary({ root, kind, path: join(dir, name), brand: job.brand, title: `${kind === 'voice' ? 'Voice-over' : 'Music'} ${label}`, licence: ELEVEN_LABS_LICENCE, origin: 'elevenlabs', addedFrom: `job:${job.jobId}` });
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

/**
 * What a saved price has to change to follow these picks: the voice-over or music lines it holds that the plan no longer makes ("drop"),
 * and the rows the plan makes that it does not price yet ("missing"). Both empty when there is no saved price yet.
 */
export function soundPriceGaps(job, combine) {
  const saved = facts.readQuote(job);
  const out = { drop: [], missing: [] };
  if (!saved) return out;
  for (const kind of ['music', 'voice']) {
    const lines = saved.quote.items.filter(item => item && item.provider === facts.ELEVEN_LABS && item.kind === kind);
    // A voice-over already made and paid for needs no new price line; a fresh one does.
    const have = kind === 'voice' && combine.voice?.source === 'make' && !combine.voice.fresh && (Boolean(combine.voice.id) || Boolean(madeVoice(job)));
    if (combine[kind]?.source === 'make') { if (!lines.length && !have) out.missing.push(kind); } else out.drop.push(...lines.map(item => item.key));
  }
  return out;
}

function repriceWords({ drop, missing }) {
  const parts = [];
  if (drop.length) parts.push(`take ${drop.join(', ')} out of the saved price (pipeline_quote_save with drop)`);
  if (missing.length) parts.push(`price the ${missing.map(kind => (kind === 'voice' ? 'voice-over' : 'music')).join(' and ')} (pipeline_quote_save)`);
  return parts.length ? `The saved price does not follow this plan yet: ${parts.join(', and ')}. Then present the storyboard again.` : '';
}

// ---------------------------------------------------------------- recording the card's picks with the cut approval
const ROW_WORDS = Object.freeze({ music: 'the music', voice: 'the voice-over', captions: 'the subtitles' });
const listed = words => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]);

/**
 * Whether these picks are one or two parts of the sound, tapped on their own by the person before the sound plan was answered. Such a
 * pick is the person's word for the parts it names and nothing more: the plan is not recorded, so the parts it leaves out are not
 * chosen as "none" and the storyboard price keeps waiting for the answer. Not partial: a plan that already counts (a pick then changes
 * only its row), the Director's own plan, a pick that names every part, a plan recorded after the person answered the sound plan
 * question, and any pick once the clips are joined (the rough cut's approval records the whole card).
 */
function isPartialPick({ job, combine, by }) {
  if (!madeByPerson(by) || !combine || typeof combine !== 'object' || Array.isArray(combine)) return false;
  const named = SOUND_ROWS.filter(row => combine[row] !== undefined);
  if (!named.length || named.length === SOUND_ROWS.length) return false;
  if (facts.finishingRecord(job) || facts.cutSet(job).panels.length) return false;
  return !soundQuestionAnswered(job);
}

/** Keep the person's pick of some parts of the sound, apart from the plan; the plan they answer later carries it. */
function recordPartialPick({ job, combine, by }) {
  const named = SOUND_ROWS.filter(row => combine[row] !== undefined);
  const picked = normaliseCombine({ root: job.root, job, combine, rows: named });
  for (const row of named) {
    if (picked[row].source !== 'library') continue;
    const found = findItem({ root: job.root, id: picked[row].id, kind: row === 'voice' ? 'voice' : 'music' });
    if (found?.item?.title) picked[row] = { ...picked[row], title: found.item.title };
  }
  const kept = { ...readSoundPicks(job), ...picked };
  writeSoundPicks({ job, picks: kept, by });
  return {
    recorded: true, partial: true, combine: kept, captionStyle: kept.captions ? captionStyleOf(job, kept.captions) : null, waiting: [], next: [],
    message: `Saved as the person's pick for ${listed(named.map(row => ROW_WORDS[row]))} only. It is not the sound plan: ${listed(SOUND_ROWS.filter(row => !named.includes(row)).map(row => ROW_WORDS[row]))} stay${SOUND_ROWS.length - named.length === 1 ? 's' : ''} open, nothing is priced from it, and the storyboard price still waits for the sound plan answer. When the person answers, record the whole plan with pipeline_finishing_choice and this pick is kept for any part the answer leaves as it is. Nothing was made or bought.`,
  };
}

/** A person's plan that a Director's suggestion is about to replace: its parts are kept as the person's own picks, so the suggestion cannot undo them. */
function keepPersonsPlan(job) {
  const counted = facts.finishingRecord(job);
  if (!counted || !madeByPerson(counted.by) || !isPlain(counted.combine)) return;
  const rows = Object.fromEntries(SOUND_ROWS.filter(row => isPlain(counted.combine[row])).map(row => [row, counted.combine[row]]));
  if (Object.keys(rows).length) writeSoundPicks({ job, picks: { ...rows, ...readSoundPicks(job) }, by: counted.by });
}

/**
 * Record the combine card's picks (from the board approval, or pipeline_finishing_choice with combine). A pick of some parts on their
 * own, before the sound plan is answered, is only kept as the person's pick (recordPartialPick); a plan that counts takes those picks
 * with it, and a Director's suggestion never undoes them.
 */
export function recordCombine({ job, combine, by }) {
  if (isPartialPick({ job, combine, by })) return recordPartialPick({ job, combine, by });
  if (isSuggestion({ job, by })) keepPersonsPlan(job);
  const picks = normaliseCombine({ root: job.root, job, combine });
  const flags = combineFlags(picks);
  const choice = combineChoice(picks);
  const stored = applyCombine({ root: job.root, job, combine: picks });
  const { suggested } = writeFinishingRecord({ job, choice, parts: { captions: flags.captions, music: flags.music }, extra: { voice: flags.voice, combine: stored }, by });
  if (!suggested) clearSoundPicks(job);
  const noTrack = flags.music && !musicTrack(job.dir);
  const waiting = ['music', 'voice'].filter(row => ['upload', 'make'].includes(stored[row].source) && !stored[row].id);
  const steps = combineNextSteps(job, stored);
  const base = {
    recorded: true, choice, captions: flags.captions, music: flags.music, musicTrack: flags.music ? !noTrack : null, transcript: flags.captions ? transcriptSaved(job) : null,
    voice: flags.voice, voiceTrack: flags.voice ? Boolean(voiceTrack(job.dir)) : null, captionStyle: captionStyleOf(job, stored.captions), combine: stored, waiting, next: steps,
    ...(suggested ? { suggested: true } : {}),
  };
  if (suggested) return { ...base, message: SUGGESTED_MESSAGE };
  const reprice = repriceWords(soundPriceGaps(job, stored));
  const finish ='run finish-video.py (it mixes the music under the voice-over and draws the captions chosen) and present the rough cut (pipeline_review_present with gate cut).';
  if (waiting.length) {
    return { ...base, message: `Saved. ${waiting.map(row => (row === 'voice' ? 'The voice-over' : 'The music')).join(' and ')} still need${waiting.length === 1 ? 's' : ''} to be uploaded or made before finishing. Never make music or voice any other way. ${steps.join(' ')} ${reprice} Then ${finish}`.replace(/\s+/g, ' ') };
  }
  if (choice === 'skip') {
    const nothing = facts.onscreenPlanned(job) ? 'Saved. Nothing else is added, but the joined video is plain and the post has on-screen text: run finish-video.py now; it draws only that text. Then present the rough cut (pipeline_review_present with gate cut).' : 'Saved. Nothing is added: the joined video is the rough cut as it is, so finish-video.py is not needed. Present the rough cut (pipeline_review_present with gate cut) once the clips are joined.';
    return { ...base, message: `${nothing} ${reprice}`.trim() };
  }
  return { ...base, message: `Saved. ${steps.join(' ')} ${reprice} ${steps.length || reprice ? 'Then ' : 'Now '}${finish}`.replace(/\s+/g, ' ') };
}

// ---------------------------------------------------------------- the voices the Director listed, for the board's voice picker
export const VOICE_CATALOG_LIMIT = 50;
const VOICE_LINE_LIMIT = 140;
const PREVIEW_LIMIT = 600;

/** `<workspace>/library/voices.json`: the last list of ElevenLabs voices the Director saved, a plain array of { id, name, line, previewUrl }. */
export const voiceCatalogFile = root => join(libraryDir(root), 'voices.json');

const oneLine = value => String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

function previewLink(value, at) {
  if (value === undefined || value === null || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : '';
  let url = null;
  try { url = new URL(text); } catch { /* refused below */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || text.length > PREVIEW_LIMIT) throw new Error(`${at}: the preview must be a plain https link, or left out.`);
  return text;
}

/**
 * Keep the Director's latest list of ElevenLabs voices (from creative_list_voices) where the board can read it. The whole file is replaced
 * each time. Each voice is { id, name, line?, previewUrl? }; a list that is not usable is refused and the saved one stays as it is.
 * Saving a list never makes or buys anything: previews are free and the voice-over is priced with the storyboard.
 */
export function saveVoiceCatalog({ root, voices }) {
  if (!Array.isArray(voices)) throw new Error('Give the list of voices to save.');
  if (!voices.length) throw new Error('That list has no voices, so the saved list was kept as it is.');
  if (voices.length > VOICE_CATALOG_LIMIT) throw new Error(`Save at most ${VOICE_CATALOG_LIMIT} voices at a time: keep the closest matches.`);
  const seen = new Set();
  const list = [];
  voices.forEach((voice, index) => {
    const at = `Voice ${index + 1}`;
    if (!voice || typeof voice !== 'object' || Array.isArray(voice)) throw new Error(`${at} needs an id and a name.`);
    const id = typeof voice.id === 'string' ? voice.id.trim() : '';
    if (!VOICE_ID.test(id)) throw new Error(`${at}: give the voice id exactly as the voice list returned it.`);
    if (typeof voice.name !== 'string' || !oneLine(voice.name)) throw new Error(`${at} needs a name.`);
    const name = oneLine(voice.name);
    if (name.length > VOICE_NAME_LIMIT) throw new Error(`${at}: keep the name under ${VOICE_NAME_LIMIT} characters.`);
    if (voice.line !== undefined && voice.line !== null && typeof voice.line !== 'string') throw new Error(`${at}: the line must be text.`);
    const line = oneLine(voice.line ?? '');
    const previewUrl = previewLink(voice.previewUrl, at);
    if (seen.has(id)) return;
    seen.add(id);
    list.push({ id, name, line: line.length > VOICE_LINE_LIMIT ? `${line.slice(0, VOICE_LINE_LIMIT - 1).trimEnd()}\u2026` : line, previewUrl });
  });
  writeJson(voiceCatalogFile(root), list);
  return { saved: list.length, duplicatesLeftOut: voices.length - list.length, file: 'library/voices.json', message: `Saved ${list.length} voice${list.length === 1 ? '' : 's'} for the board's voice picker. Nothing was made or bought: previews are free and the voice-over is priced with the storyboard.` };
}

/** The saved voice list, [] when none was saved yet. */
export function readVoiceCatalog(root) {
  const list = readJson(voiceCatalogFile(root));
  return (Array.isArray(list) ? list : []).filter(voice => voice && typeof voice === 'object' && typeof voice.id === 'string' && voice.id && typeof voice.name === 'string' && voice.name)
    .map(voice => ({ id: voice.id, name: voice.name, line: typeof voice.line === 'string' ? voice.line : '', previewUrl: typeof voice.previewUrl === 'string' && voice.previewUrl ? voice.previewUrl : null }));
}
