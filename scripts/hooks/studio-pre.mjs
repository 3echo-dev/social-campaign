const INPUT_LIMIT = 8 * 1024 * 1024;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
// Only used when the small classifier module cannot load. These mirror the PreToolUse matchers in hooks/hooks.json.
const SPEND_TOOL = /^mcp__.+__(create_image_job|create_video_job|creative_generate_speech|creative_transcribe_audio|creative_design_voice|creative_generate_image|creative_generate_video|creative_edit_image|creative_generate_in_flow|creative_run_flow_nodes)$/;
const JOB_FOLDER = /[\\/]workspaces[\\/][^\\/]+[\\/]jobs[\\/]/i;
const UNCHECKED = "The price check couldn't finish, so nothing was made. Try again in a moment.";
const FACT_FILE_DENY = 'These records are kept by Social Campaign itself and cannot be edited by hand.';

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

const denial = reason => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});

// Used when the classifier module cannot load: a paid call is refused, and so is an edit inside a job folder.
async function fallback(event) {
  const name = String(event.tool_name || '');
  if (SPEND_TOOL.test(name)) return denial(UNCHECKED);
  if (!WRITE_TOOLS.has(name)) return null;
  const { resolve } = await import('node:path');
  const input = event.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
  const path = typeof input.file_path === 'string' ? input.file_path : '';
  if (!path) return null;
  const full = resolve(typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd(), path);
  return JOB_FOLDER.test(full) ? denial(FACT_FILE_DENY) : null;
}

// A Write or Edit is judged on its path alone, so it never waits on the facts module.
function judgeWrite(tools, event) {
  const input = tools.asObject(event.tool_input);
  return tools.isFactFile(input.file_path, event.cwd) ? denial(tools.FACT_FILE_DENY) : null;
}

// A paid call is judged against the job's approved price. When that check cannot run, nothing is made.
async function judgeSpend(tools, event) {
  const base = tools.toolBase(event.tool_name);
  if (!tools.isGuardedTool(base)) return null;
  const input = tools.asObject(event.tool_input);
  if (tools.honoursEstimateOnly(base, input)) return null;
  try {
    const facts = await import('../../server/pipeline/facts.mjs');
    const root = facts.resolveWorkspaceRoot(event.cwd);
    const job = root ? facts.resolveJobForCall({ root, sessionId: event.session_id, toolInput: input }) : null;
    if (!job) return root || facts.inPipelineWorkspace(event.cwd) ? denial(tools.NO_JOB_DENY) : { systemMessage: tools.NO_JOB_WARNING };
    const verdict = facts.spendDecision(job, base, input);
    return verdict.allow ? null : denial(verdict.reason);
  } catch {
    return denial(tools.SPEND_DENY.unchecked);
  }
}

async function decide(event) {
  let tools;
  try {
    tools = await import('../../server/pipeline/spend-tools.mjs');
  } catch {
    return fallback(event);
  }
  return WRITE_TOOLS.has(event.tool_name) ? judgeWrite(tools, event) : judgeSpend(tools, event);
}

async function main() {
  const event = await readEvent();
  if (!event) return;
  let result;
  try {
    result = await decide(event);
  } catch {
    result = await fallback(event).catch(() => null);
  }
  if (result) process.stdout.write(JSON.stringify(result));
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
