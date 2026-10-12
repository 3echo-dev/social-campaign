// Stable ad ids and one-change test pairs for paid jobs.
// Every ad (one deliverable) gets an id that never changes for that job, such as V-3f9a2c-D1. The person puts it
// at the end of the ad's name in Ads Manager, so results read back later (connector or CSV) can be matched to the
// ad and to the idea parts it was built from. The campaign proposal's "Test plan" table pairs ads; a fair pair
// changes one part. A pair that changes more, or not the part it says, is a warning, never a failure.
const crypto = require('crypto');

// The parts a test pair can differ by, in the order people read them.
const PART_FIELDS = ['anchor', 'awareness_stage', 'angle_id', 'format_id', 'hook_family', 'mechanic_id'];
const PART_WORDS = {
  anchor: 'anchor', awareness_stage: 'stage', angle_id: 'angle', format_id: 'format', hook_family: 'hook', mechanic_id: 'mechanic',
};
const ID_PATTERN = /^V-[0-9a-f]{6}-D\d+[a-z]?$/;
const DELIVERABLE = /\bD\d+[a-z]?\b/;

function variantId(jobId, deliverable) {
  const h = crypto.createHash('sha256').update(String(jobId)).digest('hex').slice(0, 6);
  return 'V-' + h + '-' + deliverable;
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function partsOf(data) {
  const out = {};
  for (const f of PART_FIELDS) out[f] = clean(data && data[f]);
  return out;
}

// Which parts differ between two ads. A part missing on both sides is not a difference.
function differingParts(a, b) {
  return PART_FIELDS.filter(f => clean(a[f]).toLowerCase() !== clean(b[f]).toLowerCase());
}

// "angle", "angle_id", "Angle (A-*)" -> "angle_id". Empty when the cell names no part.
function fieldFromWords(cell) {
  const text = clean(cell).toLowerCase();
  if (!text) return '';
  for (const f of PART_FIELDS) {
    if (text.includes(f) || text.split(/[^a-z_]+/).includes(PART_WORDS[f])) return f;
  }
  if (/awareness/.test(text)) return 'awareness_stage';
  if (/visual/.test(text)) return 'format_id';
  if (/pain|desire/.test(text)) return 'anchor';
  return '';
}

// Rows of the table under "## Test plan": | Pair | Ad A | Ad B | Differs by | Proven or new |.
function parseTestPlan(markdown) {
  const text = String(markdown || '');
  const at = text.search(/^##\s+Test plan\s*$/m);
  if (at < 0) return [];
  const body = text.slice(at).split(/\r?\n/).slice(1);
  const pairs = [];
  for (const line of body) {
    if (/^#{1,2}\s/.test(line)) break;
    if (!line.trim().startsWith('|') || /^\|\s*:?-/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 4) continue;
    const a = DELIVERABLE.exec(cells[1]);
    const b = DELIVERABLE.exec(cells[2]);
    if (!a || !b) continue;
    pairs.push({ pair: cells[0], a: a[0], b: b[0], statedPart: fieldFromWords(cells[3]), stated: cells[3], cohort: clean(cells[4]).toLowerCase() });
  }
  return pairs;
}

// posts: [{ deliverable, platform, data }] where data is the post.md front matter.
function buildVariants({ jobId, posts, proposalText }) {
  const byDeliverable = new Map();
  const variants = posts.map(p => {
    const v = { variantId: variantId(jobId, p.deliverable), deliverable: p.deliverable, platform: p.platform, parts: partsOf(p.data), testPairs: [] };
    byDeliverable.set(p.deliverable, v);
    return v;
  });
  const warnings = [];
  const pairs = [];
  for (const row of parseTestPlan(proposalText)) {
    const a = byDeliverable.get(row.a);
    const b = byDeliverable.get(row.b);
    if (!a || !b) {
      warnings.push('Test pair ' + row.pair + ' names ' + (!a ? row.a : row.b) + ', which is not one of this job\'s ads.');
      continue;
    }
    const differs = differingParts(a.parts, b.parts);
    const entry = { pair: row.pair, a: a.variantId, b: b.variantId, differsBy: differs, stated: row.statedPart || row.stated, cohort: row.cohort };
    pairs.push(entry);
    a.testPairs.push(row.pair);
    b.testPairs.push(row.pair);
    const words = differs.map(f => PART_WORDS[f]).join(', ');
    if (differs.length === 0) warnings.push('Test pair ' + row.pair + ' (' + row.a + ' vs ' + row.b + ') has the same parts on both ads, so it tests nothing a result can name.');
    else if (differs.length > 1) warnings.push('Test pair ' + row.pair + ' (' + row.a + ' vs ' + row.b + ') changes ' + differs.length + ' parts (' + words + '); a fair test changes one.');
    else if (row.statedPart && differs[0] !== row.statedPart) warnings.push('Test pair ' + row.pair + ' says it tests the ' + PART_WORDS[row.statedPart] + ' but the ads differ by the ' + words + '.');
  }
  return { variants, pairs, warnings };
}

function partsLine(parts) {
  const shown = PART_FIELDS.filter(f => f !== 'anchor' && parts[f]).map(f => PART_WORDS[f] + ' ' + parts[f]);
  return shown.join(', ');
}

module.exports = { PART_FIELDS, PART_WORDS, ID_PATTERN, variantId, partsOf, differingParts, parseTestPlan, buildVariants, partsLine };
