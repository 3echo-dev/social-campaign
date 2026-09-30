#!/usr/bin/env node
const ws = require('./lib-workspace.js');
const sessions = require('./lib-session.js');
const argv = process.argv.slice(2);
const { brand, jobId } = ws.resolveJobArgs(argv, argv);
try {
  sessions.bind(sessions.sessionId(argv), brand, jobId, argv);
  console.log('Selected ' + brand + ', ' + jobId + ' for this chat.');
} catch (e) { console.error(e.message); process.exitCode = 2; }
