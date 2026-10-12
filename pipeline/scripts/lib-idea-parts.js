// The idea parts every brief, concept and post names: the anchor (one pain or desire in the audience's words),
// the awareness stage, the angle, the visual format, the hook family and the attention mechanic. The ids live in
// the playbooks; this reads them so the checks and the concept ranking never drift from what the playbooks say.
// A missing or unknown part is a warning, never a failure (bob, 2026-10-12: warn for now).
const fs = require('fs');
const path = require('path');

const PLAYBOOKS = path.join(__dirname, '..', 'playbooks');
const STAGES = ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware'];

function read(name) {
  try { return fs.readFileSync(path.join(PLAYBOOKS, name), 'utf8'); } catch { return ''; }
}

// First-column ids of every table row that starts with the prefix, e.g. `| A-RECEIPT | ...`.
function idsFrom(text, prefix) {
  const ids = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\|\s*([A-Z]+-[A-Z0-9-]+)\s*\|/.exec(line);
    if (m && m[1].startsWith(prefix)) ids.add(m[1]);
  }
  return ids;
}

// The stage pairing table in visual-formats.md: stage -> { strong: Set, weak: Set }.
function pairingFrom(text) {
  const out = {};
  const at = text.indexOf('## Stage pairing');
  if (at < 0) return out;
  for (const line of text.slice(at).split(/\r?\n/)) {
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 4 || !STAGES.includes(cells[1])) continue;
    const list = cell => new Set(cell.split(',').map(s => s.trim()).filter(s => /^F-/.test(s)));
    out[cells[1]] = { strong: list(cells[2]), weak: list(cells[3]) };
  }
  return out;
}

// Best stages per angle, from the third column of angles.md: id -> Set of stages.
function angleStagesFrom(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 5 || !/^A-[A-Z0-9-]+$/.test(cells[1])) continue;
    out[cells[1]] = new Set(cells[3].split(',').map(s => s.trim()).filter(s => STAGES.includes(s)));
  }
  return out;
}

let cached = null;
function catalogue() {
  if (cached) return cached;
  const formats = read('visual-formats.md');
  const hooks = read('hooks.md');
  const families = new Set();
  for (const line of hooks.split(/\r?\n/)) {
    const m = /^\|\s*(H-[A-Z]+)\s*\|/.exec(line);
    if (m) families.add(m[1]);
  }
  cached = {
    stages: new Set(STAGES),
    angles: idsFrom(read('angles.md'), 'A-'),
    formats: idsFrom(formats, 'F-'),
    mechanics: idsFrom(read('attention-mechanics.md'), 'M-'),
    families,
    pairing: pairingFrom(formats),
    angleStages: angleStagesFrom(read('angles.md')),
  };
  // Escape hatches the playbooks allow without a table row.
  cached.angles.add('A-OTHER');
  cached.mechanics.add('M-NONE');
  return cached;
}

const clean = v => (v === undefined || v === null) ? '' : String(v).trim();
const blank = v => !clean(v) || /^\{.*\}$/.test(clean(v));

// Checks a post's (or brief's) front matter. `fields` picks which parts apply: a brief has no format or mechanic.
const POST_FIELDS = ['anchor', 'awareness_stage', 'angle_id', 'format_id', 'mechanic_id'];
const BRIEF_FIELDS = ['anchor', 'awareness_stage', 'angle_id'];
const LABEL = { anchor: 'anchor (the pain or desire, quoted)', awareness_stage: 'awareness stage', angle_id: 'angle id', format_id: 'visual format id', mechanic_id: 'attention mechanic id' };
const SOURCE = { awareness_stage: 'playbooks/awareness-stages.md', angle_id: 'playbooks/angles.md', format_id: 'playbooks/visual-formats.md', mechanic_id: 'playbooks/attention-mechanics.md' };

function checkParts(data, fields = POST_FIELDS) {
  const cat = catalogue();
  const sets = { awareness_stage: cat.stages, angle_id: cat.angles, format_id: cat.formats, mechanic_id: cat.mechanics };
  const warnings = [];
  const missing = fields.filter(f => blank(data && data[f]));
  if (missing.length) warnings.push('idea parts missing: ' + missing.map(f => LABEL[f]).join(', ') + '. Results cannot be compared by part without them.');
  for (const f of fields) {
    if (f === 'anchor' || blank(data && data[f])) continue;
    const set = sets[f];
    if (set && set.size && !set.has(clean(data[f]))) warnings.push(LABEL[f] + ' "' + clean(data[f]) + '" is not in ' + SOURCE[f]);
  }
  return warnings;
}

// How well a visual format suits a stage: 'strong', 'weak' or 'neutral' (unknown when either is missing).
function pairing(stage, format) {
  const p = catalogue().pairing[clean(stage)];
  if (!p || !clean(format)) return 'unknown';
  if (p.strong.has(clean(format))) return 'strong';
  if (p.weak.has(clean(format))) return 'weak';
  return 'neutral';
}

module.exports = { STAGES, POST_FIELDS, BRIEF_FIELDS, catalogue, checkParts, pairing };
