const INPUT_LIMIT = 8 * 1024 * 1024;
// A send that cannot be judged within this long is refused, before the host's own timeout would let it through.
// The test setting can only shorten it, never beyond 25 seconds.
const WATCHDOG_MS = (() => {
  const set = process.env.SOCIAL_CAMPAIGN_PUBLISH_PRE_TIMEOUT_MS;
  const asked = set === undefined || set === '' ? Number.NaN : Number(set);
  return Number.isFinite(asked) ? Math.max(0, Math.min(asked, 25 * 1000)) : 25 * 1000;
})();
// Set once the hook has stopped itself: nothing may be written after that, whatever is still running.
let stopped = false;
// Only used when the classifier module cannot load. This mirrors the PreToolUse matcher in hooks/hooks.json: with no way to
// judge the call, every one of these tools is refused, the reviewer-step ones included.
const PUBLISH_TOOL = /^mcp__.+__(createScheduledPost|updateScheduledPost|createScheduledPostForReview|sendScheduledPostForReview)$/;
const NAMES_A_TOOL = /(createScheduledPost|updateScheduledPost|createScheduledPostForReview|sendScheduledPostForReview)/;
const UNCHECKED = "The check on this post couldn't finish, so nothing was sent. Try again in a moment.";

// The raw text is kept: an event that is too big or cannot be parsed is still refused when it names a guarded tool.
async function readRaw() {
  let raw = '';
  let over = false;
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > INPUT_LIMIT) {
      over = true;
      break;
    }
  }
  return { raw, over };
}

function parse(text, read = JSON.parse) {
  try {
    const event = read(text);
    return event && typeof event === 'object' && !Array.isArray(event) ? event : null;
  } catch {
    return null;
  }
}

const denial = reason => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});

// A send is judged against the job's approved posting plan. The cheap refusals (reviewer step, boost, unreadable or
// repeating info) need only the classifier module; the rest loads the guard. When any of it cannot run, nothing is sent.
async function decide({ raw, over }) {
  let tools;
  try {
    tools = await import('../../server/pipeline/publish-tools.mjs');
  } catch {
    const event = over ? null : parse(raw);
    return (event ? PUBLISH_TOOL.test(String(event.tool_name || '')) : NAMES_A_TOOL.test(raw)) ? denial(UNCHECKED) : null;
  }
  // Long ids (a Metricool uuid) are kept as text while the event is parsed, so no digit is rounded away.
  const event = over ? null : parse(raw, tools.parseBigSafe) || parse(raw);
  if (!event) return tools.namesGuardedTool(raw) ? denial(UNCHECKED) : null;
  if (stopped) return denial(UNCHECKED);
  const base = tools.toolBase(event.tool_name);
  if (!tools.isPublishTool(base)) return null;
  if (tools.isReviewerTool(base)) return denial(tools.PUBLISH_DENY.reviewer);
  const early = tools.staticDenial(base, event.tool_input);
  if (early) return denial(early);
  try {
    const guard = await import('../../server/pipeline/publish-guard.mjs');
    const verdict = await guard.judgePublishCall(event, { stopped: () => stopped });
    if (!verdict) return null;
    if (verdict.deny) return denial(verdict.deny);
    return verdict.warn ? { systemMessage: verdict.warn } : null;
  } catch {
    return denial(tools.PUBLISH_DENY.unchecked);
  }
}

// Any unexpected error at all, a failed read of the input included, refuses: this hook only runs for the guarded tools.
async function main() {
  let input = { raw: '', over: false };
  let timer;
  let result;
  try {
    input = await readRaw();
    const watchdog = new Promise(resolve => {
      timer = setTimeout(() => {
        stopped = true;
        resolve(NAMES_A_TOOL.test(input.raw) ? denial(UNCHECKED) : null);
      }, WATCHDOG_MS);
    });
    result = await Promise.race([decide(input), watchdog]);
  } catch {
    stopped = true;
    result = denial(UNCHECKED);
  } finally {
    clearTimeout(timer);
  }
  if (result) process.stdout.write(JSON.stringify(result));
}

main().catch(() => {
  stopped = true;
  try {
    process.stdout.write(JSON.stringify(denial(UNCHECKED)));
  } catch { /* nothing more can be done */ }
}).finally(() => {
  process.exitCode = 0;
});
