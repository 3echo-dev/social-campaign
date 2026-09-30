#!/usr/bin/env node
// Say which stage is running and who is working on it.
//
//   node stage.js <job-id> <stage-id> running|done|waiting
//        [--substep "Looking at the audience and competitors"]
//        [--agents "audience:running,competitors:running,product-evidence:done"]
//        [--title "SK-II, 1 TikTok"] [--root <dir>] [--json]
//
// The stepper used to move only when `set-state.js` changed a state, and a workflow row is
// not a state: research ran for twenty minutes inside one state, so the pane sat on "Getting
// your brief" and then jumped to "Shaping the idea" with nothing in between. Whole stages
// came and went unreported. A stage is now said out loud at the start and the end of every
// row, by the run that is actually doing it.
//
// It also names the roles working under that stage. The person watching asked for exactly
// that: market researcher, competitor researcher, video analyzer, brand researcher, each
// showing whether it is working or finished. The pane knows nothing about agent names, so
// the friendly wording is decided here, once.
//
// Nothing here fails the caller. A pane that cannot be reached must never stop the work it
// is reporting on, so a folder with no gate-app.json prints nothing and exits 0.
const fs = require('fs');
const path = require('path');
const gate = require('./lib-gate.js');
const stages = require('./lib-stages.js');
const ws = require('./lib-workspace.js');
const execution = require('./lib-execution-availability.js');
const { NO_BRAND } = require('./lib-no-brand.js');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const json = argv.includes('--json');

// Who the workers are and how their names are spelled lives in lib-roles.js, because a
// state change names them too.
const { parseAgents, STATUSES } = require('./lib-roles.js');

const positional = argv.filter(a => !a.startsWith('--'));
const [key, stageArg, statusArg] = positional;
const status = STATUSES[String(statusArg || '').toLowerCase()] === 'working' ? 'running'
  : STATUSES[String(statusArg || '').toLowerCase()] || null;

const usage = () => {
  console.error('usage: stage.js <job-id> <stage-id> running|done|waiting [--substep "<line>"] [--agents "audience:running,competitors:done"] [--title "<words>"]');
  console.error('stages: ' + stages.STAGE_IDS.join(' '));
  console.error('report stages: ' + stages.REPORT_STAGE_IDS.join(' '));
  process.exit(2);
};

if (!key || !stageArg || !status) usage();

function findJobDir() {
  for (const brand of [...new Set([...ws.listBrands(argv), NO_BRAND])]) {
    const dir = ws.jobDir(brand, key, argv);
    if (fs.existsSync(path.join(dir, 'job.json'))) return dir;
  }
  return null;
}

function workflowOf(dir) {
  if (!dir) return null;
  try {
    const route = JSON.parse(fs.readFileSync(path.join(dir, 'route.json'), 'utf8'));
    return route && typeof route.workflowId === 'string' ? route.workflowId : null;
  } catch { return null; }
}

const jobFolder = findJobDir();
const workflowId = workflowOf(jobFolder);
const ownStages = stages.isReportWorkflow(workflowId) ? stages.REPORT_STAGE_IDS : stages.STAGE_IDS;
const otherStages = stages.isReportWorkflow(workflowId) ? stages.STAGE_IDS : stages.REPORT_STAGE_IDS;
const longStage = id => Object.keys(stages.SHORT_OF).find(name => name === id || stages.SHORT_OF[name] === id) || id;

const resolved = stages.resolveStage(stageArg);
const stage = resolved && !(jobFolder && otherStages.includes(longStage(resolved)) && !ownStages.includes(longStage(resolved))) ? resolved : null;
if (!stage) {
  console.error('"' + stageArg + '" is not a stage of this job. See docs/STAGES.md. Known stages:');
  console.error('  ' + ownStages.join(' '));
  console.error('  ' + stages.BRAND_STAGE_IDS.join(' '));
  process.exit(2);
}

const title = flag('title');
const substep = flag('substep');
const agents = parseAgents(flag('agents'));

const body = {
  key,
  ...(title ? { title } : {}),
  stage,
  ...(substep ? { substep } : {}),
  status,
  ...(agents.length ? { activities: agents } : {}),
};

if (jobFolder) {
  const availability = execution.checkJobDirectory(jobFolder, { requireJob: true });
  if (!availability.available) {
    if (json) console.log(JSON.stringify({ posted: false, sent: body, reason: availability.message }, null, 2));
    else console.error('UNSUPPORTED: ' + availability.message);
    process.exit(4);
  }
}

(async () => {
  const result = await gate.call('progress', body, { argv });
  if (json) {
    console.log(JSON.stringify({ posted: !result.offline, sent: body, ...(result.offline ? { reason: result.reason } : {}) }, null, 2));
    return;
  }
  // A folder that was never connected is the normal case in a chat-only run, so it says
  // nothing at all: one line per workflow row would be pure noise.
  if (result.offline) return;
  const who = agents.map(a => a.role + ' ' + (a.status === 'done' ? 'finished' : a.status)).join(', ');
  console.log('Pane: ' + (substep || stage) + (who ? ' - ' + who : ''));
})().catch(() => { /* the pane is never allowed to fail the work it reports on */ });
