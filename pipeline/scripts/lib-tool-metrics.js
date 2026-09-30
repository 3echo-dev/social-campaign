const path = require('path');
const ws = require('./lib-workspace.js');
const jobs = require('./lib-open-job.js');
const onboardingRun = require('./lib-onboarding-run.js');
const durable = require('./lib-durable.js');
const events = require('./lib-events.js');
// Store call identities and metadata, never hook inputs or results.
//
// Tool calls are kept locally for a later sync to 3echo, in <dir>/.metrics/tool-calls.jsonl and
// never in events.jsonl: one line per call would flood the activity feed and every job read.
const toolCallsPath = dir => path.join(dir, '.metrics', 'tool-calls.jsonl');

/**
 * Where usage recorded now belongs: the open brand onboarding run first, else the chat's job.
 * Returns `{ kind, dir, eventJob, stage, ids, job? }`, or null when neither is open.
 */
function usageTarget(argv, sessionId) {
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
  if (!job) return null;
  return {
    kind: 'job', dir: job.dir, job, eventJob: job.jobId, stage: jobs.stateIn(job.text) || 'UNKNOWN',
    ids: {
      workspaceId: job.workspaceId || job.brand, brandId: job.brand, jobId: job.jobId,
      ownerUserId: job.ownerUserId, ownerEmail: job.ownerEmail,
    },
  };
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
  if (ids.runId && !ids.jobId) delete event.jobId;
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

function record(hook, argv = []) {
  if (!hook || typeof hook.tool_name !== 'string' || typeof hook.tool_use_id !== 'string' || !hook.tool_use_id) return;
  const target = usageTarget(argv, hook.session_id);
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

module.exports = { record, toolEvent, appendToolEvents, usageTarget, toolCallsPath };
