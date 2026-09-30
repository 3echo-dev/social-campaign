// Record the state a script has just earned, through set-state.js, so status.md, the stage
// log and the pane all move the same way.
//
// A run was refused mid-flight with "cannot go from INTAKE_PENDING to PLANNED" because the
// router knew the job was routed and never said so: recording was left to whoever remembered.
// The script that knows is the script that records.
const path = require('path');
const { spawnSync } = require('child_process');

// A job folder is <root>/workspaces/<brand>/jobs/<job-id>, so both names and the root the
// workspace scripts expect can be read straight off the path.
function fromJobDir(jobDir) {
  const dir = path.resolve(jobDir);
  const jobId = path.basename(dir);
  const brand = path.basename(path.resolve(dir, '..', '..'));
  const root = path.resolve(dir, '..', '..', '..', '..');
  return { brand, jobId, root };
}

// Never throws and never fails the caller: a state that is already set, or a workspace that
// cannot be written, must not throw away the work the script just finished.
function advance(jobDir, state, opts = {}) {
  try {
    const { brand, jobId, root } = fromJobDir(jobDir);
    const args = [path.join(__dirname, 'set-state.js'), brand, jobId, state, '--by', opts.by || 'pipeline'];
    if (opts.note) args.push('--note', opts.note);
    if (opts.next) args.push('--next', opts.next);
    if (opts.reason) args.push('--reason', opts.reason);
    if (opts.operationId) args.push('--operation-id', opts.operationId);
    if (opts.decisionId) args.push('--decision-id', opts.decisionId);
    if (opts.expectState) args.push('--expect-state', opts.expectState);
    if (opts.expectRevision !== undefined && opts.expectRevision !== null) args.push('--expect-revision', String(opts.expectRevision));
    args.push('--root', root);
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 12000 });
    return { ok: run.status === 0, out: ((run.stdout || '') + (run.stderr || '')).trim() };
  } catch (e) {
    return { ok: false, out: e.message };
  }
}

module.exports = { advance, fromJobDir };
