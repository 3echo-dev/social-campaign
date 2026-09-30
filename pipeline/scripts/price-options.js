#!/usr/bin/env node
// Build the credit question when the quote overshoots the budget, out of real re-quotes.
//
//   node price-options.js <brand> <job-id> <D> --quotes quotes.json --out .pane/q-quote-D1.json
//
// A real run quoted 91 credits for five clips against a 30-credit ceiling and offered, second
// on the list, "just the five frames". Dropping the video is the last resort, not the second
// option, and one of the options it did offer showed a number that was not the sum of its
// parts. So this script builds the question instead of a run writing it by hand, and refuses
// unless every way of KEEPING the video comes first, each with its own number straight off
// estimate_video_job, and every number equals the parts under it.
//
// quotes.json, written from the tool results, never from memory:
//   {
//     "imagesAlreadySpent": false,
//     "images": [{ "panel": "P1", "credits": 1, "quoteVersion": "..." }],
//     "plans": [
//       { "lever": "as-boarded",        "clips": [{ "panel": "P1", "durationSeconds": 4,
//           "resolution": "720p", "generateAudio": true, "credits": 15, "quoteVersion": "..." }] },
//       { "lever": "lower-resolution",  "clips": [...] },
//       { "lever": "fewer-clips",       "clips": [...] },
//       { "lever": "stills-only",       "clips": [] }
//     ]
//   }
//
// Levers that keep the video: as-boarded (the whole plan), fewer-clips, shorter-clips,
// no-audio, lower-resolution. stills-only drops it, so it is always last and always says out
// loud that it changes what the job delivers.
//
// Exit 0 written · 1 refused · 2 usage
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const del = require('./lib-deliverable.js');
const execution = require('./lib-execution-availability.js');

const KEEPS_VIDEO = ['as-boarded', 'fewer-clips', 'shorter-clips', 'no-audio', 'lower-resolution'];
const TRIMS = ['fewer-clips', 'shorter-clips', 'no-audio', 'lower-resolution'];
const ALL_LEVERS = KEEPS_VIDEO.concat(['stills-only']);

// Wording. docs/SHARED-RULES.md: no file names, no ids, no jargon, in the pane or the chat.
const LABEL = {
  'as-boarded': n => 'Make the video as planned, ' + n + ' credits',
  'raise-ceiling': n => 'Make the video as planned and raise this job to ' + n + ' credits',
  'fewer-clips': n => 'Make the video with fewer moments, ' + n + ' credits',
  'shorter-clips': n => 'Make the video with quicker moments, ' + n + ' credits',
  'no-audio': n => 'Make the video without generated sound, ' + n + ' credits',
  'lower-resolution': n => 'Make the video at a softer picture quality, ' + n + ' credits',
  'stills-only': n => 'Drop the video and keep still pictures instead, ' + n + ' credits',
};
// Local so a stateful global regex somewhere else cannot make this answer differently twice.
const JARGON = [/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/, /\b[\w./-]+\.(?:md|json|jsonl|png|mp4)\b/i, /\bD\d+\b/, /\bP\d+\b/];
const jargon = s => JARGON.some(r => r.test(String(s || '')));

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const { brand, jobId: job, dir, rest } = ws.resolveJobArgs(argv, argv);
const D = rest[0];
const quotesPath = opt('--quotes');
const outPath = opt('--out');
if (!brand || !job || !D || !quotesPath || !outPath) {
  console.error('usage: price-options.js <brand> <job-id> <D> --quotes quotes.json --out question.json');
  process.exit(2);
}
const availability = execution.checkJobDirectory(dir, { requireJob: true });
if (!availability.available) {
  console.error('UNSUPPORTED: ' + availability.message);
  process.exit(4);
}

const refusals = [];
const refuse = m => refusals.push(m);

let quotes;
try { quotes = JSON.parse(fs.readFileSync(quotesPath, 'utf8')); }
catch (e) { console.error('The quotes are not readable JSON: ' + e.message); process.exit(2); }

let jobSpec = {};
try { jobSpec = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')); } catch {}
const minSeconds = del.plannedMinSeconds(jobSpec, D);

// There is no preset budget any more. The estimate says what each way costs and the person
// decides, which is the only guard that ever mattered: nothing is made without an explicit
// yes. A fixed ceiling turned a 91-credit quote into a dead end instead of a decision.
// A figure can still be passed, and then the options say which ones sit inside it.
const ceilingValue = opt('--ceiling');
const ceiling = ceilingValue === null ? null : Number(ceilingValue);
const hasCeiling = ceiling !== null && Number.isFinite(ceiling) && ceiling >= 0;
if (ceilingValue !== null && !hasCeiling) { console.error('The budget must be a non-negative credit amount.'); process.exit(2); }

// A number nobody got from the tool is a guess, and a guess is what put 6 credits next to an
// 8-credit option in a real run.
function quoted(part, where) {
  const c = part && part.credits;
  if (!Number.isInteger(c) || c < 0) { refuse(where + ' has no credit figure from the estimate tool'); return 0; }
  if (!part.quoteVersion) refuse(where + ' carries no quote version, so it did not come from an estimate call');
  if (part.expiresAt !== undefined && (!Number.isFinite(Date.parse(part.expiresAt)) || Date.parse(part.expiresAt) <= Date.now()))
    refuse(where + ' has an expired or invalid quote expiry; request a fresh estimate');
  return c;
}

const images = Array.isArray(quotes.images) ? quotes.images : [];
const imagesTotal = images.reduce((n, im, i) => n + quoted(im, 'still frame ' + (i + 1)), 0);
const imagesCounted = quotes.imagesAlreadySpent ? 0 : imagesTotal;

const plans = Array.isArray(quotes.plans) ? quotes.plans : [];
if (!plans.length) { console.error('REFUSED: no priced options were given, so there is nothing to ask.'); process.exit(1); }

const priced = plans.map((p, idx) => {
  const lever = String(p.lever || p.id || '');
  const where = 'option ' + (idx + 1) + (lever ? ' (' + lever + ')' : '');
  if (!ALL_LEVERS.includes(lever)) refuse(where + ' is not one of ' + ALL_LEVERS.join(', '));
  const clips = Array.isArray(p.clips) ? p.clips : [];
  let clipTotal = 0, seconds = 0;
  clips.forEach((c, i) => {
    clipTotal += quoted(c, where + ' clip ' + (i + 1));
    const d = Number(c.durationSeconds);
    if (!Number.isInteger(d) || d < del.CLIP_SECONDS.min || d > del.CLIP_SECONDS.max)
      refuse(where + ' clip ' + (i + 1) + ' is ' + c.durationSeconds + ' seconds; a clip is a whole ' +
        del.CLIP_SECONDS.min + ' to ' + del.CLIP_SECONDS.max + ' seconds');
    else seconds += d;
  });
  const total = imagesCounted + clipTotal;
  // The one arithmetic check that matters: what the person is shown equals the parts under it.
  if (p.credits !== undefined && Number(p.credits) !== total)
    refuse(where + ' says ' + p.credits + ' credits, and its parts add up to ' + total +
      ' (' + imagesCounted + ' for the still frames and ' + clipTotal + ' for the clips)');
  const keepsVideo = clips.length > 0;
  if (keepsVideo && minSeconds !== null && seconds < minSeconds)
    refuse(where + ' comes to ' + seconds + ' seconds, and this job asked for at least ' + minSeconds);
  if (!keepsVideo && lever !== 'stills-only') refuse(where + ' has no clips, so it does not keep the video');
  if (keepsVideo && lever === 'stills-only') refuse('the stills-only option must have no clips');
  return { lever, keepsVideo, clips: clips.length, seconds, clipTotal, imagesCounted, total,
    label: p.label || null, hint: p.hint || null };
});

const levers = priced.map(p => p.lever);
const boarded = priced.find(p => p.lever === 'as-boarded');
if (!boarded) refuse('the full plan is not among the options, so nobody is being offered the video they asked for');
const trims = TRIMS.filter(l => levers.includes(l));
if (trims.length < 2)
  refuse('only ' + trims.length + ' way(s) of trimming the video were priced; price at least two of ' + TRIMS.join(', ') +
    ' before asking, because dropping the video is the last option and not the second');
if (!priced.some(p => p.keepsVideo)) refuse('no option keeps the video');

if (refusals.length) {
  console.error('REFUSED: this question is not ready to ask.');
  for (const r of refusals) console.error('  x ' + r);
  process.exit(1);
}

// Cheapest first among the ways that keep the video, then the one that gives it up.
const rank = p => (p.keepsVideo ? (hasCeiling && p.total > ceiling ? 1 : 0) : 2);
const ordered = priced.slice().sort((a, b) => (rank(a) - rank(b)) || (a.total - b.total));

if (!ordered[0].keepsVideo) {
  console.error('REFUSED: the first option offered gives the video up. Price a way to keep it first.');
  process.exit(1);
}
const stills = ordered.filter(p => p.lever === 'stills-only');
if (stills.length && ordered[ordered.length - 1].lever !== 'stills-only') {
  console.error('REFUSED: dropping the video has to be the last option on the list.');
  process.exit(1);
}

const options = ordered.map(p => {
  const overBudget = hasCeiling && p.keepsVideo && p.total > ceiling;
  const key = p.lever === 'as-boarded' && overBudget ? 'raise-ceiling' : p.lever;
  const label = p.label || LABEL[key](p.total);
  let hint = p.hint;
  if (!hint) {
    if (p.keepsVideo) {
      hint = p.clips + ' moving shots, ' + p.seconds + ' seconds in all' +
        (p.imagesCounted ? ', with the still frames included' : '') + '.' +
        (hasCeiling ? (overBudget ? ' More than the ' + ceiling + ' you had in mind.'
                                  : ' Inside the ' + ceiling + ' you had in mind.') : '');
    } else {
      hint = 'No video is made. This changes what this job delivers, so it only happens because you said so.';
    }
  }
  if (jargon(label) || jargon(hint))
    { console.error('REFUSED: an option reads like a file name or an id: ' + label + ' / ' + hint); process.exit(1); }
  return { id: p.lever, label, hint };
});

const text = 'The real price came back. ' +
  (quotes.imagesAlreadySpent ? 'The still frames are already made. ' : '') +
  'Making the video the way we planned it costs ' + boarded.total + ' credits' +
  (hasCeiling ? ', against the ' + ceiling + ' you had in mind' : '') +
  '. Here is every way to get it, cheapest first, and what each one costs. ' +
  'Nothing is made until you pick one.';

const question = [{
  id: 'quote',
  text,
  kind: 'single',
  options,
  placeholder: 'Anything else you want to say?',
}];
if (jargon(text)) { console.error('REFUSED: the question reads like an id or a file name.'); process.exit(1); }

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(question, null, 2) + '\n');

const breakdownPath = opt('--breakdown') || path.join(dir, 'drafts', D, 'quote.json');
fs.mkdirSync(path.dirname(breakdownPath), { recursive: true });
fs.writeFileSync(breakdownPath, JSON.stringify({
  schemaVersion: '1.0', jobId: job, brand, deliverable: D,
  quotedAt: ws.now(brand, argv), ...(hasCeiling ? { ceiling } : {}), minSeconds,
  stillFrames: { count: images.length, credits: imagesTotal, alreadySpent: Boolean(quotes.imagesAlreadySpent) },
  options: ordered.map(p => ({ lever: p.lever, keepsVideo: p.keepsVideo, clips: p.clips,
    seconds: p.seconds, clipCredits: p.clipTotal, imageCredits: p.imagesCounted, credits: p.total })),
}, null, 2) + '\n');

console.log('ok: ' + options.length + ' option(s), the video kept in ' +
  ordered.filter(p => p.keepsVideo).length + ' of them, cheapest first.');
for (const p of ordered) console.log('  ' + p.total + ' credits  ' + p.lever +
  (p.keepsVideo ? '  (' + p.clips + ' shots, ' + p.seconds + 's)' : '  (no video)') +
  (hasCeiling && p.keepsVideo && p.total <= ceiling ? '  fits' : ''));
console.log('Every number above is the still frames plus the clips under it, added up.');
console.log('Ask it with ask.js, then wait-answer.js. Nothing is spent without an explicit yes.');
