#!/usr/bin/env node
// Planner: route.json + workflows/<id>.md -> plan.md. The markdown stage table is the executable truth.
//
//   node plan-job.js <route.json> [--job <job.json>] [--out <plan.md>]
//
// Keeps a workflow row when its Condition holds. Conditions: always | if:tag | unless:tag, several
// joined by spaces (all must hold). A row with a Gate that is not in the route's gates is dropped.
// Role is the agent's role name, carried through from the table. Owner resolves per job: the
// route's owner agent gets owner, other specialists get support.
// Exit: 0 ok · 1 error · 2 usage · 3 route not ROUTED
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ws = require('./lib-workspace.js');
const { buildContracts } = require('./lib-task-contracts.js');
const execution = require('./lib-execution-availability.js');
const kinds = require('./lib-kinds.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const routePath = args.find(a => !a.startsWith('--'));
if (!routePath) { console.error('usage: plan-job.js <route.json> [--job <job.json>] [--out <plan.md>]'); process.exit(2); }
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const jobPath = opt('--job', path.join(path.dirname(routePath), 'job.json'));
const outPath = opt('--out', path.join(path.dirname(routePath), 'plan.md'));

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
let route, job, workflowsReg;
try {
  route = readJson(routePath);
  job = fs.existsSync(jobPath) ? readJson(jobPath) : {};
  workflowsReg = readJson(path.join(ROOT, 'registry', 'workflows.json'));
} catch (e) { console.error('cannot read inputs: ' + e.message); process.exit(1); }

// Check the saved route before reading a workflow table or writing a plan. This closes the
// old ROUTED performance route even when its registry entry or source file is still present.
const availability = execution.checkExecutionAvailability({
  job, route, workflows: workflowsReg.workflows,
});
if (!availability.available) {
  console.error('UNSUPPORTED: ' + availability.message);
  process.exit(4);
}

if (route.status !== 'ROUTED') { console.error('route is ' + route.status + ', not ROUTED. Resolve intake first.'); process.exit(3); }
const wf = workflowsReg.workflows.find(w => w.workflowId === route.workflowId);
if (!wf || !wf.file) { console.error('no workflow file for ' + route.workflowId); process.exit(1); }
const table = fs.readFileSync(path.join(ROOT, wf.file), 'utf8');

// Tags
const dels = Array.isArray(job.deliverables) ? job.deliverables : [];
const tags = new Set(route.requiredDisciplines || []);
const media = dels.some(d => d.creativeDiscipline !== 'text_only');
if (media) tags.add('media');
if (media && tags.has('video_intelligence')) tags.add('video_qa');
if (!(route.gates || []).includes('publish')) tags.add('merged_publish');
if (tags.has('ads')) tags.add('paid');
// One tag per gate the route kept, so a row that only makes sense next to a gate
// (the export after the concept gate, say) can be tied to it with if:gate_concept.
for (const g of route.gates || []) tags.add('gate_' + g);
if (['organic', 'both'].includes(job.distribution)) tags.add('organic');
if (route.researchDepth === 'lite') tags.add('research_lite');
// "Make me a TikTok like this <url>". A reference video is watched and broken down before
// anything is written. The router already adds video_intelligence for it, but no row on the
// organic route watched it, so the link the person gave was quietly ignored.
const refs = Array.isArray(job.sourceRefs) ? job.sourceRefs : [];
if (refs.some(kinds.isVideoSource)) tags.add('reference_video');
if (refs.some(kinds.sourceLink)) tags.add('sources');

function holds(cond) {
  const parts = String(cond || 'always').trim().split(/\s+/);
  return parts.every(p => {
    if (p === 'always' || p === '') return true;
    if (p.startsWith('if:')) return tags.has(p.slice(3));
    if (p.startsWith('unless:')) return !tags.has(p.slice(7));
    return false;
  });
}

// Parse the first markdown table that has a Condition column
const lines = table.split(/\r?\n/);
let header = null, rows = [];
for (const line of lines) {
  if (!line.trim().startsWith('|')) { if (header && rows.length) break; continue; }
  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  if (!header) { if (cells.includes('Condition')) header = cells; continue; }
  if (cells.every(c => /^:?-+:?$/.test(c))) continue;
  const row = {}; header.forEach((h, i) => row[h] = cells[i] || '');
  rows.push(row);
}
if (!header) { console.error('no stage table with a Condition column in ' + wf.file); process.exit(1); }

const owner = route.owner;
const support = new Set(route.support || []);

// A newer router may attach a compact evidence decision without changing legacy route
// files.  An explicit reuse-only decision removes the research rows from this frozen plan;
// a missing decision preserves the existing discipline-driven behavior.
function researchDecisionFor() {
  const candidates = [route.researchDecision, route.evidenceDecision, route.evidencePlan,
    job.researchDecision, job.evidenceDecision, job.evidencePlan];
  return candidates.find(value => value && typeof value === 'object') || null;
}

function normalizedResearchDecision(decision) {
  if (!decision) return null;
  const rawWork = [decision.work, decision.questions, decision.pendingQuestions, decision.refreshRequired,
    decision.missing, decision.gaps].find(value => Array.isArray(value)) ||
    (Array.isArray(decision.questionIds) ? decision.questionIds : []);
  const work = rawWork.map(item => typeof item === 'string' ? item : item &&
    (item.id || item.questionId || item.evidenceId)).filter(Boolean);
  const questionIds = work.length ? work :
    (Array.isArray(decision.questionIds) ? decision.questionIds.filter(Boolean) : []);
  const required = decision.required === true || decision.needsResearch === true ||
    decision.dispatch === true || rawWork.length > 0;
  const explicitReuseOnly = decision.required === false || decision.needsResearch === false ||
    decision.reuseOnly === true || (decision.status === 'current' && questionIds.length === 0);
  return {
    ...decision,
    work: questionIds,
    required: required && !explicitReuseOnly,
    reuseOnly: explicitReuseOnly && !required,
  };
}

const researchDecision = normalizedResearchDecision(researchDecisionFor());
if (researchDecision) {
  if (researchDecision.reuseOnly) {
    tags.delete('research');
    tags.delete('research_lite');
    tags.add('evidence_reused');
  } else if (researchDecision.required) {
    tags.add('research');
    if (researchDecision.researchDepth === 'lite' || researchDecision.depth === 'lite') tags.add('research_lite');
  }
}

const kept = rows.filter(r => holds(r.Condition) && (!r.Gate || (route.gates || []).includes(r.Gate)) &&
  (!(researchDecision && researchDecision.reuseOnly) || !/research/i.test(String(r.Stage || ''))));

const routeHash = crypto.createHash('sha256').update(fs.readFileSync(routePath)).digest('hex').slice(0, 12);
// brand comes from job.json, else from the folder layout <brand>/jobs/<job-id>/
const brandForTz = job.brand || path.basename(path.dirname(path.dirname(path.dirname(path.resolve(routePath)))));
const stamp = ws.now(brandForTz, process.argv);

let out = fs.readFileSync(path.join(ROOT, 'templates', 'plan.md'), 'utf8')
  .split('{job-id}').join(route.jobId || '?')
  .split('{workflowId}').join(route.workflowId)
  .split('{workflowVersion}').join(route.workflowVersion || '?')
  .split('{timestamp}').join(stamp)
  .split('{route sha256 prefix}').join(routeHash)
  .split('{owner}').join(owner || '-')
  .split('{support}').join((route.support || []).join(', ') || 'none')
  .split('{gates}').join((route.gates || []).join(', ') || 'none');
if (!out.endsWith('\n')) out += '\n';

for (const r of kept) {
  // Role is the agent's own name in the pipe and travels straight through; Owner is per job.
  let ownership = r.Owner;
  if (r.Agent === owner) ownership = 'owner';
  else if (support.has(r.Agent)) ownership = 'support';
  out += '| ' + [r['#'], r.Stage, r.Task, r.Agent, r.Role, ownership, r.Skills, r.Artifact, r['State after'], r.Gate || '', 'pending', ''].join(' | ') + ' |\n';
}
const contractsPath = opt('--contracts-out', path.join(path.dirname(outPath), 'task-contracts.json'));
let contracts;
try {
  contracts = buildContracts(kept, {
    route,
    job,
    questionIds: researchDecision && researchDecision.work || [],
    inputRevision: route.inputRevision || job.revision || null,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
// Keep the existing Markdown table stable for readers and older scripts.  The sidecar is
// the enforced machine contract and is linked from the frozen plan without adding columns.
out += '<!-- task-contracts: ' + path.basename(contractsPath) + ' -->\n';
fs.writeFileSync(outPath, out);
fs.mkdirSync(path.dirname(contractsPath), { recursive: true });
fs.writeFileSync(contractsPath, JSON.stringify({
  contractVersion: '1.0',
  jobId: route.jobId || job.jobId || null,
  workflowId: route.workflowId,
  workflowVersion: route.workflowVersion || null,
  routeRevision: route.revision || null,
  researchDecision: researchDecision || null,
  tasks: contracts,
}, null, 2) + '\n');
const fwd = s => s.split(path.sep).join('/');
if (process.argv.includes('--human')) {
  const gates = (route.gates || []).length;
  console.log('Planned: ' + kept.length + ' step' + (kept.length === 1 ? '' : 's') + ', ' +
    (gates ? gates + ' of them waiting on you.' : 'none of them waiting on you.'));
}
console.log('ok: ' + kept.length + ' of ' + rows.length + ' stages kept for ' + route.workflowId + ' (tags: ' + [...tags].join(', ') + ')');
console.log('wrote ' + fwd(outPath));
console.log('wrote ' + fwd(contractsPath));
const { advance } = require('./lib-advance.js');
advance(path.dirname(routePath), 'PLANNED', {
  by: 'planner',
  note: 'Planned ' + kept.length + ' stage' + (kept.length === 1 ? '' : 's') + '.',
});
