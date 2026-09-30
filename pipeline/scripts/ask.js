#!/usr/bin/env node
// Ask a blocking question in the pane and in the chat at once.
//   node ask.js <key> <questions.json>
//   node ask.js <key> "[{\"id\":\"brand\",\"text\":\"Which brand?\",\"kind\":\"text\"}]"
//
// A question is { id, text, kind: single | multi | text, options?: [{ id, label, hint? }],
// placeholder? }. The pane gets the form, the chat gets the same questions as numbered text,
// so a person reading either can answer in either. wait-answer.js reads the reply back.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const gate = require('./lib-gate.js');
const del = require('./lib-deliverable.js');
const execution = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const pos = ws.positionals(argv);
const key = pos[0];
const source = pos.length > 2 && !fs.existsSync(pos[1]) ? pos.slice(1).join(' ') : pos[1];
const titleAt = argv.indexOf('--title');
const title = titleAt >= 0 ? argv[titleAt + 1] : null;

if (!key || !source) {
  console.error('usage: ask.js <key> <questions.json path or inline JSON> [--title "..."]');
  process.exit(2);
}

let questions;
try {
  const raw = fs.existsSync(source) ? fs.readFileSync(source, 'utf8') : source;
  questions = JSON.parse(raw);
  if (questions && !Array.isArray(questions) && Array.isArray(questions.questions)) questions = questions.questions;
} catch (e) {
  const hint = /[\\/]/.test(source) && !fs.existsSync(source)
    ? 'No file at ' + source + ', and it is not JSON either.'
    : 'The questions are not readable JSON: ' + e.message;
  console.error(hint);
  process.exit(2);
}
if (!Array.isArray(questions) || !questions.length) {
  console.error('Give an array of questions.');
  process.exit(2);
}
if (questions.length > 8) {
  console.error('Eight questions at most, in one batch.');
  process.exit(2);
}

// A video job is never asked whether it would rather be pictures. The offer arrived on a
// real run as the first option, "build it from the stills, 0 credits", written straight into
// a question after price-options.js had refused the same ordering. What a job delivers
// changes only through change-deliverable.js, in the person's words; a question cannot
// carry the offer at all.
let jobDir = null;
const jobSpec = (() => {
  for (const brand of ws.listBrands(argv)) {
    const dir = ws.jobDir(brand, key, argv);
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
      jobDir = dir;
      return spec;
    } catch { /* not this brand */ }
  }
  return null;
})();
if (jobDir) {
  const availability = execution.checkJobDirectory(jobDir, { requireJob: true });
  if (!availability.available) {
    console.error('UNSUPPORTED: ' + availability.message);
    process.exit(4);
  }
}
if (del.plansVideo(jobSpec)) {
  for (const q of questions) {
    const texts = [q.text, ...(q.options || []).flatMap(o => [o.label, o.hint])];
    const found = texts.map(del.stillsOffer).find(Boolean);
    if (found) {
      console.error('This job asked for a video, and this question offers pictures instead ("' + found + '").');
      console.error('The person changes what a job delivers, in their own words, with change-deliverable.js. Ask about the video: fewer clips, shorter clips, another take on the failing shot, or a different budget.');
      process.exit(2);
    }
  }
}

// The chat copy is printed whether or not the pane took the batch, because a person who has
// no pane still has to be able to answer.
// The fence is for the run reading this output, not for the person. Runs kept replacing
// these lines with "the questions are in the pane", which leaves the chat unanswerable.
const printForChat = () => {
  console.log('--- COPY EVERYTHING BETWEEN THE LINES INTO YOUR NEXT MESSAGE, UNCHANGED ---');
  questions.forEach((q, i) => {
    console.log((i + 1) + '. ' + q.text);
    // A question whose answer is a file needs the chat to say where the file goes, or a
    // person reading only the chat has a question they cannot answer.
    if (q.kind === 'upload') {
      console.log('   Drag a photo onto the page, or click the area there to choose one.');
      if ((q.options || []).length) console.log('   If you have no photo to hand:');
    }
    (q.options || []).forEach((o, j) => {
      console.log('   ' + (j + 1) + ') ' + o.label + (o.hint ? ' - ' + o.hint : ''));
    });
  });
  // The options are a guess. Somebody who wants a 25 year old blondie has no pill to
  // click, so the box under each question is said out loud rather than left to be found.
  console.log('Under every question there is a box for anything else you want to say.');
  console.log('Answer here, or in the pane, whichever is in front of you.');
  console.log('--- END OF THE PART TO COPY ---');
};

(async () => {
  const res = await gate.call('ask', { key, ...(title ? { title } : {}), questions }, { argv });
  if (res.offline) console.log('The pane is not connected in this folder. Run set-gate-app.js once.');
  printForChat();
})();
