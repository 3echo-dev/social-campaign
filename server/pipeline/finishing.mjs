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
export function finishingChoice(job) {
  const saved = readJson(join(job.dir, ...FINISHING_FILE.split('/')));
  if (!saved || !FINISHING_CHOICES[saved.choice] || !facts.mediaSetApproved(job, 'cut') || !Array.isArray(saved.files)) return null;
  const panels = facts.reviewSet(job, 'cut').panels;
  return saved.files.length === panels.length && panels.every(panel => saved.files.some(file => file?.file === panel.file && file.sha256 === panel.sha256)) ? saved : null;
}

/** The music track named by media/music/choice.json, or null (the same rule finish-video.py uses). */
export function musicTrack(jobDir) {
  const choice = readJson(join(jobDir, 'media', 'music', 'choice.json'));
  if (!choice || choice.source === 'none' || !choice.file) return null;
  return [choice.file, join(jobDir, choice.file), join(jobDir, 'media', 'music', choice.file)].find(path => existsSync(path)) || null;
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
  return {
    recorded: true, choice, captions: parts.captions, music: parts.music, musicTrack: parts.music ? !noTrack : null,
    message: noTrack
      ? 'Saved. No music track is saved for this job, so finishing will not add music yet. Tell the person plainly. Music costs credits: price a track first (pipeline_quote_save, then the price approval), or ask for a saved one. Never say the video has music until one is added.'
      : choice === 'skip' ? 'Saved. The joined video is used as it is: do not run finish-video.py.' : 'Saved. Run finish-video.py now; it adds only what was chosen.',
  };
}
