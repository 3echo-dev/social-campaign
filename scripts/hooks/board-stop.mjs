import { listJobs, resolveWorkspaceRoot, sha256 } from '../../server/pipeline/facts.mjs';
import { BOARD_TEXT, boardBehind, claimStopBlock, readBoardLink, reviewsWithoutCopies, unsavedOutputs } from '../../server/pipeline/board-freshness.mjs';

const INPUT_LIMIT = 4 * 1024 * 1024;

async function readEvent() {
  if (process.stdin.isTTY) return null;
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > INPUT_LIMIT) return null;
  }
  try {
    const event = JSON.parse(raw);
    return event && typeof event === 'object' && !Array.isArray(event) ? event : null;
  } catch {
    return null;
  }
}

function stopReason(behind, unsaved, copies) {
  const reasons = [];
  if (behind.length) reasons.push(BOARD_TEXT.behind);
  if (unsaved.length) reasons.push(`${BOARD_TEXT.unsaved} Jobs: ${unsaved.map(entry => entry.ref).join(', ')}.`);
  if (copies.length) reasons.push(`${BOARD_TEXT.copies} Jobs: ${copies.map(entry => entry.ref).join(', ')}.`);
  return reasons.join(' ');
}

async function main() {
  const event = await readEvent();
  if (!event || event.hook_event_name !== 'Stop' || event.stop_hook_active === true) return;
  const root = resolveWorkspaceRoot(event.cwd);
  if (!root || !readBoardLink(root)) return;
  const jobs = listJobs(root);
  const behind = boardBehind(root, jobs);
  const unsaved = unsavedOutputs(jobs);
  const copies = await reviewsWithoutCopies(root, jobs);
  if (!behind.length && !unsaved.length && !copies.length) return;
  const signature = sha256(JSON.stringify({ behind, unsaved, copies }));
  if (!claimStopBlock(root, event.session_id, signature)) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: stopReason(behind, unsaved, copies) }));
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
