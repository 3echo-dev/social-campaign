import { isBoundBoardUrl } from '../../server/pipeline/artifact.mjs';
import { asObject, resolveWorkspaceRoot } from '../../server/pipeline/facts.mjs';
import { isReviewCopyPath, markReviewCopyDeleted, recordReviewUpload, shaFromReviewCopyPath } from '../../server/pipeline/review-copies.mjs';

const INPUT_LIMIT = 16 * 1024 * 1024;
const HEX32 = /^[0-9a-f]{32}$/i;
const BLOB_ID = /\/_blob\/([0-9a-f]{32})/i;
const MANUAL_FALLBACK = "Some review copies were uploaded but their asset id and url could not be read from the result. Call pipeline_review_copies_record with each file's path, assetId and url.";

async function readEvent() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > INPUT_LIMIT) return null;
  }
  try {
    const event = JSON.parse(raw);
    return event && typeof event === 'object' ? event : null;
  } catch {
    return null;
  }
}

function tell(context) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }));
}

function parsed(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function flaggedAsError(value) {
  const node = parsed(value);
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  return node.isError === true || node.is_error === true || node.success === false || node.ok === false;
}

function idFromUrl(url) {
  const match = typeof url === 'string' ? BLOB_ID.exec(url) : null;
  return match ? match[1].toLowerCase() : null;
}

function firstString(node, keys) {
  for (const key of keys) {
    if (typeof node[key] === 'string' && node[key].trim()) return node[key].trim();
  }
  return null;
}

function collectAssetHits(node, depth, out) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const child of node) collectAssetHits(child, depth + 1, out);
    return;
  }
  if (typeof node !== 'object') return;
  if (typeof node.text === 'string' && node.type === 'text') {
    const inner = parsed(node.text);
    if (inner && typeof inner === 'object') collectAssetHits(inner, depth + 1, out);
  }
  const url = firstString(node, ['url', 'assetUrl', 'asset_url']);
  const id = firstString(node, ['id', 'assetId', 'asset_id'])?.toLowerCase() || idFromUrl(url);
  const path = firstString(node, ['path', 'file_path', 'filePath', 'filename', 'name']);
  if (id && HEX32.test(id) && url) out.push({ id, url, path });
  for (const value of Object.values(node)) if (value && typeof value === 'object') collectAssetHits(value, depth + 1, out);
}

function inputPaths(input) {
  if (typeof input.file_path === 'string' && input.file_path.trim()) return [input.file_path.trim()];
  if (Array.isArray(input.file_paths)) return input.file_paths.filter(value => typeof value === 'string' && value.trim());
  return [];
}

// Pairs every uploaded file the result shows with its review copy path, even when other files in the same call failed.
// A file the result does not show stays in `missing` so it can be uploaded again.
// Returns null when the result shows no upload at all and was not flagged as an error.
function pairUploads(root, input, response, flagged) {
  const paths = inputPaths(input).filter(path => isReviewCopyPath(root, path));
  if (!paths.length) return { pairs: [], missing: [] };
  const hits = [];
  collectAssetHits(parsed(response), 0, hits);
  if (!hits.length) return flagged ? { pairs: [], missing: [] } : null;
  const byPath = new Map();
  for (const hit of hits) {
    if (!hit.path) continue;
    const match = paths.find(path => path === hit.path || path.endsWith(hit.path) || hit.path.endsWith(path));
    if (match && !byPath.has(match)) byPath.set(match, hit);
  }
  if (!flagged && byPath.size < paths.length && hits.length === paths.length) {
    return { pairs: paths.map((path, index) => ({ ...hits[index], path })), missing: [] };
  }
  const pairs = paths.filter(path => byPath.has(path)).map(path => ({ ...byPath.get(path), path }));
  return { pairs, missing: paths.filter(path => !byPath.has(path)) };
}

function retryNote(left) {
  return `Some review copies were saved. These were not: ${left.join(', ')}. Upload only these files again, once. If that fails, call pipeline_review_copies_record with each file's path, assetId and url.`;
}

function handleUpload(ctx) {
  const found = pairUploads(ctx.root, ctx.input, ctx.response, ctx.flagged);
  if (found === null) {
    tell(MANUAL_FALLBACK);
    return;
  }
  const uploadedAt = new Date().toISOString();
  const left = [...found.missing];
  let recorded = 0;
  for (const pair of found.pairs) {
    const sha = shaFromReviewCopyPath(pair.path);
    if (sha && recordReviewUpload(ctx.root, { sha, assetId: pair.id, url: pair.url, uploadedAt })) recorded += 1;
    else left.push(pair.path);
  }
  if (!left.length) return;
  if (!recorded && !ctx.flagged) tell(MANUAL_FALLBACK);
  else if (recorded) tell(retryNote(left));
}

function handleDelete(ctx) {
  const assetId = typeof ctx.input.path === 'string' ? ctx.input.path.trim() : null;
  if (assetId) markReviewCopyDeleted(ctx.root, { assetId });
}

async function main() {
  const event = await readEvent();
  if (!event || String(event.tool_name || '') !== 'Artifact') return;
  const root = resolveWorkspaceRoot(event.cwd);
  if (!root) return;
  const input = asObject(event.tool_input);
  if (!isBoundBoardUrl({ root, url: input.url })) return;
  const action = input.action ?? 'publish';
  const flagged = flaggedAsError(event.tool_response);
  const ctx = { root, input, response: event.tool_response, flagged };
  if (action === 'publish' && input.asset === true) handleUpload(ctx);
  else if (action === 'delete' && typeof input.path === 'string' && !flagged) handleDelete(ctx);
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
