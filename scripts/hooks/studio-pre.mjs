import {
  ELEVEN_LABS_MEDIA, FACT_FILE_DENY, NO_JOB_WARNING, SPEND_DENY, THREE_ECHO_SPENDERS, VOICE_SPENDERS,
  asObject, isFactFile, resolveJobForCall, spendDecision, toolBase,
} from '../../server/pipeline/facts.mjs';

const INPUT_LIMIT = 8 * 1024 * 1024;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const GUARDED = new Set([...THREE_ECHO_SPENDERS, ...VOICE_SPENDERS, ...ELEVEN_LABS_MEDIA]);

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

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}

function warn(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
}

async function main() {
  const event = await readEvent();
  if (!event) return;
  const input = asObject(event.tool_input);
  if (WRITE_TOOLS.has(event.tool_name)) {
    if (isFactFile(input.file_path, event.cwd)) deny(FACT_FILE_DENY);
    return;
  }
  const base = toolBase(event.tool_name);
  if (!GUARDED.has(base) || input.estimate_only === true) return;
  let job = null;
  try {
    job = resolveJobForCall({ cwd: event.cwd, sessionId: event.session_id, toolInput: input });
  } catch {
    job = null;
  }
  if (!job) {
    warn(NO_JOB_WARNING);
    return;
  }
  let verdict;
  try {
    verdict = spendDecision(job, base, input);
  } catch {
    verdict = { allow: false, reason: SPEND_DENY.unchecked };
  }
  if (!verdict.allow) deny(verdict.reason);
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
