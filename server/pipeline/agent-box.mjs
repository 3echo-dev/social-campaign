// The Agent Box: what each agent on a job is doing, as the board shows it (document.agents).
//
// A pure projection. Everything it knows comes from what the caller passes in (the job snapshot, the board details, the inbox) and from
// three things on disk beside the job: agents.jsonl (written by the agent-run hook, see agent-log.mjs), task-contracts.json (written
// by the planner) and messages/<agent>.jsonl (written by the message relay, which may not exist yet). Nothing here writes, spends or
// decides anything; the stop hook, the spend guard and the publish guard never read this.
//
// Shape of the result (the value of document.agents), see docs/PLAN-0.10-AGENT-BOX.md section 2:
//   { v: 1, list: [agent], unassigned: { yours, records, other, yoursMore, recordsMore, otherMore }, truncated }
//   agent = { id, name, model, state, task, role, since, files, filesMore, activity, runs, sessions, messages, messagesMore, pendingMessages, needs, note? }
//   `role` is what the agent does, in one plain line, whatever it is doing now. `runs` are its finished runs, oldest first: { at, tookMs }.
//   `sessions` are all of its runs, oldest first, for the step history: { at, end, state, task, tookMs, summary }; state is finished, failed, stopped, running or lost.
//   state is one of AGENT_STATES. `note` (only when there is one) says why a card waits: "Starts after researching".
//   Director only: `needs` lists what the person must act on (the inbox keys, with `from`, the agent that wrote the work behind it).
//   Director only, and only when the job is stuck: `stuck` = { reason, kind, since, asked, canRetry, retry? }, see stuckOf below.

import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STALE_RUN_MS, clipOneLine, readAgentLines } from './agent-log.mjs';
import { plainWordsProblem } from './questions.mjs';
import { handoffSent } from './handoff.mjs';

const require = createRequire(import.meta.url);
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(PLUGIN_ROOT, 'pipeline', 'scripts');
const { ROLES } = require(join(SCRIPTS, 'lib-roles.js'));
const statesLib = require(join(SCRIPTS, 'lib-states.js'));
const { canonicalArtifactRef } = require(join(SCRIPTS, 'lib-revision-targets.js'));

export const AGENT_STATES = Object.freeze(['needs_you', 'working', 'waiting', 'up_next', 'done']);
export const DIRECTOR = 'producer';
export const DIRECTOR_NAME = 'Director';
export const DIRECTOR_TASK = 'Runs the job and talks to you';
/** The agents section is held to this many bytes (as JSON text) before it goes into the job document. */
export const AGENT_BOX_BUDGET_BYTES = 32 * 1024;
export const TASK_LIMIT = 120;
export const ACTIVITY_SHOWN = 5;
export const ACTIVITY_SHED = 2;
export const RUNS_SHOWN = 6;
export const SESSIONS_SHOWN = 8;
export const FILES_SHOWN = 12;
export const FILES_SHED = 4;
export const UNASSIGNED_SHOWN = 24;
export const UNASSIGNED_SHED = 8;
export const MESSAGES_SHOWN = 10;
export const MESSAGE_CLIP = 140;
export const MESSAGE_LIMIT = 1000;
export const AGENT_LINE_LIMIT = 80;

const DONE_STAGE = new Set(['complete', 'done']);
const BLOCKED_STATES = new Set(['BLOCKED', 'ESCALATED']);
const DECISION_WORDS = Object.freeze({
  concept: 'idea', storyboard: 'storyboard', price: 'price', sample: 'sample image', content: 'final post', publish: 'posting plan',
  campaign_proposal: 'campaign plan', campaign_activation: 'going live', findings: 'report',
});
// agents.json knows the publisher; the shared role list does not.
const FALLBACK_ACTION = Object.freeze({ publisher: 'Packaging what you approved for posting.' });
const DEFAULT_ACTION = 'Working on this part of the job.';
/** The note of an agent whose finished work is waiting on the person's decision. The board shows it as a plain line, never as a question. */
export const HANDED_NOTE = 'Handed to the Director for your decision';

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
const cleanCell = value => String(value ?? '').replace(/`/g, '').trim();
const timeOf = value => {
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) ? at : null;
};
const byteSize = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Names, models, the registry
// ---------------------------------------------------------------------------

let registryCache = null;

/** The active agents of agents.json by id, each with its model and the files it produces. Empty when the file cannot be read. */
export function agentRegistry() {
  if (registryCache) return registryCache;
  const file = readJson(join(PLUGIN_ROOT, 'pipeline', 'registry', 'agents.json'));
  const map = new Map();
  for (const entry of Array.isArray(file?.agents) ? file.agents : []) {
    if (!plain(entry) || entry.status !== 'active' || typeof entry.agentId !== 'string') continue;
    map.set(entry.agentId, { id: entry.agentId, model: text(entry.model), produces: Array.isArray(entry.produces) ? entry.produces.filter(item => typeof item === 'string') : [] });
  }
  registryCache = map;
  return map;
}

/** `claude-fable-5-1` gives "Fable 5.1", `claude-haiku-4-5-20251001` gives "Haiku 4.5", `claude-3-5-sonnet-20241022` gives "Sonnet 3.5". Null when no family is named. */
export function shortModel(id) {
  const raw = String(id ?? '').toLowerCase().replace(/\[[^\]]*\]\s*$/, '').trim();
  if (!raw) return null;
  const parts = raw.replace(/^claude[-_ ]?/, '').split(/[-_.\s]+/).filter(part => part && !/^\d{8}$/.test(part) && part !== 'latest');
  const family = parts.find(part => /^[a-z]+$/.test(part));
  if (!family) return null;
  const version = parts.filter(part => /^\d{1,2}$/.test(part)).slice(0, 2).join('.');
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  return version ? `${name} ${version}` : name;
}

function nameOf(agent) {
  if (agent === DIRECTOR) return DIRECTOR_NAME;
  const label = ROLES[agent]?.label;
  if (label) return label;
  const words = String(agent).replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the board calls an agent: "Director", "Strategist". */
export const agentName = nameOf;

function actionOf(agent) {
  if (agent === DIRECTOR) return DIRECTOR_TASK;
  return ROLES[agent]?.action || FALLBACK_ACTION[agent] || DEFAULT_ACTION;
}

/** One plain line of at most `limit` characters, or null when it is empty or reads like code, a file name or an id. */
function plainLine(value, limit) {
  const line = clipOneLine(value, limit);
  return line && !plainWordsProblem(line) ? line : null;
}

function lowerFirst(value) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function minutes(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 60 * 1000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${Math.round(ms / 60000)} min`;
}

// ---------------------------------------------------------------------------
// The roster and each agent's place in the plan
// ---------------------------------------------------------------------------

/**
 * The agents to show, as ids, the Director first: each distinct `Agent` of the plan rows in order of first appearance, active agents
 * only (a script, a human or an unknown name never counts). Before a plan, the route's owner and its support.
 */
export function rosterOf({ rows = [], route = null } = {}) {
  const active = agentRegistry();
  const out = [DIRECTOR];
  const add = id => {
    if (typeof id === 'string' && active.has(id) && !out.includes(id)) out.push(id);
  };
  for (const row of Array.isArray(rows) ? rows : []) add(cleanCell(row?.Agent));
  if (out.length === 1) {
    add(route?.owner);
    for (const id of Array.isArray(route?.support) ? route.support : []) add(id);
  }
  return out;
}

/**
 * The agent that wrote the work a gate shows: the last non-human plan row at or before the gate row. A person's own row and a script
 * row are skipped. Null when the plan has no such row or the author is the Director (the Director's own card needs no "from").
 */
export function gateAuthor(rows, gate) {
  if (!gate || !Array.isArray(rows)) return null;
  const active = agentRegistry();
  const at = rows.findIndex(row => cleanCell(row?.Gate) === gate || statesLib.gateOf(cleanCell(row?.['State after'])) === gate);
  if (at < 0) return null;
  for (let index = at; index >= 0; index -= 1) {
    const agent = cleanCell(rows[index]?.Agent);
    if (active.has(agent)) return agent === DIRECTOR ? null : agent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Runs, from agents.jsonl
// ---------------------------------------------------------------------------

/**
 * Fold the lines of agents.jsonl into runs, oldest first. A run is one spawn: dispatched, maybe started, then finished (a foreground
 * run), failed, or stopped (a background run ends with the host's stop event). A run with no end is open.
 */
export function runsFrom(lines) {
  const runs = [];
  const byTool = new Map();
  const byAgentId = new Map();
  const find = line => (line.toolUseId && byTool.get(line.toolUseId)) || (line.agentId && byAgentId.get(line.agentId)) || null;
  const make = line => {
    const run = {
      toolUseId: text(line.toolUseId), agentId: null, agent: line.agent, description: null, background: null, dispatchedAt: null, startedAt: null,
      endedAt: null, ended: null, summary: null, error: null, durationMs: null, model: null,
    };
    runs.push(run);
    if (run.toolUseId) byTool.set(run.toolUseId, run);
    return run;
  };
  const bind = (run, agentId) => {
    const id = text(agentId);
    if (!id) return;
    run.agentId = id;
    byAgentId.set(id, run);
  };
  const end = (run, kind, at) => {
    // A finished or failed line is the better word for how a run ended than the host's stop event, which may arrive before it.
    if (run.ended && !(run.ended === 'stopped' && kind !== 'stopped')) return;
    run.ended = kind;
    run.endedAt = text(at) ?? run.endedAt;
  };
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!plain(line) || typeof line.agent !== 'string') continue;
    const at = text(line.at);
    if (line.kind === 'dispatch') {
      const run = find(line) ?? make(line);
      run.description = text(line.description) ?? run.description;
      run.background = typeof line.background === 'boolean' ? line.background : run.background;
      run.dispatchedAt ??= at;
    } else if (line.kind === 'started') {
      const run = find(line) ?? make(line);
      bind(run, line.agentId);
      run.startedAt ??= at;
      run.model = text(line.model) ?? run.model;
    } else if (line.kind === 'finished') {
      const run = find(line) ?? make(line);
      bind(run, line.agentId);
      end(run, 'finished', at);
      run.durationMs = Number.isFinite(line.durationMs) ? line.durationMs : run.durationMs;
      run.model = text(line.model) ?? run.model;
    } else if (line.kind === 'failed') {
      const run = find(line) ?? make(line);
      end(run, 'failed', at);
      run.error = text(line.error) ?? run.error;
    } else if (line.kind === 'stopped') {
      const run = find(line) ?? make(line);
      bind(run, line.agentId);
      end(run, 'stopped', at);
      run.summary = text(line.summary) ?? run.summary;
    }
  }
  return runs;
}

const startOf = run => timeOf(run.startedAt) ?? timeOf(run.dispatchedAt);
const isOpen = run => !run.ended;
const isFresh = (run, now) => {
  const began = startOf(run);
  return began === null || now - began < STALE_RUN_MS;
};

/**
 * A helper that is allowed to hold up a review for this long, counted from its start. A helper that has run longer than this
 * with no end line is taken as lost (a killed session never fires the host's stop event), so a dead run cannot block a review forever.
 */
export const HELPER_WAIT_MS = 30 * 60 * 1000;

/**
 * The helpers still working on a job: runs of the job's agent log with a start or a dispatch and no end, started less than
 * HELPER_WAIT_MS ago. The Director (the producer) is never one: it is the agent that presents, and its own run is open until it stops.
 * `lines` is the parsed agents.jsonl. Oldest first.
 */
export function openHelpers(lines, { now = Date.now(), waitMs = HELPER_WAIT_MS } = {}) {
  return runsFrom(lines).filter(run => {
    if (run.agent === 'producer' || !isOpen(run)) return false;
    const began = startOf(run);
    return began !== null && now - began < waitMs;
  });
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Does a task output ref or a `produces` entry cover this path? Exact, a folder prefix, or a `*` pattern (a `*` crosses folders). */
export function refCovers(ref, path) {
  const out = canonicalArtifactRef(ref);
  const want = canonicalArtifactRef(path);
  if (!out || !want) return false;
  if (out === want) return true;
  if (!out.includes('*')) return out.endsWith('/') && want.startsWith(out);
  const body = out.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${out.endsWith('/') ? '' : '$'}`).test(want);
}

const YOURS = ['inputs/', 'media/supplied/'];
const RECORDS = ['approvals/', 'revisions/', 'validation/qc-frames/', 'publish/'];
const startsWithAny = (path, folders) => folders.some(folder => path.startsWith(folder));

/** The task contracts of the frozen plan, in plan order, or [] when the job has none. */
export function readTaskContracts(dir) {
  if (!dir) return [];
  const file = readJson(join(dir, 'task-contracts.json'));
  return Array.isArray(file?.tasks) ? file.tasks.filter(task => plain(task) && typeof task.agent === 'string' && Array.isArray(task.outputRefs)) : [];
}

/** Which roster agent owns a path: the first task contract that lists it, else the first roster agent whose agents.json `produces` covers it. */
function ownerOf(path, { contracts, roster }) {
  const owned = new Set(roster);
  for (const task of contracts) {
    if (owned.has(task.agent) && task.outputRefs.some(ref => refCovers(ref, path))) return task.agent;
  }
  const registry = agentRegistry();
  for (const agent of roster) {
    if ((registry.get(agent)?.produces ?? []).some(ref => refCovers(ref, path))) return agent;
  }
  return null;
}

/** "brief.md" gives "Brief", "drafts/D1/post.md" gives "Post (D1)". Only used when the document has no better title. */
function fallbackTitle(path) {
  const parts = String(path).split('/');
  const file = parts.pop() || '';
  const stem = file.replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' ').trim() || file;
  const title = stem.charAt(0).toUpperCase() + stem.slice(1);
  const folder = parts[parts.length - 1];
  return folder && /^D\d+$/i.test(folder) ? `${title} (${folder.toUpperCase()})` : title;
}

function titleMap(titles) {
  if (titles instanceof Map) return titles;
  return new Map(plain(titles) ? Object.entries(titles) : []);
}

// ---------------------------------------------------------------------------
// Messages, from messages/<agent>.jsonl (written by the message relay; the folder may not exist)
// ---------------------------------------------------------------------------

/**
 * The messages the person sent to one agent, oldest first, each with how far it got. Lines: `sent` {id, text, at}, `delivered` {id, at},
 * `reply` {id, text, at}. A line that is not JSON or names no sent message is skipped.
 */
export function readMessages(dir, agent) {
  if (!dir || !/^[a-z][a-z0-9-]*$/.test(String(agent))) return [];
  let raw;
  try {
    raw = readFileSync(join(dir, 'messages', `${agent}.jsonl`), 'utf8');
  } catch {
    return [];
  }
  const order = [];
  const byId = new Map();
  for (const row of raw.split(/\r?\n/)) {
    if (!row.trim()) continue;
    let line;
    try {
      line = JSON.parse(row);
    } catch {
      continue;
    }
    if (!plain(line) || typeof line.id !== 'string') continue;
    if (line.kind === 'sent' && typeof line.text === 'string') {
      if (byId.has(line.id)) continue;
      const message = { id: line.id, text: line.text.slice(0, MESSAGE_LIMIT), at: text(line.at), status: 'sent', deliveredAt: null, reply: null, repliedAt: null };
      byId.set(line.id, message);
      order.push(message);
    } else if (line.kind === 'delivered' && byId.has(line.id)) {
      const message = byId.get(line.id);
      message.deliveredAt ??= text(line.at);
      if (message.status === 'sent') message.status = 'delivered';
    } else if (line.kind === 'reply' && byId.has(line.id) && typeof line.text === 'string') {
      const message = byId.get(line.id);
      message.reply = line.text.slice(0, MESSAGE_LIMIT);
      message.repliedAt = text(line.at);
      message.status = 'answered';
    }
  }
  return order;
}

/** A message waits on an agent until it is passed on; one to the Director waits until it is answered (it is delivered at once). */
const isPending = (message, agent) => (agent === DIRECTOR ? message.status !== 'answered' : message.status === 'sent');

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function runActivity(run) {
  const out = [];
  const began = text(run.startedAt) ?? text(run.dispatchedAt);
  const task = plainLine(run.description, 100);
  if (began) out.push({ at: began, text: task ? `Started: ${task}` : 'Started working' });
  if (run.ended && run.endedAt) {
    const summary = plainLine(run.summary, 120);
    let line;
    if (run.ended === 'failed') {
      const reason = plainLine(run.error, 100);
      line = reason ? `Could not finish: ${reason}` : 'Could not finish';
    } else {
      const took = run.ended === 'finished' ? minutes(run.durationMs) : null;
      line = `Finished${took ? ` in ${took}` : ''}${summary ? `: ${summary}` : ''}`;
    }
    out.push({ at: run.endedAt, text: line });
  }
  return out;
}

function messageActivity(messages, agent) {
  const out = [];
  for (const message of messages) {
    if (message.at) out.push({ at: message.at, text: 'You sent a message' });
    if (message.deliveredAt && agent !== DIRECTOR) out.push({ at: message.deliveredAt, text: 'Your message was passed on' });
    if (message.repliedAt) out.push({ at: message.repliedAt, text: agent === DIRECTOR ? 'The Director answered your message' : 'Your message was answered' });
  }
  return out;
}

// What the Director did: the moves in status.md's stage log, and the decisions the person made.
function directorActivity({ dir, decisions }) {
  const out = [];
  let status = '';
  try {
    status = dir ? readFileSync(join(dir, 'status.md'), 'utf8') : '';
  } catch {
    status = '';
  }
  let last = null;
  for (const line of status.split(/\r?\n/)) {
    const cells = line.split('|').map(cell => cell.trim());
    if (cells.length < 5 || !/^\d{4}-\d{2}-\d{2}T/.test(cells[1])) continue;
    const state = cleanCell(cells[3]);
    const label = state && statesLib.exists(state) ? statesLib.label(state) : null;
    if (!label || label === last) continue;
    last = label;
    out.push({ at: cells[1], text: label });
  }
  for (const record of Array.isArray(decisions) ? decisions : []) {
    if (!plain(record) || record.malformed || typeof record.gate !== 'string' || !text(record.decidedAt)) continue;
    const words = DECISION_WORDS[record.gate];
    if (!words) continue;
    const approved = /^approved?$/.test(String(record.decision));
    out.push({ at: record.decidedAt, text: approved ? `You approved the ${words}` : `You asked for changes to the ${words}` });
  }
  return out;
}

/** Newest first, at most `limit`. Entries with no readable time are dropped. */
function newestFirst(entries, limit) {
  return entries
    .map((entry, index) => ({ entry, index, time: timeOf(entry.at) }))
    .filter(item => item.time !== null)
    .sort((a, b) => b.time - a.time || b.index - a.index)
    .slice(0, limit)
    .map(item => ({ at: item.entry.at, text: item.entry.text }));
}

/** One run as the step history lists it: when it began and ended, what it was asked, how it ended and how long it took. */
function sessionOf(run, now) {
  const lost = isOpen(run) && !isFresh(run, now);
  const state = run.ended ?? (lost ? 'lost' : 'running');
  const reason = state === 'failed' ? plainLine(run.error, 100) : null;
  return {
    at: text(run.startedAt) ?? text(run.dispatchedAt),
    end: text(run.endedAt),
    state,
    task: plainLine(run.description, 80),
    tookMs: Number.isFinite(run.durationMs) ? run.durationMs : null,
    summary: reason ?? plainLine(run.summary, 100),
  };
}

// ---------------------------------------------------------------------------
// The Director's needs
// ---------------------------------------------------------------------------

// The same key the board gives an inbox item (board/src/board.js inboxKey), so a need can be matched to its card.
export function inboxKey(item) {
  if (item?.kind === 'onboarding') return `onboarding-${item.brand || ''}`;
  if (item?.kind === 'post') return `post-${item.jobId || ''}-${item.target || ''}`;
  if (item?.kind === 'question') return `question-${item.questionId}`;
  return [item?.kind || 'item', item?.jobId || '', item?.field || ''].filter(Boolean).join('-');
}

/** What the person must act on, one entry per inbox item: its key, its kind, its gate, and `from` (the agent behind it, or null). */
function needsOf(items, rows) {
  return items.map(item => ({
    key: inboxKey(item),
    kind: item?.kind || 'item',
    gate: item?.gate || null,
    from: item?.kind === 'decision' ? gateAuthor(rows, item.gate) : null,
  }));
}

/** Is the person needed? The same test as personWaiting, from the pieces already built: an open inbox item, a blocked job, or a delivery to close. */
function personWaits({ inbox, state }) {
  if ((inbox.items || []).some(item => !item?.closing)) return true;
  return BLOCKED_STATES.has(state) || state === 'HANDOFF_READY';
}

// ---------------------------------------------------------------------------
// Stuck jobs
// ---------------------------------------------------------------------------

export const STUCK_KINDS = Object.freeze(['missing_info', 'approval', 'clarification', 'account', 'internal']);
/** No change for this long, with nobody waiting on the person and no agent running, is a stuck job. */
export const STUCK_QUIET_MS = 6 * 60 * 60 * 1000;
/** A job quiet for longer than this is paused, not stuck, so old idle jobs never show as stuck. */
export const STUCK_PAUSED_MS = 3 * 24 * 60 * 60 * 1000;
/** After "Try again", the job shows "Trying this step again" for this long before a second failure is assumed. */
export const RETRY_TRYING_MS = 30 * 60 * 1000;
/** A retry older than this is forgotten: a new problem gets its own "Try again". */
export const RETRY_MEMORY_MS = 12 * 60 * 60 * 1000;

// Words in an error or a held-up line that mean a connected account, a login or credits, which only the person can sort out.
const ACCOUNT_SIGNS = /credits?|log ?in|logged out|sign(?:ed)? in|expired|reconnect|not connected|unauthori[sz]ed|forbidden|api key|\btoken\b|\b40[13]\b/i;
const REASONS = Object.freeze({
  missing_info: "We're missing something from you to carry on.",
  approval: 'Your approval is the next step.',
  clarification: 'We need to check one thing with you.',
});
export const RETRY_TRYING_TEXT = 'Trying this step again.';
export const RETRY_FAILED_TEXT = "It didn't work again. We've saved the details for our team. There's nothing you need to do.";

function accountReason(said) {
  if (/credits?/i.test(said)) return "You're out of credits. Top up, then say done.";
  if (/metricool/i.test(said)) return "Metricool's login expired. Reconnect it, then say done.";
  if (/elevenlabs/i.test(said)) return 'ElevenLabs needs you to sign in again. Reconnect it, then say done.';
  if (/3 ?echo/i.test(said)) return '3echo needs you to sign in again. Reconnect it, then say done.';
  return 'A connected account needs you. Reconnect it, then say done.';
}

function blockedKind(said, items) {
  if (ACCOUNT_SIGNS.test(said)) return 'account';
  if (items.some(item => item.kind === 'decision')) return 'approval';
  if (items.some(item => item.kind === 'question')) return 'clarification';
  if (items.some(item => item.kind === 'brief')) return 'missing_info';
  if (/approv|decision|sign off/i.test(said)) return 'approval';
  if (/unclear|clarif|not sure|which one|ambiguous|not right/i.test(said)) return 'clarification';
  return 'missing_info';
}

/** The latest sign of life in a job: its status time, its agent lines, and the last write to its event log. Milliseconds, or null. */
export function lastChangeAt({ dir, updatedAt, lines = [] } = {}) {
  const times = [timeOf(updatedAt), ...lines.map(line => timeOf(line?.at))];
  try {
    if (dir) times.push(statSync(join(dir, 'events.jsonl')).mtimeMs);
  } catch {
    // a job with no event log has only its status time
  }
  const known = times.filter(time => Number.isFinite(time));
  return known.length ? Math.max(...known) : null;
}

/**
 * Is this job stuck, and for what reason the person can understand? Null when it is not. The signals, first match wins: the job is
 * BLOCKED or ESCALATED; a board request needs reconciliation; an agent's last run failed or went stale and the job has not moved on since;
 * nothing changed for six hours while nobody waits on the person and no agent runs.
 *
 * Each signal gets one kind: missing_info, approval, clarification, account, or internal. The person is never asked to fix an internal
 * problem; they see "Something went wrong on our side" and a "Try again" that works once. A second failure shows a fixed
 * "It didn't work again" line and no button. `asked` says the person already has the question on the board (an internal
 * problem has none to ask). `since` is when the signal began. `reason` is one plain line; the board shows it after "Stuck:".
 *
 * Pure: every input is passed in. `runs` come from runsFrom, `requests` are the job's needs_reconciliation board requests as
 * [{at, detail}], `retriedAt` is when "Try again" was last applied for this job (ms) and `changedAt` is lastChangeAt.
 */
export function stuckOf({ state, inboxItems = [], blockedLine = null, runs = [], requests = [], updatedAt = null, changedAt = null, stageLabel = null, retriedAt = null, now = Date.now() } = {}) {
  if (!state || statesLib.isTerminal(state)) return null;
  const items = (Array.isArray(inboxItems) ? inboxItems : []).filter(plain);
  const updated = timeOf(updatedAt);
  const live = runs.some(run => isOpen(run) && isFresh(run, now));
  let signal = null;

  if (BLOCKED_STATES.has(state)) {
    const said = text(blockedLine) ?? '';
    signal = { at: updated, said, kind: !said && !items.length ? 'internal' : blockedKind(said, items) };
  }
  if (!signal) {
    const request = [...requests].filter(plain).sort((a, b) => (timeOf(a.at) ?? 0) - (timeOf(b.at) ?? 0))[0];
    if (request) signal = { at: timeOf(request.at), said: text(request.detail) ?? '', kind: null };
  }
  if (!signal) {
    const last = new Map();
    for (const run of runs) if (run.agent !== DIRECTOR) last.set(run.agent, run);
    for (const run of last.values()) {
      const failed = run.ended === 'failed';
      const lost = isOpen(run) && !isFresh(run, now);
      const at = failed ? timeOf(run.endedAt) : startOf(run);
      // A run the job has moved past is not what holds it up.
      if ((failed || lost) && (updated === null || at === null || at >= updated)) {
        signal = { at, said: failed ? (run.error ?? '') : '', kind: null };
        break;
      }
    }
  }
  if (!signal && !live && changedAt !== null && now - changedAt > STUCK_QUIET_MS && now - changedAt <= STUCK_PAUSED_MS && !personWaits({ inbox: { items }, state })) {
    signal = { at: changedAt, said: '', kind: null, quiet: true };
  }
  if (!signal) return null;

  const kind = signal.kind ?? (ACCOUNT_SIGNS.test(signal.said) ? 'account' : 'internal');
  const since = new Date(signal.at ?? now).toISOString();
  let reason;
  if (kind === 'account') reason = accountReason(signal.said);
  else if (kind === 'internal') {
    const where = stageLabel ? ` while ${lowerFirst(stageLabel)}` : '';
    reason = signal.quiet ? 'This job stopped moving. Try again to get it going.' : `Something went wrong on our side${where}.`;
  } else reason = REASONS[kind];

  let retry = null;
  if (kind === 'internal' && retriedAt !== null && now - retriedAt <= RETRY_MEMORY_MS) {
    const same = (timeOf(since) ?? 0) <= retriedAt;
    retry = same && now - retriedAt <= RETRY_TRYING_MS ? 'trying' : 'failed_again';
    reason = retry === 'trying' ? RETRY_TRYING_TEXT : RETRY_FAILED_TEXT;
  }
  const asked = kind === 'internal' ? true
    : kind === 'approval' ? items.some(item => item.kind === 'decision')
      : kind === 'missing_info' ? items.some(item => item.kind === 'question' || item.kind === 'brief')
        : items.some(item => item.kind === 'question');
  return { reason, kind, since, asked, canRetry: kind === 'internal' && !retry, ...(retry ? { retry } : {}) };
}

function clockOf(now) {
  return now instanceof Date ? now.getTime() : typeof now === 'string' ? (timeOf(now) ?? Date.now()) : Number.isFinite(now) ? now : Date.now();
}

/** stuckOf from what a job snapshot (full or light) holds and the job folder: reads agents.jsonl unless `lines` is given. */
export function stuckFor({ dir, snapshot, inboxItems, requests = [], retriedAt = null, blockedLine = null, now, lines } = {}) {
  const clock = clockOf(now);
  const state = text(snapshot?.project?.state) ?? text(snapshot?.status?.state);
  if (!state || statesLib.isTerminal(state)) return null;
  // A video with Post-production is waiting on them, not stuck.
  if (handoffSent(dir)) return null;
  const all = lines ?? (dir ? readAgentLines(dir) : []);
  const updatedAt = text(snapshot?.status?.updatedAt);
  const open = (Array.isArray(snapshot?.project?.stages) ? snapshot.project.stages : []).find(stage => plain(stage) && !stage.skipped && !DONE_STAGE.has(stage.status));
  return stuckOf({
    state, inboxItems, blockedLine, runs: runsFrom(all), requests, updatedAt, changedAt: lastChangeAt({ dir, updatedAt, lines: all }),
    stageLabel: text(open?.label), retriedAt, now: clock,
  });
}

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/**
 * Hold the section to AGENT_BOX_BUDGET_BYTES, shedding in the documented order and stopping as soon as it fits: activity beyond 2 per
 * agent; older message texts clipped to 140 characters (the newest of each agent keeps its text); files beyond 4 per agent; Your files,
 * Records and Other files beyond 8; all activity; all but the newest message (the counts stay). id, name, model, state, task, needs and
 * pendingMessages are never dropped. Sets `truncated` when it had to shed anything.
 */
export function fitAgentBox(section, budget = AGENT_BOX_BUDGET_BYTES) {
  const fits = () => byteSize(section) <= budget;
  if (fits()) return section;
  section.truncated = true;
  const steps = [
    () => section.list.forEach(agent => { agent.activity = agent.activity.slice(0, ACTIVITY_SHED); }),
    () => section.list.forEach(agent => {
      agent.messages = agent.messages.map((message, index, all) => {
        if (index === all.length - 1) return message;
        const clipped = { ...message, text: message.text.length > MESSAGE_CLIP ? `${message.text.slice(0, MESSAGE_CLIP - 3).trimEnd()}...` : message.text };
        if (typeof message.reply === 'string' && message.reply.length > MESSAGE_CLIP) clipped.reply = `${message.reply.slice(0, MESSAGE_CLIP - 3).trimEnd()}...`;
        return clipped;
      });
    }),
    () => section.list.forEach(agent => {
      if (agent.files.length > FILES_SHED) {
        agent.filesMore += agent.files.length - FILES_SHED;
        agent.files = agent.files.slice(0, FILES_SHED);
      }
    }),
    () => {
      for (const key of ['yours', 'records', 'other']) {
        const list = section.unassigned[key];
        if (list.length > UNASSIGNED_SHED) {
          section.unassigned[`${key}More`] += list.length - UNASSIGNED_SHED;
          section.unassigned[key] = list.slice(0, UNASSIGNED_SHED);
        }
      }
    },
    () => section.list.forEach(agent => { agent.activity = []; if (Array.isArray(agent.runs)) agent.runs = agent.runs.slice(-1); if (Array.isArray(agent.sessions)) agent.sessions = agent.sessions.slice(-2); }),
    () => section.list.forEach(agent => {
      if (agent.messages.length > 1) {
        agent.messagesMore += agent.messages.length - 1;
        agent.messages = agent.messages.slice(-1);
      }
    }),
  ];
  for (const step of steps) {
    step();
    if (fits()) break;
  }
  return section;
}

// ---------------------------------------------------------------------------
// agentBox
// ---------------------------------------------------------------------------

function eventModel(events) {
  let model = null;
  for (const event of Array.isArray(events) ? events : []) {
    if (!plain(event) || event.eventName !== 'tokens.observed' || !plain(event.attrs)) continue;
    if (event.attrs.agentType || !text(event.attrs.model)) continue;
    model = event.attrs.model;
  }
  return shortModel(model);
}

/**
 * @param {object} input
 * @param {string} input.root       the workspace root (only used to find the job folder when `dir` is not given)
 * @param {string} input.brand      the brand slug
 * @param {string} input.jobId
 * @param {object} input.snapshot   readJobSnapshot's result: project (state, stages, decisions), plan.rows, route, events, status
 * @param {object} input.details    the board details: artifacts, pendingReviews
 * @param {object} input.inbox      the job's inbox: { items }
 * @param {number|string|Date} [input.now]
 * @param {string}  [input.dir]     the job folder
 * @param {object[]} [input.lines]    agents.jsonl lines (read from the job folder when left out)
 * @param {object[]} [input.contracts] task contracts (read from the job folder when left out)
 * @param {Record<string, object[]>} [input.messages] messages by agent (read from messages/ when left out)
 * @param {Array<{path:string,title?:string}>} [input.pinned] the pinned final files, shown first
 * @param {object|Map} [input.titles] path to title, for the files the document already titled
 * @param {Array<{at:string,detail?:string}>} [input.requests] the job's board requests that need reconciliation (a stuck signal)
 * @param {number|null} [input.retriedAt] when "Try again" was last applied for this job, in ms
 * @param {string|null} [input.blockedLine] the plain line the board shows for a held-up job (null when there is none)
 * @returns {{v:1, list:object[], unassigned:object, truncated:boolean}}
 */
export function agentBox({ root, brand, jobId, snapshot, details, inbox, now, dir, lines, contracts, messages, pinned, titles, requests, retriedAt, blockedLine } = {}) {
  const clock = clockOf(now);
  const folder = dir ?? (root && brand && jobId ? join(resolve(root), 'workspaces', brand, 'jobs', jobId) : null);
  const project = plain(snapshot?.project) ? snapshot.project : {};
  const state = text(project.state) ?? text(snapshot?.status?.state) ?? 'UNKNOWN';
  const finished = statesLib.isTerminal(state);
  const rows = Array.isArray(snapshot?.plan?.rows) ? snapshot.plan.rows : [];
  const inboxItems = Array.isArray(inbox?.items) ? inbox.items : [];
  const roster = rosterOf({ rows, route: snapshot?.route });
  const registry = agentRegistry();

  // Where each agent's rows sit in the stage list, and which stages are current and next.
  const stages = (Array.isArray(project.stages) ? project.stages : []).filter(stage => plain(stage) && !stage.skipped);
  const rowStages = new Map(roster.map(agent => [agent, []]));
  stages.forEach((stage, index) => {
    for (const task of Array.isArray(stage.tasks) ? stage.tasks : []) {
      const agent = cleanCell(task?.agent);
      if (rowStages.has(agent) && !rowStages.get(agent).includes(index)) rowStages.get(agent).push(index);
    }
  });
  const open = stages.findIndex(stage => !DONE_STAGE.has(stage.status));
  const window = new Set();
  if (open >= 0) {
    window.add(open);
    const next = stages.findIndex((stage, index) => index > open && !DONE_STAGE.has(stage.status) && roster.some(agent => agent !== DIRECTOR && rowStages.get(agent).includes(index)));
    if (next >= 0) window.add(next);
  }

  // Files.
  const contractList = contracts ?? readTaskContracts(folder);
  const pinnedList = (Array.isArray(pinned) ? pinned : []).filter(item => plain(item) && typeof item.path === 'string');
  const pinnedOrder = new Map(pinnedList.map((item, index) => [item.path, index]));
  const known = titleMap(titles);
  for (const item of pinnedList) if (text(item.title) && !known.has(item.path)) known.set(item.path, item.title.trim());
  const artifacts = (Array.isArray(details?.artifacts) ? details.artifacts : []).filter(item => plain(item) && typeof item.path === 'string');
  const owned = new Map(roster.map(agent => [agent, []]));
  const unassigned = { yours: [], records: [], other: [] };
  for (const item of artifacts) {
    const file = { path: item.path, sha256: text(item.sha256), title: known.get(item.path) || fallbackTitle(item.path), pinned: pinnedOrder.has(item.path) };
    const owner = ownerOf(item.path, { contracts: contractList, roster });
    if (owner) owned.get(owner).push(file);
    else if (startsWithAny(item.path, YOURS)) unassigned.yours.push(file);
    else if (startsWithAny(item.path, RECORDS)) unassigned.records.push(file);
    else unassigned.other.push(file);
  }
  for (const files of owned.values()) {
    const rank = file => (file.pinned ? pinnedOrder.get(file.path) : Number.POSITIVE_INFINITY);
    // A stable sort: pinned finals first in the order they are pinned, the rest as listed.
    files.sort((a, b) => (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1));
  }

  // Runs, messages and the gate the person is deciding.
  const allLines = lines ?? (folder ? readAgentLines(folder) : []);
  const allRuns = runsFrom(allLines);
  const stuck = stuckFor({ dir: folder, snapshot, inboxItems, requests, retriedAt: retriedAt ?? null, blockedLine, now: clock, lines: allLines });
  const pendingPaths = new Set((Array.isArray(details?.pendingReviews) ? details.pendingReviews : []).flatMap(review => (Array.isArray(review?.artifacts) ? review.artifacts : [])).map(item => item?.path).filter(path => typeof path === 'string'));
  const waits = personWaits({ inbox: { items: inboxItems }, state });
  const oldestNeed = inboxItems.map(item => timeOf(item?.at)).filter(time => time !== null).sort((a, b) => a - b)[0];
  const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

  const list = roster.map(agent => {
    const runs = allRuns.filter(run => run.agent === agent);
    const live = runs.filter(run => isOpen(run) && isFresh(run, clock));
    const lastRun = runs[runs.length - 1] ?? null;
    const files = owned.get(agent);
    const stageRows = rowStages.get(agent);
    const rowsDone = stageRows.length > 0 && stageRows.every(index => DONE_STAGE.has(stages[index].status));
    const sent = messages ? (Array.isArray(messages[agent]) ? messages[agent] : []) : readMessages(folder, agent);
    const isDirector = agent === DIRECTOR;
    let at = null;
    let note = null;
    let agentState;

    if (isDirector && waits && !finished) {
      agentState = 'needs_you';
      at = iso(oldestNeed);
    } else if (live.length) {
      agentState = 'working';
      at = iso(Math.min(...live.map(run => startOf(run)).filter(time => time !== null)));
    } else if (isDirector && !finished) {
      agentState = 'working';
      at = text(snapshot?.status?.updatedAt);
    } else if (!isDirector && !finished && files.some(file => pendingPaths.has(file.path))) {
      // One voice: only the Director asks the person. The agent that wrote the files under review has handed them over, so it
      // is not waiting on the person and never needs_you.
      agentState = 'waiting';
      note = HANDED_NOTE;
    } else if (!isDirector && !finished && !rowsDone && lastRun && (lastRun.ended === 'failed' || (isOpen(lastRun) && !isFresh(lastRun, clock)))) {
      agentState = 'waiting';
      note = lastRun.ended === 'failed' ? 'The last run did not finish' : 'The last run stopped responding';
      at = lastRun.ended === 'failed' ? lastRun.endedAt : text(lastRun.startedAt) ?? text(lastRun.dispatchedAt);
    } else if (finished || isDirector || rowsDone) {
      agentState = 'done';
      const ends = runs.map(run => timeOf(run.endedAt)).filter(time => time !== null);
      at = ends.length ? iso(Math.max(...ends)) : null;
    } else if (stageRows.some(index => window.has(index))) {
      agentState = 'up_next';
    } else {
      agentState = 'waiting';
      const later = stageRows.find(index => !DONE_STAGE.has(stages[index].status));
      const before = later === undefined ? stages[open >= 0 ? open : 0] : stages[Math.max(0, later - 1)];
      note = before?.label ? `Starts after ${lowerFirst(before.label)}` : 'Starts after the plan is set';
    }

    // The task line: the work in hand when an agent is running, else what the role does.
    let task = actionOf(agent);
    if (!isDirector && agentState === 'working') {
      const said = [...new Set(live.map(run => plainLine(run.description, TASK_LIMIT)).filter(Boolean))];
      if (said.length) task = clipOneLine(said.join('; '), TASK_LIMIT);
    }

    const activity = isDirector
      ? [...directorActivity({ dir: folder, decisions: project.decisions }), ...messageActivity(sent, agent)]
      : [...runs.flatMap(runActivity), ...messageActivity(sent, agent)];
    const shown = sent.slice(-MESSAGES_SHOWN).map(({ id, text: body, at: sentAt, status, deliveredAt, reply }) => ({ id, text: body, at: sentAt, status, deliveredAt, reply }));
    const model = isDirector ? eventModel(snapshot?.events) : (shortModel(registry.get(agent)?.model) ?? shortModel(runs.map(run => run.model).filter(Boolean).pop()));
    const card = {
      id: agent,
      name: nameOf(agent),
      model,
      state: agentState,
      task,
      role: actionOf(agent),
      since: at,
      files: files.slice(0, FILES_SHOWN),
      filesMore: Math.max(0, files.length - FILES_SHOWN),
      activity: newestFirst(activity, ACTIVITY_SHOWN),
      sessions: runs.slice(-SESSIONS_SHOWN).map(run => sessionOf(run, clock)),
      runs: isDirector ? [] : runs.filter(run => run.ended === 'finished' && text(run.endedAt)).slice(-RUNS_SHOWN).map(run => ({ at: run.endedAt, tookMs: Number.isFinite(run.durationMs) ? run.durationMs : null })),
      messages: shown,
      messagesMore: Math.max(0, sent.length - shown.length),
      pendingMessages: sent.filter(message => isPending(message, agent)).length,
      needs: isDirector ? needsOf(inboxItems, rows) : [],
    };
    if (note) card.note = note;
    if (isDirector && stuck) card.stuck = stuck;
    return card;
  });

  const cap = (files, key) => {
    const kept = files.slice(0, UNASSIGNED_SHOWN);
    return { [key]: kept, [`${key}More`]: files.length - kept.length };
  };
  return fitAgentBox({
    v: 1,
    list,
    unassigned: { ...cap(unassigned.yours, 'yours'), ...cap(unassigned.records, 'records'), ...cap(unassigned.other, 'other') },
    truncated: false,
  });
}

/**
 * The short line a job card on the home page shows while agents work, at most 80 characters: "Strategist working", "Researcher and
 * Copywriter working". Null when no agent other than the Director is working.
 */
export function agentLine(agents) {
  const names = (Array.isArray(agents?.list) ? agents.list : []).filter(agent => agent.id !== DIRECTOR && agent.state === 'working').map(agent => agent.name);
  if (!names.length) return null;
  const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more`;
  return clipOneLine(`${who} working`, AGENT_LINE_LIMIT);
}

/**
 * The last resort when the whole job document is still over its budget: every card keeps only id, name, model, state, task, needs,
 * pendingMessages (and its note, since and stuck line); files, activity and messages go and their counts stay in filesMore and
 * messagesMore. Returns a new section.
 */
export function coreOnlyAgentBox(section) {
  const list = (Array.isArray(section?.list) ? section.list : []).map(agent => {
    const { id, name, model, state, task, role, since, note, needs, pendingMessages, stuck } = agent;
    return {
      id, name, model, state, task, role, since: since ?? null, files: [], filesMore: (agent.files?.length ?? 0) + (agent.filesMore ?? 0), activity: [], runs: [], sessions: [],
      messages: [], messagesMore: (agent.messages?.length ?? 0) + (agent.messagesMore ?? 0), pendingMessages, needs,
      ...(note ? { note } : {}), ...(stuck ? { stuck } : {}),
    };
  });
  return { v: 1, list, unassigned: { yours: [], records: [], other: [], yoursMore: 0, recordsMore: 0, otherMore: 0 }, truncated: true };
}

/**
 * The home page's line for one job without building the whole box: the agents with a live run, as agentLine words them. Reads
 * agents.jsonl from `dir` unless `lines` is given. Null when the job is finished or only the Director works.
 */
export function jobAgentLine({ dir, snapshot, lines, now } = {}) {
  const state = text(snapshot?.project?.state) ?? text(snapshot?.status?.state);
  if (!state || statesLib.isTerminal(state)) return null;
  const clock = clockOf(now);
  const runs = runsFrom(lines ?? (dir ? readAgentLines(dir) : []));
  const list = rosterOf({ rows: snapshot?.plan?.rows, route: snapshot?.route })
    .filter(id => id !== DIRECTOR && runs.some(run => run.agent === id && isOpen(run) && isFresh(run, clock)))
    .map(id => ({ id, name: nameOf(id), state: 'working' }));
  return agentLine({ list });
}

// ---------------------------------------------------------------------------
// Brand onboarding: a small list of agents, no job
// ---------------------------------------------------------------------------

const RESEARCHER = 'researcher';

// The same reading the board makes of a brand's research usage: running, complete, failed or new.
function onboardingPhase({ usage, onboardingStatus, clock }) {
  const status = usage?.status ?? null;
  const pending = usage?.pending ?? null;
  const until = timeOf(usage?.pendingUntil);
  const lapsed = pending === 'expired' || (pending === 'waiting' && until !== null && clock >= until);
  if (status === 'running') return 'running';
  if (pending && lapsed) return 'failed';
  if (pending === 'waiting') return 'running';
  if (status === 'complete') return 'complete';
  if (status === 'failed' || status === 'abandoned') return 'failed';
  return onboardingStatus === 'complete' ? 'complete' : 'new';
}

/**
 * The agents on a brand's onboarding page: the Director, then the Researcher (always), then any other agent that recorded a run
 * under the brand (<brand folder>/onboarding/agents.jsonl). Cards use the job card shape, with no files or messages.
 * @param {{brandDir:string, brandName?:string, usage?:object, onboardingStatus?:string, readyForJobs?:boolean, now?:number|string|Date, lines?:object[]}} input
 * @returns {{v:1, list:object[]}}
 */
export function onboardingAgents({ brandDir, brandName, usage, onboardingStatus, readyForJobs, now, lines } = {}) {
  const clock = clockOf(now);
  const phase = onboardingPhase({ usage, onboardingStatus, clock });
  const registry = agentRegistry();
  const runs = runsFrom(lines ?? (brandDir ? readAgentLines(join(brandDir, 'onboarding')) : []));
  const brand = clipOneLine(brandName, 60) || 'your brand';
  const card = (id, fields) => ({
    id, name: nameOf(id), model: shortModel(registry.get(id)?.model), state: 'waiting', task: actionOf(id), role: actionOf(id), since: null, files: [], filesMore: 0,
    activity: [], runs: [], sessions: [], messages: [], messagesMore: 0, pendingMessages: 0, ...fields,
  });

  const waitsOnPerson = phase === 'failed'
    ? 'Research could not finish. Fill in the profile by hand'
    : phase === 'complete' ? 'Waiting for you to check the brand profile' : 'Waiting for you to start onboarding';
  const director = phase === 'running' ? { state: 'working', task: 'Getting your brand ready' }
    : readyForJobs ? { state: 'done', task: 'Your brand is ready for jobs' }
      : { state: 'needs_you', task: waitsOnPerson };

  const ids = [RESEARCHER, ...runs.map(run => run.agent).filter(id => id !== DIRECTOR)].filter((id, at, all) => all.indexOf(id) === at);
  const others = ids.map(id => {
    const mine = runs.filter(run => run.agent === id);
    const open = mine.filter(run => isOpen(run) && isFresh(run, clock)).at(-1);
    const last = mine.at(-1);
    const researcher = id === RESEARCHER;
    if (open) return card(id, { state: 'working', since: text(open.startedAt) ?? text(open.dispatchedAt), task: researcher ? `Researching ${brand}` : actionOf(id) });
    if (last?.ended === 'failed') return card(id, { state: 'waiting', task: researcher ? 'Could not finish the research' : actionOf(id) });
    if (last || (researcher && phase === 'complete')) {
      const summary = plainLine(last?.summary, 160);
      return card(id, { state: 'done', task: researcher ? `Researched ${brand}` : actionOf(id), ...(summary ? { note: summary } : {}) });
    }
    return card(id, { state: 'up_next', task: phase === 'running' ? 'Gets to work in a moment' : 'Researches your brand after you start' });
  });
  return { v: 1, list: [card(DIRECTOR, director), ...others] };
}
