import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { jobAt, readSessionBinding, resolveWorkspaceRoot } from '../../server/pipeline/facts.mjs';
import {
  attemptState, classifyFailure, deliveryReference, findReservation, inputDigest, readAttempts, recordAssets, recordListing, recordOutcome, sentFacts,
} from '../../server/pipeline/publish-attempts.mjs';
import { LISTING_TOOL, asObject, bigSafeReply, parseBigSafe, toolBase } from '../../server/pipeline/publish-tools.mjs';
import { readJsonFile } from '../../server/lib/json.mjs';

const INPUT_LIMIT = 64 * 1024 * 1024;
const SEND_TOOLS = new Set(['createScheduledPost']);
// What 3echo says about a media file. The guard reads these lines to see that a link was just returned by 3echo for a
// file of the approved size, so the model never has to report them.
const ASSET_TOOLS = new Set(['get_asset', 'complete_asset_upload', 'list_assets']);
// What Metricool really listed, kept for reconcile, which trusts nothing the model passes in.


async function readEvent() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > INPUT_LIMIT) return null;
  }
  try {
    // Long ids (a Metricool uuid) are kept as text while parsing, so no digit is rounded away.
    const event = parseBigSafe(raw);
    return event && typeof event === 'object' ? event : null;
  } catch {
    return null;
  }
}

function tell(context) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }));
}

/** The reply as an object when it is JSON text (the host sends a tool result either way), else as it came. */
function opened(response) {
  if (typeof response !== 'string') return response;
  try {
    const value = JSON.parse(response);
    return value && typeof value === 'object' ? value : response;
  } catch {
    return response;
  }
}

/** The text a reply holds, whichever way the host wrapped it. */
function rawText(response) {
  if (typeof response === 'string') return response;
  if (Array.isArray(response?.content)) return response.content.map(block => (typeof block?.text === 'string' ? block.text : '')).join('\n');
  try {
    return JSON.stringify(response) ?? '';
  } catch {
    return '';
  }
}

/** The error text of a reply that says it failed, or null when it does not. */
function errorText(response, data) {
  if (response && typeof response === 'object' && response.isError === true) return rawText(response) || 'The call failed.';
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string' && data.error) return data.error;
    if (data.error && typeof data.error === 'object') return rawText(data.error);
    if (data.success === false || String(data.status || '').toLowerCase() === 'error') return String(data.message || data.detail || 'The call failed.');
  }
  return null;
}

function outcomeFor(event, reservation) {
  if (event.hook_event_name === 'PostToolUseFailure') {
    const said = typeof event.error === 'string' ? event.error : rawText(event.error);
    return { kind: classifyFailure(said, event.is_interrupt === true), error: said || 'The call did not finish.' };
  }
  const response = opened(event.tool_response);
  const data = bigSafeReply(event.tool_response);
  const failed = errorText(response, data);
  if (failed) return { kind: classifyFailure(failed), error: failed };
  const facts = data ? sentFacts(data, reservation?.network ?? null) : null;
  if (facts) return { kind: 'sent', facts };
  const raw = rawText(response).trim();
  if (!data && /^error\b/i.test(raw)) return { kind: classifyFailure(raw), error: raw };
  return { kind: 'unknown', error: `The reply could not be read: ${raw.slice(0, 200)}` };
}

const NOTES = Object.freeze({
  failed: error => `Metricool turned this post down: ${error}. Nothing was created for it. Tell the person what to fix in their own terms, and never change the post to get around it.`,
  unknown: () => 'The result of this send is not known, and the post may exist. Do not send it again. Call pipeline_publish_reconcile with only the job to see what to look up, call getScheduledPosts for that span, then call pipeline_publish_reconcile again.',
});

function recordSend(job, event) {
  const input = asObject(event.tool_input);
  const reservation = findReservation(readAttempts(job.dir), { toolUseId: event.tool_use_id ?? null, inputSha: inputDigest(input) });
  const outcome = outcomeFor(event, reservation);
  if (!reservation) {
    if (outcome.kind === 'unknown') tell(NOTES.unknown());
    return;
  }
  recordOutcome(job.dir, reservation, outcome);
  if (outcome.kind !== 'sent') {
    tell(NOTES[outcome.kind](String(outcome.error).slice(0, 300)));
    return;
  }
  const intent = readJsonFile(join(job.dir, 'publish', 'intent.json'), null);
  const posts = Array.isArray(intent?.posts) ? intent.posts : [];
  const entries = readAttempts(job.dir);
  const sentCount = posts.filter(post => attemptState(entries, post.id).sent).length;
  const reference = deliveryReference({ jobDir: job.dir, intent });
  const mine = attemptState(entries, reservation.post).sent;
  const handle = `${reservation.post} is saved as uuid ${mine?.uuid ?? '?'}${mine?.id ? `, id ${mine.id}` : ''}. To change or cancel it, the person opens it in Metricool.`;
  tell(reference
    ? `Saved. All ${posts.length} posts are in Metricool. ${handle} Close the job now with pipeline_publish_close.`
    : `Saved. ${sentCount} of ${posts.length} posts are in Metricool. ${handle}`);
}

async function main() {
  const event = await readEvent();
  if (!event) return;
  const base = toolBase(event.tool_name);
  const sends = SEND_TOOLS.has(base);
  const reads = (ASSET_TOOLS.has(base) || base === LISTING_TOOL) && event.hook_event_name !== 'PostToolUseFailure';
  if (!sends && !reads) return;
  const root = resolveWorkspaceRoot(event.cwd);
  const bound = root ? readSessionBinding(root, event.session_id) : null;
  const job = bound ? jobAt(root, bound.brand, bound.jobId) : null;
  if (!job) return;
  if (sends) {
    recordSend(job, event);
    return;
  }
  // Only a job that has a posting plan needs these lines.
  if (!existsSync(join(job.dir, 'publish', 'intent.json'))) return;
  const data = bigSafeReply(event.tool_response);
  if (!data || typeof data !== 'object') return;
  if (base === LISTING_TOOL) recordListing(job.dir, data, event.tool_input);
  else recordAssets(job.dir, data, event.tool_input, base);
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
