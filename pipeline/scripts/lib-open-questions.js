// Open questions the Director asked the person about one job (pipeline_board_ask). While one is open the job waits on the
// person's answer, so the job's status lines say so and the brief step is not started. Questions live in the workspace root.
const fs = require('fs');
const path = require('path');
const states = require('./lib-states.js');
const wording = require('./lib-wording.js');

function openFor(root, jobId) {
  const dir = path.join(root, '.social-pipeline', 'board', 'questions');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const open = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (record && record.status === 'open' && record.jobId === jobId) open.push(record);
    } catch { /* an unreadable file is not a question */ }
  }
  return open;
}

// Moving on to the brief or the ideas while a question is open would start work the answer may change.
const BRIEF_STEPS = new Set(['BRIEF_READY', 'CONCEPTS_DRAFTED']);
function refusal(current, target, open) {
  if (!open.length || !BRIEF_STEPS.has(target) || states.gateOf(current)) return null;
  return 'You asked the person ' + (open.length === 1 ? 'a question' : open.length + ' questions') + ' on this job that ' + (open.length === 1 ? 'is' : 'are') +
    ' still waiting for an answer, so the brief is not started. Wait for the answer, then move the job on.';
}

const field = (text, name) => (text.match(new RegExp('\\*\\*' + name + ':\\*\\*\\s*`?([^`\\n]*)`?')) || [])[1];
function setLine(text, name, value) {
  return text.replace(new RegExp('(\\*\\*' + name + ':\\*\\*\\s*)`?[^`\\n]*`?'), (m, head) => head + value);
}

// Bring Next action and Blocked on in line with the open questions. Never bumps the revision: the state did not change.
function refreshStatusLines(dir, root, jobId) {
  const file = path.join(dir, 'status.md');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  let text = raw.replace(/\r\n/g, '\n');
  const state = (field(text, 'Current state') || '').trim();
  if (!state || !states.exists(state) || states.isTerminal(state) || states.gateOf(state) || state === 'BLOCKED' || state === 'ESCALATED') return false;
  const open = openFor(root, jobId);
  const asking = field(text, 'Next action') === wording.QUESTION_NEXT_ACTION;
  if (open.length && !asking) {
    text = setLine(text, 'Next action', wording.QUESTION_NEXT_ACTION);
    text = setLine(text, 'Blocked on', wording.QUESTION_BLOCKED_ON);
  } else if (!open.length && asking) {
    text = setLine(text, 'Next action', wording.sentence(state));
    text = setLine(text, 'Blocked on', 'Nothing');
  } else return false;
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text.replace(/\n/g, nl), 'utf8');
  fs.renameSync(tmp, file);
  return true;
}

module.exports = { openFor, refusal, refreshStatusLines };
