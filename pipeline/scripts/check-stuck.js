#!/usr/bin/env node
// Is anything waiting that nobody is listening to?
//   node check-stuck.js [--json] [--quiet]
//
// Reads every job in this workspace, then asks the pane what the person has already said. The
// case this exists for: someone decides in the pane after the run stopped watching, the
// decision is saved, and the job sits at the same step looking broken.
//
// It reports; it does not decide anything on anyone's behalf.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const gate = require('./lib-gate.js');
const states = require('./lib-states.js');
const wording = require('./lib-wording.js');
const execution = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const quiet = argv.includes('--quiet');

const grab = (txt, label) => {
  const m = txt.match(new RegExp('\\*\\*' + label + ':\\*\\*\\s*`?([^`\\n]+)`?'));
  return m ? m[1].trim() : null;
};

// status.md writes "2026-09-04 16:01 +08:00", which Date.parse does not take as it stands.
const minutesSince = (stamp) => {
  const m = String(stamp || '').match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}:?\d{2}|Z)?/);
  if (!m) return null;
  const zone = (m[3] || '').replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') || 'Z';
  const then = Date.parse(m[1] + 'T' + (m[2].length === 5 ? m[2] + ':00' : m[2]) + zone);
  if (!Number.isFinite(then)) return null;
  return Math.round((Date.now() - then) / 60000);
};

const said = (n) => (n === null ? 'unknown' : n < 1 ? 'just now'
  : n === 1 ? '1 minute ago' : n < 60 ? n + ' minutes ago'
  : Math.round(n / 60) + (Math.round(n / 60) === 1 ? ' hour ago' : ' hours ago'));

(async () => {
  const rows = [];
  for (const brand of ws.listBrands()) {
    for (const jobId of ws.listJobs(brand)) {
      const dir = ws.jobDir(brand, jobId);
      let status = '';
      try { status = fs.readFileSync(path.join(dir, 'status.md'), 'utf8'); } catch { continue; }
      const state = grab(status, 'Current state');
      const idle = minutesSince(grab(status, 'Last updated'));
      let route = {};
      try { route = JSON.parse(fs.readFileSync(path.join(dir, 'route.json'), 'utf8')); } catch {}
      const row = {
        brand, job: jobId, state,
        sentence: wording.has(state) ? wording.sentence(state, route.workflowId) : 'Working.',
        idleMinutes: idle, waitingOnPerson: states.isGate(state), needsNudge: false, why: null,
      };

      // Historical review jobs remain visible, but their saved pane decisions are no longer
      // actionable. Do not contact the gate app for them or suggest a resume.
      const availability = execution.checkJobDirectory(dir);
      if (!availability.available) {
        row.retired = true;
        row.executionAvailable = false;
        row.waitingOnPerson = false;
        row.why = availability.message;
        rows.push(row);
        continue;
      }
      row.executionAvailable = true;

      // What the pane holds that the job folder does not.
      const gateName = states.gateOf ? states.gateOf(state) : null;
      if (gateName) {
        const decision = await gate.call('decision?key=' + encodeURIComponent(jobId) + '&gate=' + encodeURIComponent(gateName), null, { method: 'GET', argv });
        if (!decision.offline && decision.status === 'decided') {
          row.needsNudge = true;
          row.why = 'You already decided this in the pane, and the job has not been moved on yet.';
          row.decision = { verdict: decision.decision, score: decision.score, chosen: decision.chosen, id: decision.id };
        }
      }
      const answer = await gate.call('answer?key=' + encodeURIComponent(jobId), null, { method: 'GET', argv });
      if (!answer.offline && answer.status === 'answered' && row.waitingOnPerson) {
        row.needsNudge = true;
        row.why = row.why || 'You already answered in the pane, and nothing has read it yet.';
      }
      rows.push(row);
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ checked: rows.length, jobs: rows }, null, 2));
    return;
  }

  const nudge = rows.filter((r) => r.needsNudge);
  const waiting = rows.filter((r) => r.waitingOnPerson && !r.needsNudge);
  const retired = rows.filter((r) => r.retired);
  const running = rows.filter((r) => !r.retired && !r.waitingOnPerson && !r.needsNudge);

  if (!rows.length) { if (!quiet) console.log('No jobs yet.'); return; }

  for (const r of nudge) {
    console.log('NEEDS A NUDGE  ' + r.brand + ' ' + r.job);
    console.log('  ' + r.why);
    if (r.decision) {
      console.log('  You said: ' + r.decision.verdict + (r.decision.chosen ? ', ' + r.decision.chosen : '') + '.');
    }
    console.log('  Say "continue" in the session running this job, or resume it in a new one.');
  }
  for (const r of waiting) {
    console.log('WAITING ON YOU  ' + r.brand + ' ' + r.job + '  (last moved ' + said(r.idleMinutes) + ')');
    console.log('  ' + r.sentence);
  }
  for (const r of retired) {
    console.log('HISTORY  ' + r.brand + ' ' + r.job + '  (' + r.state + ')');
    console.log('  ' + r.why);
  }
  if (!quiet) {
    for (const r of running) {
      const stale = r.idleMinutes !== null && r.idleMinutes > 20;
      console.log((stale ? 'QUIET  ' : 'WORKING  ') + r.brand + ' ' + r.job + '  (last moved ' + said(r.idleMinutes) + ')');
      if (stale) console.log('  Nothing has changed for a while. Open the session and say "continue" if it is not still thinking.');
    }
  }
  if (!nudge.length && !waiting.length && quiet) process.exitCode = 0;
})();
