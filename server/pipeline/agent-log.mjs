// The record of which agents ran on a job, written only by the agent-run hook.
//
// Two small files hold it:
//   <job>/agents.jsonl                              one line per fact about a run: dispatch, started, finished, failed, stopped
//   <workspace>/.social-pipeline/board/agent-runs.json   the open and recent runs, so a later event finds the job its run belongs to
// Both are written under the lib-durable lock (agents can start in parallel) and neither is ever read to decide money, approval
// or publishing. A third file, agent-reminders.json beside stop-hook.json, remembers that the board was already told about a job.
//
// Line shapes (v: 1; `at` is an ISO time):
//   {kind:'dispatch', toolUseId, agent, description, background, sessionId}
//   {kind:'started',  toolUseId, agentId, agent, model?, sessionId}
//   {kind:'finished', toolUseId, agentId?, agent, durationMs?, tokens?, model?}
//   {kind:'failed',   toolUseId, agent, error}                    error at most 120 characters
//   {kind:'stopped',  toolUseId?, agentId, agent, summary?}       summary is one plain line, at most 160 characters

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const durable = require(join(PLUGIN_ROOT, 'pipeline', 'scripts', 'lib-durable.js'));

export const AGENTS_FILE = 'agents.jsonl';
export const AGENT_PREFIX = 'social-campaign:';
export const RUNS_KEEP = 200;
export const ERROR_LIMIT = 120;
export const SUMMARY_LIMIT = 160;
export const DESCRIPTION_LIMIT = 200;
/** A run with no end line that is older than this is treated as lost (a killed session never fires SubagentStop). */
export const STALE_RUN_MS = 2 * 60 * 60 * 1000;
const REMINDERS_KEEP = 100;
const LOCK_WAIT_MS = 3000;

const BOARD_DIR = join('.social-pipeline', 'board');
const boardFile = (root, name) => join(resolve(root), BOARD_DIR, name);
export const runsFile = root => boardFile(root, 'agent-runs.json');
export const remindersFile = root => boardFile(root, 'agent-reminders.json');
export const agentsFile = jobDir => join(jobDir, AGENTS_FILE);

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Which agents count
// ---------------------------------------------------------------------------

let activeIds = null;

/** The ids of the agents agents.json lists as active, or an empty set when the file cannot be read (nothing is then recorded). */
export function activeAgentIds() {
  if (activeIds) return activeIds;
  const registry = readJson(join(PLUGIN_ROOT, 'pipeline', 'registry', 'agents.json'));
  const list = Array.isArray(registry?.agents) ? registry.agents : [];
  activeIds = new Set(list.filter(entry => plain(entry) && entry.status === 'active' && typeof entry.agentId === 'string').map(entry => entry.agentId));
  return activeIds;
}

/** `social-campaign:strategist` gives `strategist` when that agent is active. Anything else, including a bare name, gives null. */
export function agentOf(subagentType) {
  const value = typeof subagentType === 'string' ? subagentType.trim() : '';
  if (!value.startsWith(AGENT_PREFIX)) return null;
  const id = value.slice(AGENT_PREFIX.length);
  return activeAgentIds().has(id) ? id : null;
}

let roles = null;

/** What the board calls an agent in a sentence: the Director for the producer, else the role label. */
export function agentLabel(agent) {
  if (agent === 'producer') return 'Director';
  try {
    roles ??= require(join(PLUGIN_ROOT, 'pipeline', 'scripts', 'lib-roles.js'));
    const label = roles.ROLES?.[agent]?.label;
    if (label) return label;
  } catch {
    // fall through to the id
  }
  const words = String(agent).replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Plain one-line text
// ---------------------------------------------------------------------------

/** One plain line of at most `limit` characters: markdown marks dropped, every run of white space one space, clipped with "...". */
export function clipOneLine(value, limit) {
  let line = String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]{1,200}>/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|[-*+>]|\d+[.)])\s+/gm, '')
    .replace(/[*`~|]+/g, ' ')
    .replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (line.length > limit) line = `${line.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
  return line;
}

// ---------------------------------------------------------------------------
// <job>/agents.jsonl
// ---------------------------------------------------------------------------

/** One line added to the job's agent log under the lock. Returns the line written. Throws when the lock cannot be taken. */
export function appendAgentLine(jobDir, line) {
  const entry = { v: 1, ...line, at: line.at ?? new Date().toISOString() };
  const file = agentsFile(jobDir);
  // The lock file is a dot name beside the log, so a listing of the job's files never shows it.
  const release = durable.acquire(join(jobDir, '.agents'), { timeoutMs: LOCK_WAIT_MS });
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', flag: 'a' });
  } finally {
    release();
  }
  return entry;
}

/** Every readable line of the job's agent log, oldest first. A line that is not JSON is skipped. */
export function readAgentLines(jobDir) {
  let raw;
  try {
    raw = readFileSync(agentsFile(jobDir), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const row of raw.split(/\r?\n/)) {
    if (!row.trim()) continue;
    try {
      const value = JSON.parse(row);
      if (plain(value) && value.v === 1 && typeof value.kind === 'string') out.push(value);
    } catch {
      continue;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// .social-pipeline/board/agent-runs.json
// ---------------------------------------------------------------------------

const isRun = value => plain(value) && typeof value.agent === 'string' && typeof value.brand === 'string' && typeof value.jobId === 'string';

/** The runs on record, oldest first, read without the lock (the file is always replaced whole). */
export function readRuns(root) {
  const record = readJson(runsFile(root));
  return Array.isArray(record?.runs) ? record.runs.filter(isRun) : [];
}

/**
 * Run `work(runs)` on the recorded runs under the lock. `work` changes the array and its entries in place and may return a
 * value, which is returned from here. Only the newest RUNS_KEEP runs are kept.
 */
export function withRuns(root, work) {
  let out;
  const file = runsFile(root);
  mkdirSync(dirname(file), { recursive: true });
  durable.update(file, raw => {
    let runs = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.runs)) runs = parsed.runs.filter(isRun);
    } catch {
      runs = [];
    }
    out = work(runs);
    return `${JSON.stringify({ v: 1, runs: runs.slice(-RUNS_KEEP) })}\n`;
  }, '');
  return out;
}

/** The run for a tool call id, else for an agent id. */
export function findRun(runs, { toolUseId = null, agentId = null } = {}) {
  if (toolUseId) {
    const hit = runs.find(run => run.toolUseId === toolUseId);
    if (hit) return hit;
  }
  if (agentId) return runs.find(run => run.agentId === agentId) ?? null;
  return null;
}

/**
 * The one run a start or stop event can belong to when it names only an agent type: dispatched in this session for this agent,
 * with no agent id yet, no end and not stale. Two or more candidates give null, so parallel spawns are never swapped; their own tool
 * results pair them.
 */
export function pairableRun(runs, { sessionId, agent, now = Date.now() }) {
  const fresh = run => !(now - Date.parse(run.dispatchedAt ?? '') > STALE_RUN_MS);
  const open = runs.filter(run => run.agent === agent && !run.agentId && !run.ended && fresh(run) && (run.sessionId ?? null) === (sessionId ?? null));
  return open.length === 1 ? open[0] : null;
}

// ---------------------------------------------------------------------------
// The board reminder, once per job until a publish is recorded
// ---------------------------------------------------------------------------

export const reminderKey = (brand, jobId) => `${brand}/${jobId}`;

/** When the board was last recorded as published to its artifact, as milliseconds, or null. */
function lastPublishedAt(root) {
  const record = readJson(boardFile(root, 'last-projection.json'));
  const at = Date.parse(record?.published?.publishedAt ?? '');
  return Number.isFinite(at) ? at : null;
}

/**
 * Claim the reminder for a job. True for the first caller; false while the claim stands. A claim ends when a publish is recorded
 * after it, so the next agent start on that job reminds again. Parallel starts claim under the lock, so only one gets true.
 */
export function claimBoardReminder(root, brand, jobId, at = new Date().toISOString()) {
  const file = remindersFile(root);
  mkdirSync(dirname(file), { recursive: true });
  let won = false;
  durable.update(file, raw => {
    let jobs = {};
    try {
      const parsed = JSON.parse(raw);
      if (plain(parsed?.jobs)) jobs = parsed.jobs;
    } catch {
      jobs = {};
    }
    const key = reminderKey(brand, jobId);
    const claimed = Date.parse(jobs[key]?.at ?? '');
    const published = lastPublishedAt(root);
    if (Number.isFinite(claimed) && !(published !== null && published > claimed)) return raw;
    won = true;
    jobs[key] = { at };
    const kept = Object.entries(jobs).sort((a, b) => String(a[1]?.at).localeCompare(String(b[1]?.at))).slice(-REMINDERS_KEEP);
    return `${JSON.stringify({ jobs: Object.fromEntries(kept) })}\n`;
  }, '');
  return won;
}

/** The sentence PostToolUse hands the model so the board learns that an agent started on a job. */
export function boardReminderText({ agent, brand, jobId, title, verb = 'started' }) {
  const name = agentLabel(agent);
  const place = title ? `${brand} "${clipOneLine(title, 80)}"` : brand;
  return `Board: the ${name} ${verb} on ${place}. Call pipeline_board_job_documents {brand: "${brand}", jobId: "${jobId}"} and write its documents in one ArtifactData batch. Say nothing in chat.`;
}

