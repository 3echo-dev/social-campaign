const INPUT_LIMIT = 8 * 1024 * 1024;
// A call that cannot be judged within this long is refused, before the host's own timeout (hooks/hooks.json) would let it
// through. The test setting can only shorten it, never beyond 15 seconds.
const WATCHDOG_MS = (() => {
  const set = process.env.SOCIAL_CAMPAIGN_STUDIO_PRE_TIMEOUT_MS;
  const asked = set === undefined || set === '' ? Number.NaN : Number(set);
  return Number.isFinite(asked) ? Math.max(0, Math.min(asked, 15 * 1000)) : 15 * 1000;
})();
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
// Only used when the small classifier module cannot load. SPEND_TOOL is the PreToolUse matcher in hooks/hooks.json: every
// tool on the 3Echo and ElevenLabs servers. With no way to judge the call, all of them are refused except plain reads.
const SPEND_TOOL = /^mcp__(.*(3[Ee]cho|3ECHO|[Tt]hree_?[Ee]cho|THREE_?ECHO|[Ee]leven[_-]?[Ll]abs|ELEVEN[_-]?LABS).*__.+|.+__(create_image_job|create_video_job|creative_[a-z_]+|[a-z_]*studio[a-z_]*|list_workspaces|get_workspace_capabilities|get_upload_capabilities|estimate_image_job|estimate_video_job|wait_for_job|get_job|get_job_result|list_jobs|cancel_job|get_asset|list_assets|fetch_asset_bytes|upload_asset|update_asset_metadata|create_asset_upload_session|complete_asset_upload|import_asset_from_url|import_asset_from_file_reference|get_overlay_track|get_overlay_render|save_overlay_track|render_overlay_track|delete_overlay_track))$/;
const OWN_TOOL = /^mcp__plugin_social-campaign_/;
const READ_TOOL = /__(get_[a-z_]+|list_[a-z_]+|estimate_[a-z_]+|preview_[a-z_]+|wait_for_job|fetch_asset_bytes|creative_(get|list|show)_[a-z_]+)$/;
// The tool an event names, read from its raw text when the event is too big or cannot be parsed. Inside a JSON string a
// quote is always escaped, so only the event's own tool_name key can match.
const TOOL_NAME = /"tool_name"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const JOB_FOLDER = /[\\/]workspaces[\\/][^\\/]+[\\/]jobs[\\/]/i;
const UNCHECKED = "The price check couldn't finish, so nothing was made. Try again in a moment.";
const FACT_FILE_DENY = 'These records are kept by Social Campaign itself and cannot be edited by hand.';
// The classifier module, once loaded.
let tools = null;
// Set once the hook has stopped itself: nothing may be allowed after that, whatever is still running.
let stopped = false;

// The raw text is kept: an event that is too big or cannot be parsed is still refused when it names a guarded tool.
async function readRaw(input) {
  for await (const chunk of process.stdin) {
    input.raw += chunk;
    if (input.raw.length > INPUT_LIMIT) {
      input.over = true;
      break;
    }
  }
}

function parse(text) {
  try {
    const event = JSON.parse(text);
    return event && typeof event === 'object' && !Array.isArray(event) ? event : null;
  } catch {
    return null;
  }
}

function nameIn(raw) {
  const found = TOOL_NAME.exec(raw);
  if (!found) return '';
  try {
    return String(JSON.parse(`"${found[1]}"`));
  } catch {
    return '';
  }
}

const denial = reason => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});

// True when the call may go through unjudged: an edit (judged on its path alone, and never refused for want of a check),
// a tool the guard does not cover, or a reviewed read or upload. A call with no readable name is never exempt.
function exempt(name) {
  if (!name) return false;
  if (WRITE_TOOLS.has(name)) return true;
  if (tools) return tools.spendClass(name) !== 'guarded' && tools.spendClass(name) !== 'unsupported';
  return !SPEND_TOOL.test(name) || OWN_TOOL.test(name) || READ_TOOL.test(name);
}

// Used when the event cannot be read, the check fails or runs out of time: only an exempt call goes through.
const unsure = raw => (exempt(nameIn(raw)) ? null : denial(UNCHECKED));

// Used when the classifier module cannot load: a covered call is refused, and so is an edit inside a job folder.
async function fallback(event) {
  const name = String(event.tool_name || '');
  if (!WRITE_TOOLS.has(name)) return exempt(name) ? null : denial(UNCHECKED);
  const { resolve } = await import('node:path');
  const input = event.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
  const path = typeof input.file_path === 'string' ? input.file_path : '';
  if (!path) return null;
  const full = resolve(typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd(), path);
  return JOB_FOLDER.test(full) ? denial(FACT_FILE_DENY) : null;
}

// A Write or Edit is judged on its path alone, so it never waits on the facts module.
function judgeWrite(event) {
  const input = tools.asObject(event.tool_input);
  return tools.isFactFile(input.file_path, event.cwd) ? denial(tools.FACT_FILE_DENY) : null;
}

// A paid call is judged against the job's approved price. Any other 3Echo or ElevenLabs tool that is not a reviewed read or
// upload is refused inside a campaign workspace, since no price covers it; outside one it is left alone, as before. When
// that check cannot run, nothing is made.
async function judgeSpend(event) {
  const kind = tools.spendClass(event.tool_name);
  if (kind !== 'guarded' && kind !== 'unsupported') return null;
  const base = tools.toolBase(event.tool_name);
  const input = tools.asObject(event.tool_input);
  if (kind === 'guarded' && tools.honoursEstimateOnly(base, input)) return null;
  try {
    const facts = await import('../../server/pipeline/facts.mjs');
    const root = facts.resolveWorkspaceRoot(event.cwd);
    const inWorkspace = Boolean(root) || facts.inPipelineWorkspace(event.cwd);
    if (kind === 'unsupported') return inWorkspace ? denial(tools.SPEND_DENY.unsupported) : null;
    const job = root ? facts.resolveJobForCall({ root, sessionId: event.session_id, toolInput: input }) : null;
    if (!job) return inWorkspace ? denial(tools.NO_JOB_DENY) : { systemMessage: tools.NO_JOB_WARNING };
    const verdict = facts.spendDecision(job, base, input);
    if (stopped) return denial(tools.SPEND_DENY.unchecked);
    return verdict.allow ? null : denial(verdict.reason);
  } catch {
    return denial(tools.SPEND_DENY.unchecked);
  }
}

async function decide(input) {
  await readRaw(input);
  const event = input.over ? null : parse(input.raw);
  try {
    tools = await import('../../server/pipeline/spend-tools.mjs');
  } catch {
    return event ? fallback(event) : unsure(input.raw);
  }
  if (!event) return unsure(input.raw);
  if (typeof event.tool_name !== 'string' || !event.tool_name) return denial(UNCHECKED);
  return WRITE_TOOLS.has(event.tool_name) ? judgeWrite(event) : judgeSpend(event);
}

// Any unexpected error, a failed read of the input included, refuses a covered call. The watchdog starts before the input
// is read, so a host that never closes stdin is refused too.
async function main() {
  const input = { raw: '', over: false };
  let timer;
  let result;
  try {
    const watchdog = new Promise(resolve => {
      timer = setTimeout(() => {
        stopped = true;
        resolve(unsure(input.raw));
      }, WATCHDOG_MS);
    });
    result = await Promise.race([decide(input), watchdog]);
  } catch {
    stopped = true;
    const event = input.over ? null : parse(input.raw);
    result = event ? await fallback(event).catch(() => denial(UNCHECKED)) : unsure(input.raw);
  } finally {
    clearTimeout(timer);
  }
  if (result) process.stdout.write(JSON.stringify(result));
  // Whatever is still running (an unread stdin, a module still loading) must not hold the answer back past the host's timeout.
  if (stopped) process.stdout.write('', () => process.exit(0));
}

main().catch(() => {
  stopped = true;
  try {
    process.stdout.write(JSON.stringify(denial(UNCHECKED)));
  } catch { /* nothing more can be done */ }
}).finally(() => {
  process.exitCode = 0;
});
