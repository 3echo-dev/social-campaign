// Tiny front matter and section reader for the plugin's markdown artifacts. No dependencies.
// parse(text) -> { data, body, sections }
//   data: YAML subset: scalars, inline lists [a, b], block lists (- item), one level of nested maps.
//   sections: { "Caption": "...", "Hashtags": "..." } keyed by H1 heading text (leading '# ').
const fs = require('fs');

function coerce(v) {
  const s = String(v).trim();
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(x => x !== '');
  return s.replace(/^["']|["']$/g, '');
}

function parseYamlSubset(block) {
  const data = {};
  let curKey = null, curObj = null;
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const m = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.*)$/);
    const li = line.match(/^\s*-\s+(.*)$/);
    if (indent === 0 && m) {
      curKey = m[1]; curObj = null;
      if (m[2].trim() === '') { data[curKey] = null; }           // list or map follows
      else data[curKey] = coerce(m[2]);
    } else if (indent > 0 && li && curKey) {
      if (!Array.isArray(data[curKey])) data[curKey] = [];
      data[curKey].push(coerce(li[1]));
    } else if (indent > 0 && m && curKey) {
      if (data[curKey] === null || typeof data[curKey] !== 'object' || Array.isArray(data[curKey])) data[curKey] = {};
      data[curKey][m[1]] = coerce(m[2]);
    }
  }
  return data;
}

function parse(text) {
  const t = text.replace(/\r\n/g, '\n');
  let data = {}, body = t;
  const fm = t.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) { data = parseYamlSubset(fm[1]); body = t.slice(fm[0].length); }
  const sections = {};
  let name = null, buf = [];
  for (const line of body.split('\n')) {
    const h = line.match(/^#\s+(.+?)\s*$/);
    if (h) { if (name !== null) sections[name] = buf.join('\n').trim(); name = h[1]; buf = []; }
    else buf.push(line);
  }
  if (name !== null) sections[name] = buf.join('\n').trim();
  return { data, body, sections };
}

function parseFile(p) { return parse(fs.readFileSync(p, 'utf8')); }

// First fenced ```json block in a markdown file, parsed.
function jsonBlock(p) {
  const t = fs.readFileSync(p, 'utf8');
  const m = t.match(/```json\r?\n([\s\S]*?)```/);
  if (!m) return null;
  return JSON.parse(m[1]);
}

// Markdown table rows -> array of objects keyed by header cells.
function table(text) {
  const rows = [];
  let header = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) { if (header) break; continue; }
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (!header) { header = cells; continue; }
    if (cells.every(c => /^:?-+:?$/.test(c))) continue;
    const r = {}; header.forEach((h, i) => r[h] = cells[i] || ''); rows.push(r);
  }
  return rows;
}

module.exports = { parse, parseFile, jsonBlock, table };
