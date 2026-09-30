#!/usr/bin/env node
const fs = require('fs');
const ws = require('./lib-workspace.js');
const research = require('./lib-brand-research.js');
const argv = process.argv.slice(2), brand = ws.positionals(argv)[0];
if (!brand) { console.error('usage: brand-research.js <brand> [--file research.json | --context | --refresh-plan | --decision]'); process.exit(2); }
try {
  const at = argv.indexOf('--file');
  if (at >= 0 && fs.statSync(argv[at + 1]).size > 60000) throw new Error('Keep research under 60 KB.');
  const dir = ws.wsDir(brand, argv);
  const jsonArg = name => {
    const index = argv.indexOf(name);
    if (index < 0 || !argv[index + 1]) return undefined;
    try { return JSON.parse(argv[index + 1]); } catch { return argv[index + 1]; }
  };
  const now = jsonArg('--now');
  const scope = jsonArg('--scope');
  const questions = jsonArg('--questions');
  const options = { scope, questions, now };
  let result;
  if (argv.includes('--context')) {
    result = research.taskContext(dir, options);
  } else if (argv.includes('--decision') || argv.includes('--evidence-decision')) {
    result = research.evidenceDecision(dir, options);
  } else if (argv.includes('--refresh-plan')) {
    const changedAt = argv.indexOf('--changed');
    const scopeAt = argv.indexOf('--scope');
    const request = {};
    if (changedAt >= 0 && argv[changedAt + 1]) request.changedClaims = argv[changedAt + 1].split(',').map(v => v.trim()).filter(Boolean);
    if (scopeAt >= 0 && argv[scopeAt + 1]) request.scope = scope;
    if (questions !== undefined) request.questions = questions;
    if (now !== undefined) request.now = now;
    result = research.refreshPlan(dir, request);
  } else if (argv.includes('--needs-refresh')) {
    result = research.needsRefresh(dir, scope, { now, questions });
  } else {
    if (at >= 0) {
      const input = JSON.parse(fs.readFileSync(argv[at + 1], 'utf8'));
      result = research.save(dir, input, { now });
    } else result = research.read(dir, { now, scope, questions });
  }
  console.log(JSON.stringify(result || { status: 'not_researched' }, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
