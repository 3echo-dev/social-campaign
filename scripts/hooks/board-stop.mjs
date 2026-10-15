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
  if (more.republish) reasons.push(text.republish);
  if (behind.length) reasons.push(text.behind);
  if (unsaved.length) reasons.push(`${text.unsaved} Jobs: ${jobsOf(unsaved)}.`);
  if (copies.length) reasons.push(`${text.copies} Jobs: ${jobsOf(copies)}.`);
  if (more.stuck?.length) reasons.push(`${text.stuck} Jobs: ${more.stuck.map(entry => `${entry.ref} (${entry.kind})`).join(', ')}.`);
  if (more.replies?.length) reasons.push(`${text.replies} Jobs: ${jobsOf(more.replies)}.`);
  if (more.agents?.length) reasons.push(`${text.agents} Jobs: ${jobsOf(more.agents)}.`);
  if (more.yourTurn) reasons.push(more.yourTurn);
  if (more.chatAsk) reasons.push(text.chatAsk);
  return reasons.join(' ');
}

async function main() {
  const event = await readEvent();
  if (!event || event.hook_event_name !== 'Stop') return;
  // With Social Campaign access refused, a board reminder only makes Claude retry tools that fail again.
  const { accessBlocked } = await import('../../server/licence/licence.mjs');
  if (accessBlocked()) return;
  const { listJobs, resolveWorkspaceRoot, sha256 } = await import('../../server/pipeline/facts.mjs');
  const fresh = await import('../../server/pipeline/board-freshness.mjs');
  const { sessionHasPluginTools } = await import('../../server/pipeline/session-tools.mjs');
  const root = resolveWorkspaceRoot(event.cwd);
  if (!root || !fresh.readBoardLink(root)) return;
  // This turn is over: an owner that was answering a board message is no longer busy, so the person's next message elsewhere takes the board.
  fresh.endBoardTurn(root, event.session_id);
  if (event.stop_hook_active === true) return;
  const jobs = fresh.jobsForSession(root, event.session_id, listJobs(root));
  const found = await fresh.stopFindings(root, jobs, {
    sessionId: event.session_id, lastMessage: event.last_assistant_message, backgroundTasks: event.background_tasks,
  });
  // Writing the board belongs to the window that owns it. While another window holds the board, this one gets no order to republish,
  // sync, answer or ask on it (the owner's own Stop hook gets them); the files it made and the job it carries on stay its own business.
  const standBack = fresh.boardHeldByOtherWindow(root, event.session_id);
  const { unsaved, waiting } = found;
  const [behind, copies, agents, replies, stuck] = [found.behind, found.copies, found.agents ?? [], found.replies ?? [], found.stuck ?? []].map(list => (standBack ? [] : list));
  const chatAsk = standBack ? null : (found.chatAsk ?? null);
  // A question just put to the person is theirs to answer, so the job is not on Claude's turn.
  const yourTurn = chatAsk ? [] : (found.yourTurn ?? []);
  // The board page on the artifact is older than this plugin version (an update just arrived): say so once per window and page version, without asking the person.
  const outdated = !standBack && fresh.boardSourceOutdated(fresh.readBoardLink(root), root) === true;
  const version = outdated ? fresh.republishVersion(root) : null;
  const republish = outdated && !fresh.republishTold(root, event.session_id, version);
  if (!behind.length && !unsaved.length && !copies.length && !agents.length && !replies.length && !stuck.length && !yourTurn.length && !chatAsk && !republish) return;
  // A window without Social Campaign's tools can act on none of it.
  if (!sessionHasPluginTools(event.transcript_path)) return;
  const onPerson = entry => waiting.has(entry.ref);
  const [blockBehind, blockUnsaved, blockCopies] = [behind, unsaved, copies].map(list => list.filter(onPerson));
  // An agent that finished, a message waiting for the Director's reply, a stuck job nobody asked about and a job on Claude's own turn block whoever is waiting.
  const block = republish || blockBehind.length > 0 || blockUnsaved.length > 0 || blockCopies.length > 0 || agents.length > 0 || replies.length > 0 || stuck.length > 0 || yourTurn.length > 0 || chatAsk !== null;
  // A block repeats when the waiting job's facts change. A note only names which jobs and what kind
  // of gap, so a busy job nobody is waiting on does not bring a new note every turn.
  const refs = list => list.map(entry => entry.ref).sort();
  const signature = sha256(JSON.stringify(block
    ? { block, ...(republish ? { republish: true } : {}), behind: blockBehind, unsaved: blockUnsaved, copies: blockCopies, ...(agents.length ? { agents } : {}), ...(replies.length ? { replies } : {}), ...(stuck.length ? { stuck } : {}), ...(yourTurn.length ? { yourTurn: yourTurn.map(({ jobId, state, revision }) => ({ jobId, state, revision })) } : {}), ...(chatAsk ? { chatAsk: { jobId: chatAsk.jobId, hash: chatAsk.hash } } : {}) }
    : { block, behind: refs(behind), unsaved: refs(unsaved), copies: refs(copies) }));
  // With nobody waiting there is nothing to tell Claude now, and a Stop hook has no model-only
  // channel besides a block, so a systemMessage would show up in the person's chat as "Stop says".
  if (!block) return;
  if (!fresh.claimStopBlock(root, event.session_id, signature)) return;
  if (republish) fresh.recordRepublishTold(root, event.session_id, version);
  process.stdout.write(JSON.stringify({ decision: 'block', reason: stopReason(fresh.BOARD_TEXT, blockBehind, blockUnsaved, blockCopies, { republish, agents, replies, stuck, yourTurn: yourTurn.length ? fresh.yourTurnReason(yourTurn) : '', chatAsk: chatAsk !== null }) }));
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
