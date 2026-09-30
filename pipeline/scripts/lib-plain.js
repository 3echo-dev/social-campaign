// Everything a person reads in the pane goes through here first.
//
// The pane is read by a client, not by whoever built the pipeline. A concept card once opened
// with "Insight it rests on: `brief.md#angle`", which means nothing to the person deciding,
// and a state id like AWAITING_CONCEPT_APPROVAL is worse: it looks like an error.
const wording = require('./lib-wording.js');

// A file the person will never open: a workspace path, a markdown or json file, an anchor.
const FILE_REF = /`[^`]*\.(?:md|json|jsonl|py|js|png|mp4)(?:#[^`]*)?`|\b[\w./-]+\.(?:md|json|jsonl)(?:#[\w-]+)?\b/gi;
// A word in SHOUTING_SNAKE_CASE, which is always an internal id.
const STATE_ID = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g;
// The bullet that exists to record where a claim came from, not to help anyone choose.
const RECORD_LINE = /^\s*[-*]\s*(insight it rests on|source anchor|provenance|traceability|evidence id)\s*:/i;

function stateToSentence(match) {
  const said = wording.has && wording.has(match) ? wording.sentence(match) : null;
  return said || '';
}

// One line, ready to read. Empty when the line was only a record of where something came from.
function plainLine(line) {
  if (RECORD_LINE.test(line)) return '';
  return line
    .replace(FILE_REF, '')
    .replace(STATE_ID, stateToSentence)
    .replace(/\(\s*\)/g, '')
    // A provenance bullet points at the file it came from. With the file name gone the
    // arrow points at nothing, and the line ends mid-gesture: "the essence she owns ->".
    .replace(/\s*(?:->|→|-->)\s*[,;]?\s*$/, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*:\s*$/, '')
    .trimEnd();
}

// A block of text, ready to read: no file names, no ids, no empty leftovers.
function plain(text) {
  if (!text) return '';
  return String(text)
    .split('\n')
    .map(plainLine)
    .filter((line, i, all) => line.trim() !== '' || (i > 0 && all[i - 1].trim() !== ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// True when something would still read as jargon to a client. Used by the tests, so a new
// card cannot quietly bring the ids back.
function carriesJargon(text) {
  const s = String(text || '');
  return STATE_ID.test(s) || FILE_REF.test(s);
}

// The two patterns are exported so `hooks/lib.mjs` can carry a copy of them: a function hook
// runs in the engine's worker and cannot require a CommonJS script, and a deny reason is read
// by the model, so it has to be as free of file names and ids as a card in the pane is.
// `scripts/test/tables.smoke.js` fails if the copy and this original ever disagree.
module.exports = { plain, plainLine, carriesJargon, FILE_REF, STATE_ID };
