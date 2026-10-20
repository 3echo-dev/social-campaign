#!/usr/bin/env node
// Source-only release check, run by GitHub on every push and by hand before a release:
//   node scripts/check-plugin.mjs
// It never runs the behaviour tests (they stay local) and never calls a provider. It checks that the JSON parses, every
// script compiles, the versions agree, every hook and plugin-root path exists, the generated board matches its source,
// and the MCP server starts and lists its tools.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const files = [];
const walk = dir => {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (['.git', 'node_modules'].includes(name) || (!dir && name === 'tmp')) continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel); else files.push(rel);
  }
};
walk('');

// JSON parses.
for (const file of files.filter(f => f.endsWith('.json'))) {
  try { JSON.parse(readFileSync(join(ROOT, file), 'utf8')); } catch (error) { problems.push(`${file}: not valid JSON (${error.message})`); }
}

// Every script compiles.
for (const file of files.filter(f => /\.(mjs|js)$/.test(f) && !f.startsWith('board/'))) {
  try { execFileSync(process.execPath, ['--check', join(ROOT, file)], { stdio: 'pipe' }); }
  catch (error) { problems.push(`${file}: ${String(error.stderr || error.message).split('\n').find(Boolean)}`); }
}

// One version everywhere.
const version = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).version;
const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const versions = { 'package.json': pkg.version, 'marketplace metadata': market.metadata?.version, 'marketplace entry': market.plugins?.find(p => p.name === 'social-campaign')?.version };
for (const [where, value] of Object.entries(versions)) if (value !== version) problems.push(`${where} says ${value}, plugin.json says ${version}`);
if (!readme.includes(`Current version: ${version}.`)) problems.push(`README.md does not say "Current version: ${version}."`);

// Every hook command and every plugin-root path named by the plugin's own files exists.
const hooks = readFileSync(join(ROOT, 'hooks/hooks.json'), 'utf8');
for (const match of hooks.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\\\s]+)/g)) if (!existsSync(join(ROOT, match[1]))) problems.push(`hooks/hooks.json runs ${match[1]}, which does not exist`);
for (const match of hooks.matchAll(/scripts\/hooks\/forward\.mjs\\" ([A-Za-z0-9_\/-]+\.mjs)/g)) if (!existsSync(join(ROOT, 'scripts', match[1]))) problems.push(`hooks/hooks.json forwards to scripts/${match[1]}, which does not exist`);
if (/\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/(?!hooks\/forward\.mjs)/.test(hooks)) problems.push('hooks/hooks.json runs a script directly: every hook command goes through scripts/hooks/forward.mjs so it follows plugin updates');
for (const file of files.filter(f => /^(skills|agents)\/.*\.md$/.test(f))) {
  for (const match of readFileSync(join(ROOT, file), 'utf8').matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+[A-Za-z0-9_/-])/g)) {
    if (!existsSync(join(ROOT, match[1]))) problems.push(`${file} points at ${match[1]}, which does not exist`);
  }
}

// The generated board matches its source: build it in memory and compare.
try {
  const { buildBoard } = await import('./build-board.mjs');
  if (buildBoard() !== readFileSync(join(ROOT, 'board/social-campaign.html'), 'utf8')) problems.push('board/social-campaign.html is out of date: run node scripts/build-board.mjs');
} catch (error) {
  problems.push(`the board could not be built: ${String(error.message).split('\n').find(Boolean)}`);
}

// The published board loads as separate modules that import each other; load them the same way so a name used before
// its module has run (which leaves the page stuck on "Opening your workspace") fails here, not on the board.
try {
  const { buildBoardShell } = await import('./build-board.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'board-modules-'));
  const fileOf = name => (name === 'app' ? 'board.mjs' : `board-${name}.mjs`);
  for (const file of buildBoardShell().files.filter(f => f.kind === 'js')) {
    writeFileSync(join(dir, fileOf(file.name)), file.text.replace(/(["'])board\/([a-z0-9-]+)\1/g, (_, quote, name) => `${quote}./${fileOf(name)}${quote}`));
  }
  await import(pathToFileURL(join(dir, 'board.mjs')).href);
} catch (error) {
  problems.push(`the published board does not load: ${String(error.message).split('\n').find(Boolean)}`);
}

// The MCP server starts and lists its tools.
const tools = await new Promise(resolve => {
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', join(ROOT, 'server/index.mjs')], {
    env: { ...process.env, SOCIAL_CAMPAIGN_DATA_DIR: mkdtempSync(join(tmpdir(), 'sc-data-')) },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let out = '';
  const done = value => { clearTimeout(timer); child.kill(); resolve(value); };
  const timer = setTimeout(() => done(null), 20000);
  child.stdout.on('data', chunk => {
    out += chunk;
    for (const line of out.split('\n')) {
      try { const message = JSON.parse(line); if (message.id === 2) done(message.result?.tools?.length ?? null); } catch { /* partial line */ }
    }
  });
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
});
if (!tools) problems.push('the MCP server did not start and list its tools within 20 seconds');

if (problems.length) {
  console.error(`Plugin check failed (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Plugin check passed: version ${version}, ${files.length} files, ${tools} tools.`);
