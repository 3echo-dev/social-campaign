#!/usr/bin/env node
// PostToolUse hook. The page stays alive between the calls that report a stage.
//
// The complaint this exists for, in the person's own words: "i dont like the gap in the
// process where the chat is still working and on the interactive side it feels like
// nothings moving". The cause was structural. The workspace page only ever changed when a
// run happened to execute one of this plugin's scripts. Between those calls a run can be
// busy for six minutes, spawning agents, reading files, searching the web, writing a
// script, and the page was frozen for every second of it. A person watching a still page
// assumes it has died.
//
// So the page is told the run is alive by the harness rather than by anyone remembering.
// Claude Code hands this script the same JSON event shape the other hooks get, carrying
// session_id, cwd, hook_event_name, and for this event tool_name and tool_input. It sends
// one short plain-English line saying what just happened, at most once every fifteen
// seconds, and the page shows it beside the stage clock.
//
// Three rules it may never break, because it fires on every single tool call:
//
//   1. It never writes to stdout or stderr. Anything a hook prints lands in the run.
//   2. It always exits 0. A non-zero hook interferes with the turn it is reporting on.
//   3. It costs nothing when the folder was never connected to a gate app: no network.
//
// A heartbeat says "still here, and this is what I last did", and the gate app's store
// refuses to let it say anything else: it cannot move the stage, change the status, filter
// the stages list or replace the activities.

const fs = require('fs');
const path = require('path');
const ws = require('../lib-workspace.js');
const gate = require('../lib-gate.js');
const jobs = require('../lib-open-job.js');
const durable = require('../lib-durable.js');
const { plain } = require('../lib-plain.js');
const execution = require('../lib-execution-availability.js');

const argv = process.argv.slice(2);

// One every fifteen seconds. A hook that fires on every tool call must not become a flood:
// a research stage runs hundreds of calls, and the page only needs to know the run is warm.
const THROTTLE_MS = 15000;
// Three seconds. This sits in front of every tool call, so a gate app that is slow must cost
// the run a moment, never the twenty seconds a script a person is watching can afford.
const TIMEOUT_MS = 1000;
const STAMP = 'heartbeat.json';
const MAX_LINE = 160;

/**
 * What just happened, in words a client reads without wincing.
 *
 * No file name, no path, no tool id, no jargon: `docs/SHARED-RULES.md` sets that rule for
 * everything in the pane and it holds here too. The tool input is used in exactly one place,
 * where it genuinely helps and cannot leak a path, and everywhere else the line says less.
 */
const SAID = {
  Read: 'Reading through the material',
  NotebookRead: 'Reading through the material',
  Glob: 'Looking through the work so far',
  Grep: 'Looking through the work so far',
  LS: 'Looking through the work so far',
  WebSearch: 'Looking something up',
  WebFetch: 'Reading something it found',
  Write: 'Writing it down',
  Edit: 'Making changes to the draft',
  MultiEdit: 'Making changes to the draft',
  NotebookEdit: 'Making changes to the draft',
  Task: 'Handing work to a specialist',
  Agent: 'Handing work to a specialist',
  Bash: 'Running a check',
  BashOutput: 'Running a check',
  KillShell: 'Running a check',
  TodoWrite: 'Working out the next steps',
  ExitPlanMode: 'Working out the next steps',
  AskUserQuestion: 'Putting a question to you',
  SlashCommand: 'Getting the next part started',
  Skill: 'Getting the next part started',
};

// A named specialist is the one thing the input tells us that is worth saying, and its
// vocabulary is already the vocabulary the pane uses, so nothing new can leak through it.
const specialist = (name) => {
  const role = require('../lib-roles.js').roleOf(
    String(name || '').replace(/^social-pipeline:/, '').trim(),
  );
  return role ? 'Handing work to the ' + role.label.toLowerCase() : null;
};

function saidFor(toolName, toolInput) {
  // A payload that is not the shape a hook event has is not a tool call. Coercing a number
  // to a string here would put "Still working" on the page off the back of nothing at all.
  if (typeof toolName !== 'string') return null;
  const name = toolName.trim();
  if (!name) return null;

  if (name === 'Task' || name === 'Agent') {
    const who = toolInput && (toolInput.subagent_type || toolInput.subagentType);
    return specialist(who) || SAID.Task;
  }
  if (SAID[name]) return SAID[name];

  // Anything reached through a connector. The 3echo studio tools are the ones a person is
  // paying for, so those two are worth naming; the rest of them are not.
  if (/^mcp__/.test(name)) {
    if (/image|frame|panel/i.test(name)) return 'Working on the pictures';
    if (/video|clip|take|cut/i.test(name)) return 'Working on the video';
    return 'Working with the studio';
  }
  // A tool nobody here has heard of still means the run is alive, which is the whole point.
  return 'Still working';
}

/**
 * Which job this run is on.
 *
 * `lib-open-job.js` holds the answer, because the turn hook has to agree with this one about
 * which job a card belongs to.
 */
const openJob = sessionId => jobs.openJob(argv, { sessionId });

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('error', () => resolve(''));
    process.stdin.on('end', () => resolve(raw));
  });
}

async function run() {
  // Run as a command it would sit forever on a stdin that never closes. Say nothing, exit 0.
  if (process.stdin.isTTY) return;

  let hook = {};
  try { hook = JSON.parse(await readStdin()) || {}; } catch { return; }
  if (!hook || typeof hook !== 'object') return;

  // The hook's cwd is where the session is, which is what the root resolver walks up from.
  try { if (hook.cwd && fs.existsSync(hook.cwd)) process.chdir(hook.cwd); } catch { /* stay put */ }

  try { require('../lib-tool-metrics.js').record(hook, argv); } catch { /* telemetry cannot fail a turn */ }

  // Rule 3, and it comes first: a folder that was never connected costs one small read.
  if (!gate.configured(argv)) return;

  const line = saidFor(hook.tool_name, hook.tool_input);
  if (!line) return;

  const job = openJob(hook.session_id);
  if (!job) return;
  if (!execution.checkJobDirectory(job.dir).available) return;

  // The stamp lives in the workspace's own hidden folder, beside the setting that says where
  // the work is, so it travels with the workspace and never lands in a job's artifacts.
  const stampDir = path.join(ws.root(argv), ws.CONFIG_DIR);
  const stampFile = path.join(stampDir, STAMP);
  const said = plain(line).slice(0, MAX_LINE).trim();
  if (!said) return;

  // Reserve the window while holding the durable lock. A gate app that is slow must not let
  // another process pass a read/write gap and start a second request.
  let reserved = false;
  try {
    durable.update(stampFile, raw => {
      let last = null;
      try { last = JSON.parse(raw); } catch { /* the first beat */ }
      const now = Date.now();
      if (last && last.key === job.jobId && now - Number(last.at) < THROTTLE_MS) return raw;
      reserved = true;
      return JSON.stringify({ key: job.jobId, at: now }) + '\n';
    });
  } catch { return; }
  if (!reserved) return;
  await gate.call('heartbeat', { key: job.jobId, line: said }, { argv, timeoutMs: TIMEOUT_MS });
}

/**
 * Rule 1, enforced rather than remembered.
 *
 * `lib-gate.js` writes one line to stderr when a key is refused, which is right for a script
 * a person ran and wrong for a hook nobody did. Only the hook is silenced, never the test
 * that reads the wording out of this file.
 */
function hush() {
  const quiet = () => {};
  console.log = quiet;
  console.error = quiet;
  console.warn = quiet;
  console.info = quiet;
  console.debug = quiet;
}

module.exports = { saidFor, SAID, THROTTLE_MS };

if (require.main === module) {
  hush();
  // Rule 2, enforced rather than remembered: nothing above may fail the turn it reports on.
  run().then(() => process.exit(0), () => process.exit(0));
}
