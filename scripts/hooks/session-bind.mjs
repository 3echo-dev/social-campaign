import { asObject, jobFromDir, parseToolResponse, resolveWorkspaceRoot, toolBase, writeSessionBinding } from '../../server/pipeline/facts.mjs';

const INPUT_LIMIT = 16 * 1024 * 1024;
const BIND_TOOLS = new Set([
  'pipeline_job_read', 'pipeline_job_create', 'pipeline_review_present',
  'pipeline_decision_apply', 'pipeline_intake_update', 'pipeline_board_request_apply',
  'pipeline_quote_save', 'pipeline_generation_land', 'pipeline_inputs_import', 'pipeline_post_files_add',
  'pipeline_product_photo_attach', 'pipeline_recipe_choose', 'pipeline_review_copies_prepare',
]);

const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);

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

function refFromNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const jobId = text(node.jobId);
  const brand = text(node.brand) || text(node.brand?.slug) || text(node.brandSlug);
  return jobId && brand ? { brand, jobId } : null;
}

function refFromResult(data) {
  const queue = [{ node: data, depth: 0 }];
  while (queue.length) {
    const { node, depth } = queue.shift();
    if (!node || typeof node !== 'object' || depth > 6) continue;
    if (!Array.isArray(node)) {
      const dir = text(node.jobDir);
      if (dir) {
        const job = jobFromDir(dir);
        if (job) return { brand: job.brand, jobId: job.jobId };
      }
      if (node.project && refFromNode(node.project)) return refFromNode(node.project);
      const direct = refFromNode(node);
      if (direct) return direct;
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      if (child && typeof child === 'object') queue.push({ node: child, depth: depth + 1 });
    }
  }
  return null;
}

async function main() {
  const event = await readEvent();
  if (!event || !event.session_id || !BIND_TOOLS.has(toolBase(event.tool_name))) return;
  const ref = refFromNode(asObject(event.tool_input)) || refFromResult(parseToolResponse(event.tool_response));
  if (!ref) return;
  const root = resolveWorkspaceRoot(event.cwd);
  if (!root) return;
  writeSessionBinding({ root, sessionId: event.session_id, brand: ref.brand, jobId: ref.jobId });
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
