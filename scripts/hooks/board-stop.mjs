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

const jobsOf = list => list.map(entry => entry.ref).join(', ');

function stopReason(text, behind, unsaved, copies, more = {}) {
  const reasons = [];
  if (behind.length) reasons.push(text.behind);
  if (unsaved.length) reasons.push(`${text.unsaved} Jobs: ${jobsOf(unsaved)}.`);
  if (copies.length) reasons.push(`${text.copies} Jobs: ${jobsOf(copies)}.`);
  if (more.stuck?.length) reasons.push(`${text.stuck} Jobs: ${more.stuck.map(entry => `${entry.ref} (${entry.kind})`).join(', ')}.`);
  if (more.replies?.length) reasons.push(`${text.replies} Jobs: ${jobsOf(more.replies)}.`);
  if (more.agents?.length) reasons.push(`${text.agents} Jobs: ${jobsOf(more.agents)}.`);
  if (more.yourTurn) reasons.push(more.yourTurn);
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
  const { behind, unsaved, copies, waiting, agents = [], replies = [], stuck = [], yourTurn = [] } = await fresh.stopFindings(root, jobs, { sessionId: event.session_id });
  if (!behind.length && !unsaved.length && !copies.length && !agents.length && !replies.length && !stuck.length && !yourTurn.length) return;
  const onPerson = entry => waiting.has(entry.ref);
  const [blockBehind, blockUnsaved, blockCopies] = [behind, unsaved, copies].map(list => list.filter(onPerson));
  // An agent that finished, a message waiting for the Director's reply, a stuck job nobody asked about and a job on Claude's own turn block whoever is waiting.
  const block = blockBehind.length > 0 || blockUnsaved.length > 0 || blockCopies.length > 0 || agents.length > 0 || replies.length > 0 || stuck.length > 0 || yourTurn.length > 0;
  // A block repeats when the waiting job's facts change. A note only names which jobs and what kind
  // of gap, so a busy job nobody is waiting on does not bring a new note every turn.
  const refs = list => list.map(entry => entry.ref).sort();
  const signature = sha256(JSON.stringify(block
    ? { block, behind: blockBehind, unsaved: blockUnsaved, copies: blockCopies, ...(agents.length ? { agents } : {}), ...(replies.length ? { replies } : {}), ...(stuck.length ? { stuck } : {}), ...(yourTurn.length ? { yourTurn: yourTurn.map(({ jobId, state, revision }) => ({ jobId, state, revision })) } : {}) }
    : { block, behind: refs(behind), unsaved: refs(unsaved), copies: refs(copies) }));
  if (!fresh.claimStopBlock(root, event.session_id, signature)) return;
  process.stdout.write(JSON.stringify(block
    ? { decision: 'block', reason: stopReason(fresh.BOARD_TEXT, blockBehind, blockUnsaved, blockCopies, { agents, replies, stuck, yourTurn: yourTurn.length ? fresh.yourTurnReason(yourTurn) : '' }) }
    : { systemMessage: noteText(fresh.BOARD_NOTE, behind, unsaved, copies) }));
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
