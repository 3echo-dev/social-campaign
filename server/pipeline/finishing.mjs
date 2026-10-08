// What to add to the joined video, asked after the person approved it (gate "cut", see board.mjs and facts.MEDIA_REVIEWS).
//
// The Director asks once with pipeline_board_ask (Add captions, Add background music, Both, Skip use as is) and records the
// answer with pipeline_finishing_choice, which writes approvals/finishing.json for the cut as approved. finish-video.py
// reads the same file and refuses to run without it (pipeline/scripts/review_gate.py).
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as facts from './facts.mjs';

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
  if (off.has('captions')) captions = false;
  if (off.has('music')) music = false;
  if (!captions && !music && !off.size) return null;
  const left = text.split(' ').filter(word => word && !FILLER.has(word));
  if (left.length) return null;
  const choice = captions && music ? 'both' : captions ? 'captions' : music ? 'music' : 'skip';
  return { choice, ...FINISHING_CHOICES[choice] };
}

/** The music track named by media/music/choice.json, or null (the same rule finish-video.py uses). */
export function musicTrack(jobDir) {
  const choice = readJson(join(jobDir, 'media', 'music', 'choice.json'));
  if (!choice || choice.source === 'none' || !choice.file) return null;
  return [choice.file, join(jobDir, choice.file), join(jobDir, 'media', 'music', choice.file)].find(path => existsSync(path)) || null;
}

/** Whether a transcript of the approved cut is saved where finish-video.py looks (the workspace's imports/transcripts/<sha256>.json), for the captions. */
export function transcriptSaved(job) {
  const panels = facts.reviewSet(job, 'cut').panels;
  if (!panels.length || !job.root) return null;
  return panels.every(panel => existsSync(join(job.root, 'imports', 'transcripts', `${panel.sha256}.json`)) || existsSync(join(job.dir, 'media', panel.deliverable, 'transcript.json')));
}

export function recordFinishingChoice({ job, choice, by }) {
  const parts = FINISHING_CHOICES[choice];
  if (!parts) throw new Error('Choose captions, music, both or skip.');
  const set = facts.reviewSet(job, 'cut');
  if (!set.panels.length) throw new Error('The clips are not joined yet. Join them with stitch-clips.py, show the joined video (pipeline_review_present with gate cut) and wait for the approval first.');
  if (!facts.mediaSetApproved(job, 'cut')) throw new Error('The person has not approved the joined video yet, so what to add cannot be recorded. Show it (pipeline_review_present with gate cut) and wait for the approval first.');
  mkdirSync(join(job.dir, 'approvals'), { recursive: true });
  const saved = { choice, ...parts, decidedAt: new Date().toISOString(), by: by || 'director', files: set.panels.map(panel => ({ file: panel.file, sha256: panel.sha256 })) };
  const file = join(job.dir, ...FINISHING_FILE.split('/'));
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(saved, null, 2));
  renameSync(temp, file);
  const noTrack = parts.music && !musicTrack(job.dir);
  const transcript = parts.captions ? transcriptSaved(job) : null;
  return {
    recorded: true, choice, captions: parts.captions, music: parts.music, musicTrack: parts.music ? !noTrack : null, transcript,
    message: noTrack
      ? 'Saved. No music track is saved for this job, so finishing will not add music yet. Say so plainly: the plugin has no music maker. Check the shelf with pipeline_music_list; if it is empty, ask the person for a track (a file) or a link to one, add it with pipeline_music_add, then run finish-video.py. Or offer captions only. Never say the video has music until one is added, and never make audio by hand.'
      : choice === 'skip' && !facts.onscreenPlanned(job) ? 'Saved. The joined video is used as it is: do not run finish-video.py.'
        : choice === 'skip' ? 'Saved. Nothing else is added, but the joined video is plain and the post has on-screen text: run finish-video.py now; it draws only that text. Then present the finished video (pipeline_review_present with gate finish).'
        : 'Saved. Run finish-video.py now; it adds only what was chosen and draws the post\'s on-screen text. Captions are built from a transcript of the approved cut when one is saved (media_transcribe on media/D1/final-raw.mp4; transcript_save when the words come from elsewhere), else from the script wording, which you must say is not checked against the speech. Then present the finished video (pipeline_review_present with gate finish).',
  };
}
