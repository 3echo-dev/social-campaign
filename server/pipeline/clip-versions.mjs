import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvalidInputError } from '../lib/errors.mjs';
import * as facts from './facts.mjs';
import { promoteFile } from './land-outputs.mjs';
import { noteOnJob } from './session-claims.mjs';

/**
 * Putting an already-saved version of a clip back under the shot's own name in the media folder, which is the file the join reads.
 *
 * A shot can have several saved versions (a redo is a new one, and some jobs make two takes on purpose). Landing keeps the newest
 * under the shot's own name and puts the one it replaces aside as <shot>-r<n>. Going back to an earlier version needs no new clip:
 * the file is already there, so this costs nothing.
 */

const events = createRequire(import.meta.url)(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts', 'lib-events.js'));

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * Put `pick` (a saved version of a shot: { deliverable, panel, version, file, sha256 }) under the shot's own name. `top` is the newest
 * version of the shot ({ key, version }). A different file that was there is kept aside as <shot>-r<n>. The save step is told with a
 * promotion record on the newest version, so a later save pass (repairPromotions) leaves the pick alone.
 *
 * Nothing is done when the file already in place is the pick. With fillMissing false, a shot that has no file yet and whose pick is the
 * newest version is also left to the save step. verify(file) runs just before a file is copied.
 */
export function placeTake({ job, pick, top, fillMissing = false, verify = null }) {
  const ext = extname(pick.file).slice(1).toLowerCase();
  const target = join(job.dir, 'media', pick.deliverable, `${pick.panel}.${ext}`);
  let current = null;
  try { current = digest(readFileSync(target)); } catch { /* nothing joined under this name yet */ }
  if (current === pick.sha256 || (!fillMissing && current === null && pick.version === top.version)) return { placed: null, unchanged: true };
  if (verify) verify(pick.file);
  const placed = promoteFile(job, facts.parseJobKey(top.key), top.key, pick.file.split(sep).join('/'));
  // The promotion goes on the first output of the newest version (the file named for the shot and version), the same pick the save pass makes.
  const assetId = facts.readLanded(job).filter(entry => entry.type === 'landed' && facts.sameKey(entry.key, top.key) && basename(String(entry.file)) === `${entry.panel}-v${entry.version}${extname(String(entry.file))}`).pop()?.assetId;
  if (assetId) {
    facts.appendLanded(job, { type: 'promoted', key: top.key, deliverable: pick.deliverable, panel: pick.panel, version: top.version, assetId, promoted: placed.promoted, archived: placed.archived, promotedSha256: placed.promotedSha256, promotedBytes: placed.promotedBytes, pickedTake: pick.version });
  }
  return { placed, unchanged: false };
}

function refuse(message, fix) {
  throw new InvalidInputError(message, fix ? { fix } : {});
}

/**
 * Use an earlier saved version of one shot for the join. Free: nothing is made or priced. The version that was in use is kept aside.
 * The clips stay signed off (the sign-off is for the newest version of each shot), so the next steps are to join, finish and show the
 * rough cut again.
 */
export function useClipVersion({ root, brand, jobId, deliverable, panel, version } = {}) {
  const job = facts.jobAt(root, brand, jobId);
  if (!job) refuse('Job not found in this workspace.');
  if (facts.isFinishedState(job.state)) refuse('This job is finished, so its clips cannot be changed.');
  const d = facts.canonicalDeliverable(deliverable);
  const item = facts.canonicalItem(panel);
  if (!d || !item) refuse('Say which shot it is, such as D1 and S4.');
  const wanted = Number(version);
  if (!Number.isInteger(wanted) || wanted < 1) refuse('Say which version to use, such as 1 for the first one.');

  const takes = facts.clipTakes(job).filter(take => take.deliverable === d && take.panel === item);
  if (!takes.length) refuse(`${d} ${item} has no saved clip to choose from.`, 'Check the deliverable and shot with pipeline_generation_land.');
  const pick = takes.find(take => take.version === wanted);
  const label = `${d} ${item}`;
  if (!pick) refuse(`Version ${wanted} of ${label} was never saved, so it cannot be used.`, `The saved versions of ${label} are ${takes.map(take => take.version).join(', ')}.`);

  const newest = takes[takes.length - 1];
  const result = placeTake({ job, pick, top: newest, fillMissing: true });
  const inUse = result.unchanged;
  const words = inUse
    ? `Version ${wanted} of ${label} is already the one in use. Nothing was changed.`
    : `${label} now uses version ${wanted}${result.placed?.archived ? '; the version that was in use is kept aside' : ''}. Nothing was made and nothing was spent.`;
  if (!inUse) {
    const at = new Date().toISOString();
    try {
      appendFileSync(join(job.dir, 'events.jsonl'), `${JSON.stringify(events.makeEvent(job.jobId, 'operation.completed', at, { type: 'panel', id: `${d}-${item}` }, { operationType: 'clip_version_used', status: 'completed', deliverable: d, panel: item, version: wanted, newest: newest.version }, { jobId: job.jobId, source: 'local' }))}\n`, 'utf8');
    } catch { /* the choice stands without its event line */ }
    noteOnJob(job.dir, 'clip_version_used', words);
  }
  return {
    used: true,
    changed: !inUse,
    jobId: job.jobId,
    deliverable: d,
    panel: item,
    version: wanted,
    newestVersion: newest.version,
    versions: takes.map(take => take.version),
    credits: 0,
    file: `media/${d}/${item}.${extname(pick.file).slice(1).toLowerCase()}`,
    message: words,
    next: inUse ? 'Nothing changed, so there is nothing to join again.' : 'Sign the clips off again (pipeline_clips_signoff), join the clips, finish the video and show the rough cut again.',
  };
}
