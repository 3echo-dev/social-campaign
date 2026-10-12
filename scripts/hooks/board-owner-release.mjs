import { resolveWorkspaceRoot } from '../../server/pipeline/facts.mjs';
import { releaseBoardOwner } from '../../server/pipeline/board-freshness.mjs';

// SessionEnd: a window that closes gives the board back, but only if it is still the owner (a newer window may have taken it).
async function main() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 1024 * 1024) return;
  }
  const event = JSON.parse(raw);
  if (!event || typeof event !== 'object' || !event.session_id) return;
  const root = resolveWorkspaceRoot(event.cwd);
  if (root) releaseBoardOwner(root, event.session_id);
}

main().catch(() => null).finally(() => {
  process.exitCode = 0;
});
