#!/usr/bin/env node
// Build the hand-off package from approved drafts. Refuses unless every required gate's
// approval still matches the artifacts on disk.
//
//   node build-handoff.js <brand> <job-id>
//
// Writes handoff/<platform>/<D>.txt (caption + hashtags), copies listed media beside it,
// handoff/schedule.csv, handoff/README.md (per-platform posting checklist from platform-rules),
// handoff/campaign/ for paid jobs, and handoff/manifest.json with a hash of every file.
// Exit 0 ok · 1 an approval is missing or stale · 2 usage
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseFile, jsonBlock } = require('./lib-frontmatter.js');
const { hashFile } = require('./hash-artifact.js');
const ws = require('./lib-workspace.js');
const del = require('./lib-deliverable.js');
const execution = require('./lib-execution-availability.js');

const ROOT = path.join(__dirname, '..');
const { brand, jobId: job, dir } = ws.resolveJobArgs(process.argv.slice(2), process.argv);
if (!brand || !job) { console.error('usage: build-handoff.js <brand> <job-id>'); process.exit(2); }
const jobDir = dir;
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
// A job that has not been through intake has no route.json. That used to surface as a
// raw stack trace at the moment someone was trying to ship.
function needJson(file, what) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error('REFUSED: ' + what + ' is missing, so this job has nothing to package yet.');
      console.error('Run the intake and planning step first.');
    } else {
      console.error('REFUSED: could not read ' + what + ': ' + e.message);
    }
    process.exit(1);
  }
}

const route = needJson(path.join(jobDir, 'route.json'), 'route.json');
const jobSpec = needJson(path.join(jobDir, 'job.json'), 'job.json');
const availability = execution.checkJobDirectory(jobDir, { requireJob: true, requireRoute: true });
if (!availability.available) {
  console.error('UNSUPPORTED: ' + availability.message);
  process.exit(4);
}
let wsCfg = {};
try { wsCfg = readJson(path.join(ws.wsDir(brand), 'workspace.json')); } catch {}

// 1. Every gate the route names must hold an approval that still matches disk.
const required = (route.gates || []).filter(g => ['content', 'publish', 'campaign_proposal', 'campaign_activation'].includes(g));
const approvals = {};
const approvalRecords = {};
for (const g of required) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-approval.js'), brand, job, g, '--json'], { encoding: 'utf8' });
  let res = null; try { res = JSON.parse(r.stdout); } catch {}
  if (r.status !== 0 || !res || !res.valid) {
    console.error('REFUSED: gate ' + g + ' is not validly approved' + (res && res.reason ? ' (' + res.reason + ')' : ''));
    if (res) for (const c of res.changed || []) console.error('  changed: ' + c.path);
    process.exit(1);
  }
  approvals[g] = res.approvalId;
  approvalRecords[g] = res;
}

// 2. Re-run mechanical validation against the approved files before replacing a handoff.
const platformCheck = spawnSync(
  process.execPath,
  [path.join(__dirname, 'platform-check.js'), brand, job],
  { encoding: 'utf8' }
);
if (platformCheck.status !== 0) {
  console.error('REFUSED: current drafts do not pass platform-check.js');
  if (platformCheck.stdout.trim()) console.error(platformCheck.stdout.trim());
  if (platformCheck.stderr.trim()) console.error(platformCheck.stderr.trim());
  process.exit(1);
}

const expectedDeliverables = Array.isArray(jobSpec.deliverables)
  ? jobSpec.deliverables.map(d => d.id).filter(Boolean)
  : [];
if (!expectedDeliverables.length) {
  console.error('REFUSED: job.json has no deliverables to hand off');
  process.exit(1);
}

for (const D of expectedDeliverables) {
  const postPath = path.join(jobDir, 'drafts', D, 'post.md');
  if (!fs.existsSync(postPath)) {
    console.error('REFUSED: expected draft is missing: drafts/' + D + '/post.md');
    process.exit(1);
  }
  const { data } = parseFile(postPath);
  const media = Array.isArray(data.media) ? data.media : (data.media ? [data.media] : []);
  for (const m of media) {
    if (!fs.existsSync(path.join(jobDir, String(m)))) {
      console.error('REFUSED: media listed in ' + D + '/post.md is missing: ' + m);
      process.exit(1);
    }
  }
  // Last chance to catch a job that quietly became a different kind of post. platform-check.js
  // already refused it above; this is here because the hand-off is what a person actually
  // takes away, and it must never be a carousel where a video was asked for.
  const kind = del.check(jobSpec, D, media);
  if (!kind.ok) {
    console.error('REFUSED: ' + kind.reason);
    console.error('Take it back to them with the options, and record their answer with change-deliverable.js.');
    process.exit(1);
  }
}

const contentApproval = approvalRecords.content;
if (!contentApproval) {
  console.error('REFUSED: the handoff requires a valid content approval');
  process.exit(1);
}
const covered = new Set(contentApproval.artifacts.map(p => String(p).replace(/\\/g, '/')));
const requiredContentPaths = [];
for (const D of expectedDeliverables) {
  const postRel = 'drafts/' + D + '/post.md';
  requiredContentPaths.push(postRel);
  const { data } = parseFile(path.join(jobDir, postRel));
  const media = Array.isArray(data.media) ? data.media : (data.media ? [data.media] : []);
  requiredContentPaths.push(...media.map(m => String(m).replace(/\\/g, '/')));
}
const notCovered = requiredContentPaths.filter(p => !covered.has(p));
if (notCovered.length) {
  console.error('REFUSED: content approval does not cover every handoff artifact');
  for (const p of notCovered) console.error('  not covered: ' + p);
  process.exit(1);
}

const approvalCovers = (gate, artifactPath) => {
  const record = approvalRecords[gate];
  if (!record) return false;
  const expected = artifactPath.replace(/\\/g, '/');
  return record.artifacts.some(p => String(p).replace(/\\/g, '/') === expected);
};
const campaignDir = path.join(jobDir, 'campaign');
const proposalRel = 'campaign/proposal.md';
const checklistRel = 'campaign/activation-checklist.md';
const proposalPath = path.join(jobDir, proposalRel);
const checklistPath = path.join(jobDir, checklistRel);

if (required.includes('campaign_proposal')) {
  if (!fs.existsSync(proposalPath)) {
    console.error('REFUSED: campaign proposal is missing: ' + proposalRel);
    process.exit(1);
  }
  if (!approvalCovers('campaign_proposal', proposalRel)) {
    console.error('REFUSED: campaign proposal approval does not cover ' + proposalRel);
    process.exit(1);
  }
}

if (required.includes('campaign_activation')) {
  if (!required.includes('campaign_proposal')) {
    console.error('REFUSED: campaign activation requires the campaign_proposal gate');
    process.exit(1);
  }
  if (!fs.existsSync(checklistPath)) {
    console.error('REFUSED: campaign activation checklist is missing: ' + checklistRel);
    process.exit(1);
  }
  if (!approvalCovers('campaign_activation', checklistRel)) {
    console.error('REFUSED: campaign activation approval does not cover ' + checklistRel);
    process.exit(1);
  }
  const { data: checklist } = parseFile(checklistPath);
  const proposalHash = hashFile(proposalPath).sha256;
  const printedHash = String(checklist.proposal_hash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{12,64}$/.test(printedHash) || !proposalHash.startsWith(printedHash)) {
    console.error('REFUSED: activation checklist proposal_hash does not match the approved campaign proposal');
    process.exit(1);
  }
}

// 3. Collect drafts.
const draftsDir = path.join(jobDir, 'drafts');
const dels = expectedDeliverables;
const out = path.join(jobDir, 'handoff');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const files = [];
const schedule = [['deliverable', 'platform', 'account', 'publish_at', 'destination_url', 'file']];
const platforms = new Set();
const posts = [];

for (const D of dels) {
  const postPath = path.join(draftsDir, D, 'post.md');
  if (!fs.existsSync(postPath)) continue;
  const { data, sections } = parseFile(postPath);
  const platform = String(data.platform || jobSpec.deliverables.find(x => x.id === D)?.platform || 'unknown');
  platforms.add(platform);
  const pdir = path.join(out, platform);
  fs.mkdirSync(pdir, { recursive: true });
  const caption = (sections['Caption'] || '').trim();
  const tags = (sections['Hashtags'] || '').trim();
  const disclosure = (sections['Disclosure'] || '').trim();
  const body = caption + (tags && tags.toLowerCase() !== 'none' ? '\n\n' + tags : '') + '\n';
  const txt = path.join(pdir, D + '.txt');
  fs.writeFileSync(txt, body);
  files.push(txt);
  const media = Array.isArray(data.media) ? data.media : (data.media ? [data.media] : []);
  const copied = [];
  for (const m of media) {
    const src = path.join(jobDir, String(m));
    if (!fs.existsSync(src)) { console.error('REFUSED: media listed in ' + D + '/post.md is missing: ' + m); process.exit(1); }
    const dst = path.join(pdir, D + '-' + path.basename(src));
    fs.copyFileSync(src, dst); files.push(dst); copied.push(path.basename(dst));
  }
  // Publish plan row (first table row after the heading)
  const plan = (sections['Publish plan'] || '').split('\n').filter(l => l.trim().startsWith('|') && !/^\|\s*-/.test(l) && !/Account/.test(l));
  const cells = plan.length ? plan[0].split('|').slice(1, -1).map(c => c.trim()) : [];
  const account = cells[0] || (ws.accounts && ws.accounts[platform] && ws.accounts[platform].handle) || '';
  const publishAt = cells[2] || (jobSpec.schedule && jobSpec.schedule.publishAt) || '';
  const dest = cells[3] || jobSpec.landingPageUrl || '';
  schedule.push([D, platform, account, publishAt, dest, platform + '/' + D + '.txt']);
  posts.push({ D, platform, txt: platform + '/' + D + '.txt', media: copied, disclosure, accessibility: data.accessibility_text || '', hookFamily: data.hook_family || '' });
}

// 3. Paid artifacts.
if (required.includes('campaign_proposal') && fs.existsSync(campaignDir)) {
  fs.mkdirSync(path.join(out, 'campaign'), { recursive: true });
  const campaignFiles = ['proposal.md'];
  if (required.includes('campaign_activation')) campaignFiles.push('activation-checklist.md');
  for (const f of campaignFiles) {
    const dst = path.join(out, 'campaign', f);
    fs.copyFileSync(path.join(campaignDir, f), dst);
    files.push(dst);
  }
}

// 4. schedule.csv
const csv = path.join(out, 'schedule.csv');
fs.writeFileSync(csv, schedule.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n') + '\n');
files.push(csv);

// 5. README from template and platform-rules checklists.
let readme = fs.readFileSync(path.join(ROOT, 'templates', 'handoff-README.md'), 'utf8')
  .split('{job-id}').join(job).split('{brand}').join(brand).split('{title}').join(jobSpec.title || job);
let perPost = '';
for (const p of posts) {
  perPost += '\n### ' + p.D + ' on ' + p.platform + '\n\n- Text: `' + p.txt + '`\n';
  if (p.media.length) perPost += '- Media: ' + p.media.map(m => '`' + p.platform + '/' + m + '`').join(', ') + '\n';
  if (p.accessibility) perPost += '- Alt text / on-screen summary: ' + p.accessibility + '\n';
  perPost += '- Disclosure: ' + (p.disclosure || 'None') + '\n';
  perPost += '- Hook family: ' + p.hookFamily + '\n';
}
let checklists = '';
for (const platform of platforms) {
  const rulesPath = path.join(ROOT, 'platform-rules', platform + '.md');
  let rules = null; try { rules = jsonBlock(rulesPath); } catch {}
  checklists += '\n### ' + platform + '\n\n';
  if (rules && Array.isArray(rules.manual_posting_checklist)) for (const item of rules.manual_posting_checklist) checklists += '- [ ] ' + item + '\n';
  else checklists += '- [ ] Post the text file and media exactly as delivered\n- [ ] Confirm the publish time in schedule.csv\n';
}
readme = readme.split('{per-post}').join(perPost.trim()).split('{checklists}').join(checklists.trim())
  .split('{approvals}').join(Object.entries(approvals).map(([g, id]) => '- ' + g + ': `' + id + '`').join('\n'));
const readmePath = path.join(out, 'README.md');
fs.writeFileSync(readmePath, readme);
files.push(readmePath);

// 6. manifest.json
const manifest = { schemaVersion: '1.0', jobId: job, brand, builtAt: new Date().toISOString(), approvals,
  files: files.map(f => ({ path: path.relative(out, f).split(path.sep).join('/'), ...hashFile(f) })) };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('ok: handoff/ built with ' + files.length + ' file(s) for ' + [...platforms].join(', ') + '; approvals ' + Object.values(approvals).join(', '));
