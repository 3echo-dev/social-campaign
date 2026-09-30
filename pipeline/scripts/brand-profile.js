#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const profile = require('./lib-brand-profile.js');
const argv = process.argv.slice(2);
const brand = ws.positionals(argv)[0];
if (!brand) { console.error('usage: brand-profile.js <brand> [--file profile.json | --questions | --json]'); process.exit(2); }
const dir = ws.wsDir(brand, argv);
try {
  if (!fs.existsSync(path.join(dir, 'workspace.json'))) throw new Error('Scaffold the brand first.');
  if (argv.includes('--questions')) {
    console.log(JSON.stringify(profile.CHANNELS.map(k => ({ id: k, kind: 'text', required: true,
      text: k === 'website' ? 'Brand website' : k[0].toUpperCase() + k.slice(1) + ' profile', placeholder: 'https://... or Not available' })).concat([
      { id: 'competitors', kind: 'list', required: false, max: 3, text: 'Your top three competitors', placeholder: 'Names or URLs. Leave blank for research to select them.' },
      { id: 'market', kind: 'text', required: false, text: 'Primary market', placeholder: 'Country, region, and category.' },
      { id: 'audience', kind: 'text', required: false, text: 'Audience', placeholder: 'The customers you serve.' },
      { id: 'palette', kind: 'list', required: false, text: 'Palette and color roles', placeholder: 'Hex values, names, or unknown.' },
      { id: 'fonts', kind: 'list', required: false, text: 'Typography', placeholder: 'Font families and weights, or unknown.' },
      { id: 'voice', kind: 'text', required: false, text: 'Voice and text guidance', placeholder: 'Tone, terminology, examples, and forbidden claims.' },
      { id: 'strategy', kind: 'text', required: false, text: 'Declared strategy', placeholder: 'Current approach and constraints.' },
      { id: 'contentPillars', kind: 'list', required: false, text: 'Content pillars', placeholder: 'Current declared pillars.' },
      { id: 'assets', kind: 'list', required: false, text: 'Brand assets', placeholder: 'Stable logo, photo, or guide references.' },
    ]), null, 2));
  } else {
    const at = argv.indexOf('--file');
    if (at >= 0) {
      if (fs.statSync(argv[at + 1]).size > 40000) throw new Error('Keep the brand profile under 40 KB.');
      const saved = profile.save(dir, JSON.parse(fs.readFileSync(argv[at + 1], 'utf8')), { requireChannels: true });
      console.log(argv.includes('--json') ? JSON.stringify(saved, null, 2) : 'Brand onboarding saved. Account URLs are research references, not authenticated connections.');
    } else {
      const saved = profile.read(dir);
      if (!saved) throw new Error('Complete brand onboarding before starting a job. Website and each social profile need a URL or Not available.');
      console.log(JSON.stringify(saved, null, 2));
    }
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
