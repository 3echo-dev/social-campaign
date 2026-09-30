#!/usr/bin/env node
// Stop and SubagentStop hook. What a stage cost, recorded while the run is happening.
//
// Claude Code hands this script a JSON event on stdin carrying session_id, transcript_path,
// cwd, hook_event_name and, for a subagent, agent_id, agent_type and agent_transcript_path. The
// transcript is JSONL; every assistant line holds message.usage and message.model. That file is
// the only per-job token source we have, and it is written asynchronously, so what is missing at
// the end of one turn is picked up at the end of the next.
//
// A subagent's own transcript is read when the event names one that exists. Otherwise the main
// transcript is read, which is where older hosts wrote a subagent's lines.
//
// Usage goes to the open brand onboarding run when there is one (lib-onboarding-run.js), else to
// the chat's job. Appends one tokens.observed line per model to that folder's events.jsonl:
//   subject { type: "stage", id: <Current state from status.md, or BRAND_RESEARCH for a run> }
//   attrs   { model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
//             agentType?, sessionId }
// and one tool.completed line per finished tool call to its .metrics/tool-calls.jsonl: the tool's
// name, whether it failed, when it started and how long it took. Never its input or its result.
//
// Cowork does not fire plugin hooks at all, so there it never runs and the dashboard shows
// tokens as not reported. Nothing else changes.
//
// Never throws. On any error it writes one line to stderr and exits 0: a hook that fails a
// turn to report on the turn is worse than no number.
//
// Exit 0 always, except 2 when someone runs it as a command.
const fs = require('fs');
const path = require('path');
const ws = require('../lib-workspace.js');
const ev = require('../lib-events.js');
const toolMetrics = require('../lib-tool-metrics.js');
const durable = require('../lib-durable.js');
const crypto = require('crypto');

// A tool call whose result has not been read yet waits in the shared read position, so a call
// and its result that land in different turns still pair. A call that never gets a result is
// dropped after a day, and at most MAX_PENDING wait at once.
const MAX_PENDING = 200;
const MAX_SHARED_RECORDS = 200;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// One usage record per model, summed. Read as a stream from the offset we stopped at last
// time, because a long session's transcript runs to tens of megabytes and reading it whole
// at the end of every turn would cost more than the turn.
//
// Tool calls are paired on the way: a tool_use opens a call, its tool_result closes it. A result
// whose call was never seen is skipped. Only the name and the two line timestamps are kept.
function sumFrom(file, start, priorRecords = {}, priorPending = new Map()) {
  return new Promise(resolve => {
    const totals = new Map();
    const records = { ...priorRecords };
    const touched = new Set();
    const pending = new Map(priorPending);
    const calls = [];
    let end = start;                 // only ever advanced past a line that ended in a newline
    let rest = Buffer.alloc(0);
    const take = line => {
      const text = line.toString('utf8');
      if (!text.trim()) return;
      let rec = null;
      try { rec = JSON.parse(text); } catch { return; }   // a half-written line is skipped
      const msg = rec && rec.message;
      // Before the usage check: a tool_result arrives on a user line, which carries no usage.
      if (msg && Array.isArray(msg.content)) {
        const at = typeof rec.timestamp === 'string' && Number.isFinite(Date.parse(rec.timestamp)) ? rec.timestamp : null;
        for (const block of msg.content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'tool_use' && typeof block.id === 'string' && block.id) {
            pending.set(block.id, { name: String(block.name || 'unknown').slice(0, 120), at });
          } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string' && pending.has(block.tool_use_id)) {
            const call = pending.get(block.tool_use_id);
            pending.delete(block.tool_use_id);
            calls.push({ toolUseId: block.tool_use_id, name: call.name, failed: block.is_error === true, startedAt: call.at, endedAt: at });
          }
        }
      }
      const u = msg && msg.usage;
      if (!u) return;
      const model = String(msg.model || 'unknown');
      const inferredProvider = msg.provider || rec.provider
        || (/^(gpt|o[1-9]|text-)/i.test(model) ? 'openai' : (/gemini|google/i.test(model) ? 'google' : 'anthropic'));
      const normalized = ev.normalizeTokenUsage(inferredProvider, u, model);
      const identity = ev.usageIdentity(rec);
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ model, usage: u })).digest('hex');
      let contribution = { ...normalized };
      if (identity) {
        const previous = records[identity];
        if (previous) {
          const wasSeen = Array.isArray(previous.fingerprints) && previous.fingerprints.includes(fingerprint);
          const values = ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens'];
          const cumulative = normalized.semantics === 'cumulative'
            || values.every(k => normalized[k] >= Number(previous[k] || 0))
              && values.some(k => normalized[k] > Number(previous[k] || 0));
          if (wasSeen) contribution = { ...normalized, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
          else if (cumulative) contribution = {
            ...normalized,
            inputTokens: Math.max(0, normalized.inputTokens - Number(previous.inputTokens || 0)),
            outputTokens: Math.max(0, normalized.outputTokens - Number(previous.outputTokens || 0)),
            cacheCreationTokens: Math.max(0, normalized.cacheCreationTokens - Number(previous.cacheCreationTokens || 0)),
            cacheReadTokens: Math.max(0, normalized.cacheReadTokens - Number(previous.cacheReadTokens || 0)),
          };
        }
        const fingerprints = Array.isArray(records[identity]?.fingerprints) ? records[identity].fingerprints : [];
        records[identity] = {
          ...normalized,
          fingerprints: [...new Set(fingerprints.concat(fingerprint))].slice(-8),
        };
        touched.add(identity);
      }
      const t = totals.get(model) || { provider: normalized.provider, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      t.provider = normalized.provider || t.provider;
      t.inputTokens += contribution.inputTokens;
      t.outputTokens += contribution.outputTokens;
      t.cacheCreationTokens += contribution.cacheCreationTokens;
      t.cacheReadTokens += contribution.cacheReadTokens;
      totals.set(model, t);
    };
    const done = () => resolve({ totals, records, touched, calls, pending, end });
    // Buffers rather than readline: the offset written to the cursor has to be an exact byte
    // count, and a reader that strips the line ending cannot give one on a CRLF file.
    const stream = fs.createReadStream(file, { start });
    // A read that fails counts nothing, because the offset does not move past it either.
    stream.on('error', () => resolve({ totals: new Map(), records: { ...priorRecords }, touched: new Set(),
      calls: [], pending: new Map(priorPending), end: start }));
    stream.on('data', chunk => {
      let buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      let at;
      while ((at = buf.indexOf(0x0a)) >= 0) {
        take(buf.subarray(0, at));
        end += at + 1;
        buf = buf.subarray(at + 1);
      }
      rest = buf;                    // an unterminated tail is left for the next turn
    });
    stream.on('end', done);
  });
}

// The shared read position: `{ offset, pending: { <tool_use_id>: { name, at } } }`.
function readShared(file) {
  let value = {};
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* first turn */ }
  const pending = new Map();
  if (value.pending && typeof value.pending === 'object' && !Array.isArray(value.pending)) {
    for (const [id, call] of Object.entries(value.pending)) {
      if (!id || !call || typeof call !== 'object' || typeof call.name !== 'string') continue;
      pending.set(id, { name: call.name.slice(0, 120), at: typeof call.at === 'string' ? call.at : null });
    }
  }
  const records = value.records && typeof value.records === 'object' && !Array.isArray(value.records) ? value.records : {};
  return { offset: Number(value.offset) || 0, pending, records };
}

function sharedRecords(previous, records, touched) {
  const merged = { ...previous };
  for (const identity of touched) merged[identity] = records[identity];
  return Object.fromEntries(Object.entries(merged).slice(-MAX_SHARED_RECORDS));
}

function prunePending(pending) {
  const now = Date.now();
  const kept = [...pending].filter(([, call]) => {
    const at = Date.parse(call.at);
    return !Number.isFinite(at) || now - at <= PENDING_MAX_AGE_MS;
  });
  return Object.fromEntries(kept.slice(-MAX_PENDING));
}

function readStdin() {
  return new Promise(resolve => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { raw += d; });
    process.stdin.on('error', () => resolve(''));
    process.stdin.on('end', () => resolve(raw));
  });
}

function sharedCursorPath(argv, transcript) {
  return path.join(ws.root(argv), '.social-pipeline', 'usage-cursors',
    crypto.createHash('sha256').update(path.resolve(transcript)).digest('hex') + '.json');
}

async function skipUntargeted(transcript, argv) {
  let release = () => {};
  try {
    const sharedPath = sharedCursorPath(argv, transcript);
    release = durable.acquire(sharedPath);
    const shared = readShared(sharedPath);
    let start = shared.offset;
    let pending = shared.pending;
    const size = fs.statSync(transcript).size;
    if (start > size) { start = 0; pending = new Map(); }
    if (start === size) return;
    const { records, touched, pending: open, end } = await sumFrom(transcript, start, shared.records, pending);
    if (end > start) {
      durable.atomicWrite(sharedPath, JSON.stringify({
        offset: end, pending: prunePending(open), records: sharedRecords(shared.records, records, touched),
      }) + '\n');
    }
  } catch (e) {
    process.stderr.write('tokens hook: could not advance the usage cursor: ' + e.message + '\n');
  } finally {
    release();
  }
}

async function run(hook, argv = []) {
  const agentTranscript = hook.hook_event_name === 'SubagentStop' && typeof hook.agent_transcript_path === 'string'
    && hook.agent_transcript_path && fs.existsSync(hook.agent_transcript_path) ? hook.agent_transcript_path : null;
  const transcript = agentTranscript || hook.transcript_path;
  if (!transcript || !fs.existsSync(transcript)) return;   // nothing to count yet

  // The hook's cwd is where the session is, which is what the resolver walks up from.
  try { if (hook.cwd && fs.existsSync(hook.cwd)) process.chdir(hook.cwd); } catch { /* stay put */ }

  // An open brand research run takes everything; without one, the chat's job. With neither the
  // transcript is read past without counting, so whichever opens next starts from there.
  let target = null;
  try { target = toolMetrics.usageTarget(argv, hook.session_id); } catch { return; }
  if (!target) { await skipUntargeted(transcript, argv); return; }
  const flush = async () => {
    if (target.kind === 'job') await require('../lib-metrics-sync.js').flush(target.job, argv);
  };

  const sessionId = String(hook.session_id || 'unknown');
  const agentId = String(hook.agent_id || 'main');
  const key = sessionId + '::' + agentId;
  const cursorPath = path.join(target.dir, '.tokens-cursor.json');
  // A chat can switch jobs. Its transcript cursor must not restart from zero in the new job.
  const sharedPath = sharedCursorPath(argv, transcript);
  const release = durable.acquire(sharedPath);
  let cursor = {};
  try { cursor = JSON.parse(fs.readFileSync(cursorPath, 'utf8')) || {}; } catch { /* first turn */ }
  const shared = readShared(sharedPath);

  // Offsets are per session and agent, so the main transcript and each subagent's are counted
  // once each. Where two of those keys name the same file, the furthest offset wins, which is
  // what stops a shared transcript being billed twice.
  let start = 0;
  for (const entry of Object.values(cursor)) {
    if (entry && entry.transcript === transcript) start = Math.max(start, Number(entry.offset) || 0);
  }
  start = Math.max(start, shared.offset);
  let pending = shared.pending;
  let size = 0;
  try { size = fs.statSync(transcript).size; } catch { return; }
  if (start > size) { start = 0; pending = new Map(); }             // the file was replaced under us
  if (start === size) {
    release();
    await flush();
    return;
  }

  // Usage identities are shared by every agent of the session. A host that writes a subagent's
  // lines into the main transcript as well as the subagent's own file gives both copies one
  // message id, so whichever pass comes second finds them already counted.
  const ownRecords = cursor[key] && cursor[key].records && typeof cursor[key].records === 'object'
    ? cursor[key].records : {};
  const previousRecords = {};
  for (const [name, entry] of Object.entries(cursor)) {
    if (name === key || !name.startsWith(sessionId + '::')) continue;
    if (entry && entry.records && typeof entry.records === 'object') Object.assign(previousRecords, entry.records);
  }
  Object.assign(previousRecords, ownRecords);
  for (const [identity, entry] of Object.entries(shared.records)) if (!previousRecords[identity]) previousRecords[identity] = entry;
  const { totals, records, touched, calls, pending: open, end } = await sumFrom(transcript, start, previousRecords, pending);
  const kept = { ...ownRecords };
  for (const identity of touched) kept[identity] = records[identity];
  cursor[key] = { transcript, offset: end, records: kept };

  const occurredAt = new Date().toISOString();

  // occurredAt is a minute, so two models answering inside one stage would share an id.
  // The salt is what keeps them apart while an export of the same numbers stays idempotent.
  const lines = [];
  for (const [model, t] of totals) {
    if (!t.inputTokens && !t.outputTokens && !t.cacheCreationTokens && !t.cacheReadTokens) continue;
    const event = ev.makeEvent(target.eventJob, 'tokens.observed', occurredAt, { type: 'stage', id: target.stage },
      { model, ...t, usageSemantics: 'delta', agentType: hook.agent_type, sessionId }, {
        dedupeKey: [model, sessionId, agentId, String(start), String(end)].join('|'),
        ...target.ids,
        source: 'stop_hook', host: 'claude_code', quality: 'measured',
      });
    if (target.kind === 'run') delete event.jobId;                  // a run is not a job
    event.eventId = crypto.createHash('sha256').update([path.resolve(transcript), model, sessionId, start, end].join('|')).digest('hex');
    lines.push(event);
  }

  // Tool calls take the stage of the target, like the tokens. The call started when its
  // tool_use line was written and ended when its result was.
  const tools = calls.map(call => {
    const began = Date.parse(call.startedAt);
    const ended = Date.parse(call.endedAt);
    return toolMetrics.toolEvent({
      eventJob: target.eventJob, ids: target.ids, stage: target.stage, sessionId,
      toolUseId: call.toolUseId, name: call.name, failed: call.failed,
      durationMs: Number.isFinite(began) && Number.isFinite(ended) && ended >= began ? ended - began : undefined,
      occurredAt: call.startedAt || occurredAt, source: 'stop_hook',
    });
  });

  try {
    if (lines.length) {
      durable.update(path.join(target.dir, 'events.jsonl'), text => {
        const ids = new Set(text.split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line).eventId; } catch { return null; } }));
        return text + (text && !text.endsWith('\n') ? '\n' : '') + lines.filter(l => !ids.has(l.eventId)).map(l => JSON.stringify(l) + '\n').join('');
      });
    }
    if (tools.length) toolMetrics.appendToolEvents(target.dir, tools);
    durable.atomicWrite(sharedPath, JSON.stringify({
      offset: end, pending: prunePending(open), records: sharedRecords(shared.records, records, touched),
    }) + '\n');
    durable.update(cursorPath, text => {
      let existing = {}; try { existing = JSON.parse(text); } catch {}
      existing[key] = cursor[key];
      return JSON.stringify(existing, null, 2) + '\n';
    });
    release();
  } catch (e) {
    process.stderr.write('tokens hook: could not write to ' + ws.fwd(target.dir) + ': ' + e.message + '\n');
    return;
  }
  await flush();
}

module.exports = { run };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (process.stdin.isTTY || ws.positionals(argv).length) {
    console.error('tokens.js is a hook, not a command. It reads a Stop or SubagentStop event on stdin.');
    console.error('To read the numbers back: tokens-summary.js <brand> <job-id>');
    process.exit(2);
  }
  (async () => {
    let hook = {};
    try { hook = JSON.parse(await readStdin()) || {}; } catch { process.exit(0); }
    await run(hook, argv);
    process.exit(0);
  })().catch(e => {
    process.stderr.write('tokens hook: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(0);
  });
}
