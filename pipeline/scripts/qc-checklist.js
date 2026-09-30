#!/usr/bin/env node
// Render validation/qc-checklist.md from what is already on disk. No new judgement: every
// row restates an artifact another script or agent already wrote, and names the file it
// came from, so a person reading the gate can go and look.
//
//   node qc-checklist.js <brand> <job-id> [--out validation/qc-checklist.md]
// Exit 0 always. A failing row is a fact about the job, not a fault in this script.
const fs = require('fs');
const path = require('path');
const { parseFile, jsonBlock } = require('./lib-frontmatter.js');
const ws = require('./lib-workspace.js');
const execution = require('./lib-execution-availability.js');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!brand || !jobId || !dir) {
  console.error('usage: qc-checklist.js <brand> <job-id> [--out <file>]');
  process.exit(2);
}
const availability = execution.checkJobDirectory(dir, { requireJob: true });
if (!availability.available) {
  console.error('UNSUPPORTED: ' + availability.message);
  process.exit(4);
}
const oi = argv.indexOf('--out');
const outPath = oi >= 0 ? argv[oi + 1] : path.join(dir, 'validation', 'qc-checklist.md');

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

const route = readJson(path.join(dir, 'route.json')) || {};
const platformCheck = readJson(path.join(dir, 'validation', 'platform-check.json'));
const marks = readJson(path.join(dir, 'validation', 'brand-marks.json'));

const LABEL_SOURCE = 'validation/label-check.json';
let labelCheck = null;
try {
  labelCheck = require(path.join(ROOT, '..', 'server', 'pipeline', 'label-qc.mjs'))
    .labelCheckStatus({ root: path.resolve(dir, '..', '..', '..', '..'), brand, jobId });
} catch {
  labelCheck = null;
}
const labelState = labelCheck ? labelCheck.state : 'unreadable';
const labelCurrent = labelState === 'current' || labelState === 'not_needed';
const labelLine = {
  current: 'The label check is current for these files.',
  not_needed: 'No image or video needs a label check.',
  stale: 'Not done: an image or video changed after the label check, so it must run again.',
  missing: 'Not done: the label check has not run for this job.',
  unreadable: 'Not done: the label check could not be read.',
}[labelState];

// The route flags that make a disclosure mandatory rather than optional. Paid partnership and
// gifted product arrive as a flag on the job; the enum lives in schemas/route.schema.json.
const DISCLOSURE_FLAGS = ['synthetic_person', 'paid_spend', 'regulated_claim', 'licensed_media'];
const flagged = [...new Set([...(route.riskFlags || []), ...(route.modelAddedRiskFlags || [])])].filter(f => DISCLOSURE_FLAGS.includes(f));

const draftsDir = path.join(dir, 'drafts');
const dels = fs.existsSync(draftsDir)
  ? fs.readdirSync(draftsDir).filter(d => /^D\d+$/.test(d)).sort()
  : [];

const rows = [];
const add = (D, check, result, detail, source) => rows.push({ D, check, result, detail, source });

// Findings from brand-marks.json belong to a deliverable through the media/D{n}/ path they
// were found under. A finding on media/D2/P1.png is D2's row, not every deliverable's.
function markRows(D) {
  const label = { logo: 'Logo found', colour: 'Colours within tolerance', subtitle: 'Subtitles readable' };
  if (!labelCurrent) {
    for (const check of ['logo', 'colour', 'subtitle']) {
      add(D, label[check], 'not run', 'waits for a current label check on the images and video',
        labelState === 'stale' ? LABEL_SOURCE : '-');
    }
    return;
  }
  for (const check of ['logo', 'colour', 'subtitle']) {
    if (!marks) {
      add(D, label[check], 'not run', 'brand-marks-check.py has not run for this job', '-');
      continue;
    }
    const mine = (marks.findings || []).filter(f => f.check === check && String(f.file || '').startsWith('media/' + D + '/'));
    const seen = (marks.checked || []).filter(f => String(f).startsWith('media/' + D + '/'));
    if (!seen.length) {
      add(D, label[check], 'not run', 'no frames under media/' + D + '/ were checked', 'validation/brand-marks.json');
      continue;
    }
    add(D, label[check], mine.length ? 'fail' : 'pass',
      mine.length ? mine.map(f => f.file + ': ' + f.detail).join('; ')
                  : seen.length + ' frame(s) checked, no R-VISUAL finding',
      'validation/brand-marks.json');
  }
}

const describeLabelFlag = f => "'" + f.seen + "'" + (f.expected ? " (expected '" + f.expected + "')" : '') +
  (f.at ? ' at ' + f.at : '') + ' in ' + f.name + ' (' + f.kind + ')';

function labelRow(D, owns) {
  const check = 'Labels and brand marks';
  if (!labelCheck) {
    add(D, check, 'not run', 'the label check could not be read', '-');
    return;
  }
  const targets = labelCheck.targets.filter(owns);
  if (!targets.length) {
    add(D, check, 'not required', 'no image or video to check', '-');
    return;
  }
  if (labelState === 'missing') {
    add(D, check, 'not run', 'the label check has not run for this job', '-');
    return;
  }
  if (!labelCurrent) {
    add(D, check, 'not run', 'an image or video changed after the label check, so it must run again', LABEL_SOURCE);
    return;
  }
  const open = labelCheck.flags.filter(owns);
  add(D, check, open.length ? 'flagged' : 'pass',
    open.length ? open.map(describeLabelFlag).join('; ') : targets.length + ' file(s) checked, every label and mark matches',
    LABEL_SOURCE);
}

const ownedBy = D => x => x.role === 'deliverable' && x.deliverable === D;

for (const D of dels) {
  const postPath = path.join(draftsDir, D, 'post.md');
  const source = 'drafts/' + D + '/post.md';
  if (!fs.existsSync(postPath)) {
    add(D, 'Hook in line one', 'fail', 'the deliverable has no post.md', source);
    add(D, 'Caption inside the cutoff', 'fail', 'the deliverable has no post.md', source);
    add(D, 'Exactly one CTA', 'fail', 'the deliverable has no post.md', source);
    add(D, 'Disclosure present', 'fail', 'the deliverable has no post.md', source);
    markRows(D);
    labelRow(D, ownedBy(D));
    continue;
  }
  const { data, sections } = parseFile(postPath);
  const platform = String(data.platform || '');
  const caption = (sections['Caption'] || '').trim();
  const firstLine = (caption.split('\n')[0] || '').trim();

  add(D, 'Hook in line one', firstLine ? 'pass' : 'fail',
    firstLine ? '"' + firstLine.slice(0, 60) + (firstLine.length > 60 ? '...' : '') + '"'
              : 'the Caption section opens empty',
    source);

  // platform-check.js already measured this against the same json block. Reuse its numbers
  // when they exist so the two files can never disagree; fall back to the block itself.
  const fromCheck = platformCheck && (platformCheck.drafts || []).find(d => d.D === D);
  let limits = null;
  if (fromCheck) {
    const hit = (fromCheck.findings || []).filter(f => f.code === 'R-LIMIT' || f.code === 'R-HOOK');
    add(D, 'Caption inside the cutoff', hit.some(f => f.severity === 'fail') ? 'fail' : 'pass',
      hit.length ? hit.map(f => f.msg).join('; ')
                 : fromCheck.chars + ' chars, first line ' + fromCheck.firstLineChars,
      'validation/platform-check.json');
  } else {
    try { limits = jsonBlock(path.join(ROOT, 'platform-rules', platform + '.md')); } catch { limits = null; }
    if (!limits) {
      add(D, 'Caption inside the cutoff', 'not run', 'no platform rules for "' + platform + '"', source);
    } else {
      const c = limits.caption || {};
      const chars = [...caption].length;
      const head = [...firstLine].length;
      const over = [];
      if (c.max_chars && chars > c.max_chars) over.push('caption ' + chars + ' chars, limit ' + c.max_chars);
      if (c.visible_cutoff_chars && head > c.visible_cutoff_chars) {
        over.push('first line ' + head + ' chars, visible cutoff ' + c.visible_cutoff_chars);
      }
      add(D, 'Caption inside the cutoff', over.length ? 'fail' : 'pass',
        over.length ? over.join('; ') : chars + ' chars, first line ' + head,
        'platform-rules/' + platform + '.md');
    }
  }

  const ctas = (sections['CTA'] || '').split('\n').map(l => l.trim()).filter(Boolean);
  add(D, 'Exactly one CTA', ctas.length === 1 ? 'pass' : 'fail',
    ctas.length === 1 ? ctas[0].slice(0, 60) : ctas.length + ' line(s) in the CTA section',
    source);

  const disclosure = (sections['Disclosure'] || '').trim();
  const given = disclosure && !/^none$/i.test(disclosure);
  if (!flagged.length) {
    add(D, 'Disclosure present', 'not required', 'the route carries no disclosure risk flag', 'route.json');
  } else {
    add(D, 'Disclosure present', given ? 'pass' : 'fail',
      (given ? 'declared: ' + disclosure.split('\n')[0].slice(0, 60) : 'the Disclosure section is empty or "None"') +
      ' (flags: ' + flagged.join(', ') + ')',
      source);
  }

  markRows(D);
  labelRow(D, ownedBy(D));
}

if (dels.length && labelCheck) {
  const other = x => x.role === 'deliverable' && !dels.includes(x.deliverable);
  if (labelCheck.targets.some(other)) labelRow('Other media', other);
  const supplied = x => x.role === 'supplied';
  if (labelCheck.targets.some(supplied)) labelRow('Supplied', supplied);
}

const cell = s => String(s === undefined || s === '' ? '-' : s).split('\n').join(' ').split('|').join('\\|');
const counts = rows.reduce((a, r) => (a[r.result] = (a[r.result] || 0) + 1, a), {});
const summary = ['pass', 'fail', 'flagged', 'not run', 'not required']
  .filter(k => counts[k]).map(k => counts[k] + ' ' + k).join(', ') || 'nothing to check';

let md = '# QC checklist: ' + jobId + '\n\n';
md += 'Every row restates an artifact that already exists. Nothing here is a fresh judgement.\n';
md += 'Written ' + ws.now(brand, process.argv) + '. ' + summary + '.\n';
md += labelLine + '\n\n';
if (!dels.length) {
  md += 'No `drafts/D*/post.md` exists yet, so there is nothing to check.\n';
} else {
  md += '| Deliverable | Check | Result | Detail | Source |\n|---|---|---|---|---|\n';
  for (const r of rows) {
    md += '| ' + [r.D, r.check, r.result, cell(r.detail), cell(r.source)].join(' | ') + ' |\n';
  }
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md);
console.log(rows.length + ' row(s) across ' + dels.length + ' deliverable(s): ' + summary + '.');
console.log(labelLine);
if (!platformCheck) console.log('platform-check.json is absent, so the caption rows were measured from platform-rules.');
if (!marks) console.log('brand-marks.json is absent, so the logo, colour and subtitle rows say "not run".');
console.log('wrote ' + ws.fwd(outPath));
process.exit(0);
