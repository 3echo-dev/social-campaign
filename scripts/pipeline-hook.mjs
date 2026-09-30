#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resolveActiveWorkspace } from '../server/workspace/index.mjs';

const require = createRequire(import.meta.url);

// Hook failures never block the turn. Only usage fields are kept by tokens.js.
try {
  let input='';
  for await(const chunk of process.stdin) { input+=chunk;if(input.length>1024*1024)process.exit(0); }
  const event=JSON.parse(input);
  const {root}=resolveActiveWorkspace(event.cwd || process.cwd());
  if(!root || !existsSync(join(root,'.social-pipeline','config.json')))process.exit(0);
  const config=JSON.parse(readFileSync(join(root,'.social-pipeline','config.json'),'utf8'));
  if(config.storage?.mode!=='local')process.exit(0);
  const pipeline=join(dirname(fileURLToPath(import.meta.url)),'..','pipeline');
  const tokensHook=require(join(pipeline,'scripts','hooks','tokens.js'));
  try {
    await tokensHook.run(event,['--root',root]);
  } catch {
    process.stderr.write('Social Campaign: usage was not recorded for this turn.\n');
  }
} catch { /* Missing hook fields remain missing metrics. */ }
