#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');
const ws = require('./lib-workspace.js');
const metrics = require('./lib-metrics-sync.js');
const argv = process.argv.slice(2);
const { brand, jobId, dir } = ws.resolveJobArgs(argv, argv);
if (!dir) { console.error('usage: sync-events.js <brand> <job-id> [--root <dir>]'); process.exit(2); }
const exported = spawnSync(process.execPath, [path.join(__dirname, 'export-events.js'), brand, jobId, '--root', ws.root(argv)], { encoding: 'utf8', timeout: 5000 });
if (exported.status !== 0) { console.error(exported.stderr || 'Could not prepare metrics.'); process.exit(1); }
metrics.sync(dir, argv).then(result => console.log(JSON.stringify(result)), e => { console.error(e.message); process.exitCode = 1; });
