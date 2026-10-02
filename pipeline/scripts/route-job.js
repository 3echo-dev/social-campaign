#!/usr/bin/env node
// Deterministic router: job.json -> route.json. Rules override the model.
//
//   node route-job.js <job.json> [--out <route.json>] [--config <CONFIG.md>]
//
// Exit codes: 0 ROUTED · 3 NEEDS_CLARIFICATION · 4 UNSUPPORTED · 1 internal error · 2 usage
// The producer may append to modelAddedRiskFlags. It never edits anything else and never
// raises confidence.
const fs = require('fs');
const path = require('path');
const { validate } = require('./validate-schema.js');
const research = require('./lib-brand-research.js');
const execution = require('./lib-execution-availability.js');
const brandProfile = require('./lib-brand-profile.js');
const kinds = require('./lib-kinds.js');
const deliverable = require('./lib-deliverable.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const jobPath = args.find(a => !a.startsWith('--'));
if (!jobPath) {
  console.error('usage: route-job.js <job.json> [--out <route.json>] [--config <CONFIG.md>] [--no-record]');
  process.exit(2);
}
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const outPath = opt('--out', path.join(path.dirname(jobPath), 'route.json'));
const cfgPath = opt('--config', path.join(ROOT, 'CONFIG.md'));

function readConfig(file) {
  const cfg = {};
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return cfg; }
  const m = txt.match(/```yaml\r?\n([\s\S]*?)```/);
  if (!m) return cfg;
  for (const raw of m[1].split(/\r?\n/)) {
    if (/^\s/.test(raw)) continue;                       // nested keys are not used by scripts
    const line = raw.replace(/#.*$/, '').trimEnd();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v === '') continue;
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (!isNaN(Number(v))) v = Number(v);
    cfg[k] = v;
  }
  return cfg;
}

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
let job, schema, routeSchema, agentsReg, workflowsReg;
try {
  job = readJson(jobPath);
  schema = readJson(path.join(ROOT, 'schemas', 'job.schema.json'));
  routeSchema = readJson(path.join(ROOT, 'schemas', 'route.schema.json'));
  agentsReg = readJson(path.join(ROOT, 'registry', 'agents.json'));
  workflowsReg = readJson(path.join(ROOT, 'registry', 'workflows.json'));
} catch (e) {
  console.error('cannot read inputs: ' + e.message);
  process.exit(1);
}
// This is deliberately before research, routing writes, pane progress, or state advancement.
// Old job kinds remain readable by the schemas, but a new route must fail in a bounded way.
const availability = execution.checkExecutionAvailability({ job, workflows: workflowsReg.workflows });
if (!availability.available) {
  console.error('UNSUPPORTED: ' + availability.message);
  process.exit(4);
}
const cfg = readConfig(cfgPath);
const threshold = typeof cfg.route_confidence_threshold === 'number' ? cfg.route_confidence_threshold : 0.8;
const platformsV1 = Array.isArray(cfg.platforms_v1) ? cfg.platforms_v1 : ['facebook', 'instagram', 'tiktok'];

const R = {
  schemaVersion: '1.0', jobId: job.jobId || null, status: null,
  workflowId: null, workflowVersion: null,
  requiredDisciplines: [], owner: null, support: [],
  riskFlags: [], modelAddedRiskFlags: [], gates: [],
  confidence: 1, missingFields: [], unsupported: [], rationale: [], researchDepth: null,
  researchDecision: null,
  createdAt: new Date().toISOString(),
};
const say = s => R.rationale.push(s);
const need = d => { if (!R.requiredDisciplines.includes(d)) R.requiredDisciplines.push(d); };
const flag = f => { if (!R.riskFlags.includes(f)) R.riskFlags.push(f); };
const missing = f => { if (!R.missingFields.includes(f)) R.missingFields.push(f); };
const agentFor = disc => agentsReg.agents.find(a => a.discipline === disc);

// The brand's own directory, two levels above <brand>/jobs/<jobId>/job.json. Used below to
// fall back to the brand profile's audience, and further down for evidence and research.
const brandDir = path.resolve(path.dirname(jobPath), '..', '..');

const kindEntry = kinds.kindOf(job.kind);
const producesContent = kinds.makesContent(job.kind);
// A kind whose pictures or video the person already has (publish_post). The files were copied into
// the job when it was created, so the rules about making, researching and planning content do not
// apply to it; every rule below that is skipped for it says so.
const supplied = kinds.suppliesMedia(job.kind);
const suppliedFiles = Array.isArray(job.suppliedMedia) ? job.suppliedMedia : [];
const hasCaption = typeof job.caption === 'string' && job.caption.trim().length > 0;

// Rule 1: schema and v1 platforms
for (const e of validate(schema, job)) {
  const field = e.path.replace(/^\$\.?/, '');
  if (e.keyword === 'required') missing(field);
  else missing(field + ' (' + e.message + ')');
}
for (const field of kinds.missingFields(job)) missing(field);
if (producesContent) {
  for (const p of job.platforms || []) {
    if (!platformsV1.includes(p)) { R.unsupported.push('platform:' + p); say('Rule 1: platform ' + p + ' is not in platforms_v1 ' + JSON.stringify(platformsV1)); }
  }
}
// The schema cannot say "required when creativeDiscipline is ugc" in the subset
// validate-schema.js understands, and the answer decides which stages run, so rule 1 asks for it.
for (const d of Array.isArray(job.deliverables) ? job.deliverables : []) {
  if (d && d.creativeDiscipline === 'ugc' && !d.ugcSource) missing('deliverables.' + (d.id || '?') + '.ugcSource');
}
// Rule 1c: every deliverable that becomes a post carries one fixed post type, chosen at the start
// of the job (an Instagram reel, a TikTok video). The schema's enum is the union of all of them, so
// the platform it belongs to, the media it needs and the missing case are asked here. A post type
// that cannot be what the deliverable is, or no post type at all, goes back to the person as a
// question about the deliverable; publishing never offers another one. An older job's post type
// that can only be one thing (a TikTok video) is read as that, the same way the board reads it,
// so only the ones that could be several are asked.
const seenJob = deliverable.withDerivedPlacements(job);
for (const d of Array.isArray(seenJob.deliverables) ? seenJob.deliverables : []) {
  if (!d || typeof d !== 'object') continue;
  if (d.placement === undefined || d.placement === null) {
    if (deliverable.publishable(seenJob, d)) missing(deliverable.missingPlacementLabel(d, seenJob));
    continue;
  }
  for (const reason of deliverable.placementProblems(d, seenJob)) missing(deliverable.placementProblemLabel(d, reason, seenJob));
}
// Rule 1b: audience is optional on the job; it only narrows the brand's own audience for this
// brief. A job with none of its own falls back to the brand profile, so the router asks for
// one only when neither side has one.
const jobAudienceDescription = job.audience && typeof job.audience.description === 'string' ? job.audience.description.trim() : '';
if (supplied) {
  say('Rule 1b: a post made from supplied files needs no audience, so none is asked for');
} else if (producesContent && !jobAudienceDescription) {
  let brandAudience = '';
  try {
    const profile = brandProfile.read(brandDir);
    const ctx = profile && brandProfile.context(profile);
    brandAudience = ctx && typeof ctx.audience === 'string' ? ctx.audience.trim() : '';
  } catch { /* no readable brand profile; fall through to missing */ }
  if (!brandAudience) missing('audience');
  else say('Rule 1b: the job has no audience of its own, so it uses the brand profile\'s audience');
}
if (R.missingFields.length) say('Rule 1: missing or invalid fields: ' + R.missingFields.join(', '));

// Rule 2: does this kind produce content
say('Rule 2: kind ' + job.kind + ' producesContent=' + producesContent);
const dels = Array.isArray(job.deliverables) ? job.deliverables : [];
// A supplied-media job is already asked for its files and its platforms by rule 1, and its deliverables follow from those two, so it is not also asked for deliverables.
// Words alone on Facebook (a caption, no file) have no file to ask for, so they keep this rule.
const wordsAlone = hasCaption && Array.isArray(job.platforms) && job.platforms.length > 0 && job.platforms.every(p => p === 'facebook');
if (producesContent && dels.length === 0 && !(supplied && !wordsAlone && (suppliedFiles.length === 0 || !(Array.isArray(job.platforms) && job.platforms.length)))) { missing('deliverables (at least one)'); say('Rule 2: a content job needs at least one deliverable'); }

// Rule 3: paid distribution
if (['paid', 'both'].includes(job.distribution) && producesContent) {
  need('ads'); flag('paid_spend');
  say('Rule 3: paid distribution adds ads and flags paid_spend; budget and landingPageUrl become required');
  if (!job.budget) missing('budget');
  if (!job.landingPageUrl) missing('landingPageUrl');
}

// Rule 4: UGC deliverable. Current UGC is generated, so it carries the synthetic-person flag
// and the AI-label policy path. Retired real-creator inputs are rejected by the availability
// guard above rather than being silently converted into generated UGC.
const ugcDels = supplied ? [] : dels.filter(d => d.creativeDiscipline === 'ugc');
if (ugcDels.length) {
  need('ugc');
  R.deliverableModes = ugcDels.map(d => ({ id: d.id, mode: 'ai_generated' }));
  flag('synthetic_person');
  say('Rule 4: a UGC deliverable adds ugc and flags synthetic_person (v1 UGC is generated, so disclosure applies)');
}

const TALKING_KINDS = ['ugc', 'brand_video'];
const talkingDels = supplied ? [] : dels.filter(d => d.talkingCharacter === true && TALKING_KINDS.includes(d.creativeDiscipline));
for (const d of supplied ? [] : dels) {
  if (d.talkingCharacter === true && !TALKING_KINDS.includes(d.creativeDiscipline)) {
    say('Rule 4b: deliverable ' + (d.id || '?') + ' is marked talkingCharacter but is not a ugc or brand_video deliverable, so the mark is ignored');
  }
}
if (talkingDels.length) {
  say('Rule 4b: ' + talkingDels.map(d => d.id).join(', ') + ' has a character speaking in the clips (dialogue generated in the clip, no separate voiceover stage)');
}
if (talkingDels.length) {
  flag('synthetic_person');
  say('Rule 4b: a generated character speaks, so synthetic_person is flagged and disclosure applies');
}

// Rule 5: organic distribution
if (supplied) {
  // The post goes out as it is, so the copywriter is needed only when the person gave no caption.
  flag('external_publish');
  if (!hasCaption) need('social_post');
  say('Rule 5: supplied files are posted as they are and flag external_publish; ' + (hasCaption ? 'the person gave the caption, so no caption is written' : 'no caption was given, so social_post writes one'));
} else if (['organic', 'both'].includes(job.distribution) && producesContent) {
  need('social_post'); flag('external_publish');
  say('Rule 5: organic distribution adds social_post and flags external_publish');
}

// Rule 6: video must be inspected
const refs = Array.isArray(job.sourceRefs) ? job.sourceRefs : [];
if (supplied) {
  say('Rule 6: supplied files are not inspected, repurposed or rendered, so video_intelligence is not added');
} else if (job.kind === 'content_repurpose' || refs.some(kinds.isVideoSource) ||
    dels.some(d => ['ugc', 'brand_video'].includes(d.creativeDiscipline))) {
  need('video_intelligence');
  say('Rule 6: video is inspected, repurposed or rendered, so video_intelligence is added');
}
const unownedProductAsset = job.productAsset && typeof job.productAsset === 'object' && job.productAsset.ownedByBrand === false;
const unownedAndShipped = s => s.ownedByBrand === false &&
  (s.usedInPost !== false || (job.kind === 'content_repurpose' && kinds.isVideoSource(s)));
if (unownedProductAsset || refs.some(unownedAndShipped)) {
  flag('licensed_media');
  say('Rule 6b: a product photo or a source the brand does not own, and that is not only a reference, flags licensed_media');
}

// Rule 6c: a picture of the product, before anything expensive.
// The board never draws the product from a description, so a media job without one cannot
// finish. Finding that out at the storyboard stage wasted a whole run.
const needsMedia = dels.some(d => d.creativeDiscipline !== 'text_only');
const asset = job.productAsset;
const subject = job.subject === 'character' || job.subject === 'none' ? job.subject : 'product';
let blockedOnAsset = false;
// A repurpose job cuts frames out of footage that already exists, so it needs no product
// still. This applies to media the pipeline generates.
const generatesMedia = producesContent && needsMedia && subject !== 'none' && kinds.needsProductPhoto(job.kind);
if (generatesMedia) {
  const assetPath = asset && typeof asset === 'object' ? asset.path : asset;
  const thing = subject === 'character' ? 'character picture' : 'product photo';
  if (!assetPath) {
    if (subject === 'character') {
      say('Rule 6c: a character job with no reference picture is not blocked; reference art comes first');
    } else {
      blockedOnAsset = true;
      R.blockers = (R.blockers || []).concat('a photo of the product');
      say('Rule 6c: this job makes pictures or video, and no ' + thing + ' is recorded');
    }
  } else if (!path.isAbsolute(assetPath) && !/^https?:/i.test(assetPath) &&
             !fs.existsSync(path.resolve(path.dirname(jobPath), '..', '..', '..', '..', assetPath)) &&
             !fs.existsSync(path.resolve(assetPath))) {
    blockedOnAsset = true;
    R.blockers = (R.blockers || []).concat('the ' + thing + ' at ' + assetPath + ', which is not there');
    say('Rule 6c: productAsset names a file that does not exist');
  }
}

// Rule 6d: a source file that was named but never arrived fails at stage 6 otherwise.
for (const s of refs) {
  const uri = s && s.uri;
  if (!uri || /^[a-z][a-z0-9+.-]+:/i.test(uri)) continue;
  const here = path.resolve(uri);
  const nearJob = path.resolve(path.dirname(jobPath), uri);
  if (!fs.existsSync(here) && !fs.existsSync(nearJob)) {
    R.blockers = (R.blockers || []).concat('the file ' + uri + ', which is not there');
    say('Rule 6d: sourceRefs names a local file that does not exist: ' + uri);
  }
}

// Rule 7: how much research, if any. Skipped while blocked, so a job that cannot finish
// never spawns research first.
//
// This used to add four workstreams to every content job unless the user asserted evidence
// existed, and an onboarded brand did not count. One TikTok pulled four agents and most of
// what came back was "Not verified", because the answers were already in the brand files.
function countRows(file, headerMatch) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let inTable = false, n = 0;
    for (const line of lines) {
      if (!inTable) { if (headerMatch.test(line)) inTable = true; continue; }
      // The first line that is not a table row ends the table. Reading on would count the
      // next table's header as a proof point on a brand whose own table is still empty.
      if (!line.trim().startsWith('|')) break;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (!cells.length || cells.every(c => /^:?-+:?$/.test(c))) continue;
      // A row counts when it carries a value and a source, and neither is the placeholder.
      const filled = cells.filter(c => c && !/^unknown$/i.test(c));
      if (filled.length >= 2) n++;
    }
    return n;
  } catch { return 0; }
}

const proofPoints = countRows(path.join(brandDir, 'brand', 'positioning.md'), /^\s*\|\s*Proof\s*\|/i);
const verbatim = countRows(path.join(brandDir, 'brand', 'audience.md'), /^\s*\|\s*Phrase\s*\|/i);
const evidenceBearing = proofPoints >= 3 && verbatim >= 1;

if (supplied) {
  say('Rule 7: supplied files need no research');
} else if (producesContent && !blockedOnAsset) {
  const paid = R.requiredDisciplines.includes('ads');
  const makesVideo = dels.some(d => ['ugc', 'brand_video', 'video', 'motion_graphic'].includes(d.creativeDiscipline));
  let decision;
  try {
    decision = research.routeDecision(brandDir, { job, now: new Date() });
  } catch (error) {
    decision = {
      action: 'dispatch', zeroCall: false, workRequired: true,
      researchDepth: paid || makesVideo ? 'full' : 'lite', questionIds: [],
      counts: { reused: 0, adapted: 0, refreshed: 0, missing: 1, excluded: 0 },
      reasons: [{ reason: 'Evidence decision failed: ' + error.message }],
      consideredEvidence: [], acceptedEvidence: [], refreshRequired: [],
      gaps: [{ question: 'Research decision', reason: error.message, required: true, decision: 'missing' }],
      stop: 'required_gap', policyVersion: research.POLICY_VERSION,
    };
  }
  const work = decision.questions && decision.questions.length
    ? decision.questions.filter(item => ['refresh', 'missing', 'excluded'].includes(item.decision)).map(item => ({
      id: item.id || item.questionId || null,
      questionId: item.id || item.questionId || null,
      target: item.target || null,
      reason: item.reason || 'Evidence is not ready for this request.',
      decision: item.decision || 'missing',
    }))
    : [...(decision.gaps || []), ...(decision.refreshRequired || [])].map(item => ({
      id: item.questionId || item.evidenceId || null,
      questionId: item.questionId || null,
      target: item.target || null,
      reason: item.reason || 'Evidence is not ready for this request.',
      decision: item.decision || 'missing',
    }));
  R.researchDecision = {
    action: decision.action,
    status: decision.workRequired ? 'required' : 'current',
    required: Boolean(decision.workRequired),
    needsResearch: Boolean(decision.workRequired),
    dispatch: Boolean(decision.workRequired),
    reuseOnly: !decision.workRequired,
    zeroCall: Boolean(decision.zeroCall),
    work,
    questionIds: decision.questionIds || [],
    questions: decision.questions || [],
    counts: decision.counts || {},
    reasons: decision.reasons || [],
    consideredEvidence: decision.consideredEvidence || [],
    acceptedEvidence: decision.acceptedEvidence || [],
    refreshRequired: decision.refreshRequired || [],
    gaps: decision.gaps || [],
    budget: decision.budget || null,
    stop: decision.stop || null,
    policyVersion: decision.policyVersion || research.POLICY_VERSION,
  };
  if (decision.workRequired) {
    need('research');
    if (paid) {
      if (decision.researchDepth === 'full') say('Rule 7: paid work gets full research, whatever the brand files hold');
      else say('Rule 7: paid work has uncovered evidence questions, so bounded research is dispatched');
    } else if (makesVideo) {
      if (decision.researchDepth === 'full') {
        say('Rule 7: a video job gets full research, because what is working on the platform ' +
            'right now is not in the brand files');
      } else say('Rule 7: the video request has uncovered platform or claim questions, so bounded research is dispatched');
    } else if (job.evidence && job.evidence.supplied === true) {
      R.researchDepth = 'lite';
      say('Rule 7: the request points at material that answers the claims, so one workstream checks it rather than four');
    } else if (decision.researchDepth === 'lite' && evidenceBearing) {
      R.researchDepth = 'lite';
      say('Rule 7: the brand files already carry ' + proofPoints + ' sourced proof points and ' +
          verbatim + ' verbatim customer phrases, so one workstream checks the uncovered questions');
    } else {
      R.researchDepth = 'lite';
      say('Rule 7: the brand files are thin (' + proofPoints + ' sourced proof points, ' + verbatim +
          ' verbatim phrases), so one research workstream is added rather than four');
    }
    if ((job.requiredClaims || []).length && refs.length === 0) { flag('missing_source'); say('Rule 7: required claims with no sourceRefs flags missing_source'); }
  } else {
    R.researchDepth = 'reuse';
    say('Rule 7: current applicable evidence covers the material questions; research completes with zero external calls');
  }
}

// Rule 8: strategy for campaigns, series, multi-platform, multi-persona
const personas = ((job.audience || {}).personas || []);
if (!supplied && producesContent && (['paid_campaign', 'organic_series'].includes(job.kind) || (job.platforms || []).length > 1 || personas.length > 1)) {
  need('strategy');
  say('Rule 8: campaign, series, more than one platform or persona, so strategy is added');
}

// Rule 9: previously supplied historical material is scoped, read-only context. It does not
// dispatch an analyst or grant permission to calculate a new performance report.
if (job.usesHistoricalData === true) {
  say('Rule 9: supplied historical material remains read-only context; no performance analysis is dispatched');
}

// Rule 10: unsupported creative disciplines or inactive agents
const map = agentsReg.disciplineForCreativeDiscipline || {};
// A carousel maps to a planned agent, but a supplied set of pictures is not made by any discipline agent.
for (const d of supplied ? [] : dels) {
  const disc = map[d.creativeDiscipline];
  const a = disc ? agentFor(disc) : null;
  if (!a || a.status !== 'active') {
    R.unsupported.push('creativeDiscipline:' + d.creativeDiscipline + ' needs ' + (disc || 'unknown') + ' (' + (a ? a.status : 'no agent') + ')');
    say('Rule 10: deliverable ' + (d.id || '?') + ' needs a discipline that is not active in v1');
  }
}

// Rule 11: owner and support
const ownerA = kindEntry && kindEntry.owner ? agentsReg.agents.find(a => a.agentId === kindEntry.owner) : null;
if (ownerA) { R.owner = ownerA.agentId; need(ownerA.discipline); }
else if (job.kind) { R.unsupported.push('kind:' + job.kind + ' has no owner agent'); say('Rule 11: no owner agent for kind ' + job.kind); }
for (const disc of R.requiredDisciplines) {
  const a = agentFor(disc);
  if (!a || a.status !== 'active') R.unsupported.push('discipline:' + disc + ' is ' + (a ? a.status : 'unknown'));
}
const order = agentsReg.disciplineOrder || [];
R.requiredDisciplines.sort((a, b) => order.indexOf(a) - order.indexOf(b));
R.support = R.requiredDisciplines
  .filter(d => !ownerA || d !== ownerA.discipline)
  .map(d => agentFor(d)).filter(Boolean).map(a => a.agentId);
// A supplied post has no editor pass: the person checks their own files, and the plugin checks their shape.
if (producesContent && !supplied && agentFor('review')) R.support.push(agentFor('review').agentId);
say('Rule 11: owner ' + (R.owner || 'none') + '; support ' + (R.support.join(', ') || 'none'));

// Rule 12: confidence
let conf = 1 - 0.15 * R.missingFields.length;
const words = String(job.request || '').trim().split(/\s+/).filter(Boolean).length;
if (producesContent && words < 12 && dels.length === 0) { conf -= 0.3; say('Rule 12: request under 12 words with no deliverables'); }
R.confidence = Math.max(0, Math.round(conf * 100) / 100);
if (R.confidence < threshold) flag('ambiguous_request');
say('Rule 12: confidence ' + R.confidence + ' (threshold ' + threshold + ')');

// Workflow selection
const wf = kindEntry && kindEntry.workflowId ? workflowsReg.workflows.find(w => w.workflowId === kindEntry.workflowId) : null;
if (!wf) { if (job.kind) R.unsupported.push('kind:' + job.kind + ' has no workflow'); }
else if (wf.status !== 'active') { R.unsupported.push('workflow:' + wf.workflowId + ' is ' + wf.status); }
else { R.workflowId = wf.workflowId; R.workflowVersion = wf.version; }

// Rule 13: status. A blocker outranks a missing field: there is a specific thing to fetch.
if (R.unsupported.length) R.status = 'UNSUPPORTED';
else if ((R.blockers || []).length) R.status = 'BLOCKED';
else if (R.missingFields.length || R.confidence < threshold) R.status = 'NEEDS_CLARIFICATION';
else R.status = 'ROUTED';
say('Rule 13: status ' + R.status);

// Rule 14: gates
if (wf && wf.status === 'active') {
  let gates = [...(wf.gates || [])];
  const needsMedia = dels.some(d => d.creativeDiscipline !== 'text_only');
  if (!R.requiredDisciplines.includes('ugc')) gates = gates.filter(g => g !== 'concept');
  if (!needsMedia) gates = gates.filter(g => g !== 'storyboard');
  if (!R.requiredDisciplines.includes('ads')) gates = gates.filter(g => !g.startsWith('campaign_'));
  // The publish gate is never merged into the content gate, even when a schedule is present and even when the
  // person posts it themselves: its approval covers the exact posting plan (publish/intent.json), and that
  // approval is what lets Claude upload the job's media to the person's 3echo workspace.
  if (gates.includes('publish')) say('Rule 14: the publish gate stays its own approval, whether or not a schedule is present');
  R.gates = gates;
  say('Rule 14: gates ' + (gates.join(', ') || 'none'));
}

// Self-check and write
const selfErrs = validate(routeSchema, R);
if (selfErrs.length) {
  console.error('internal error: route.json fails its own schema: ' + selfErrs.map(e => e.path + ' ' + e.message).join('; '));
  process.exit(1);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(R, null, 2) + '\n');

const fwd = s => s.split(path.sep).join('/');
// --human is the line a skill reads out. It names no workflow id, no discipline and no
// confidence number, because none of those mean anything to the person who asked.
if (args.includes('--human')) {
  if (R.status === 'ROUTED') {
    const gates = R.gates.length
      ? 'I will stop and ask you ' + R.gates.length + ' time' + (R.gates.length === 1 ? '' : 's') + ' along the way.'
      : 'Nothing here needs your approval.';
    console.log('I can do this. ' + gates);
  } else if (R.status === 'BLOCKED') {
    console.log('I need ' + R.blockers.join(', and ') + ' before I can make this.');
  } else if (R.status === 'NEEDS_CLARIFICATION') {
    // A post type entry carries a path the board maps back to its form; the person reads its words only.
    const asks = R.missingFields.map(deliverable.placementEntryWords).filter(Boolean);
    const rest = R.missingFields.filter(f => !deliverable.placementEntryWords(f));
    console.log([rest.length ? 'I need a bit more before I start: ' + rest.join(', ') + '.' : '', ...asks.map(a => (/[?.]$/.test(a) ? a : a + '.'))].filter(Boolean).join(' '));
  } else {
    console.log('I cannot make this: ' + R.unsupported.join('; ') + '.');
  }
}
console.log(R.status + ': ' + (R.workflowId || '-') + ' · owner ' + (R.owner || '-') + ' · support [' + R.support.join(', ') + '] · gates [' + R.gates.join(', ') + '] · confidence ' + R.confidence);
// The plain second line, for the skill to quote instead of the first.
if ((R.blockers || []).length) {
  console.log('I need ' + R.blockers.join(', and ') + ' before I can make this.');
}
if (R.missingFields.length) console.log('missing: ' + R.missingFields.join(', '));
if (R.unsupported.length) console.log('unsupported: ' + R.unsupported.join('; '));
console.log('wrote ' + fwd(outPath));
// The router is the only thing that knows the job is routed, so it records it. Leaving
// that to the caller cost one run its next step, refused as an illegal state jump.
const { advance } = require('./lib-advance.js');
const earned = { ROUTED: 'ROUTED', NEEDS_CLARIFICATION: 'NEEDS_CLARIFICATION',
  UNSUPPORTED: 'UNSUPPORTED', BLOCKED: 'BLOCKED' }[R.status];
const recording = !args.includes('--no-record');
if (earned && recording) {
  advance(path.dirname(jobPath), earned, {
    by: 'router',
    note: earned === 'ROUTED' ? ('Routed to ' + (R.workflowId || 'a workflow') + '.') : undefined,
  });
}
const code = R.status === 'ROUTED' ? 0
  : (R.status === 'NEEDS_CLARIFICATION' || R.status === 'BLOCKED') ? 3
  : 4;

/**
 * A job that cannot go on says so in the pane, not only in the chat.
 *
 * The router refused for want of a photo of the product, and said so plainly in the chat,
 * while the page went on drawing "Getting your brief, Working" with a spinner. The person
 * was waiting on the run and the run was waiting on them.
 *
 * When what is missing is a photo of the product, the page can take it: the card carries a
 * drop area, a click-to-choose control, and the two named ways on for somebody with no
 * photo to hand. Before that the only way to satisfy this rule was to find a folder on
 * your own machine, and the run printed the path at a person sitting in a browser.
 *
 * A blocker the page cannot take, such as a source file that never arrived, is still said
 * as what it is: your turn, and here is why.
 */
async function sayWhyItStopped() {
  if (!(R.blockers || []).length) return;
  const gate = require('./lib-gate.js');
  const jobId = path.basename(path.dirname(path.resolve(jobPath)));

  // The chat line names the file that is missing; the pane never carries a file name, so
  // it gets the same sentence with the missing photo said as a thing rather than a path.
  const forThePane = blockedOnAsset && R.blockers.length === 1
    ? 'I need a ' + (subject === 'character' ? 'picture of the character' : 'photo of the product') + ' before I can make this.'
    : 'I need ' + R.blockers.join(', and ') + ' before I can make this.';
  await gate.call('progress', {
    key: jobId,
    stage: 'getting-your-brief',
    substep: forThePane.slice(0, 160),
    status: 'waiting',
    fromState: true,
  }, { argv: process.argv });

  if (!blockedOnAsset || subject === 'character') return;
  // Asking is a separate script because it must not ask over a card already waiting: this
  // is the question people take longest over, since they have to go and find a photo first.
  const { spawnSync } = require('child_process');
  const rootAt = process.argv.indexOf('--root');
  spawnSync(process.execPath, [
    path.join(__dirname, 'ask-product-photo.js'), jobId,
    ...(rootAt >= 0 && process.argv[rootAt + 1] ? ['--root', process.argv[rootAt + 1]] : []),
  ], { stdio: 'inherit' });
}

(recording ? sayWhyItStopped() : Promise.resolve())
  // The pane is never allowed to fail the routing it is reporting on.
  .catch(() => {})
  .then(() => process.exit(code));
