#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const memory = require('./lib-memory.js');
const execution = require('./lib-execution-availability.js');
const argv = process.argv.slice(2);
const { dir } = ws.resolveJobArgs(argv, argv);
const i = argv.indexOf('--memory-file');
if (!dir || i < 0 || !argv[i + 1]) { console.error('usage: checkpoint-job.js <brand> <job-id> --memory-file notes.json'); process.exit(2); }
try {
  if (!fs.existsSync(path.join(dir, 'status.md'))) throw new Error('No such job.');
  const availability = execution.checkJobDirectory(dir, { requireJob: true });
  if (!availability.available) {
    console.error('UNSUPPORTED: ' + availability.message);
    process.exit(4);
  }
  if (fs.statSync(argv[i + 1]).size > 20000) throw new Error('Keep the memory input under 20 KB.');
  memory.save(dir, JSON.parse(fs.readFileSync(argv[i + 1], 'utf8')));
  console.log('Working notes saved. This does not approve or advance the job.');
} catch (e) { console.error(e.message); process.exitCode = 1; }
