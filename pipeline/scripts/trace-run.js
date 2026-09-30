#!/usr/bin/env node
// What went wrong in a run, and what it repeated.
//   node trace-run.js [transcript.jsonl] [--all] [--json]
//
// With no path it reads the newest transcript for this workspace folder. A failed command is
// worth seeing even when the run recovered: every one of them cost a turn, and most turned
// out to be a defect in this plugin rather than a mistake by the person or the model.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ws = require('./lib-workspace.js');

const argv = process.argv.slice(2);
const pos = ws.positionals(argv);
const asJson = argv.includes('--json');
const showAll = argv.includes('--all');

// Claude Code keeps one folder per project, named after the path with separators flattened.
function projectDir(root) {
  const home = os.homedir();
  // Every character that is not a letter or a digit becomes a dash, spaces included, so
  // "Desktop\social media pipeline" and "Desktop\3echo\social-media-pipeline" stay apart.
  const flat = path.resolve(root).replace(/[^A-Za-z0-9]/g, '-');
  const base = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(base)) return null;
  const exact = fs.readdirSync(base).find((d) => d.toLowerCase() === flat.toLowerCase());
  return exact ? path.join(base, exact) : null;
}

function newestTranscript(root) {
  const dir = projectDir(root);
  if (!dir) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}

const file = pos[0] || newestTranscript(ws.root());
if (!file || !fs.existsSync(file)) {
  console.error('No transcript found. Pass one: trace-run.js <file.jsonl>');
  process.exit(2);
}

const calls = new Map();
const results = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let rec;
  try { rec = JSON.parse(line); } catch { continue; }
  const content = rec.message && rec.message.content;
  if (!Array.isArray(content)) continue;
  for (const block of content) {
    if (block.type === 'tool_use') {
      const input = block.input || {};
      const arg = input.command || input.file_path || input.pattern || input.skill
        || JSON.stringify(input).slice(0, 160);
      calls.set(block.id, { name: block.name, arg: String(arg).replace(/\s+/g, ' ').trim() });
    }
    if (block.type === 'tool_result') {
      const call = calls.get(block.tool_use_id) || { name: 'unknown', arg: '' };
      let text = '';
      if (typeof block.content === 'string') text = block.content;
      else if (Array.isArray(block.content)) text = block.content.map((c) => c.text || '').join(' ');
      results.push({
        failed: block.is_error === true,
        name: call.name,
        arg: call.arg,
        text: text.replace(/\s+/g, ' ').trim(),
      });
    }
  }
}

// A command run more than once with the same first words is usually a retry, and a retry is
// usually a defect: the first attempt should have worked.
const shape = (r) => r.name + ' ' + r.arg.replace(/"[^"]*"/g, '""').split(' ').slice(0, 8).join(' ');
const counts = new Map();
for (const r of results) counts.set(shape(r), (counts.get(shape(r)) || 0) + 1);

const failed = results.filter((r) => r.failed);
const repeated = [...counts.entries()].filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]);

if (asJson) {
  console.log(JSON.stringify({ file, calls: results.length, failed, repeated }, null, 2));
  process.exit(0);
}

console.log(path.basename(file) + ': ' + results.length + ' tool results, ' + failed.length + ' failed');
if (!failed.length) console.log('Nothing failed in this run.');
for (const f of (showAll ? failed : failed.slice(0, 12))) {
  console.log('');
  console.log('FAILED  ' + f.name + '  ' + f.arg.slice(0, 150));
  console.log('        ' + f.text.slice(0, 300));
}
if (repeated.length) {
  console.log('');
  console.log('Run more than twice, which usually means a retry:');
  for (const [k, n] of repeated.slice(0, 8)) console.log('  ' + n + 'x  ' + k.slice(0, 140));
}
console.log('');
console.log('Every failure here is a defect until proven otherwise. Record it in docs/RUN-DEFECTS.md with its fix.');
