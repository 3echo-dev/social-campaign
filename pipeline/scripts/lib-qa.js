// Shared editor QA policy.
//
// Mechanical checks, an independent editor and a human gate have different jobs.  This
// module keeps their decision vocabulary in one place: advisory findings are visible but
// do not restart work, blocking findings get one targeted correction and focused recheck,
// and a persistent blocker pauses the affected deliverable instead of being auto-approved.
const crypto = require('crypto');
const deps = require('./lib-dependencies.js');
const { canonicalArtifactRefs } = require('./lib-revision-targets.js');

const BLOCKING_SEVERITIES = new Set(['blocker', 'blocking', 'critical', 'high', 'fail', 'error']);

function reasonFor(finding) {
  return String(finding && (finding.reasonCode || finding.code || finding.reason || 'UNKNOWN')).trim() || 'UNKNOWN';
}

function artifactFor(finding) {
  return canonicalArtifactRefs(finding && (finding.artifactRefs || finding.artifactRef || finding.scope || finding.artifact));
}

function revisionFor(finding) {
  return String(finding && (finding.artifactRevision || finding.revision || '')).trim() || null;
}

function findingId(finding) {
  if (finding && finding.id) return String(finding.id);
  const input = {
    reasonCode: reasonFor(finding),
    artifactRefs: artifactFor(finding),
    artifactRevision: revisionFor(finding),
    check: finding && (finding.check || finding.rule || null),
    location: finding && (finding.location || null),
  };
  return 'finding-' + crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

function isBlocking(finding) {
  if (finding && finding.blocking === true) return true;
  return BLOCKING_SEVERITIES.has(String(finding && finding.severity || '').toLowerCase());
}

function consolidateFindings(findings, options = {}) {
  const unique = new Map();
  for (const original of Array.isArray(findings) ? findings : []) {
    const finding = {
      ...original,
      id: findingId(original),
      reasonCode: reasonFor(original),
      artifactRefs: artifactFor(original),
      artifactRevision: revisionFor(original),
      severity: String(original && original.severity || (original && original.blocking ? 'blocking' : 'advisory')).toLowerCase(),
    };
    const prior = unique.get(finding.id);
    if (!prior || (isBlocking(finding) && !isBlocking(prior))) unique.set(finding.id, finding);
  }
  const all = [...unique.values()];
  const blocking = all.filter(isBlocking);
  const advisory = all.filter(f => !isBlocking(f));
  const correctionPass = Number.isSafeInteger(options.correctionPass) ? options.correctionPass : 0;
  const maxCorrectionPasses = Number.isSafeInteger(options.maxCorrectionPasses) ? options.maxCorrectionPasses : 1;
  const scope = canonicalArtifactRefs((blocking.length ? blocking : advisory).flatMap(artifactFor));
  return {
    findings: all,
    blocking,
    advisory,
    blockingCount: blocking.length,
    advisoryCount: advisory.length,
    verdict: blocking.length ? 'NEEDS REVISION' : 'GO',
    correctionPass,
    maxCorrectionPasses,
    correctionAllowed: blocking.length > 0 && correctionPass < maxCorrectionPasses,
    correctionScope: scope,
    recheckScope: scope,
  };
}

function correctionPlan(result, options = {}) {
  const pass = Number.isSafeInteger(options.correctionPass) ? options.correctionPass : result && result.correctionPass || 0;
  const review = result && result.blocking ? result : consolidateFindings(result && result.findings || [], { ...options, correctionPass: pass });
  if (!review.blocking.length) {
    return { status: 'GO', correctionPass: pass, findings: review.findings, advisory: review.advisory, recheckScope: [] };
  }
  if (pass >= (options.maxCorrectionPasses ?? 1)) {
    return {
      status: 'PAUSED',
      reason: 'blocking_finding_persists_after_focused_recheck',
      correctionPass: pass,
      findings: review.findings,
      blocking: review.blocking,
      advisory: review.advisory,
      recheckScope: review.recheckScope,
    };
  }
  return {
    status: 'CORRECTION_REQUIRED',
    correctionPass: pass + 1,
    findings: review.findings,
    blocking: review.blocking,
    advisory: review.advisory,
    correctionScope: review.correctionScope,
    recheckScope: review.recheckScope,
    targetTaskKeys: [...new Set(review.blocking.map(f => f.targetTask || f.taskKey).filter(Boolean))],
  };
}

function focusedRecheck(result, findings, options = {}) {
  const prior = result || {};
  const review = consolidateFindings(findings, {
    correctionPass: Number.isSafeInteger(options.correctionPass) ? options.correctionPass : (prior.correctionPass || 1),
    maxCorrectionPasses: options.maxCorrectionPasses ?? 1,
  });
  const allowed = new Set(canonicalArtifactRefs(options.scope || prior.recheckScope || []));
  const outOfScope = review.findings.filter(f => allowed.size && !f.artifactRefs.some(ref => allowed.has(ref)));
  if (outOfScope.length) {
    return {
      ...review,
      verdict: 'PAUSED',
      status: 'PAUSED',
      reason: 'recheck_reported_unassigned_artifact',
      outOfScope,
    };
  }
  const decision = correctionPlan(review, { correctionPass: options.correctionPass ?? 1, maxCorrectionPasses: options.maxCorrectionPasses ?? 1 });
  return { ...review, ...decision, status: decision.status };
}

function mechanicalResult(result, input) {
  return deps.cachedResult({ ...result, status: result && result.status || 'complete' }, input);
}

function canReuseMechanicalResult(result, input) {
  return deps.canReuseMechanicalResult(result, input);
}

function invalidateForChanges(plan, changedRefs, cachedChecks = []) {
  const affectedTaskKeys = deps.affectedTaskKeys(plan, changedRefs, { includeOutputs: true });
  const affected = new Set(affectedTaskKeys);
  return {
    affectedTaskKeys,
    checks: cachedChecks.map(check => ({
      ...check,
      status: affected.has(check.taskKey) || canonicalArtifactRefs(check.artifactRefs || check.artifactRef)
        .some(ref => canonicalArtifactRefs(changedRefs).some(changed => deps.sameRef(ref, changed)))
        ? 'invalidated' : check.status,
    })),
  };
}

module.exports = {
  BLOCKING_SEVERITIES,
  findingId,
  isBlocking,
  consolidateFindings,
  correctionPlan,
  focusedRecheck,
  mechanicalResult,
  canReuseMechanicalResult,
  invalidateForChanges,
};
