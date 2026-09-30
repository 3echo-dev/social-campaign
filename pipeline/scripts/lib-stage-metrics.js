// Stage metrics: turns a job's status.md and events.jsonl into the board's usage rows.
//
// One classifier feeds two views. `classify` maps a pipeline state to the row a person sees
// it under (a stage, a wait for their decision, or "Blocked"), and both the timeline (wall
// clock time per row) and the token totals (from tokens.observed events) are grouped through
// that same function, so a state always lands on the same row whichever measure is counting
// it.
//
// `lib-timing.timing()` stops at the first delivery boundary, because a campaign report's
// production window ends at first delivery. The board wants a job's whole run, start to its
// real end (or to now while it is still going), so `timeline` here is its own read of
// status.md rather than a reuse of that boundary. It still parses rows the same way
// (`lib-timing.parseTime`, the same five-cell table) so the two never disagree about what a
// row says.
const fs = require('fs');
const path = require('path');
const states = require('./lib-states.js');
const stagesLib = require('./lib-stages.js');
const { summarize, FIELDS } = require('./lib-usage.js');
const { parseTime } = require('./lib-timing.js');
const { STALE_MS, isStale, pendingInfo } = require('./lib-onboarding-run.js');

const FACTS = path.join(__dirname, '..', '..', 'server', 'pipeline', 'facts.mjs');

const TOKEN_FIELDS = Object.keys(FIELDS);
const HEADLINE_FIELDS = TOKEN_FIELDS.filter(field => field !== 'cacheReadTokens');

const headlineTokens = counts => HEADLINE_FIELDS.reduce((sum, field) => sum + (Number(counts[field]) || 0), 0);

// The gate ids in lib-states.js are the internal short names. A person reads the sentence
// AWAITING_*_APPROVAL already shows them, not the code.
const GATE_LABELS = {
  concept: 'concept',
  storyboard: 'storyboard',
  content: 'final post',
  publish: 'posting plan',
  campaign_proposal: 'campaign plan',
  campaign_activation: 'going live',
  findings: 'report',
};

function gateLabel(gate) {
  return GATE_LABELS[gate] || String(gate).replace(/_/g, ' ');
}

// Same sentence-casing as runtime.mjs's stageLabel, kept local so this file never imports the
// server runtime module. "shaping-the-idea" reads as "Shaping the idea", not "Shaping The Idea".
function sentenceCase(id) {
  const text = String(id).split('-').join(' ');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * The row a state's time or tokens belong on. Null means the state ends the timeline (a
 * terminal state) rather than owning a row of its own.
 */
function classify(state, workflowId) {
  if (!state || typeof state !== 'string') return { id: 'other', label: 'Other work', kind: 'work' };
  if (states.isTerminal(state)) return null;
  if (states.isGate(state)) {
    const gate = states.gateOf(state);
    return { id: `waiting-${gate}`, label: `Waiting for your approval: ${gateLabel(gate)}`, kind: 'waiting' };
  }
  if (state === 'NEEDS_CLARIFICATION') return { id: 'waiting-answers', label: 'Waiting for your answers', kind: 'waiting' };
  if (state === 'BLOCKED' || state === 'ESCALATED') return { id: 'blocked', label: 'Blocked', kind: 'blocked' };
  if (state === 'CHANGES_REQUESTED') return { id: 'revisions', label: 'Revisions', kind: 'work' };
  const mapped = stagesLib.forState(state, workflowId);
  if (mapped && mapped.stage) return { id: mapped.stage, label: sentenceCase(mapped.stage), kind: 'work' };
  return { id: 'other', label: 'Other work', kind: 'work' };
}

function parseStatusRows(statusText) {
  const rows = [];
  for (const line of String(statusText || '').split(/\r?\n/)) {
    const cells = line.split('|').slice(1, -1).map(value => value.trim().replace(/`/g, ''));
    if (cells.length !== 5 || !states.exists(cells[2])) continue;
    rows.push({ at: parseTime(cells[0]), state: cells[2] });
  }
  return rows;
}

/**
 * A job's whole run, start to its real end (a terminal state), or through its last closed row
 * while it is still going. This never reads the clock: the still-open row contributes no
 * closed time of its own (`openSince` marks where it began instead), so the same status.md
 * gives the same timeline on every call, not a number that grows between reads. Unlike
 * lib-timing.timing(), this never stops early at a delivery boundary either: HANDOFF_READY and
 * its successors are ordinary rows here, not the end of the window.
 */
function timeline(statusText, workflowId) {
  const parsed = parseStatusRows(statusText);
  if (!parsed.length) return { startedAt: null, endedAt: null, running: false, openSince: null, totalMs: null, coverage: 'missing', rows: [] };
  const terminalIndex = parsed.findIndex(row => states.isTerminal(row.state));
  const selected = terminalIndex >= 0 ? parsed.slice(0, terminalIndex + 1) : parsed;
  const running = terminalIndex < 0;
  const startAt = selected[0].at;
  // A terminal row's own timestamp ends the timeline; otherwise the only end known without
  // the clock is where the still-open last row began.
  const endAt = selected[selected.length - 1].at;
  let coverage = 'measured';
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) coverage = 'partial';

  const openIndex = running ? selected.length - 1 : -1;
  const buckets = new Map();
  const order = [];
  for (let i = 0; i < selected.length; i++) {
    const row = selected[i];
    const info = classify(row.state, workflowId);
    if (!info) continue; // the terminal row ends the timeline; it owns no row itself
    if (!buckets.has(info.id)) {
      buckets.set(info.id, { id: info.id, label: info.label, kind: info.kind, elapsedMs: null, openSince: null });
      order.push(info.id);
    }
    const bucket = buckets.get(info.id);
    if (i === openIndex) {
      // The current visit has not closed yet. It adds no closed time of its own; openSince is
      // what tells a reader this row is the one still running, so far only through its
      // earlier, already-closed visits (or null when it has never closed before).
      bucket.openSince = Number.isFinite(row.at) ? new Date(row.at).toISOString() : null;
      continue;
    }
    const rowStart = row.at;
    const rowEnd = i + 1 < selected.length ? selected[i + 1].at : endAt;
    let ms = null;
    if (Number.isFinite(rowStart) && Number.isFinite(rowEnd) && rowEnd >= rowStart) ms = rowEnd - rowStart;
    else coverage = 'partial';
    if (ms !== null) bucket.elapsedMs = (bucket.elapsedMs || 0) + ms;
  }

  const totalMs = Number.isFinite(startAt) && Number.isFinite(endAt) && endAt >= startAt ? endAt - startAt : null;
  return {
    startedAt: Number.isFinite(startAt) ? new Date(startAt).toISOString() : null,
    endedAt: !running && Number.isFinite(endAt) ? new Date(endAt).toISOString() : null,
    running,
    openSince: running && Number.isFinite(endAt) ? new Date(endAt).toISOString() : null,
    totalMs,
    coverage,
    rows: order.map(id => buckets.get(id)),
  };
}

function creditsGeneration(jobDir) {
  try {
    return require(FACTS).generationCredits({ dir: jobDir });
  } catch {
    return { threeEchoCredits: { spent: null, approved: null }, elevenLabsCredits: { spent: null, approved: null } };
  }
}

/**
 * A job's usage for the board: native Claude tokens (whole job, never cut at delivery),
 * wall-clock time per row, and the 3echo/ElevenLabs credits from the job's generation facts.
 * Deterministic for an unchanged status.md and events.jsonl: nothing here reads the clock, so
 * two reads of the same files give the same numbers. `openSince` on a still-running job (and
 * on its open stage row) is the fixed point in time a client can subtract `Date.now()` from.
 */
function jobWorkflowId(jobDir) {
  try {
    const route = JSON.parse(fs.readFileSync(path.join(jobDir, 'route.json'), 'utf8'));
    return route && typeof route.workflowId === 'string' ? route.workflowId : undefined;
  } catch { return undefined; }
}

function jobUsage(jobDir, root, { createdAt } = {}) {
  const workflowId = jobWorkflowId(jobDir);
  let statusText = '';
  try { statusText = fs.readFileSync(path.join(jobDir, 'status.md'), 'utf8'); } catch { /* no status yet */ }
  const t = timeline(statusText, workflowId);
  const fallbackStart = Date.parse(createdAt || '');
  const startedAt = t.startedAt || (Number.isFinite(fallbackStart) ? new Date(fallbackStart).toISOString() : null);

  const usage = summarize(jobDir, root);
  const tokenBuckets = new Map();
  for (const row of usage.stages || []) {
    // A terminal state (COMPLETE/CANCELLED) owns no timeline row, but tokens billed while
    // the job sat in it are real and still need a home: "other" takes them.
    const info = classify(row.stage, workflowId) || { id: 'other', label: 'Other work', kind: 'work' };
    const bucket = tokenBuckets.get(info.id) || { id: info.id, label: info.label, kind: info.kind, tokens: 0 };
    bucket.tokens += headlineTokens(row);
    tokenBuckets.set(info.id, bucket);
  }

  const timeById = new Map(t.rows.map(row => [row.id, row]));
  const order = t.rows.map(row => row.id);
  for (const id of tokenBuckets.keys()) if (!order.includes(id)) order.push(id); // tokens with no time go last
  const stages = order.map(id => {
    const timeRow = timeById.get(id);
    const tokenRow = tokenBuckets.get(id);
    const source = timeRow || tokenRow;
    return {
      id, label: source.label, kind: source.kind,
      tokens: tokenRow ? tokenRow.tokens : null,
      elapsedMs: timeRow ? timeRow.elapsedMs : null,
      openSince: timeRow ? timeRow.openSince : null,
    };
  });

  const totalTokens = usage.observations > 0 ? headlineTokens(usage.total) : null;

  return {
    tokens: totalTokens,
    startedAt,
    endedAt: t.endedAt,
    running: t.running,
    elapsedMs: t.totalMs,
    openSince: t.openSince,
    coverage: t.coverage,
    generation: creditsGeneration(jobDir),
    stages,
  };
}

// Package A (lib-onboarding-run.js) owns the run's own read/write helpers. This reads the
// same `run.json` files directly rather than importing that module, same as the rest of the
// board never reaches into another package's files.
function listOnboardingRuns(brandDir) {
  let entries = [];
  try { entries = fs.readdirSync(path.join(brandDir, 'onboarding'), { withFileTypes: true }); } catch { return []; }
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(brandDir, 'onboarding', entry.name);
    let run;
    try { run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')); } catch { continue; }
    if (!run || typeof run !== 'object' || typeof run.runId !== 'string') continue;
    runs.push({ ...run, dir });
  }
  runs.sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  return runs;
}

// Whether a run is stale is the one place this file still needs the clock (package A's own
// STALE_MS decides it the same way). Every other number here comes from stored timestamps, so
// a run only changes the projection once, at the instant it actually crosses that line, not on
// every read the way "now - startedAt" would.
//
// A running, non-stale run has no fixed end yet: it contributes no closed time to the sum,
// only `openSince`. A stale run stops counting at the moment package A's own `start()` would
// close it as abandoned (`startedAt + STALE_MS`), so a run left open does not grow forever.
function runEndMs(run, now) {
  if (run.completedAt) return Date.parse(run.completedAt);
  if (run.status !== 'running') return NaN; // closed with no completedAt: unmeasurable
  const startMs = Date.parse(run.startedAt || '');
  if (!isStale(run, now)) return startMs; // open and not stale: zero closed time so far
  return Number.isFinite(startMs) ? startMs + STALE_MS : NaN;
}

function runStatus(run, now) {
  return run.status === 'running' && isStale(run, now) ? 'abandoned' : run.status;
}

/** A brand's onboarding research usage: one row, summed across every run. */
function brandResearchUsage(brandDir, root, { now = Date.now() } = {}) {
  const runs = listOnboardingRuns(brandDir);
  const row = { id: 'brand-research', label: 'Brand research', kind: 'work', tokens: null, cacheReadTokens: null, elapsedMs: null, openSince: null };
  const { state: pending, until: pendingUntil } = pendingInfo(brandDir, { now, runs });
  if (!runs.length) return { status: null, runId: null, runs: 0, pending, pendingUntil, stages: [row] };

  let tokens = 0, cacheReadTokens = 0, sawTokens = false, elapsedMs = 0, sawTime = false, openSince = null;
  for (const run of runs) {
    const runUsage = summarize(run.dir, root);
    if (runUsage.observations > 0) {
      sawTokens = true;
      tokens += headlineTokens(runUsage.total);
      cacheReadTokens += Number(runUsage.total.cacheReadTokens) || 0;
    }
    const startMs = Date.parse(run.startedAt || '');
    const endMs = runEndMs(run, now);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      sawTime = true;
      elapsedMs += endMs - startMs;
    }
    if (run.status === 'running' && !isStale(run, now)) openSince = run.startedAt || null;
  }
  const latest = runs[runs.length - 1];
  row.tokens = sawTokens ? tokens : null;
  row.cacheReadTokens = sawTokens ? cacheReadTokens : null;
  row.elapsedMs = sawTime ? elapsedMs : null;
  row.openSince = openSince;
  return { status: runStatus(latest, now) || null, runId: latest.runId, runs: runs.length, pending, pendingUntil, stages: [row] };
}

module.exports = { classify, timeline, jobUsage, brandResearchUsage };
