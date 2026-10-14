// The upstream inputs an approval stood on, so a later change to them stales it.
//   basisFor(jobDir, gate, ownPaths) -> [{ path, sha256 }]   recorded by record-approval.js
//   staleBasis(jobDir, record)       -> [{ path, approved, now }]   read by check-approval.js
// An approval of the storyboard, final post or price says "this is right given the brief and the
// concept chosen". If the brief is edited afterwards, the file hash alone still matches, so the
// approval is also bound to the hashes of those inputs. Records without `basis` are not checked.
const fs = require('fs');
const path = require('path');
const { hashFile } = require('./hash-artifact.js');

// Gates that come after the brief. The report and findings gates look at results, not at the brief.
const BASIS_GATES = ['concept', 'storyboard', 'content', 'publish', 'campaign_proposal', 'campaign_activation'];
// plan.md is left out: its Status and Verified lines change as the job runs. concepts.md is covered by the concept approval record.
const FIXED = ['brief.md'];
const CONCEPT_RECORD = /^approvals\/concept-(\d+)\.json$/;
const norm = p => String(p).split(path.sep).join('/').replace(/^\.\//, '');

function latestApprovedConcept(jobDir) {
  let names = [];
  try { names = fs.readdirSync(path.join(jobDir, 'approvals')); } catch { return null; }
  const rounds = names.map(n => n.match(/^concept-(\d+)\.json$/)).filter(Boolean).map(m => +m[1]).sort((a, b) => a - b);
  if (!rounds.length) return null;
  const rel = 'approvals/concept-' + rounds[rounds.length - 1] + '.json';
  try { if (JSON.parse(fs.readFileSync(path.join(jobDir, rel), 'utf8')).decision !== 'approved') return null; } catch { return null; }
  return rel;
}

function basisFor(jobDir, gate, ownPaths) {
  if (!BASIS_GATES.includes(gate)) return [];
  const own = new Set((ownPaths || []).map(norm));
  const wanted = [...FIXED];
  if (gate !== 'concept') { const c = latestApprovedConcept(jobDir); if (c) wanted.push(c); }
  const out = [];
  for (const rel of wanted) {
    if (own.has(rel)) continue;
    const p = path.join(jobDir, rel);
    if (!fs.existsSync(p)) continue;
    out.push({ path: rel, sha256: hashFile(p).sha256 });
  }
  return out;
}

function staleBasis(jobDir, record) {
  const stale = [];
  if (!record || !Array.isArray(record.basis)) return stale;
  for (const b of record.basis) {
    if (!b || typeof b.path !== 'string' || typeof b.sha256 !== 'string') continue;
    const rel = norm(b.path);
    const short = b.sha256.slice(0, 12);
    const p = path.join(jobDir, rel);
    if (!fs.existsSync(p)) { stale.push({ path: rel, approved: short, now: 'missing' }); continue; }
    let now;
    try { now = hashFile(p).sha256; } catch { stale.push({ path: rel, approved: short, now: 'unreadable' }); continue; }
    if (now !== b.sha256) { stale.push({ path: rel, approved: short, now: now.slice(0, 12) }); continue; }
    // A concept pick made again after this approval replaces the one it stood on.
    if (CONCEPT_RECORD.test(rel) && latestApprovedConcept(jobDir) !== rel) stale.push({ path: rel, approved: short, now: 'superseded' });
  }
  return stale;
}

module.exports = { BASIS_GATES, basisFor, staleBasis };
