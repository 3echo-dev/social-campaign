// What to add to the joined video (gate "cut", see board.mjs and facts.MEDIA_REVIEWS).
//
// The board's combine card (combine.mjs) has three rows, music, voice-over and captions, and the approval carries the picks; they
// are written to approvals/finishing.json as `combine`. The older four-way answer (captions, music, both, skip) still works through
// pipeline_finishing_choice and a change note. finish-video.py reads the same file and refuses to run without it
// (pipeline/scripts/review_gate.py).
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as facts from './facts.mjs';
import { renameReplacing } from '../lib/rename.mjs';

export const FINISHING_FILE = 'approvals/finishing.json';
export const FINISHING_CHOICES = Object.freeze({
  captions: Object.freeze({ captions: true, music: false }),
  music: Object.freeze({ captions: false, music: true }),
  both: Object.freeze({ captions: true, music: true }),
  skip: Object.freeze({ captions: false, music: false }),
});

const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** The recorded choice when it was made for the joined video(s) as approved now, else null. */
export const finishingChoice = job => facts.finishingRecord(job);

const FILLER = new Set(['add', 'adding', 'put', 'putting', 'include', 'including', 'with', 'and', 'also', 'plus', 'some', 'please', 'pls', 'a', 'an', 'the', 'to', 'it', 'on', 'in', 'over', 'under', 'video', 'this', 'that', 'too', 'can', 'could', 'you', 'we', 'i', 'want', 'wanna', 'would', 'like', 'need', 'needs', 'use', 'have', 'has', 'get', 'make', 'me', 'then', 'just', 'only', 'for', 'of', 'background', 'soft', 'light', 'nice', 'sound', 'audio', 'both', 'them', 'these', 'those', 'is', 'are', 'be', 'so', 'ok', 'okay', 'yes', 'lets', "let's", 'do', 'should', 'must', 'every', 'all', 'finish', 'finishing', 'finished', 'final', 'version', 'but', 'approve', 'approved', 'good', 'great', 'looks', 'look', 'else', 'rest', 'fine', 'as', 'now', 'next', 'step']);
const CAPTION_WORD = /\b(captions?|subtitles?|subs|closed captions?|cc)\b/g;
const MUSIC_WORD = /\b(music|song|songs|soundtrack|beat|bgm|track|tune|tunes)\b/g;
const NEGATION = /\b(no|without|not|don'?t|dont|skip|never|remove|drop|nothing)\b(?:\s+\w+){0,2}?\s+(captions?|subtitles?|subs|music|song|soundtrack|bgm|track)\b/g;

/**
 * Whether a change note on the joined video only asks for finishing (captions, music, or both) and nothing about the cut itself.
 * Returns { choice, captions, music } for a finishing-only note, else null. Anything left over once the finishing words and plain
 * filler are removed (an order, a trim, a shot, a colour, a length) makes it a real edit note, and the cut is reopened as before.
 */
export function finishingFromNote(note) {
  let text = String(note ?? '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const off = new Set();
  text = text.replace(NEGATION, (all, _no, kind) => { off.add(/^(captions?|subtitles?|subs)$/.test(kind) ? 'captions' : 'music'); return ' '; });
  let captions = false;
  let music = false;
  text = text.replace(CAPTION_WORD, () => { captions = true; return ' '; }).replace(MUSIC_WORD, () => { music = true; return ' '; });
  const touched = { captions: captions || off.has('captions'), music: music || off.has('music') };
  if (off.has('captions')) captions = false;
  if (off.has('music')) music = false;
  if (!captions && !music && !off.size) return null;
  const left = text.split(' ').filter(word => word && !FILLER.has(word));
  if (left.length) return null;
  const choice = captions && music ? 'both' : captions ? 'captions' : music ? 'music' : 'skip';
  // touched: which of the two the note spoke about, so a saved plan keeps what the note did not mention.
  return { choice, ...FINISHING_CHOICES[choice], touched };
}

/** The music track named by media/music/choice.json, or null (the same rule finish-video.py uses). */
export function musicTrack(jobDir) {
  const choice = readJson(join(jobDir, 'media', 'music', 'choice.json'));
  if (!choice || choice.source === 'none' || !choice.file) return null;
  return [choice.file, join(jobDir, choice.file), join(jobDir, 'media', 'music', choice.file)].find(path => existsSync(path)) || null;
}

/** Whether a transcript of the approved cut is saved where finish-video.py looks (the workspace's imports/transcripts/<sha256>.json), for the captions. */
export function transcriptSaved(job) {
  const panels = facts.cutSet(job).panels;
  if (!panels.length || !job.root) return null;
  return panels.every(panel => existsSync(join(job.root, 'imports', 'transcripts', `${panel.sha256}.json`)) || existsSync(join(job.dir, 'media', panel.deliverable, 'transcript.json')));
}

/** Write approvals/finishing.json. The sound can be chosen any time before finishing (before the clips are joined too), so it is not tied to the joined video's files. `extra` carries the combine picks (combine.mjs). */
export function writeFinishingRecord({ job, choice, parts, extra = {}, by }) {
  mkdirSync(join(job.dir, 'approvals'), { recursive: true });
  const saved = { choice, ...parts, ...extra, decidedAt: new Date().toISOString(), by: by || 'director' };
  const file = join(job.dir, ...FINISHING_FILE.split('/'));
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(saved, null, 2));
  renameReplacing(temp, file);
  return saved;
}

export function recordFinishingChoice({ job, choice, by }) {
  const parts = FINISHING_CHOICES[choice];
  if (!parts) throw new Error('Choose captions, music, both or skip.');
  writeFinishingRecord({ job, choice, parts, by });
  const noTrack = parts.music && !musicTrack(job.dir);
  const transcript = parts.captions ? transcriptSaved(job) : null;
  return {
    recorded: true, choice, captions: parts.captions, music: parts.music, musicTrack: parts.music ? !noTrack : null, transcript,
    message: noTrack
      ? 'Saved. No music track is saved for this job, so finishing will not add music yet. Say so plainly: check the library with pipeline_library_list; if it is empty, offer to make music with ElevenLabs (priced, the person clicks the price) or ask for a track (a file), add it with pipeline_music_add, then run finish-video.py. Or offer captions only. Never say the video has music until one is added, and never make audio by hand.'
      : choice === 'skip' && !facts.onscreenPlanned(job) ? 'Saved. Nothing is added: the joined video is the rough cut as it is, so finish-video.py is not needed. Present the rough cut (pipeline_review_present with gate cut) once the clips are joined.'
        : choice === 'skip' ? 'Saved. Nothing else is added, but the joined video is plain and the post has on-screen text: run finish-video.py now; it draws only that text. Then present the rough cut (pipeline_review_present with gate cut).'
        : 'Saved. Run finish-video.py now; it adds only what was chosen and draws the post\'s on-screen text. Captions are built from a transcript of the joined video when one is saved (media_transcribe on media/D1/final-raw.mp4; transcript_save when the words come from elsewhere), else from the script wording, which you must say is not checked against the speech. Then present the rough cut (pipeline_review_present with gate cut).',
  };
}
