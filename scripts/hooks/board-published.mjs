import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { asObject, resolveWorkspaceRoot } from '../../server/pipeline/facts.mjs';
import {
  BOARD_TEXT, WORKSPACE_DOCUMENT, claimBoardOwner, isBoardUrl, noteBoardTurn, noteOtherWindowOnce, markProjectionPublished, needsRearm, projectionHashFromFileName, projectionSha, readBoardLink, recordBoardAlias, recordBoardArmed, sessionChatOnly, touchBoardWindow,
} from '../../server/pipeline/board-freshness.mjs';
import { sessionHasPluginTools } from '../../server/pipeline/session-tools.mjs';
import { accessBlocked } from '../../server/licence/licence.mjs';

const INPUT_LIMIT = 16 * 1024 * 1024;
const TEXT_LIMIT = 64 * 1024;
const WRITE_FAILED = /(\bconflict\b|\brefused\b|\bfailed\b|nothing (?:was )?written|writes nothing|not written)/i;
const ARTIFACT_URL = /(?:https:\/\/)?claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/gi;
const BOARD_SOURCE = join('.social-pipeline', 'board', 'social-campaign.html');
// A prompt the host put in, not one the person typed: a comment sent from the board, or a background task that finished.
const HOST_PROMPT = /^\s*(?:\[Artifact comment sent to Claude\]|<task-notification>)/;
const READ_HEADER = /\bArtifact\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\(version\b/i;

async function readEvent() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > INPUT_LIMIT) return null;
  }
  try {
    const event = JSON.parse(raw);
    return event && typeof event === 'object' && !Array.isArray(event) ? event : null;
  } catch {
    return null;
  }
}

// Does a host-sent prompt carry a message from this workspace's board? Either address of the board counts; with the long address not
// known yet, any artifact address in a host-sent prompt does.
function isBoardMessage(prompt, link) {
  if (!HOST_PROMPT.test(prompt)) return false;
  const urls = prompt.match(ARTIFACT_URL) || [];
  return urls.some(url => isBoardUrl(link, url)) || (!link.aliasUrl && urls.length > 0);
}

function tell(context) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
}

function parsed(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function responseText(value) {
  const parts = [];
  let size = 0;
  const walk = (node, depth) => {
    if (node == null || depth > 8 || size > TEXT_LIMIT) return;
    if (typeof node === 'string') {
      parts.push(node);
      size += node.length;
      return;
    }
    if (typeof node !== 'object') return;
    for (const child of Array.isArray(node) ? node : Object.values(node)) walk(child, depth + 1);
  };
  walk(parsed(value), 0);
  return parts.join('\n').slice(0, TEXT_LIMIT);
}

function flaggedAsError(value) {
  const node = parsed(value);
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  return node.isError === true || node.is_error === true || node.success === false || node.ok === false;
}

const samePath = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
const localPath = (value, cwd) => (isAbsolute(value) ? value : resolve(cwd || process.cwd(), value));
const isWorkspaceDocument = write => write && write.collection === WORKSPACE_DOCUMENT.collection && write.doc_id === WORKSPACE_DOCUMENT.doc_id;

function workspaceWrites(input) {
  if (input.action === 'set') return isWorkspaceDocument(input) ? [input] : [];
  if (input.action === 'batch' && Array.isArray(input.writes)) return input.writes.filter(write => write?.op === 'set' && isWorkspaceDocument(write));
  return [];
}

function writtenHash(write, cwd) {
  if (typeof write.file_path === 'string' && write.file_path.trim()) {
    const named = projectionHashFromFileName(write.file_path);
    if (named) return named;
    try {
      return projectionSha(readFileSync(localPath(write.file_path, cwd)));
    } catch {
      return null;
    }
  }
  if (write.data && typeof write.data === 'object' && !Array.isArray(write.data)) return projectionSha(Buffer.from(JSON.stringify(write.data), 'utf8'));
  return null;
}

function recordWorkspaceWrite(ctx) {
  const writes = workspaceWrites(ctx.input);
  if (!writes.length || !isBoardUrl(ctx.link, ctx.input.url)) return;
  if (flaggedAsError(ctx.response) || WRITE_FAILED.test(responseText(ctx.response))) return;
  for (const write of writes) {
    const hash = writtenHash(write, ctx.cwd);
    if (hash && markProjectionPublished(ctx.root, { projectionSha256: hash, sessionId: ctx.sessionId })) return;
  }
}

function publishesBoard(ctx) {
  const input = ctx.input;
  if ((input.action ?? 'publish') !== 'publish' || input.asset === true || input.type_url) return false;
  if (typeof input.url === 'string' && input.url.trim()) return isBoardUrl(ctx.link, input.url);
  if (typeof input.file_path === 'string' && input.file_path.trim() && samePath(localPath(input.file_path, ctx.cwd), join(ctx.root, BOARD_SOURCE))) return true;
  return (responseText(ctx.response).match(ARTIFACT_URL) || []).some(url => isBoardUrl(ctx.link, url));
}

function watchesBoard(ctx) {
  return ctx.input.action === 'watch' && ctx.input.on !== false && isBoardUrl(ctx.link, ctx.input.url);
}

function recordAlias(ctx) {
  const input = ctx.input;
  if (!ctx.link || ctx.link.aliasUrl || input.path != null || input.paths != null || input.type_url) return;
  if (!isBoardUrl(ctx.link, input.url) || flaggedAsError(ctx.response)) return;
  const header = READ_HEADER.exec(responseText(ctx.response));
  if (header) recordBoardAlias(ctx.root, header[1]);
}

function recordArming(ctx) {
  if (flaggedAsError(ctx.response)) return;
  const armed = ctx.tool === 'Artifact' ? publishesBoard(ctx) : ctx.tool === 'ArtifactComments' ? watchesBoard(ctx) : false;
  // Only the window that owns the board arms its wake-up.
  if (armed && claimBoardOwner(ctx.root, ctx.sessionId).owner) recordBoardArmed(ctx.root, ctx.sessionId);
}

async function main() {
  const event = await readEvent();
  if (!event) return;
  // With Social Campaign access refused, board instructions only make Claude retry tools that fail again.
  if (accessBlocked()) return;
  const root = resolveWorkspaceRoot(event.cwd);
  if (!root) return;
  if (event.hook_event_name === 'UserPromptSubmit') {
    const bound = readBoardLink(root);
    if (!event.session_id || !bound) return;
    // A job the person asked to run in chat without the board gets no board instructions.
    if (sessionChatOnly(root, event.session_id)) return;
    // A window that cannot call Social Campaign's tools cannot answer the board: it does not take the board and is told nothing about it.
    if (!sessionHasPluginTools(event.transcript_path)) return;
    const prompt = typeof event.prompt === 'string' ? event.prompt : '';
    const fromHost = HOST_PROMPT.test(prompt);
    const boardMessage = isBoardMessage(prompt, bound);
    // The window the person writes in owns the board, unless the owner is answering a board message right now (it ends with its
    // Stop hook). A prompt the host sent (a board comment) never moves the board: it only takes a board nobody holds.
    const ownership = claimBoardOwner(root, event.session_id, { takeOver: !fromHost });
    if (!ownership.owner) {
      // Said only while the other window really is busy; an owner that went quiet is replaced, not announced.
      if (ownership.busy && !fromHost) {
        if (noteOtherWindowOnce(root, event.session_id, ownership.by)) tell(BOARD_TEXT.otherWindow);
      } else if (boardMessage) {
        tell(BOARD_TEXT.otherWindowMessage);
      }
      return;
    }
    noteBoardTurn(root, event.session_id, { board: boardMessage ? true : (fromHost ? undefined : false), transcript: event.transcript_path });
    if (needsRearm(root, event.session_id)) tell(BOARD_TEXT.rearm);
    return;
  }
  const link = readBoardLink(root);
  // A board tool call is a sign of life from the owner in the middle of its turn.
  if (link && event.session_id) touchBoardWindow(root, event.session_id);
  const ctx = {
    root,
    link,
    tool: String(event.tool_name || ''),
    input: asObject(event.tool_input),
    response: event.tool_response,
    cwd: event.cwd,
    sessionId: event.session_id ?? null,
  };
  if (ctx.tool === 'ArtifactData') {
    if (link) recordWorkspaceWrite(ctx);
  } else if (ctx.tool === 'Artifact' && ctx.input.action === 'read') recordAlias(ctx);
  else recordArming(ctx);
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
