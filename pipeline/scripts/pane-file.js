#!/usr/bin/env node
// Embed the workspace page in a local HTML file for Claude Code Preview.
//   node pane-file.js <key> <url>
//
// Some desktop Code tab sessions are not offered preview_start. A static HTML path in an
// assistant message opens in Preview, so this file keeps the remote workspace inside a
// full-size iframe. It does not redirect the Preview pane to an external address.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');

const [key, url] = ws.positionals(process.argv.slice(2));
if (!key || !url) {
  console.error('usage: pane-file.js <key> <url>');
  process.exit(2);
}
if (!/^https?:\/\//i.test(url)) {
  console.error('The url must start with http:// or https://.');
  process.exit(2);
}

// A key is `home`, `brand:{slug}` or a job id; the colon is not a filename anywhere.
const safe = String(key).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
const dir = path.join(ws.root(), '.pane');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, safe + '.html');

const attr = String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

fs.writeFileSync(file, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Social pipeline</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=Inter:wght@400;500;600&display=swap">
<style>
html, body { height: 100%; margin: 0; background: #fff; }
body { display: grid; font: 14px/1.65 Inter, 'Segoe UI', sans-serif; color: #1E2F55; }
iframe { width: 100%; height: 100%; border: 0; background: #fff; }
.fallback { display: none; place-self: center; max-width: 28rem; margin: 24px; padding: 2rem; text-align: center; background: #F5F7FB; border: 1px solid #DCE3F0; border-radius: 14px; }
.fallback strong { font-family: Manrope, Inter, sans-serif; color: #0B2148; }
.fallback a { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border: 1px solid #DCE3F0; border-radius: 999px; background: #fff; color: #0B3D91; text-decoration: none; transition: background-color 150ms ease, border-color 180ms ease, transform 180ms cubic-bezier(.23,1,.32,1); }
.fallback a:hover { background: #EEF1FF; border-color: #3E4BE1; }
.fallback a:active { transform: scale(.97); }
.fallback a:focus-visible { outline: 3px solid #3E4BE1; outline-offset: 4px; }
.fallback svg { width: 18px; height: 18px; }
@media(prefers-reduced-motion:reduce) { .fallback a { transition: none; transform: none; } }
</style>
</head>
<body>
<iframe src="${attr}" title="Interactive social pipeline" allow="clipboard-read; clipboard-write"></iframe>
<noscript>
  <div class="fallback" style="display:grid">
    <p><strong>Social Campaign</strong></p>
    <p>The interactive pipeline needs JavaScript.</p>
    <p><a href="${attr}">Open the pipeline page <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></p>
  </div>
</noscript>
</body>
</html>
`);

console.log(ws.fwd(file));
