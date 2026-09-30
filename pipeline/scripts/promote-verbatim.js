#!/usr/bin/env node
// Move the customer's own words out of a job and into the brand, where the next job can use them.
//
//   node promote-verbatim.js <brand> <job-id> [--dry-run]
//
// Research finds verbatim phrases, writes them into one job's research/audience.md, and the job
// ends. The next job starts from the same empty brand table and pays for the same research
// again. This copies the sourced rows into brand/audience.md, bumps the file version and adds a
// changelog line. After the first job a brand usually has enough for route-job.js to treat it as
// evidence-bearing and skip research entirely.
//
// Exit 0 promoted or nothing to do · 1 could not write · 2 usage · 3 a file is missing.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace');
const execution = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
const dryRun = argv.includes('--dry-run');
if (!brand || !jobId) {
  console.error('usage: promote-verbatim.js <brand> <job-id> [--dry-run]');
  process.exit(2);
}
const availability = execution.checkJobDirectory(dir, { requireJob: true });
if (!availability.available) {
  console.error('UNSUPPORTED: ' + availability.message);
  process.exit(4);
}

const src = path.join(dir, 'research', 'audience.md');
const dst = path.join(ws.wsDir(brand, argv), 'brand', 'audience.md');
for (const [file, what] of [[src, 'research/audience.md for this job'], [dst, "the brand's audience.md"]]) {
  if (!fs.existsSync(file)) {
    console.log('Nothing to promote: ' + what + ' is not there.');
    process.exit(3);
  }
}

// Pull the rows out of the table under the "Verbatim customer language" heading in either file.
function table(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  let inSection = false, inTable = false;
  for (const line of lines) {
    if (/^#{2,3}\s+Verbatim customer language/i.test(line)) { inSection = true; continue; }
    if (inSection && /^#{2,3}\s/.test(line)) break;
    if (!inSection) continue;
    if (!line.trim().startsWith('|')) { if (inTable) break; continue; }
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (/^phrase$/i.test(cells[0] || '')) { inTable = true; continue; }
    if (!inTable || cells.every(c => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

const usable = row => row[0] && !/^unknown$/i.test(row[0]) && row[1] && !/^unknown$/i.test(row[1]);
const key = row => row[0].replace(/^["'“‘]|["'”’]$/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const found = table(fs.readFileSync(src, 'utf8')).filter(usable);
if (!found.length) {
  console.log('Nothing to promote: no phrase in this job carried a source.');
  process.exit(0);
}

let brandText = fs.readFileSync(dst, 'utf8');
const nl = brandText.includes('\r\n') ? '\r\n' : '\n';
const existing = new Set(table(brandText).map(key));
const fresh = found.filter(r => !existing.has(key(r)));

if (!fresh.length) {
  console.log('Nothing to promote: all ' + found.length + ' sourced phrase' +
    (found.length === 1 ? ' is' : 's are') + ' already in the brand file.');
  process.exit(0);
}

const lines = brandText.split(/\r?\n/);
// Insert after the last row of the brand's own table, and drop the `unknown` placeholder row
// if it is still the only thing there.
let inSection = false, lastRow = -1, placeholder = -1;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/^#{2,3}\s+Verbatim customer language/i.test(line)) { inSection = true; continue; }
  if (inSection && /^#{2,3}\s/.test(line)) break;
  if (!inSection || !line.trim().startsWith('|')) continue;
  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  if (cells.every(c => /^:?-+:?$/.test(c)) || /^phrase$/i.test(cells[0] || '')) { lastRow = i; continue; }
  lastRow = i;
  if (/^unknown$/i.test(cells[0] || '')) placeholder = i;
}
if (lastRow < 0) {
  console.error('The brand audience file has no verbatim table to add to. Add the heading and');
  console.error('the table from templates/brand/audience.md, then run this again.');
  process.exit(1);
}

const added = fresh.map(r => '| ' + [r[0], r[1], r[2] || ''].join(' | ') + ' |');
lines.splice(lastRow + 1, 0, ...added);
if (placeholder >= 0) lines.splice(placeholder, 1);

let out = lines.join(nl);

// Bump the version and date in the front matter, then say why in the changelog.
const version = Number((out.match(/^version:\s*(\d+)/m) || [])[1] || 1) + 1;
const today = ws.now(brand, argv).slice(0, 10);
out = out.replace(/^version:\s*\d+/m, 'version: ' + version).replace(/^updated:.*$/m, 'updated: ' + today);
const note = '- v' + version + ' ' + today + ' added ' + added.length + ' verbatim phrase' +
  (added.length === 1 ? '' : 's') + ' from ' + jobId;
// Newest entry first, under the heading and the blank line after it.
out = /^## Changelog/m.test(out)
  ? out.replace(/^(## Changelog[^\n]*\n(?:[ \t]*\n)?)/m, (m, head) => head + note + nl)
  : out.replace(/\s*$/, nl + nl + '## Changelog' + nl + nl + note + nl);

if (dryRun) {
  console.log(added.length + ' phrase' + (added.length === 1 ? '' : 's') + ' would be added to the brand:');
  for (const a of added) console.log('  ' + a);
  process.exit(0);
}

try {
  fs.writeFileSync(dst, out);
} catch (e) {
  console.error('Could not write ' + ws.fwd(dst) + ': ' + e.message);
  process.exit(1);
}
console.log('Added ' + added.length + ' phrase' + (added.length === 1 ? '' : 's') +
  " your customers actually used to the brand's audience file. It is now version " + version + '.');
console.log('The next job starts from these instead of researching them again.');
