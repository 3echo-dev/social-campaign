#!/usr/bin/env node
// Preview or apply the versioned compatibility migration for jobs created before the
// performance-review removal.
//
//   node migrate-performance-review.js preview [--brand <brand>] [--job <job-id>] [--json]
//   node migrate-performance-review.js apply [--brand <brand>] [--job <job-id>] [--plan <file>] [--json]
//
// Preview only reads job records. Apply uses the preview's expected hashes and durable status
// locks. Neither mode is invoked automatically by a job worker.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const durable = require('./lib-durable.js');
const migration = require('./lib-legacy-migration.js');

const argv = process.argv.slice(2);
const positionals = ws.positionals(argv);
const mode = positionals[0];
const value = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const json = argv.includes('--json');
const brand = value('brand', argv.includes('--plan') ? undefined : positionals[1]);
const jobId = value('job', argv.includes('--plan') ? undefined : positionals[2]);
const root = ws.root(argv);
const usage = 'usage: migrate-performance-review.js <preview|apply> [--brand <brand>] [--job <job-id>] [--plan <preview.json>] [--json] [--root <dir>]';

if (!['preview', 'apply'].includes(mode)) { console.error(usage); process.exit(2); }

function output(result) {
  if (json) { console.log(JSON.stringify(result, null, 2)); return; }
  const jobs = Array.isArray(result.jobs) ? result.jobs : [];
  console.log((mode === 'preview' ? 'Compatibility preview' : 'Compatibility migration') + ': ' + jobs.length + ' job(s).');
  for (const job of jobs) {
    const actions = (job.actions || []).map(action => action.type).join(', ');
    const suffix = actions ? ' - ' + actions : ' - no changes';
    console.log('  ' + job.jobId + ': ' + (job.state || 'unknown') + suffix);
  }
}

try {
  if (mode === 'preview') {
    const result = migration.preview(root, { brand, jobId });
    const out = value('out');
    if (out) durable.atomicWrite(path.resolve(out), JSON.stringify(result, null, 2) + '\n');
    output(result);
    process.exit(0);
  }

  const planFile = value('plan');
  let plan = null;
  if (planFile) {
    try { plan = JSON.parse(fs.readFileSync(path.resolve(planFile), 'utf8')); }
    catch (error) { console.error('Could not read migration preview: ' + error.message); process.exit(1); }
    if (!plan || plan.migration !== migration.MIGRATION_ID || plan.version !== migration.MIGRATION_VERSION || !Array.isArray(plan.jobs)) {
      console.error('The preview file is not a compatible ' + migration.MIGRATION_ID + ' v' + migration.MIGRATION_VERSION + ' plan.');
      process.exit(1);
    }
  }
  const result = migration.apply(root, plan, { root, brand, jobId, argv });
  output(result);
} catch (error) {
  if (json) console.log(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2));
  else console.error('Migration refused: ' + (error.message || String(error)));
  process.exit(1);
}
