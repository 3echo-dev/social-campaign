const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const jobs = require('./lib-open-job.js');
const onboardingRun = require('./lib-onboarding-run.js');
const durable = require('./lib-durable.js');
const events = require('./lib-events.js');
const stageMetrics = require('./lib-stage-metrics.js');
// Store call identities and metadata, never hook inputs or results.
//
// Tool calls are kept locally for a later sync to 3echo, in <dir>/.metrics/tool-calls.jsonl and
// never in events.jsonl: one line per call would flood the activity feed and every job read.
const toolCallsPath = dir => path.join(dir, '.metrics', 'tool-calls.jsonl');

function jobTarget(job) {
  return {
    kind: 'job', dir: job.dir, job, eventJob: job.jobId, stage: jobs.stateIn(job.text) || 'UNKNOWN',
    row: stageMetrics.rowOf(job.dir, jobs.stateIn(job.text)),
    ids: {
      workspaceId: job.workspaceId || job.brand, brandId: job.brand, jobId: job.jobId,
      ownerUserId: job.ownerUserId, ownerEmail: job.ownerEmail,
    },
  };
}

// The job a helper (subagent) was started on, from the agent run record the agent-run hook keeps. Null when the helper is not on
// record, or its job is gone: the helper's tokens then follow the chat's job, and the row still carries the agent id.
function helperJob(argv, agentId) {
  if (!agentId) return null;
  try {
    const file = path.join(ws.root(argv), '.social-pipeline', 'board', 'agent-runs.json');
    const runs = JSON.parse(fs.readFileSync(file, 'utf8')).runs;
    const run = (Array.isArray(runs) ? runs : []).find(item => item && item.agentId === agentId && item.brand && item.jobId);
    return run ? jobs.openJob(argv, { brand: run.brand, jobId: run.jobId, includeFinished: true }) : null;
  } catch { return null; }
}

// Brand setup happens before any job or research run. Its usage goes to the one brand still being set up
// (<brand>/onboarding/setup), else to the workspace when there is no brand yet or more than one is unfinished.
// A workspace whose brands are all set up counts nothing here.
function setupTarget(argv) {
  const slugs = ws.listBrands(argv);
  const unfinished = [];
  for (const slug of slugs) {
    const dir = path.join(ws.brandsDir(argv), slug);
    let config = {};
    try { config = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8')) || {}; } catch { /* unreadable: counts as unfinished */ }
    const status = config.onboarding && config.onboarding.status
      || (fs.existsSync(path.join(dir, 'brand', 'profile.json')) ? 'complete' : 'required');
    if (status !== 'complete' && status !== 'not_needed') unfinished.push({ slug, dir, config });
  }
  if (unfinished.length === 1) {
    const { slug, dir, config } = unfinished[0];
    return { kind: 'setup', dir: path.join(dir, 'onboarding', 'setup'), eventJob: 'setup', stage: 'BRAND_SETUP',
      ids: { workspaceId: config.workspaceId || slug, brandId: config.brandId || config.id || slug } };
  }
  if (slugs.length && !unfinished.length) return null;
  return { kind: 'setup', dir: path.join(ws.root(argv), '.social-pipeline', 'setup-usage'), eventJob: 'setup-usage',
    stage: 'BRAND_SETUP', ids: {} };
}

/**
 * Where usage recorded now belongs: a helper's own job when the agent run record names it, else the open brand onboarding
 * run, else the chat's job, else brand setup. Returns `{ kind, dir, eventJob, stage, ids, job?, row? }`, or null when none applies.
 */
function usageTarget(argv, sessionId, { agentId } = {}) {
  const helper = helperJob(argv, agentId);
  if (helper) return { ...jobTarget(helper), helper: true };
  let open = null;
  try { open = onboardingRun.active(ws.root(argv)); } catch { open = null; }
  if (open) {
    const run = open.run;
    return {
      kind: 'run', dir: open.dir, eventJob: run.runId, stage: onboardingRun.STAGE,
      ids: { workspaceId: run.workspaceId || run.brand, brandId: run.brandId || run.brand, runId: run.runId, stage: onboardingRun.STAGE },
    };
  }
  const job = jobs.openJob(argv, { sessionId, includeFinished: true });
  if (job) return jobTarget(job);
  return setupTarget(argv);
}

/** One tool.completed event. A run-scoped event carries runId and no jobId. */
function toolEvent({ eventJob, ids = {}, stage, sessionId, toolUseId, name, failed, durationMs, occurredAt, source } = {}) {
  const attrs = { tool: String(name || 'unknown').slice(0, 120), status: failed ? 'failed' : 'succeeded' };
  const measured = Number.isFinite(durationMs) && durationMs >= 0;
  if (measured) attrs.durationMs = durationMs;
  const event = events.makeEvent(eventJob, 'tool.completed', occurredAt || new Date().toISOString(),
    { type: 'stage', id: stage || 'UNKNOWN' }, attrs, {
      ...ids,
      dedupeKey: String(sessionId || 'unknown') + '\0' + toolUseId,
      source, host: 'claude_code', quality: measured ? 'measured' : 'partial',
    });
  // makeEvent fills jobId from the event's job, which for a run is the run id.
  if (!ids.jobId) delete event.jobId;
  return event;
}

/** Append to <dir>/.metrics/tool-calls.jsonl, skipping ids already there. Returns how many landed. */
function appendToolEvents(dir, list) {
  const fresh = (Array.isArray(list) ? list : [list]).filter(event => event && event.eventId);
  if (!fresh.length) return 0;
  let added = 0;
  durable.update(toolCallsPath(dir), raw => {
    const seen = new Set(raw.split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line).eventId; } catch { return null; } }));
    const lines = [];
    for (const event of fresh) {
      if (seen.has(event.eventId)) continue;
      seen.add(event.eventId);
      lines.push(JSON.stringify(event) + '\n');
    }
    added = lines.length;
    return lines.length ? raw + (raw && !raw.endsWith('\n') ? '\n' : '') + lines.join('') : raw;
  });
  return added;
}

/** The tool.completed events of <dir>/.metrics/tool-calls.jsonl, oldest first. A missing file or an unreadable line is skipped. */
function readToolEvents(dir) {
  let raw = '';
  try { raw = fs.readFileSync(toolCallsPath(dir), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && event.eventName === 'tool.completed' && event.attrs && typeof event.attrs.tool === 'string') out.push(event);
    } catch { /* a torn line is not a call */ }
  }
  return out;
}

// The tool without its server prefix: 'mcp__plugin_social-campaign_core__web_crawl' is 'web_crawl'. A Chrome tool is 'chrome'.
function baseTool(name) {
  const text = String(name || '');
  if (/^mcp__claude-in-chrome__/i.test(text)) return 'chrome';
  const match = /^mcp__.+?__(.+)$/.exec(text);
  return match ? match[1] : text;
}
const SEARCH_TOOLS = new Set(['WebSearch', 'social_search']);
const FETCH_TOOLS = new Set([
  'WebFetch', 'web_crawl', 'social_profile_get', 'social_post_get', 'social_outliers_find', 'social_comments_get', 'social_ad_search', 'chrome',
]);

/**
 * What a run or job really called, counted from its tool log and not from what the agent says it did.
 * { recorded, total, failed, searches, fetches, byTool: { web_crawl: { ok, failed } } }. `recorded` is false when the
 * log has no call at all, which also happens when the host never runs the hook; callers then cannot check anything against it.
 */
function summarizeToolEvents(events) {
  const byTool = {};
  let failed = 0;
  let searches = 0;
  let fetches = 0;
  for (const event of Array.isArray(events) ? events : []) {
    const tool = baseTool(event.attrs && event.attrs.tool);
    const bad = event.attrs && event.attrs.status === 'failed';
    byTool[tool] = byTool[tool] || { ok: 0, failed: 0 };
    byTool[tool][bad ? 'failed' : 'ok'] += 1;
    if (bad) failed += 1;
    if (SEARCH_TOOLS.has(tool)) searches += 1;
    if (FETCH_TOOLS.has(tool)) fetches += 1;
  }
  const total = Object.values(byTool).reduce((sum, item) => sum + item.ok + item.failed, 0);
  return { recorded: total > 0, total, failed, searches, fetches, byTool };
}

function record(hook, argv = []) {
  if (!hook || typeof hook.tool_name !== 'string' || typeof hook.tool_use_id !== 'string' || !hook.tool_use_id) return;
  const target = usageTarget(argv, hook.session_id, { agentId: hook.agent_id });
  if (!target) return;
  const failed = hook.hook_event_name === 'PostToolUseFailure' || hook.tool_response?.is_error === true || hook.tool_response?.isError === true;
  // A job's event may name the hook's own run, operation and attempt. A brand research run keeps its id.
  const ids = target.kind === 'job' ? {
    ...target.ids,
    runId: hook.run_id || hook.runId, operationId: hook.operation_id || hook.operationId,
    attemptId: hook.attempt_id || hook.attemptId,
  } : target.ids;
  appendToolEvents(target.dir, [toolEvent({
    eventJob: target.eventJob, ids, stage: target.stage, sessionId: hook.session_id,
    toolUseId: hook.tool_use_id, name: hook.tool_name, failed, durationMs: hook.duration_ms,
    occurredAt: new Date().toISOString(), source: 'post_tool_hook',
  })]);
}

module.exports = { record, toolEvent, appendToolEvents, readToolEvents, summarizeToolEvents, baseTool, usageTarget, toolCallsPath };
