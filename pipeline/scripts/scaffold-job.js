#!/usr/bin/env node
// Scaffold one job folder in a single call.
//   node scaffold-job.js <brand> <job-slug> [title...] [--kind <kind>]
// Job id is job-YYYYMMDD-<job-slug>. Refuses to overwrite.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const kinds = require('./lib-kinds.js');
const noBrand = require('./lib-no-brand.js');

const given = process.argv.slice(2);
const kindAt = given.indexOf('--kind');
const kind = kindAt >= 0 ? kinds.normalizedKind(given[kindAt + 1]) : '';
const args = kindAt >= 0 ? given.filter((_, index) => index !== kindAt && index !== kindAt + 1) : given;
const brand = (args[0] || '').trim();
const slug = (args[1] || '').trim();
if (!brand || !slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug) || (kindAt >= 0 && !kinds.kindOf(kind))) {
  console.error('usage: scaffold-job.js <brand> <job-slug> [title...] [--kind <kind>]   (slug: lowercase, hyphens)');
  process.exit(2);
}
const report = Boolean(kind) && kinds.kindOf(kind).status === 'active' && !kinds.makesContent(kind);
const brandDir = ws.wsDir(brand);
if (noBrand.isGeneral(brand)) {
  if (!report) {
    console.error('REFUSED: a post or campaign needs a brand. Choose one, or onboard a new one.');
    process.exit(3);
  }
  noBrand.ensure(path.dirname(brandDir));
}
if (!fs.existsSync(path.join(brandDir, 'workspace.json'))) {
  console.error('REFUSED: ' + ws.fwd(brandDir) + '/workspace.json not found. Run onboard-brand first.');
  process.exit(3);
}
const workspaceConfig = ws.workspaceConfig(brand, process.argv);
const workspaceOwner = workspaceConfig.owner && typeof workspaceConfig.owner === 'object' ? workspaceConfig.owner : {};
const workspaceId = String(workspaceConfig.workspaceId || workspaceConfig.id || brand).trim();
const ownerUserId = String(workspaceConfig.ownerUserId || workspaceOwner.userId || '').trim() || null;
const ownerEmail = workspaceConfig.ownerEmailVerified === true ? workspaceConfig.ownerEmail || null : null;
const d = new Date();
const p2 = n => String(n).padStart(2, '0');
const ymd = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
// A new job is a new job, and its name carries the time it was asked for.
//
// The id used to be the date and the slug, so a second TikTok for the same brand on the same
// day landed on the name of the first. Scaffolding refused, which pushed the run into
// resuming a job nobody asked to resume. Worse, the id is also the key the pane is stored
// under: a deleted job's name came free again, and the page served that job's dead review to
// somebody who had just started a fresh one.
const title = (args.slice(2).join(' ') || slug).trim();
const hm = p2(d.getHours()) + p2(d.getMinutes());
let jobId = 'job-' + ymd + '-' + hm + '-' + slug;
let dir = path.join(brandDir, 'jobs', jobId);
// Two in the same minute is rare and still has to work.
for (let n = 2; fs.existsSync(dir) && n <= 20; n++) {
  jobId = 'job-' + ymd + '-' + hm + '-' + slug + '-' + n;
  dir = path.join(brandDir, 'jobs', jobId);
}
if (fs.existsSync(dir)) {
  console.error('There are already 20 jobs called ' + slug + ' this minute. Give this one another name.');
  process.exit(1);
}
// Stamp in the brand's own timezone, not whatever zone this process happens to run in.
const now = ws.now(brand, process.argv, d);

const folders = ['research', 'drafts', 'media', 'validation', 'revisions', 'approvals', 'handoff'];
if (report) folders.push('report');
if (report && kind === 'video_breakdown') folders.push(path.join('report', 'stills'));
for (const s of folders) {
  fs.mkdirSync(path.join(dir, s), { recursive: true });
}
const T = path.join(__dirname, '..', 'templates');
const status = fs.readFileSync(path.join(T, 'status.md'), 'utf8')
  .split(/\r?\n/).filter(l => !l.startsWith('> **When resuming') && !l.startsWith('> Every time carries')).join('\n')
  .split('{job-id}').join(jobId).split('{brand}').join(brand).split('{title}').join(title)
  .split('YYYY-MM-DD HH:MM').join(now)
  .split('{what happens next, in one line}').join('Intake: confirm the four dimensions and deliverables')
  .split('{who or what, or "Nothing"}').join('Nothing')
  .split('{Current state summary. Live constraints. Open items. Running credit tally.}').join('Job folder created. No intake yet.');
// Revision zero makes the first expected-revision check explicit while remaining compatible
// with hand-created legacy status files, which set-state upgrades on their first mutation.
const withRevision = status.replace(/(\*\*Current state:\*\*[^\r\n]*\r?\n)/i, '$1**Revision:** `0`\n');
fs.writeFileSync(path.join(dir, 'status.md'), withRevision);

const jobT = JSON.parse(fs.readFileSync(path.join(T, 'job.json'), 'utf8'));
delete jobT._enums;
// requestedAt stays machine-readable, but in the brand's zone rather than UTC, so it
// agrees with every other timestamp in the job.
const requestedAt = now.replace(' ', 'T').replace(/ ([+-]\d\d:\d\d)$/, ':00$1');
jobT.jobId = jobId; jobT.workspaceId = workspaceId; jobT.ownerUserId = ownerUserId;
jobT.ownerEmail = ownerEmail; jobT.ownerEmailVerified = Boolean(ownerEmail);
jobT.brand = brand; jobT.title = title; jobT.requestedAt = requestedAt;
if (kind) jobT.kind = kind;
fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(jobT, null, 2) + '\n');

const fwd = s => s.split(path.sep).join('/');
console.log('ready: ' + fwd(dir) + '/  state: INTAKE_PENDING');
console.log('job-id: ' + jobId);
