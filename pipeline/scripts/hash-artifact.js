#!/usr/bin/env node
// Content hash of an artifact, stable across the edits a document editor makes on its own.
//   node hash-artifact.js <file...>          prints: sha256  bytes  path
//   const { hashFile } = require('./hash-artifact.js')
// Markdown: CRLF to LF, NFC, trailing whitespace stripped per line, the "Decision" section
// removed at whatever heading level it carries (a verdict written into the file must not
// invalidate the approval it records), trailing blank lines dropped. Every other artifact
// hashes its raw bytes.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function normalizeMarkdown(text) {
  let t = text.replace(/\r\n/g, '\n').normalize('NFC');
  const lines = t.split('\n').map(l => l.replace(/[ \t]+$/, ''));
  const out = [];
  // The templates head this section "# Decision"; a human or an editor may re-level it.
  // Match any level, and stop skipping at the next heading of the same or shallower level.
  let skipLevel = 0;
  for (const l of lines) {
    const h = l.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h) {
      const level = h[1].length;
      if (/^decision\b/i.test(h[2])) { skipLevel = level; continue; }
      if (skipLevel && level <= skipLevel) skipLevel = 0;
    }
    if (!skipLevel) out.push(l);
  }
  return out.join('\n').replace(/\n+$/, '') + '\n';
}

function hashFile(p) {
  const isMarkdown = /\.md$/i.test(p);
  const buf = isMarkdown ? Buffer.from(normalizeMarkdown(fs.readFileSync(p, 'utf8')), 'utf8') : fs.readFileSync(p);
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

module.exports = { hashFile, normalizeMarkdown };

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: hash-artifact.js <file...>'); process.exit(2); }
  for (const f of files) {
    try { const h = hashFile(f); console.log(h.sha256 + '  ' + h.bytes + '  ' + f.split(path.sep).join('/')); }
    catch (e) { console.error('cannot hash ' + f + ': ' + e.message); process.exit(1); }
  }
}
