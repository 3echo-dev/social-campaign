import { pathToFileURL } from 'node:url';

// Social Campaign keeps ad accounts read-only in this version. This hook refuses the write tools of the official Meta Ads and
// TikTok for Business connectors. Like publish-pre.mjs it acts on every call it is started for (no workspace gate); the
// PreToolUse matcher in hooks/hooks.json carries the same pattern, so unrelated tools never start it. Namespaces are opaque:
// only the base name (after the last "__") is judged.
const INPUT_LIMIT = 8 * 1024 * 1024;
const DENY_REASON = 'Social Campaign keeps your ad accounts read-only for now, so make this change in Ads Manager yourself.';

const META_WRITE = 'ads_(?=[a-z0-9_]*(?:create|update|activate|delete|pause|duplicate|archive))[a-z0-9_]+';
const TIKTOK_PREFIX = 'campaign|adgroup|ad|smart_plus|creative|file|dmp|pixel|catalog|bc|identity|app|page|custom_conversion|spark';
const TIKTOK_SUFFIX = 'create|update|delete|upload|status_update|bind|unbind|transfer';
// ElevenLabs' creative_create_asset_upload would otherwise look like a TikTok creative upload.
const TIKTOK_WRITE = `(?!creative_create_asset_upload$)(?:smart_plus_ad_create|(?:${TIKTOK_PREFIX})(?:_[a-z0-9]+)*_(?:${TIKTOK_SUFFIX}))`;
// The body of the hooks.json matcher is `^mcp__.+__(?!.*__)(BASE_WRITE)$`.
export const BASE_WRITE = `${META_WRITE}|${TIKTOK_WRITE}`;
export const MATCHER = `^mcp__.+__(?!.*__)(?:${BASE_WRITE})$`;
const BASE_RE = new RegExp(`^(?:${BASE_WRITE})$`);

export const toolBase = name => {
  const text = String(name || '');
  const cut = text.lastIndexOf('__');
  return text.startsWith('mcp__') && cut > 'mcp__'.length ? text.slice(cut + 2) : '';
};
export const isAdsWriteTool = name => BASE_RE.test(toolBase(name));
export const denial = reason => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});

const TOOL_NAME = /"tool_name"\s*:\s*"((?:[^"\\]|\\.)*)"/;
function nameIn(raw) {
  const found = TOOL_NAME.exec(raw);
  if (!found) return '';
  try {
    return String(JSON.parse(`"${found[1]}"`));
  } catch {
    return '';
  }
}

export function decide(raw) {
  let name = '';
  try {
    const event = JSON.parse(raw);
    if (event && typeof event === 'object' && !Array.isArray(event)) name = String(event.tool_name || '');
  } catch {
    name = nameIn(raw);
  }
  return isAdsWriteTool(name) ? denial(DENY_REASON) : null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > INPUT_LIMIT) break;
  }
  const result = decide(raw);
  if (result) process.stdout.write(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {}).finally(() => { process.exitCode = 0; });
}
