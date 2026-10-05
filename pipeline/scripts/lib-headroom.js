'use strict';
// Clip headroom, hook clip only. The first clip in the cut is asked for one second more than
// its beat, and the stitch starts half a second in, so the weak first frames of a generated clip
// never reach the hook. The ask is the clip's durationSeconds, so the quote, the spend guard and
// the create call all carry the same number.
//
//   headroom: { askSec, inSec, useSec }   askSec whole, 4 to 15 = durationSeconds
//                                         inSec  seconds skipped at the start (0.5)
//                                         useSec seconds kept = the beat length
const { CLIP_SECONDS } = require('./lib-deliverable.js');

const IN_SEC = 0.5;
const EXTRA_SEC = 1;

/** The headroom block for a hook beat of `beatSec` seconds. */
function headroomFor(beatSec) {
  const beat = Number(beatSec);
  const askSec = Math.min(CLIP_SECONDS.max, Math.max(CLIP_SECONDS.min, Math.ceil(beat + EXTRA_SEC)));
  return { askSec, inSec: IN_SEC, useSec: Math.min(beat, askSec - IN_SEC) };
}

/** Plain-words problems with one video item's headroom; an empty list means fine or none. */
function headroomProblems(item, isHook) {
  const h = item && item.headroom;
  if (h === undefined || h === null) return [];
  const problems = [];
  if (typeof h !== 'object' || Array.isArray(h)) return ['headroom must be an object with askSec, inSec and useSec'];
  if (!isHook) problems.push('only the first clip in the cut gets headroom');
  const { askSec, inSec, useSec } = h;
  if (!Number.isInteger(askSec) || askSec < CLIP_SECONDS.min || askSec > CLIP_SECONDS.max)
    problems.push('headroom askSec must be a whole number from ' + CLIP_SECONDS.min + ' to ' + CLIP_SECONDS.max + '; this says ' + askSec);
  else if (askSec !== item.durationSeconds)
    problems.push('headroom askSec is ' + askSec + ' but the clip is quoted and generated at ' + item.durationSeconds + ' seconds; they must be the same number');
  if (!Number.isFinite(inSec) || inSec < 0) problems.push('headroom inSec must be zero or more seconds; this says ' + inSec);
  if (!Number.isFinite(useSec) || useSec <= 0) problems.push('headroom useSec must be more than zero seconds; this says ' + useSec);
  if (Number.isFinite(inSec) && Number.isFinite(useSec) && Number.isInteger(askSec) && inSec + useSec > askSec + 1e-6)
    problems.push('headroom starts ' + inSec + ' s in and keeps ' + useSec + ' s, which is more than the ' + askSec + ' s that is generated');
  return problems;
}

module.exports = { IN_SEC, EXTRA_SEC, headroomFor, headroomProblems };
