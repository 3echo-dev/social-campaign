// Resolve a chat's explicit job or its working directory.
// A different job becoming newer must never redirect approvals, spending, or token attribution.
//
// `heartbeat.js` worked this out for itself and `turn.js` needs the same answer plus the
// folder, so the resolution lives here once rather than drifting into two versions that
// disagree about which job a card belongs to.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const states = require('./lib-states.js');
const sessions = require('./lib-session.js');

const STATE_LINE = /\*\*Current state:\*\*\s*`?([A-Z_]+)`?/;
const REVISION_LINE = /\*\*Revision:\*\*\s*`?(\d+)`?/i;

/** The state id written in a `status.md`, or null when there is not one. */
const stateIn = text => (String(text || '').match(STATE_LINE) || [])[1] || null;
/** The durable state revision, or zero for a legacy status file without a revision header. */
const revisionIn = text => {
  const raw = String(text || '');
  const present = raw.match(/\*\*Revision:\*\*\s*([^\r\n]*)/i);
  if (!present) return 0;
  const n = Number((present[1].trim().match(/^`?(\d+)`?$/) || [])[1]);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

function within(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/**
 * The explicitly selected session job, or the job containing cwd.
 *
 * Returns `{ at, brand, jobId, dir, status, state, revision, text }`, so a caller that only
 * wants the key and one that wants to read the whole file both get what they came for from one
 * walk. `includeFinished` is for callers like the token counter, which attach to whatever the
 * run last touched even after it is done. The default leaves a finished job out.
 */
function openJob(argv, options) {
  const opts = options || {};
  let brands;
  try { brands = fs.readdirSync(ws.brandsDir(argv), { withFileTypes: true }); } catch { return null; }
  const root = ws.brandsDir(argv);
  const all = [];
  for (const brand of brands) {
    if (!brand.isDirectory() || brand.name.startsWith('.')) continue;
    const jobs = path.join(root, brand.name, 'jobs');
    let entries = [];
    try { entries = fs.readdirSync(jobs); } catch { continue; }
    for (const job of entries) {
      const dir = path.join(jobs, job);
      const status = path.join(dir, 'status.md');
      const specPath = path.join(dir, 'job.json');
      let at = null;
      let text = '';
      let spec = {};
      try {
        at = fs.statSync(status).mtimeMs;
        text = fs.readFileSync(status, 'utf8');
      } catch { continue; }
      try {
        const parsed = JSON.parse(fs.readFileSync(specPath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) spec = parsed;
      } catch { /* legacy jobs may not have a readable spec */ }
      const state = stateIn(text);
      const revision = revisionIn(text);
      const done = state && states.exists(state) && (states.get(state).next || []).length === 0;
      const corrupt = !state || !states.exists(state) || revision === null;
      all.push({
        at, brand: brand.name, jobId: job, dir, status, state, revision, done, corrupt, text,
        workspaceId: spec.workspaceId || null,
        ownerUserId: spec.ownerUserId || null,
        ownerEmail: spec.ownerEmail || null,
        ownerEmailVerified: spec.ownerEmailVerified === true,
      });
    }
  }

  const open = opts.includeFinished ? all : all.filter(j => !j.done);
  const id = opts.sessionId || sessions.sessionId(argv);
  const selected = sessions.read(id, argv);

  // An explicit action takes precedence over a persisted chat binding. It does not use
  // recency, and a missing explicit job is a hard no-job result rather than a fallback.
  const requested = opts.explicit || opts.requested ||
    (opts.brand && opts.jobId ? { brand: opts.brand, jobId: opts.jobId } : null);
  if (requested && requested.brand && requested.jobId) {
    const found = all.find(j => j.brand === requested.brand && j.jobId === requested.jobId);
    if (!found || (found.done && !opts.includeFinished)) return null;
    return found;
  }

  // Explicit chat selection never falls through to another job, even if it finished or vanished.
  if (selected) {
    const found = all.find(j => j.brand === selected.brand && j.jobId === selected.jobId);
    if (!found || (found.done && !opts.includeFinished)) {
      if (opts.onStale) opts.onStale({ binding: selected, reason: !found ? 'missing' : 'finished' });
      return null;
    }
    return found;
  }

  const cwd = path.resolve(opts.cwd || process.cwd());
  const inside = open.find(j => within(cwd, j.dir));
  if (inside) {
    if (id) {
      try { sessions.bind(id, inside.brand, inside.jobId, argv); } catch { /* context is read-only */ }
    }
    return inside;
  }

  // Recency is not identity. An ambiguous workspace needs an explicit selection.
  if (open.length > 1 && opts.onAmbiguous) opts.onAmbiguous(open);
  return null;
}

module.exports = { openJob, stateIn, revisionIn, STATE_LINE, REVISION_LINE };
