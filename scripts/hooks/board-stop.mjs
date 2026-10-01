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

function stopReason(text, behind, unsaved, copies) {
  const reasons = [];
  if (behind.length) reasons.push(text.behind);
  if (unsaved.length) reasons.push(`${text.unsaved} Jobs: ${unsaved.map(entry => entry.ref).join(', ')}.`);
  if (copies.length) reasons.push(`${text.copies} Jobs: ${copies.map(entry => entry.ref).join(', ')}.`);
  return reasons.join(' ');
}

function noteText(note, behind, unsaved, copies) {
  const lines = [];
  if (behind.length) lines.push(note.behind);
  if (unsaved.length) lines.push(note.unsaved);
  if (copies.length) lines.push(note.copies);
  return [...lines, note.close].join(' ');
}

async function main() {
  const event = await readEvent();
  if (!event || event.hook_event_name !== 'Stop' || event.stop_hook_active === true) return;
  const { listJobs, resolveWorkspaceRoot, sha256 } = await import('../../server/pipeline/facts.mjs');
  const fresh = await import('../../server/pipeline/board-freshness.mjs');
  const root = resolveWorkspaceRoot(event.cwd);
  if (!root || !fresh.readBoardLink(root)) return;
  const jobs = fresh.jobsForSession(root, event.session_id, listJobs(root));
  const { behind, unsaved, copies, waiting } = await fresh.stopFindings(root, jobs);
  if (!behind.length && !unsaved.length && !copies.length) return;
  const onPerson = entry => waiting.has(entry.ref);
  const [blockBehind, blockUnsaved, blockCopies] = [behind, unsaved, copies].map(list => list.filter(onPerson));
  const block = blockBehind.length > 0 || blockUnsaved.length > 0 || blockCopies.length > 0;
  // A block repeats when the waiting job's facts change. A note only names which jobs and what kind
  // of gap, so a busy job nobody is waiting on does not bring a new note every turn.
  const refs = list => list.map(entry => entry.ref).sort();
  const signature = sha256(JSON.stringify(block
    ? { block, behind: blockBehind, unsaved: blockUnsaved, copies: blockCopies }
    : { block, behind: refs(behind), unsaved: refs(unsaved), copies: refs(copies) }));
  if (!fresh.claimStopBlock(root, event.session_id, signature)) return;
  process.stdout.write(JSON.stringify(block
    ? { decision: 'block', reason: stopReason(fresh.BOARD_TEXT, blockBehind, blockUnsaved, blockCopies) }
    : { systemMessage: noteText(fresh.BOARD_NOTE, behind, unsaved, copies) }));
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
