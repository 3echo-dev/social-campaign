#!/usr/bin/env node
// Sleeps, then exits 0. Nothing else.
//   node scripts/wait.js 10
// It exists for bounded backoff inside an external operation that has explicit progress and
// cancellation. Human questions and reviews use one-shot readers and never call this script.
const seconds = Number(process.argv[2]);
if (!Number.isFinite(seconds) || seconds < 0 || seconds > 300) {
  console.error('usage: wait.js {seconds}, 0 to 300');
  process.exit(2);
}
setTimeout(() => process.exit(0), seconds * 1000);
