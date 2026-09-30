#!/usr/bin/env node
// Is 3echo answering, and is there enough credit to finish this job?
//
//   node check-3echo.js <brand> <job-id> --credits <n>   after list_workspaces returned
//   node check-3echo.js <brand> <job-id> --unreachable   after list_workspaces failed
//
// Scripts in this plugin cannot reach the MCP server, so the skill calls `list_workspaces`
// itself and passes the balance in here. Run it before the first estimate of a job.
// estimate_video_job failed three times in a row on a real run and nothing said why; the
// point of this is that the failure gets named before any credits are reserved.
//
// Exit 0 ok · 1 not enough credit · 2 usage · 3 3echo is not answering.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace');

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const has = name => argv.includes(name);
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!brand || !jobId || (!has('--unreachable') && opt('--credits') === null)) {
  console.error('usage: check-3echo.js <brand> <job-id> --credits <n>');
  console.error('       check-3echo.js <brand> <job-id> --unreachable');
  console.error('');
  console.error('Call the 3echo tool `list_workspaces` first and pass its credit balance in.');
  process.exit(2);
}

const jobDir = dir;
if (!fs.existsSync(jobDir)) {
  console.error('No job called ' + jobId + ' under ' + ws.fwd(ws.wsDir(brand, argv)) + '.');
  process.exit(3);
}

if (has('--unreachable')) {
  console.log('3echo is not answering right now. Nothing was spent.');
  console.log('The board and the manifest are saved, so say when you want the quote tried again.');
  process.exit(3);
}

const credits = Number(opt('--credits'));
if (!Number.isFinite(credits) || credits < 0) {
  console.error('--credits needs a number, got ' + JSON.stringify(opt('--credits')));
  process.exit(2);
}

// There is no preset budget on a brand. The only figure that binds is what the person
// agreed to at the concept gate, and if they agreed to nothing yet, the estimate will tell
// them the price and they will decide then.
let ceiling = null;
let ceilingFrom = null;
const approvals = path.join(jobDir, 'approvals');
if (fs.existsSync(approvals)) {
  const concept = fs.readdirSync(approvals).filter(f => /^concept-\d+\.json$/.test(f)).sort().pop();
  if (concept) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(approvals, concept), 'utf8'));
      const agreed = Number((rec.scope || {}).maxSpendCredits);
      if (Number.isFinite(agreed) && (!ceiling || agreed < ceiling)) {
        ceiling = agreed;
        ceilingFrom = 'what you agreed at the concept gate';
      }
    } catch { /* an unreadable approval is check-approval.js's problem, not this one's */ }
  }
}

console.log('3echo is answering. ' + credits + ' credit' + (credits === 1 ? '' : 's') + ' available.');
if (ceiling) {
  console.log('This job may spend up to ' + ceiling + ', which is ' + ceilingFrom + '.');
  if (credits < ceiling) {
    console.log('');
    console.log('That is less credit than this job is allowed to spend. Top up, or lower the');
    console.log('ceiling and cut the plan to fit, before anything is generated.');
    process.exit(1);
  }
}
process.exit(0);
