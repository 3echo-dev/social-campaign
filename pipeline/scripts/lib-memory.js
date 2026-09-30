// Compact, resumable working notes for a job. This is a checkpoint, not a second ledger.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const durable = require('./lib-durable.js');

const MAX_BYTES = 20000;
const MAX_SUMMARY = 2000;
const MAX_STEP = 240;
const MAX_ACTION = 500;
const MAX_LIST_ITEMS = 12;
const MAX_ITEM = 240;
const MAX_REFERENCES = 24;

function text(value, limit, label = 'Memory text') {
  if (typeof value !== 'string' || value.length > limit) throw new Error(label + ' is missing or too long.');
  return value;
}

function list(value = [], label = 'memory list') {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new Error('Keep at most twelve notes per ' + label + '.');
  return value.map(v => text(v, MAX_ITEM, 'Memory note'));
}

function safeReferencePath(dir, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error('Memory references must be files inside this job.');
  }
  const root = fs.realpathSync(dir);
  const absolute = path.resolve(dir, relative);
  const file = fs.realpathSync(absolute);
  const rel = path.relative(root, file);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) ||
    !/\.(md|json|txt)$/i.test(file) || fs.statSync(file).size > 1024 * 1024) {
    throw new Error('Memory references must be small text artifacts inside this job.');
  }
  return { root, file, relative: rel.split(path.sep).join('/') };
}

function reference(dir, value, revisions = {}) {
  const requested = typeof value === 'string' ? { path: value } : value;
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
    throw new Error('Memory references must name files inside this job.');
  }
  const location = safeReferencePath(dir, requested.path);
  const result = {
    path: location.relative,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(location.file)).digest('hex'),
  };
  const revision = requested.revision !== undefined ? requested.revision : revisions[requested.path];
  if (revision !== undefined && revision !== null) {
    if (!Number.isSafeInteger(Number(revision)) || Number(revision) < 0) throw new Error('Memory reference revisions must be non-negative integers.');
    result.revision = Number(revision);
  }
  return result;
}

function artifactRevision(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (/\.json$/i.test(file)) {
      const value = JSON.parse(raw);
      if (Number.isSafeInteger(Number(value && value.revision)) && Number(value.revision) >= 0) return Number(value.revision);
    }
    const match = raw.match(/\*\*Revision:\*\*\s*`?(\d+)`?/i);
    return match ? Number(match[1]) : null;
  } catch { return null; }
}

function parseExisting(textValue) {
  if (!String(textValue || '').trim()) return null;
  let previous;
  try { previous = JSON.parse(textValue); } catch { throw new Error('The checkpoint is corrupt. Reread the job and save a new checkpoint.'); }
  if (!previous || previous.version !== 1 || !Array.isArray(previous.references)) {
    throw new Error('The checkpoint is corrupt. Reread the job and save a new checkpoint.');
  }
  return previous;
}

function save(dir, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Memory must be a JSON object.');
  const refs = input.references === undefined
    ? ['job.json', 'route.json', 'brief.md'].filter(f => fs.existsSync(path.join(dir, f)))
    : input.references;
  if (!Array.isArray(refs) || refs.length > MAX_REFERENCES) throw new Error('Keep at most twenty-four memory references.');
  const revisions = input.referenceRevisions && typeof input.referenceRevisions === 'object' && !Array.isArray(input.referenceRevisions)
    ? input.referenceRevisions : {};
  const base = {
    version: 1,
    summary: text(input.summary, MAX_SUMMARY),
    unresolvedQuestions: list(input.unresolvedQuestions === undefined ? input.openQuestions : input.unresolvedQuestions, 'memory list'),
    constraints: list(input.constraints, 'memory list'),
    currentStep: text(input.currentStep === undefined ? '' : input.currentStep, MAX_STEP, 'Current step'),
    nextAction: text(input.nextAction === undefined ? '' : input.nextAction, MAX_ACTION, 'Next action'),
    references: refs.map(r => reference(dir, r, revisions)),
    authority: 'Working notes only. Approvals, quotes, and evidence remain in their original records.',
  };
  base.openQuestions = base.unresolvedQuestions;
  let saved;
  const file = path.join(dir, 'memory.json');
  durable.update(file, current => {
    const previous = parseExisting(current);
    saved = { ...base, revision: (Number.isSafeInteger(previous && previous.revision) ? previous.revision : 0) + 1,
      savedAt: new Date().toISOString() };
    const serialized = JSON.stringify(saved, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) throw new Error('The checkpoint is too large. Keep the summary and references compact.');
    return serialized;
  });
  return saved;
}

function read(dir) {
  const file = path.join(dir, 'memory.json');
  if (!fs.existsSync(file)) return null;
  try {
    if (fs.statSync(file).size > MAX_BYTES) throw new Error('Memory exceeds its size limit.');
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (m.version !== 1 || !Array.isArray(m.references) || m.references.length > MAX_REFERENCES ||
      typeof m.summary !== 'string') {
      throw new Error('Invalid memory record.');
    }
    // Checkpoints written before the current-step fields were introduced remain useful. They
    // resume with an empty step and still get the hash checks below.
    if (typeof m.currentStep !== 'string') m.currentStep = '';
    if (typeof m.nextAction !== 'string') m.nextAction = '';
    if (!Array.isArray(m.unresolvedQuestions)) m.unresolvedQuestions = Array.isArray(m.openQuestions) ? m.openQuestions : [];
    const changed = m.references.filter(r => {
      try {
        const now = reference(dir, r);
        const revision = artifactRevision(path.join(dir, r.path));
        return now.sha256 !== r.sha256 ||
          (r.revision !== undefined && revision !== null && revision !== Number(r.revision));
      } catch { return true; }
    }).map(r => r.path);
    return { ...m, current: !changed.length, changedReferences: changed };
  } catch { return { current: false, unreadable: true, summary: null }; }
}

module.exports = { save, read, reference, MAX_BYTES };
