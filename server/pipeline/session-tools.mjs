import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';

const PLUGIN_TOOL_PREFIX = 'mcp__plugin_social-campaign_core__';
const PLUGIN_SERVER = /social-campaign/i;
const HEAD_BYTES = 2 * 1024 * 1024;
const FILE_LIMIT = 48 * 1024 * 1024;

/** What the lines of a chat transcript say about this plugin's tools: {listed: a tool list was seen, found: ours is in it or was used, pending: ours is still connecting}. */
function scanLines(lines) {
  const seen = { listed: false, found: false, pending: false };
  for (const line of lines) {
    if (!line) continue;
    // A tool call or a loaded tool record names the tool in a "name" field; prose that merely mentions it does not.
    if (line.includes(`"name":"${PLUGIN_TOOL_PREFIX}`)) {
      seen.found = true;
      return seen;
    }
    if (!line.includes('"deferred_tools_delta"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const listing = entry?.attachment;
    if (listing?.type !== 'deferred_tools_delta') continue;
    seen.listed = true;
    const names = [...(Array.isArray(listing.addedNames) ? listing.addedNames : []), ...(Array.isArray(listing.readdedNames) ? listing.readdedNames : [])];
    if (names.some(name => typeof name === 'string' && name.startsWith(PLUGIN_TOOL_PREFIX))) {
      seen.found = true;
      return seen;
    }
    if (Array.isArray(listing.pendingMcpServers) && listing.pendingMcpServers.some(name => PLUGIN_SERVER.test(String(name)))) seen.pending = true;
  }
  return seen;
}

function readHead(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size > FILE_LIMIT) return { size, text: null };
    const buffer = Buffer.alloc(Math.min(size, HEAD_BYTES));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, read).toString('utf8');
    // The cut can fall inside a line: drop the unfinished one unless the whole file was read.
    return { size, text: size > HEAD_BYTES ? text.slice(0, text.lastIndexOf('\n') + 1) : text, whole: size <= HEAD_BYTES };
  } finally {
    closeSync(fd);
  }
}

/**
 * Can this chat call Social Campaign's tools? Read from its own transcript: the tool list the host recorded names the plugin's tools,
 * or a plugin tool was called. Answers false only when the transcript shows a tool list without the plugin (or a plugin server that
 * failed to connect); anything it cannot tell (no transcript, an unreadable or huge one, no tool list recorded) answers true, so an
 * unknown window is treated as before and only a window that plainly has no plugin tools is left alone.
 */
export function sessionHasPluginTools(transcriptPath) {
  try {
    if (typeof transcriptPath !== 'string' || !transcriptPath.trim()) return true;
    const head = readHead(transcriptPath);
    if (head.text === null) return true;
    let seen = scanLines(head.text.split('\n'));
    if (!seen.found && !head.whole) {
      const text = readFileSync(transcriptPath, 'utf8');
      seen = scanLines(text.split('\n'));
    }
    if (seen.found || seen.pending) return true;
    return !seen.listed;
  } catch {
    return true;
  }
}
