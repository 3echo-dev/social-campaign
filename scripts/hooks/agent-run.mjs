// Records which Social Campaign agents ran on a job, from the host's own events.
//
//   PreToolUse / PostToolUse / PostToolUseFailure on the Agent tool, and SubagentStart / SubagentStop.
//
// Only a `social-campaign:<id>` agent that agents.json lists as active counts. The job comes from the `job:<jobId>` tag in
// the spawn prompt, else the session's binding. Everything lands in <job>/agents.jsonl (see server/pipeline/agent-log.mjs).
// It protects no money: it always exits 0 and fails open. It says two things: the board-sync reminder, and the one refusal of a
// spawn that leaves out the messages the person left for that agent (see server/pipeline/agent-messages.mjs).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { jobAt, resolveJobForCall, resolveWorkspaceRoot } from '../../server/pipeline/facts.mjs';
import {
  ERROR_LIMIT, DESCRIPTION_LIMIT, SUMMARY_LIMIT, agentLabel, agentOf, appendAgentLine, boardReminderText, claimBoardReminder, clipOneLine, findRun, pairableRun, readRuns, withRuns,
} from '../../server/pipeline/agent-log.mjs';
import {
  claimGuardRefusal, deliveredBy, idsInPrompt, markMessagesDelivered, pendingMessages, DIRECTOR,
} from '../../server/pipeline/agent-messages.mjs';

const INPUT_LIMIT = 16 * 1024 * 1024;
const AGENT_TOOL = /^(?:Agent|Task)$/;

async function readEvent() {
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

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const word = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
const count = value => (Number.isFinite(Number(value)) && value !== null && value !== '' && Number(value) >= 0 ? Number(value) : null);

function say(eventName, context) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: context } }));
}

/** A tool reply as an object when it is JSON text or already an object (the host sends either), else null. */
function opened(response) {
  if (plain(response)) return response;
  if (typeof response !== 'string') return null;
  try {
    const value = JSON.parse(response);
    return plain(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * What the Agent tool's reply says. `async_launched` is a launch (the agent is still running); `completed` is a finished
 * foreground run. A reply with neither is read by the call's own run_in_background flag.
 */
function replyOf(event, input) {
  const reply = opened(event.tool_response) ?? {};
  const status = word(reply.status);
  let launched;
  if (status === 'async_launched') launched = true;
  else if (status === 'completed') launched = false;
  else launched = input.run_in_background === true;
  return {
    launched,
    remote: status === 'remote_launched',
    agentId: word(reply.agentId),
    model: word(reply.resolvedModel) ?? word(reply.model),
    durationMs: count(reply.totalDurationMs ?? reply.durationMs),
    tokens: count(reply.totalTokens),
  };
}

/** The job an Agent call belongs to: the run already on record, else the tag in the prompt, else the session's binding. */
function jobFor(root, event, input, run) {
  if (run) {
    const known = jobAt(root, run.brand, run.jobId);
    if (known) return known;
  }
  const job = resolveJobForCall({ root, sessionId: event.session_id, toolInput: { context: typeof input.prompt === 'string' ? input.prompt : '' } });
  return job ? { root: job.root, brand: job.brand, jobId: job.jobId, dir: job.dir } : null;
}

function titleOf(job) {
  try {
    return word(JSON.parse(readFileSync(join(job.dir, 'job.json'), 'utf8'))?.title);
  } catch {
    return null;
  }
}

/** The board-sync reminder, claimed once per job until a publish is recorded. Null when it was already given. */
function reminderFor(job, agent, verb) {
  if (!claimBoardReminder(job.root, job.brand, job.jobId)) return null;
  return boardReminderText({ agent, brand: job.brand, jobId: job.jobId, title: titleOf(job), verb });
}

// ---------------------------------------------------------------------------
// The person's board messages: the delivery guard and delivery evidence
// ---------------------------------------------------------------------------

const REFUSAL = agent => `The person left a message for the ${agentLabel(agent)} on the board. Call pipeline_agent_brief and add its block to the end of this prompt.`;

/**
 * PreToolUse: refuse a spawn once when the person has messages waiting for that agent and the prompt does not carry their ids. The
 * refusal is claimed per pending set (agent-guard.json), so the same set never refuses twice and the guard cannot loop. Any problem
 * lets the spawn go on. Returns a deny output object, or null.
 */
function deliveryGuard({ root, job, agent, input }) {
  if (agent === DIRECTOR) return null;
  try {
    const waiting = pendingMessages(job.dir, agent);
    if (!waiting.length) return null;
    const carried = idsInPrompt(input.prompt, agent);
    if (waiting.every(message => carried.has(message.id))) return null;
    if (!claimGuardRefusal(root, job.brand, job.jobId, agent, waiting.map(message => message.id))) return null;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REFUSAL(agent) } };
  } catch {
    return null;
  }
}

/**
 * PostToolUse on a spawn: mark a waiting message delivered only when its id is in the prompt's block for that agent and its exact
 * text is quoted there. A message the prompt only names, or quotes differently, stays waiting.
 */
function markDelivered({ job, agent, input, event, agentId }) {
  try {
    if (agent === DIRECTOR) return;
    const delivered = deliveredBy(input.prompt, agent, pendingMessages(job.dir, agent));
    if (delivered.length) markMessagesDelivered(job.dir, agent, delivered.map(message => message.id), { toolUseId: word(event.tool_use_id), agentId });
  } catch {
    // a message that could not be marked stays waiting and is offered again at the next spawn
  }
}

// ---------------------------------------------------------------------------
// Agent tool events
// ---------------------------------------------------------------------------

function onDispatch({ root, job, agent, input, event }) {
  const refusal = deliveryGuard({ root, job, agent, input, event });
  if (refusal) {
    process.stdout.write(JSON.stringify(refusal));
    return;
  }
  const toolUseId = word(event.tool_use_id);
  const background = input.run_in_background !== false;
  appendAgentLine(job.dir, {
    kind: 'dispatch',
    toolUseId,
    agent,
    description: clipOneLine(input.description, DESCRIPTION_LIMIT) || null,
    background,
    sessionId: word(event.session_id),
  });
  withRuns(root, runs => {
    const at = new Date().toISOString();
    const known = findRun(runs, { toolUseId });
    if (known) return;
    runs.push({ toolUseId, agentId: null, agent, brand: job.brand, jobId: job.jobId, sessionId: word(event.session_id), dispatchedAt: at, startedAt: null, endedAt: null, ended: null });
  });
}

function onReply({ root, job, agent, input, event }) {
  const reply = replyOf(event, input);
  if (reply.remote) return null;
  const toolUseId = word(event.tool_use_id);
  const at = new Date().toISOString();
  let needsLine = true;
  withRuns(root, runs => {
    let run = findRun(runs, { toolUseId });
    if (!run) {
      run = { toolUseId, agentId: null, agent, brand: job.brand, jobId: job.jobId, sessionId: word(event.session_id), dispatchedAt: at, startedAt: null, endedAt: null, ended: null };
      runs.push(run);
    }
    if (reply.launched) {
      // A SubagentStart that already paired this run wrote the start line.
      if (run.startedAt && (!reply.agentId || run.agentId === reply.agentId)) needsLine = false;
      run.agentId = reply.agentId ?? run.agentId;
      run.startedAt ??= at;
    } else {
      run.agentId = reply.agentId ?? run.agentId;
      run.endedAt = at;
      run.ended = 'finished';
    }
  });
  markDelivered({ job, agent, input, event, agentId: reply.agentId });
  if (reply.launched) {
    if (needsLine) appendAgentLine(job.dir, { kind: 'started', toolUseId, agentId: reply.agentId, agent, model: reply.model, sessionId: word(event.session_id) });
    return reminderFor(job, agent, 'started');
  }
  appendAgentLine(job.dir, { kind: 'finished', toolUseId, agentId: reply.agentId, agent, durationMs: reply.durationMs, tokens: reply.tokens, model: reply.model });
  // A foreground run never had a start line the board could hear about, so its end is the first news of it.
  return reminderFor(job, agent, 'finished');
}

function onFailure({ root, job, agent, event }) {
  const toolUseId = word(event.tool_use_id);
  const said = typeof event.error === 'string' ? event.error : (() => {
    try {
      return JSON.stringify(event.error ?? '');
    } catch {
      return '';
    }
  })();
  const error = clipOneLine(said, ERROR_LIMIT) || 'The agent did not finish.';
  withRuns(root, runs => {
    const run = findRun(runs, { toolUseId });
    if (run) {
      run.endedAt = new Date().toISOString();
      run.ended = 'failed';
    }
  });
  appendAgentLine(job.dir, { kind: 'failed', toolUseId, agent, error });
}

function onToolEvent(event, root) {
  const input = plain(event.tool_input) ? event.tool_input : {};
  const agent = agentOf(input.subagent_type);
  if (!agent) return null;
  const toolUseId = word(event.tool_use_id);
  const run = findRun(readRuns(root), { toolUseId });
  const job = jobFor(root, event, input, run);
  if (!job) return null;
  const ctx = { root, job, agent, input, event };
  if (event.hook_event_name === 'PreToolUse') onDispatch(ctx);
  else if (event.hook_event_name === 'PostToolUse') return onReply(ctx);
  else if (event.hook_event_name === 'PostToolUseFailure') onFailure(ctx);
  return null;
}

// ---------------------------------------------------------------------------
// SubagentStart and SubagentStop
// ---------------------------------------------------------------------------

/** The run an agent id belongs to, found by id or, failing that, as the only open run of that agent in this session. Marks the id on the run. */
function runForAgent(runs, event, agent) {
  const agentId = word(event.agent_id);
  if (!agentId) return null;
  const known = findRun(runs, { agentId });
  if (known) return known;
  const paired = pairableRun(runs, { sessionId: word(event.session_id), agent });
  if (paired) paired.agentId = agentId;
  return paired;
}

function onSubagentStart(event, root) {
  const agent = agentOf(event.agent_type);
  if (!agent || !word(event.agent_id)) return;
  const at = new Date().toISOString();
  const found = withRuns(root, runs => {
    const run = runForAgent(runs, event, agent);
    if (!run || run.startedAt) return null;
    run.startedAt = at;
    return { ...run };
  });
  if (!found) return;
  const job = jobAt(root, found.brand, found.jobId);
  if (job) appendAgentLine(job.dir, { kind: 'started', toolUseId: found.toolUseId, agentId: word(event.agent_id), agent, sessionId: found.sessionId, at });
}

function onSubagentStop(event, root) {
  const agent = agentOf(event.agent_type);
  if (!agent || !word(event.agent_id)) return;
  const at = new Date().toISOString();
  const found = withRuns(root, runs => {
    const run = runForAgent(runs, event, agent);
    if (!run || run.stoppedAt) return null;
    run.stoppedAt = at;
    if (!run.ended) {
      run.endedAt = at;
      run.ended = 'stopped';
    }
    return { ...run };
  });
  if (!found) return;
  const job = jobAt(root, found.brand, found.jobId);
  if (!job) return;
  const summary = clipOneLine(event.last_assistant_message, SUMMARY_LIMIT);
  appendAgentLine(job.dir, { kind: 'stopped', toolUseId: found.toolUseId, agentId: word(event.agent_id), agent, ...(summary ? { summary } : {}), at });
}

async function main() {
  const event = await readEvent();
  if (!event) return;
  const root = resolveWorkspaceRoot(event.cwd);
  if (!root) return;
  const name = event.hook_event_name;
  if (name === 'SubagentStart') {
    onSubagentStart(event, root);
    return;
  }
  if (name === 'SubagentStop') {
    onSubagentStop(event, root);
    return;
  }
  if (!AGENT_TOOL.test(String(event.tool_name || ''))) return;
  const context = onToolEvent(event, root);
  if (context) say(name, context);
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
