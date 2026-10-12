#!/usr/bin/env node
// Lists a paid job's stable ad ids, the idea parts each ad carries, and checks the proposal's test pairs.
// The media buyer runs it while writing campaign/proposal.md, so the creative-to-ad map and the ad names
// carry the ids, and each test pair changes one part. Pair problems are warnings; the exit code stays 0.
//
//   node ad-variants.js <brand> <job-id> [--json]
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const { parseFile } = require('./lib-frontmatter.js');
const variants = require('./lib-ad-variants.js');

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const { jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!dir || !jobId) { console.error('usage: ad-variants.js <brand> <job-id> [--json]'); process.exit(2); }

let job = {};
try { job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')); } catch {
  console.error('job.json is missing or unreadable in ' + dir);
  process.exit(3);
}
const posts = [];
for (const d of Array.isArray(job.deliverables) ? job.deliverables : []) {
  if (!d || !d.id) continue;
  const file = path.join(dir, 'drafts', d.id, 'post.md');
  let data = {};
  try { data = parseFile(file).data || {}; } catch {}
  posts.push({ deliverable: d.id, platform: String(data.platform || d.platform || ''), data });
}
let proposalText = '';
try { proposalText = fs.readFileSync(path.join(dir, 'campaign', 'proposal.md'), 'utf8'); } catch {}

const result = variants.buildVariants({ jobId, posts, proposalText });
if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('| Ad id | Deliverable | Platform | Parts |');
  console.log('|---|---|---|---|');
  for (const v of result.variants) console.log('| ' + v.variantId + ' | ' + v.deliverable + ' | ' + v.platform + ' | ' + (variants.partsLine(v.parts) || 'none named') + ' |');
  if (result.pairs.length) {
    console.log('\nTest pairs:');
    for (const p of result.pairs) console.log('- ' + p.pair + ': ' + p.a + ' vs ' + p.b + ' differ by ' + (p.differsBy.map(f => variants.PART_WORDS[f]).join(', ') || 'nothing'));
  } else if (proposalText) {
    console.log('\nNo test pairs in campaign/proposal.md yet.');
  }
  for (const w of result.warnings) console.log('WARN: ' + w);
}
