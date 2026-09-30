#!/usr/bin/env node
// PostToolUseFailure hook. Two jobs:
//   1. Correct a known trap immediately, on stderr, which Claude sees.
//   2. Record it so the next session starts knowing.
// Never throws: a hook that crashes is noise on top of a failure.
const fs = require('fs');
const path = require('path');

const KNOWN = [
  { when: i => /agentc\.3echo\.ai/.test(i) && /\bcurl\b/.test(i),
    say: 'A 3echo asset URL is signed and short-lived. Get a fresh media URL from get_asset right before fetching, ' +
         'or use fetch_asset_bytes with variant thumbnail for review. curl on a stale URL saves an error body as a valid file.' },
  { when: i => /fetch_asset_bytes/.test(i) && /(path|output|dest|write|save|file)/i.test(i),
    say: 'fetch_asset_bytes returns base64 for looking at. It cannot write a file. Pipe dataBase64 into ' +
         'scripts/save-asset-bytes.py, or fetch the media URL from get_asset over HTTP.' },
  { when: i => /(import_asset_from_url|upload_asset|import_asset_from_file_reference)/.test(i)
               && /(download|save|to disk|local)/i.test(i),
    say: 'Those tools import INTO 3echo. Nothing in the MCP downloads to disk. Use get_asset for a media URL.' },
  { when: i => /create_(video|image)_job/.test(i) && /(estimate|quote|confirm)/i.test(i),
    say: 'Paid submission refused. Run estimate_video_job (or count images at 1 credit each), present the quote, ' +
         'and wait for the human to confirm before create_*_job.' },
  { when: i => /\bpython3\b/.test(i) && /(not found|not recognized|Microsoft Store|was not found)/i.test(i),
    say: 'On Windows python3 is the Store stub. Use python.' },
  { when: i => /charmap.*codec|cp1252|UnicodeDecodeError/i.test(i),
    say: 'Windows codepage, not a corrupt file. Re-run with PYTHONUTF8=1.' },
  { when: i => /(^|[^\w])\/tmp\//.test(i) && /(node|python)/i.test(i),
    say: 'On Windows /tmp is AppData\\Local\\Temp to the shell but C:\\tmp to Node and Python. Use a project-relative path.' },
  { when: i => /ffmpeg|ffprobe/.test(i) && /(not found|not recognized)/i.test(i),
    say: 'ffmpeg is not on PATH. winget install Gyan.FFmpeg, then restart the terminal. Until then the hand-off ships separate clips.' },
];

const redact = s => String(s)
  .replace(/([?&](?:token|key|sig|signature|access_token)=)[^&\s"']+/gi, '$1REDACTED')
  .replace(/\b(eyJ[A-Za-z0-9_-]{8,})\b/g, 'JWT_REDACTED')
  .replace(/\b(sk-|ghp_|gho_)[A-Za-z0-9_-]{8,}/g, '$1REDACTED');

// This is a hook: the harness pipes it a JSON event on stdin. Run by hand with arguments
// it used to sit waiting for a stdin that never closed.
if (process.stdin.isTTY || process.argv.length > 2) {
  console.error('note-failure.js is a hook, not a command. It reads a JSON event on stdin.');
  console.error('To leave a note on a job: set-state.js <brand> <job-id> <STATE> --by <you> --note "..."');
  process.exit(2);
}

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
let ev = {};
try { ev = JSON.parse(raw); } catch { process.exit(0); }

try {
  if (ev.cwd && fs.existsSync(ev.cwd)) process.chdir(ev.cwd);
  require('./lib-tool-metrics.js').record({ ...ev, hook_event_name: 'PostToolUseFailure' });
} catch { /* failure reporting must not fail the turn */ }

const tool = ev.tool_name || 'unknown';
const blob = redact(tool + ' ' + JSON.stringify(ev.tool_input || {}) + ' ' + (ev.error || ev.tool_response || ''));

const hit = KNOWN.find(k => { try { return k.when(blob); } catch { return false; } });
if (hit) process.stderr.write('Known failure: ' + hit.say + '\n');

try {
  const dir = path.join(process.cwd(), '.social-pipeline');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'tool-failures.md');
  const sig = tool + ' :: ' + (hit ? hit.say.split('.')[0] : blob.slice(0, 90));
  let lines = [];
  try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch {}
  if (!lines.length || !lines[0].startsWith('# Tool failures')) {
    lines = ['# Tool failures', '',
             'Written by the PostToolUseFailure hook. Surfaced at session start so a trap is not',
             'rediscovered. Delete a line once it stops being true.', ''];
  }
  const i = lines.findIndex(l => l.includes(sig));
  if (i >= 0) {
    const m = lines[i].match(/^- \((\d+)x\)/);
    lines[i] = '- (' + ((m ? +m[1] : 1) + 1) + 'x) ' + sig;
  } else {
    lines.push('- (1x) ' + sig);
  }
  fs.writeFileSync(f, lines.join('\n').replace(/\n{3,}/g, '\n\n'));
} catch { /* logging must never make things worse */ }
