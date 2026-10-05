const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const durable = require('./lib-durable.js');
const profiles = require('./lib-brand-profile.js');
const capabilities = require('./lib-research-capabilities.js');
const budgets = require('./lib-research-budget.js');
const execution = require('./lib-execution-availability.js');

const MAX_RESEARCH_BYTES = 60000;
const POLICY_VERSION = 'research-policy-v2';
const DEFAULT_FRESHNESS_DAYS = Object.freeze({
  brand_identity: 365,
  competitor_identity: 90,
  competitor_activity: 14,
  product_claims: 30,
  audience: 90,
  recent_posts: 14,
  platform_assumptions: 30,
  strategy: 90,
  offer: 1,
});
const FINDING_KEYS = Object.freeze([
  'summary', 'strategy', 'voice', 'visualIdentity', 'contentPillars',
  'postAudit', 'campaignDecomposition', 'competitorRationale',
]);
const DECISIONS = new Set(['reuse', 'adapt', 'refresh', 'missing', 'excluded']);
const VALIDITY = new Set(['current', 'stale', 'superseded', 'disputed', 'historical', 'unknown']);
const SCOPE_KEYS = Object.freeze([
  'brand', 'product', 'productVariant', 'service', 'market', 'geography', 'language',
  'audience', 'segment', 'customerSegment', 'objective', 'funnelStage', 'platform',
  'platforms', 'placement', 'placements', 'format', 'formats', 'distribution',
  'offer', 'offerVersion', 'campaignPeriod', 'timeWindow', 'brandProfileVersion',
  'strategyVersion', 'ruleVersion', 'channels', 'deliverables', 'label',
]);
const SCOPE_ALIASES = Object.freeze({
  channel: 'channels',
  platformRuleVersion: 'ruleVersion',
  platformRulesVersion: 'ruleVersion',
  campaignWindow: 'campaignPeriod',
  period: 'campaignPeriod',
  funnel: 'funnelStage',
});

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function asText(value, label, limit = 6000) {
  if (typeof value !== 'string' || value.length > limit) throw new Error(label + ' must be text under ' + limit + ' characters.');
  return value.trim();
}

function asDate(value, label) {
  const stamp = new Date(value);
  if (!value || Number.isNaN(stamp.getTime())) throw new Error(label + ' needs a valid timestamp.');
  return stamp.toISOString();
}

function clockNow(options = {}) {
  const value = options.clock ? options.clock() : options.now;
  return value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
}

function normalizeList(value, label, max = 40) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(label + ' must be a short list.');
  }
  return [...new Set(value.map(item => item.trim()))];
}

function scopeValue(value, label) {
  if (Array.isArray(value)) return normalizeList(value.map(item => String(item)), label, 30).map(item => item.toLowerCase());
  return asText(String(value), label, 500);
}

function normalizeScope(value) {
  if (value === undefined || value === null) return {};
  if (typeof value === 'string') return { label: asText(value, 'Research scope', 500) };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Research scope must be text or an object.');
  const out = {};
  for (const original of Object.keys(value)) {
    const key = SCOPE_ALIASES[original] || original;
    if (!SCOPE_KEYS.includes(key) && original !== 'exclusions' && original !== 'applicableDimensions') continue;
    if (original === 'exclusions' || original === 'applicableDimensions') {
      out[original] = clone(value[original]);
      continue;
    }
    if (value[original] === undefined || value[original] === null || value[original] === '') continue;
    out[key] = scopeValue(value[original], 'Research scope ' + key);
  }
  return out;
}

const COMPETITOR_ORIGINS = new Set(['declared', 'research']);

function normalizeCompetitors(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > profiles.MAX_COMPETITORS) throw new Error('Save up to three named competitors.');
  return [...new Set(value.map(item => {
    const name = typeof item === 'string' ? item : item && (item.name || item.label);
    if (typeof name !== 'string' || !name.trim() || name.length > 500) throw new Error('Save up to three named competitors.');
    return name.trim();
  }))];
}

function normalizeCompetitorDetails(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > profiles.MAX_COMPETITORS) throw new Error('Save up to three competitor details.');
  return value.map(item => {
    if (typeof item === 'string') return { name: asText(item, 'Competitor name', 500) };
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Competitor details need a name.');
    if (typeof item.name !== 'string' || !item.name.trim()) throw new Error('Competitor details need a name.');
    const out = { name: asText(item.name, 'Competitor name', 500) };
    for (const key of ['rationale', 'limitation']) {
      if (item[key] !== undefined) out[key] = asText(item[key], 'Competitor ' + key, 2000);
    }
    if (item.origin !== undefined) {
      const origin = asText(String(item.origin), 'Competitor origin', 20).toLowerCase();
      if (!COMPETITOR_ORIGINS.has(origin)) throw new Error('Competitor origin must be declared or research.');
      out.origin = origin;
    }
    // An empty evidence list means nothing could be fetched for this competitor: the same as leaving it out, never a refusal.
    if (item.evidence !== undefined && !(Array.isArray(item.evidence) && item.evidence.length === 0)) out.evidence = normalizeSources(item.evidence);
    return out;
  });
}

function stableId(prefix, value) {
  return prefix + '-' + crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return VALIDITY.has(status) ? status : 'unknown';
}

function normalizeValidity(item, fallbackDate, label) {
  const source = item && typeof item === 'object' ? item : {};
  const raw = source.validity && typeof source.validity === 'object' ? source.validity : {};
  const status = normalizeStatus(raw.status || source.validityStatus || (typeof source.validity === 'string' ? source.validity : source.status));
  const out = { status };
  if (raw.reason !== undefined) out.reason = asText(raw.reason, label + ' validity reason', 1000);
  else if (source.validityReason !== undefined) out.reason = asText(source.validityReason, label + ' validity reason', 1000);
  const dates = [
    ['publishedAt', 'publication date'], ['publicationDate', 'publication date'],
    ['eventStart', 'event start'], ['eventEnd', 'event end'],
    ['lastVerifiedAt', 'last verified date'], ['expiresAt', 'expiry date'],
  ];
  for (const [key, display] of dates) {
    const value = source[key] !== undefined ? source[key] : raw[key];
    if (value !== undefined && value !== null && value !== '') out[key] = asDate(value, label + ' ' + display);
  }
  if (!out.observedAt && fallbackDate) out.observedAt = fallbackDate;
  return out;
}

function normalizeApplicability(item, fallbackScope, label) {
  const source = item && typeof item === 'object' ? item : {};
  const raw = source.applicability && typeof source.applicability === 'object' ? source.applicability : null;
  const scopeValueInput = raw && raw.scope !== undefined ? raw.scope : source.scope !== undefined ? source.scope : fallbackScope;
  const scope = scopeValueInput && typeof scopeValueInput === 'object' ? normalizeScope(scopeValueInput) : {};
  const explicitStatus = raw && (raw.status || raw.applicability) || source.applicabilityStatus || source.applicability;
  const status = typeof explicitStatus === 'string' && ['known', 'applicable', 'unknown', 'excluded', 'mismatch'].includes(explicitStatus.toLowerCase())
    ? explicitStatus.toLowerCase() : Object.keys(scope).length ? 'known' : 'unknown';
  const out = { status: status === 'applicable' ? 'known' : status, scope };
  const exclusions = raw && raw.exclusions !== undefined ? raw.exclusions : source.exclusions;
  if (exclusions !== undefined) out.exclusions = clone(exclusions);
  if (raw && raw.reason !== undefined) out.reason = asText(raw.reason, label + ' applicability reason', 1000);
  return out;
}

function sourceKind(source) {
  return String(source && (source.kind || source.category || '') || '').trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[- ]+/g, '_');
}

function normalizeSources(value) {
  if (!Array.isArray(value) || value.length > 80) throw new Error('Research needs 1 to 80 dated sources.');
  return value.map((source, index) => {
    if (!source || typeof source !== 'object') throw new Error('Each source needs a public URL and observedAt timestamp.');
    const observedAt = asDate(source.observedAt || source.observationDate, 'Source ' + (index + 1) + ' observedAt');
    const url = capabilities.publicUrl(source.url, 'Source ' + (index + 1));
    const result = {
      sourceId: asText(String(source.sourceId || source.id || stableId('source', url + ':' + observedAt)), 'Source id', 200),
      url,
      observedAt,
    };
    for (const key of ['title', 'kind', 'scope', 'limitation', 'captureRef', 'contentHash', 'supportingExcerpt', 'locator', 'provider', 'changeTrigger']) {
      if (source[key] !== undefined) {
        if (key === 'scope' && source[key] && typeof source[key] === 'object') result.scope = normalizeScope(source[key]);
        else result[key] = asText(String(source[key]), 'Source ' + key, key === 'supportingExcerpt' ? 4000 : 1000);
      }
    }
    for (const key of ['claims', 'platforms', 'channels', 'evidenceIds', 'applicableDimensions']) {
      if (source[key] !== undefined) result[key] = normalizeList(source[key], 'Source ' + key, 40);
    }
    if (source.publicationDate !== undefined) result.publicationDate = asDate(source.publicationDate, 'Source publication date');
    if (source.publishedAt !== undefined) result.publishedAt = asDate(source.publishedAt, 'Source publishedAt');
    if (source.lastVerifiedAt !== undefined) result.lastVerifiedAt = asDate(source.lastVerifiedAt, 'Source lastVerifiedAt');
    if (source.expiresAt !== undefined) result.expiresAt = asDate(source.expiresAt, 'Source expiresAt');
    result.applicability = normalizeApplicability(source, result.scope, 'Source');
    result.applicabilityStatus = result.applicability.status;
    result.validity = normalizeValidity(source, observedAt, 'Source');
    if (source.semantics !== undefined) result.semantics = asText(String(source.semantics), 'Source semantics', 100).toUpperCase();
    return result;
  });
}

function normalizeGaps(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 120) throw new Error('Research gaps exceed the limit.');
  return value.map(item => {
    if (typeof item === 'string') {
      const text = asText(item, 'Gap question', 2000);
      return { scope: 'general', question: text, reason: text, required: true };
    }
    if (!item || typeof item !== 'object') throw new Error('Research gaps need a question and limitation.');
    const out = {
      id: item.id ? asText(String(item.id), 'Gap id', 200) : stableId('gap', JSON.stringify(item)),
      scope: item.scope && typeof item.scope === 'object' ? normalizeScope(item.scope) : typeof item.scope === 'string' && item.scope.trim() ? item.scope.trim() : 'general',
      question: asText(item.question || item.claim || item.finding || 'Unresolved research question', 'Gap question', 1000),
      reason: asText(item.reason || item.limitation || 'Evidence was not available.', 'Gap reason', 2000),
      required: item.required === undefined ? Boolean(item.blocking) : Boolean(item.required),
    };
    for (const key of ['limitation', 'decision', 'questionId', 'stopReason']) {
      if (item[key] !== undefined) out[key] = asText(String(item[key]), 'Gap ' + key, 2000);
    }
    if (item.source !== undefined) out.source = capabilities.publicUrl(item.source, 'Gap source');
    if (item.blocking !== undefined) out.blocking = Boolean(item.blocking);
    if (item.confidence !== undefined) out.confidence = asText(String(item.confidence), 'Gap confidence', 100);
    return out;
  });
}

function normalizeEvidenceMatrix(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 160) throw new Error('Evidence matrix exceeds the limit.');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error('Evidence matrix rows need a question and finding.');
    const question = item.question || item.claim || item.observation || 'Unresolved research question';
    const finding = item.finding || item.claim || item.observation || item.result;
    const out = {
      id: asText(String(item.id || item.evidenceId || stableId('evidence', question + ':' + finding + ':' + index)), 'Evidence id', 200),
      questionId: item.questionId === undefined ? undefined : asText(String(item.questionId), 'Evidence question id', 200),
      question: asText(String(question), 'Evidence question', 1000),
      finding: asText(String(finding || ''), 'Evidence finding', 5000),
      confidence: item.confidence === undefined ? 'unknown' : asText(String(item.confidence), 'Evidence confidence', 100),
    };
    for (const key of ['decision', 'limitation', 'reason', 'sourceId', 'semantics', 'captureRef', 'contentHash', 'locator', 'supportingExcerpt']) {
      if (item[key] !== undefined) out[key] = asText(String(item[key]), 'Evidence ' + key, key === 'supportingExcerpt' ? 4000 : 2000);
    }
    if (item.source !== undefined && item.source !== '') out.source = capabilities.publicUrl(item.source, 'Evidence source');
    if (item.observedAt !== undefined) out.observedAt = asDate(item.observedAt, 'Evidence observedAt');
    if (item.publicationDate !== undefined) out.publicationDate = asDate(item.publicationDate, 'Evidence publicationDate');
    if (item.expiresAt !== undefined) out.expiresAt = asDate(item.expiresAt, 'Evidence expiresAt');
    if (item.scope !== undefined) out.scope = item.scope && typeof item.scope === 'object' ? normalizeScope(item.scope) : asText(String(item.scope), 'Evidence scope', 1000);
    out.applicability = normalizeApplicability(item, out.scope, 'Evidence');
    out.applicabilityStatus = out.applicability.status;
    out.validity = normalizeValidity(item, out.observedAt, 'Evidence');
    if (item.evidenceIds !== undefined) out.evidenceIds = normalizeList(item.evidenceIds, 'Evidence evidenceIds', 40);
    if (item.supportingEvidenceIds !== undefined) out.supportingEvidenceIds = normalizeList(item.supportingEvidenceIds, 'Evidence supportingEvidenceIds', 40);
    if (item.derivedFrom !== undefined) out.derivedFrom = normalizeList(item.derivedFrom, 'Evidence derivedFrom', 40);
    if (item.sourceIds !== undefined) out.sourceIds = normalizeList(item.sourceIds, 'Evidence sourceIds', 40);
    if (item.applicableDimensions !== undefined) out.applicableDimensions = normalizeList(item.applicableDimensions, 'Evidence applicableDimensions', 40);
    if (item.semantics !== undefined) out.semantics = asText(String(item.semantics), 'Evidence semantics', 100).toUpperCase();
    return out;
  });
}

function rawResearch(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'brand', 'research.json'), 'utf8')); }
  catch { return null; }
}

function sourceDate(record, kind) {
  const wanted = String(kind || '').toLowerCase();
  const sources = record && Array.isArray(record.sources) ? record.sources : [];
  const matching = sources.filter(source => {
    const sourceCategory = sourceKind(source);
    return wanted && (sourceCategory === wanted || String(source.scope || '').toLowerCase() === wanted);
  });
  const untyped = sources.filter(source => !sourceKind(source) && !source.scope);
  const candidates = matching.length ? matching : (wanted === 'product_claims' ? untyped : []);
  const dates = candidates.map(source => Date.parse(source.observedAt)).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : undefined;
}

function policyFor(record, key, policy) {
  const alias = String(key || '').replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const fromPolicy = policy && (policy[key] || policy[alias]);
  const custom = fromPolicy || record && record.freshnessPolicy && (record.freshnessPolicy[key] || record.freshnessPolicy[alias]);
  const days = custom && Number(custom.days) > 0 ? Number(custom.days) : DEFAULT_FRESHNESS_DAYS[key] || 90;
  return {
    days,
    reason: custom && custom.reason ? String(custom.reason) : 'default evidence policy',
    policyVersion: custom && custom.policyVersion || record && record.policyVersion || POLICY_VERSION,
  };
}

function normalizeFreshness(input, previous, record, options = {}) {
  const supplied = input && typeof input === 'object' ? input : {};
  const old = previous && previous.freshness && typeof previous.freshness === 'object' ? previous.freshness : {};
  const out = {};
  const keys = new Set([...Object.keys(old), ...Object.keys(supplied)]);
  if (!keys.size) {
    keys.add('product_claims');
    if (record.sources.some(source => sourceKind(source) === 'competitor_identity')) keys.add('competitor_identity');
    if (record.sources.some(source => sourceKind(source) === 'recent_posts')) keys.add('recent_posts');
  }
  for (const key of keys) {
    const item = supplied[key] || old[key] || {};
    const observedAt = item.observedAt ? asDate(item.observedAt, key + ' observedAt') : sourceDate(record, key);
    const policy = policyFor(record, key, options.policy);
    if (!observedAt) {
      out[key] = {
        observedAt: null,
        refreshAfter: null,
        reason: item.reason ? asText(String(item.reason), key + ' refresh reason', 1000) : 'No verified evidence for this category.',
        trigger: item.trigger ? asText(String(item.trigger), key + ' refresh trigger', 1000) : null,
        policyVersion: policy.policyVersion,
      };
      continue;
    }
    const refreshAfter = item.refreshAfter
      ? asDate(item.refreshAfter, key + ' refreshAfter')
      : new Date(Date.parse(observedAt) + policy.days * 86400000).toISOString();
    out[key] = {
      observedAt,
      refreshAfter,
      reason: item.reason ? asText(String(item.reason), key + ' refresh reason', 1000) : policy.reason,
      trigger: item.trigger ? asText(String(item.trigger), key + ' refresh trigger', 1000) : null,
      policyVersion: item.policyVersion || policy.policyVersion,
    };
  }
  return out;
}

function changedProfileFields(previousProfile, profile) {
  if (!previousProfile || !profile) return ['profile'];
  const fields = [];
  const compare = (key, category) => {
    if (JSON.stringify(previousProfile[key]) !== JSON.stringify(profile[key])) fields.push(category);
  };
  compare('channels', 'platform_assumptions');
  compare('competitors', 'competitor_identity');
  compare('market', 'audience');
  if ((previousProfile.targetMarket || '') !== (profile.targetMarket || '')) fields.push('audience');
  compare('audience', 'audience');
  compare('visualIdentity', 'brand_identity');
  compare('voice', 'brand_identity');
  compare('strategy', 'strategy');
  compare('contentPillars', 'strategy');
  return [...new Set(fields)];
}

function freshnessStatus(record, now = new Date()) {
  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const statuses = {};
  for (const [key, item] of Object.entries(record.freshness || {})) {
    const refreshAt = item.refreshAfter ? Date.parse(item.refreshAfter) : NaN;
    statuses[key] = {
      ...clone(item),
      status: Number.isFinite(refreshAt) && refreshAt > at ? 'current' : 'stale',
    };
  }
  return statuses;
}

function normalizeRecord(data) {
  if (!data || (data.version !== 1 && data.version !== 2) || !Array.isArray(data.competitors) || !Array.isArray(data.sources)) return null;
  const record = clone(data);
  record.version = Number(record.version) || 1;
  record.revision = Number(record.revision || record.researchRevision || 0);
  record.sources = normalizeSources(record.sources);
  record.competitors = normalizeCompetitors(record.competitors);
  record.competitorDetails = normalizeCompetitorDetails(record.competitorDetails || []);
  record.evidenceMatrix = normalizeEvidenceMatrix(record.evidenceMatrix || []);
  record.gaps = normalizeGaps(record.gaps || []);
  record.findings = record.findings && typeof record.findings === 'object' ? clone(record.findings) : {};
  record.scope = normalizeScope(record.scope || {});
  record.policyVersion = record.policyVersion || POLICY_VERSION;
  const legacyFreshness = !data.freshness && data.refreshAfter ? {
    product_claims: {
      observedAt: data.researchedAt,
      refreshAfter: data.refreshAfter,
      reason: 'legacy research refresh interval',
      trigger: null,
    },
  } : data.freshness;
  record.freshness = normalizeFreshness(legacyFreshness, { ...data, freshness: legacyFreshness }, record);
  return record;
}

function read(dir, options = {}) {
  const data = rawResearch(dir);
  const record = normalizeRecord(data);
  if (!record) return null;
  const profile = profiles.read(dir);
  const now = clockNow(options);
  const status = freshnessStatus(record, now);
  const changed = changedProfileFields(record.profileSnapshot, profile);
  const profileChangeIsRelevant = record.profileRevision !== (profile && profile.revision) && changed.length > 0;
  let decision = null;
  if (options.scope || options.questions || options.evidencePlan) {
    decision = evidenceDecision(record, { ...options, now });
  }
  const categoryCurrent = Object.keys(status).length > 0 && Object.values(status).every(item => item.status === 'current');
  const current = Boolean(profile && !profileChangeIsRelevant && (decision
    ? decision.refreshRequired.length === 0 && decision.gaps.every(gap => gap.required !== true)
    : categoryCurrent && !(record.gaps || []).some(gap => gap && (gap.blocking || gap.required))));
  return {
    ...record,
    freshness: status,
    current,
    changedProfileFields: changed,
    refreshRequired: !current,
    refreshTargets: [...new Set([...(record.refreshTargets || []), ...changed, ...(decision ? decision.refreshRequired.map(item => item.target).filter(Boolean) : [])])],
    evidenceDecision: decision,
    consideredEvidence: decision ? decision.consideredEvidence : [],
    acceptedEvidence: decision ? decision.acceptedEvidence : [],
    refreshRequiredItems: decision ? decision.refreshRequired : [],
  };
}

// The declared first three names always lead; research fills any remaining slots up to three,
// case-insensitive de-duplicated against what is already declared. Source is 'research' when
// nothing was declared, 'declared' when research added nothing new, else 'mixed'.
function profileCompetitors(profile, input, previous, replacement) {
  const declared = (profile && profile.competitors && profile.competitors.items || []).slice(0, profiles.MAX_COMPETITORS);
  const researchInput = input !== undefined && (!previous || replacement)
    ? input
    : previous && Array.isArray(previous.competitors) ? previous.competitors : undefined;
  const researchNames = researchInput !== undefined ? normalizeCompetitors(researchInput) : [];
  const seen = new Set(declared.map(name => name.toLowerCase()));
  const items = [...declared];
  for (const name of researchNames) {
    if (items.length >= profiles.MAX_COMPETITORS) break;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(name);
  }
  const profileSource = profile && profile.competitors && profile.competitors.source;
  const source = profileSource === 'research' || profileSource === 'mixed'
    ? profileSource
    : !declared.length ? 'research' : items.length > declared.length ? 'mixed' : 'declared';
  return { items, source };
}

function fieldReplacementAuthorized(input, options, field, previous, value) {
  const flag = 'replace' + field[0].toUpperCase() + field.slice(1);
  const clear = 'clear' + field[0].toUpperCase() + field.slice(1);
  const clearRequested = Boolean(input[clear] || input[field + 'Mode'] === 'clear' || input[field + 'Operation'] === 'clear');
  const replaceRequested = Boolean(input[flag] || input[field + 'Mode'] === 'replace' || input[field + 'Operation'] === 'replace');
  const fieldSpecified = own(input, field) || clearRequested || replaceRequested;
  if (!fieldSpecified) return false;
  const auth = input.authorization || options.authorization || {};
  const reason = input.authorizedReason || input.authorizationReason || input.authorizedBy || options.authorizedReason || options.authorizationReason || options.authorizedBy || auth.reason || auth.note;
  const expected = input.expectedRevision !== undefined ? input.expectedRevision : input.baseRevision !== undefined ? input.baseRevision : options.expectedRevision !== undefined ? options.expectedRevision : options.baseRevision;
  const requested = Boolean(replaceRequested || clearRequested || reason);
  if (!requested) return false;
  if (previous && expected === undefined) throw new Error('An expected research revision is required for ' + field + ' replacement.');
  if (!reason) throw new Error('An authorized reason is required for ' + field + ' replacement.');
  if (value === undefined && !clearRequested) throw new Error('An explicit ' + field + ' replacement value is required.');
  return true;
}

function fieldClearRequested(input, field) {
  const name = 'clear' + field[0].toUpperCase() + field.slice(1);
  return Boolean(input[name] || input[field + 'Mode'] === 'clear' || input[field + 'Operation'] === 'clear');
}

function mergeByIdentity(previous, incoming, identity) {
  const out = [...(previous || [])];
  for (const item of incoming || []) {
    const key = identity(item);
    const index = out.findIndex(existing => identity(existing) === key);
    if (index >= 0) out[index] = item;
    else out.push(item);
  }
  return out;
}

function mergeObject(previous, incoming, replace) {
  if (replace) return clone(incoming || {});
  return { ...(clone(previous) || {}), ...(clone(incoming) || {}) };
}

function buildDraft(dir, input, options, previous, profile, now) {
  const competitorReplacement = fieldReplacementAuthorized(input, options, 'competitors', previous, input.competitors);
  const sourcesReplacement = fieldReplacementAuthorized(input, options, 'sources', previous, input.sources);
  const evidenceReplacement = fieldReplacementAuthorized(input, options, 'evidenceMatrix', previous, input.evidenceMatrix);
  const findingsReplacement = fieldReplacementAuthorized(input, options, 'findings', previous, input.findings);
  const gapsReplacement = fieldReplacementAuthorized(input, options, 'gaps', previous, input.gaps);
  const competitorsCleared = competitorReplacement && fieldClearRequested(input, 'competitors');
  const sourcesCleared = sourcesReplacement && fieldClearRequested(input, 'sources');
  const evidenceCleared = evidenceReplacement && fieldClearRequested(input, 'evidenceMatrix');
  const findingsCleared = findingsReplacement && fieldClearRequested(input, 'findings');
  const gapsCleared = gapsReplacement && fieldClearRequested(input, 'gaps');
  const competitorDetailsReplacement = fieldReplacementAuthorized(input, options, 'competitorDetails', previous, input.competitorDetails);
  const competitorDetailsCleared = competitorDetailsReplacement && fieldClearRequested(input, 'competitorDetails');
  const suppliedCompetitors = own(input, 'competitors') ? normalizeCompetitors(input.competitors || []) : competitorsCleared ? [] : undefined;
  const profileCompetitorData = profileCompetitors(profile, suppliedCompetitors, previous, competitorReplacement);
  const oldSources = previous && previous.sources || [];
  const incomingSources = own(input, 'sources') ? normalizeSources(input.sources || []) : [];
  const suppliedSources = own(input, 'sources')
    ? (sourcesReplacement ? incomingSources : mergeByIdentity(oldSources, incomingSources, item => item.sourceId || item.url + ':' + item.observedAt))
    : sourcesCleared ? []
    : clone(oldSources);
  if (!suppliedSources.length && !sourcesCleared) throw new Error('Research needs 1 to 80 dated sources.');
  if (suppliedSources.length > 80) throw new Error('Research needs 1 to 80 dated sources.');
  const oldEvidence = previous && previous.evidenceMatrix || [];
  const incomingEvidence = own(input, 'evidenceMatrix') ? normalizeEvidenceMatrix(input.evidenceMatrix || []) : [];
  const evidenceMatrix = own(input, 'evidenceMatrix')
    ? (evidenceReplacement ? incomingEvidence : mergeByIdentity(oldEvidence, incomingEvidence, item => item.id || item.questionId || item.question))
    : evidenceCleared ? []
    : clone(oldEvidence);
  if (evidenceMatrix.length > 160) throw new Error('Evidence matrix exceeds the limit.');
  const oldFindings = previous && previous.findings || {};
  const suppliedFindings = input.findings && typeof input.findings === 'object' ? input.findings : {};
  const findings = findingsCleared ? {} : mergeObject(oldFindings, suppliedFindings, findingsReplacement);
  for (const key of FINDING_KEYS) {
    if (own(input, key)) findings[key] = typeof input[key] === 'string' ? asText(input[key], key) : clone(input[key]);
  }
  const oldGaps = previous && previous.gaps || [];
  const incomingGaps = own(input, 'gaps') ? normalizeGaps(input.gaps || []) : [];
  const gaps = own(input, 'gaps') ? (gapsReplacement ? incomingGaps : mergeByIdentity(oldGaps, incomingGaps, item => item.id || item.scope + ':' + item.question))
    : gapsCleared ? [] : clone(oldGaps);
  const addGap = gap => {
    const key = gap.scope + ':' + gap.question;
    if (!gaps.some(item => item.scope + ':' + item.question === key)) gaps.push(gap);
  };
  if (!profileCompetitorData.items.length) {
    addGap({ scope: 'competitors', question: 'Relevant supported competitors', reason: 'No competitor had adequate accessible evidence.', limitation: 'Select or supply a supported competitor before making comparative claims.', required: false });
  } else if (profileCompetitorData.items.length < profiles.MAX_COMPETITORS) {
    addGap({ scope: 'competitors', question: 'Additional relevant supported competitors', reason: 'Evidence supported fewer than three choices.', limitation: 'Keep the supported shortlist and do not invent another competitor.', required: false });
  }
  for (const detail of input.competitorDetails === undefined ? previous && previous.competitorDetails || [] : normalizeCompetitorDetails(input.competitorDetails || [])) {
    if (detail.limitation && /inaccessible|unavailable|denied|not accessible/i.test(detail.limitation)) {
      addGap({ scope: 'competitors', question: detail.name + ' evidence', reason: detail.limitation, limitation: 'Keep the named competitor and disclose the missing sample.', required: false });
    }
  }
  for (const channel of profile.researchPolicy && profile.researchPolicy.skipAccountDiscovery || []) {
    addGap({ scope: 'account_discovery', question: channel + ' account', reason: 'The brand declared this channel unavailable.', limitation: 'Research must not discover or infer an account unless the declaration changes.', required: false });
  }
  const oldScope = previous && previous.scope || {};
  const scope = own(input, 'scope') ? normalizeScope(input.scope) : normalizeScope(oldScope);
  const freshnessPolicy = input.freshnessPolicy || options.freshnessPolicy || previous && previous.freshnessPolicy || {};
  const hasResearchPayload = own(input, 'sources') || own(input, 'evidenceMatrix') || own(input, 'competitorDetails') || own(input, 'freshness') ||
    sourcesCleared || evidenceCleared || competitorDetailsCleared || findingsCleared || gapsCleared || competitorsCleared ||
    (!previous && own(input, 'competitors'));
  const previousAt = previous && previous.researchedAt;
  const draft = {
    ...(previous ? clone(previous) : {}),
    version: 2,
    kind: 'researched_interpretation',
    profileRevision: profile.revision,
    profileSnapshot: profiles.context(profile, { includeProvenance: false }),
    researchedAt: hasResearchPayload || !previousAt ? now.toISOString() : previousAt,
    scope,
    competitors: profileCompetitorData.items,
    competitorSource: profileCompetitorData.source,
    competitorDetails: own(input, 'competitorDetails') || competitorDetailsCleared
      ? (competitorDetailsReplacement
        ? (competitorDetailsCleared ? [] : normalizeCompetitorDetails(input.competitorDetails || []))
        : mergeByIdentity(previous && previous.competitorDetails || [], normalizeCompetitorDetails(input.competitorDetails || []), item => item.name.toLowerCase()))
      : clone(previous && previous.competitorDetails || []),
    sources: suppliedSources,
    findings,
    evidenceMatrix,
    gaps,
    freshnessPolicy,
    refresh: own(input, 'refresh') ? clone(input.refresh) : clone(previous && previous.refresh || null),
    refreshReason: own(input, 'refreshReason') ? (input.refreshReason ? asText(String(input.refreshReason), 'Refresh reason', 1000) : null) : previous && previous.refreshReason || null,
    refreshTargets: own(input, 'refreshTargets') ? normalizeList(input.refreshTargets, 'Refresh targets', 40) : clone(previous && previous.refreshTargets || []),
    policyVersion: input.policyVersion || previous && previous.policyVersion || POLICY_VERSION,
    basis: 'Research findings and recommendations; user-declared profile facts take precedence.',
    revision: (Number(previous && (previous.revision || previous.researchRevision)) || 0) + 1,
  };
  if (draft.competitorDetails.length > 3) throw new Error('Save up to three competitor details.');
  if (draft.gaps.length > 120) throw new Error('Research gaps exceed the limit.');
  draft.researchRevision = draft.revision;
  draft.freshness = normalizeFreshness(input.freshness, previous, draft, { policy: freshnessPolicy });
  draft.refreshAfter = Object.values(draft.freshness).map(value => value.refreshAfter).filter(Boolean).sort()[0] || null;
  if (draft.refresh && typeof draft.refresh === 'object') {
    draft.refresh = {
      scope: normalizeScope(draft.refresh.scope || {}),
      reason: draft.refresh.reason ? asText(String(draft.refresh.reason), 'Refresh reason', 1000) : null,
      requestedAt: draft.refresh.requestedAt ? asDate(draft.refresh.requestedAt, 'Refresh requestedAt') : now.toISOString(),
    };
  }
  if (!draft.refreshTargets.length && draft.refresh) {
    draft.refreshTargets = refreshPlan(dir, {
      scope: draft.refresh.scope,
      changedClaims: input.changedClaims || input.changed || [],
      competitors: input.competitors,
      now,
    }).targets;
  }
  return draft;
}

function staleError(expected, actual) {
  const error = new Error('Stale research output: expected revision ' + expected + ', found ' + actual + '.');
  error.code = 'STALE_RESEARCH_OUTPUT';
  error.expectedRevision = expected;
  error.actualRevision = actual;
  return error;
}

function save(dir, input, options = {}) {
  const profile = options.profile || profiles.read(dir);
  if (!profile) throw new Error('Complete the required brand profile before research.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected research fields.');
  const file = path.join(dir, 'brand', 'research.json');
  const expected = input.expectedRevision !== undefined ? input.expectedRevision : input.baseRevision !== undefined ? input.baseRevision : options.expectedRevision !== undefined ? options.expectedRevision : options.baseRevision;
  const now = clockNow(options);
  let saved;
  if (options.dryRun) {
    let previous = null;
    try { previous = normalizeRecord(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { previous = null; }
    const actual = Number(previous && (previous.revision || previous.researchRevision)) || 0;
    if (expected !== undefined && Number(expected) !== actual) throw staleError(expected, actual);
    const draft = buildDraft(dir, input, options, previous, profile, now);
    if (Buffer.byteLength(JSON.stringify(draft, null, 2) + '\n', 'utf8') > MAX_RESEARCH_BYTES) throw new Error('Keep research under 60 KB.');
    return draft;
  }
  durable.update(file, raw => {
    let previous = null;
    try { previous = raw ? normalizeRecord(JSON.parse(raw)) : null; } catch { previous = null; }
    const actual = Number(previous && (previous.revision || previous.researchRevision)) || 0;
    if (expected !== undefined && Number(expected) !== actual) throw staleError(expected, actual);
    saved = buildDraft(dir, input, options, previous, profile, now);
    const text = JSON.stringify(saved, null, 2) + '\n';
    if (Buffer.byteLength(text, 'utf8') > MAX_RESEARCH_BYTES) throw new Error('Keep research under 60 KB.');
    return text;
  }, '');
  return read(dir, { now });
}

function targetForClaim(claim) {
  const text = String(claim || '').toLowerCase();
  if (/(competitor|rival|ad library)/.test(text)) return 'competitor_discovery';
  if (/(market|audience|segment|persona|customer)/.test(text)) return 'audience';
  if (/(platform|channel|format|algorithm|tiktok|instagram|facebook)/.test(text)) return 'platform_assumptions';
  if (/(post|recent|trend|cadence|creative)/.test(text)) return 'recent_posts';
  if (/(offer|price|pricing|discount|promotion|stock)/.test(text)) return 'offer';
  if (/(voice|tone|palette|font|identity|brand)/.test(text)) return 'brand_identity';
  return 'product_claims';
}

function normalizeQuestion(question, index, scope) {
  if (typeof question === 'string') return { id: 'Q' + (index + 1), claim: question, material: true, scope: clone(scope) };
  const item = question && typeof question === 'object' ? question : {};
  return {
    id: String(item.id || item.questionId || 'Q' + (index + 1)),
    claim: String(item.claim || item.question || item.objective || 'Unresolved material research question'),
    decision: item.decision || null,
    material: item.material !== false && item.materiality !== 'optional',
    evidenceType: item.evidenceType || item.acceptableEvidenceType || null,
    scope: normalizeScope(item.scope || item.requiredScope || item.required_scope || scope || {}),
    historical: Boolean(item.historical || item.historicalAnalysis),
  };
}

function questionsForJob(job, options = {}) {
  const scope = normalizeScope({
    ...(job && (job.scope || job.researchScope || job.productScope) || {}),
    brand: job && job.brand,
    product: job && (job.product || job.productName || job.service),
    market: job && (job.market || job.geography || job.audience && job.audience.market),
    language: job && job.language,
    audience: job && (job.audience && (job.audience.description || job.audience.segment) || job.audience),
    objective: job && job.objective,
    funnelStage: job && job.funnelStage,
    platforms: job && job.platforms,
    distribution: job && job.distribution,
    offer: job && job.offer,
    campaignPeriod: job && job.campaignPeriod,
  });
  const claims = job && Array.isArray(job.requiredClaims) ? job.requiredClaims : [];
  if (claims.length) return claims.map((claim, index) => normalizeQuestion(typeof claim === 'object' ? claim : { id: 'Q' + (index + 1), claim }, index, scope));
  if (options.questions && Array.isArray(options.questions) && options.questions.length) return options.questions.map((question, index) => normalizeQuestion(question, index, scope));
  const request = job && (job.researchQuestion || job.request || job.objective);
  return request ? [normalizeQuestion({ id: 'Q-request', claim: request, scope }, 0, scope)] : [];
}

function dimensionValues(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value]).map(item => String(item).trim().toLowerCase()).filter(Boolean);
}

function candidateScope(item) {
  const applicability = item && item.applicability && typeof item.applicability === 'object' ? item.applicability : {};
  const raw = applicability.scope || (item && item.scope && typeof item.scope === 'object' ? item.scope : {});
  const scope = normalizeScope(raw || {});
  const dimensions = item && (item.applicableDimensions || item.applicable_dimensions || applicability.applicableDimensions);
  if (dimensions !== undefined) scope.applicableDimensions = normalizeList(dimensions, 'Applicable dimensions', 40);
  return scope;
}

function scopeComparison(candidate, requested) {
  const candidateScopeValue = candidate && typeof candidate === 'object' ? candidate : {};
  const requestedScope = normalizeScope(requested || {});
  const declaredDimensions = dimensionValues(candidateScopeValue.applicableDimensions || candidateScopeValue.applicable_dimensions);
  const constrained = declaredDimensions.length ? new Set(declaredDimensions.map(value => value.toLowerCase())) : new Set(Object.keys(candidateScopeValue)
    .filter(key => !['applicableDimensions', 'applicable_dimensions', 'exclusions', 'label'].includes(key))
    .map(key => key.toLowerCase()));
  const reasons = [];
  let unknown = false;
  for (const key of SCOPE_KEYS) {
    const required = dimensionValues(requestedScope[key]);
    if (!required.length) continue;
    if (constrained.size && !constrained.has(key.toLowerCase())) continue;
    const provided = dimensionValues(candidateScopeValue[key]);
    if (!provided.length) { unknown = true; reasons.push('missing ' + key); continue; }
    if (!required.some(value => provided.includes(value))) { reasons.push('different ' + key); return { status: 'mismatch', reasons }; }
  }
  const excluded = candidateScopeValue.exclusions;
  if (excluded && JSON.stringify(excluded).toLowerCase().includes(JSON.stringify(requestedScope).toLowerCase())) {
    return { status: 'mismatch', reasons: ['explicit exclusion'] };
  }
  if (unknown) return { status: 'unknown', reasons };
  return { status: 'known', reasons };
}

function evidenceValidity(item, now, record, key, policyOverride) {
  const explicit = item && item.validity && typeof item.validity === 'object' ? item.validity : {};
  const explicitStatus = normalizeStatus(explicit.status || item && (item.validityStatus || (typeof item.validity === 'string' ? item.validity : null)));
  if (explicitStatus !== 'unknown') {
    if (explicitStatus === 'current' && explicit.expiresAt && Date.parse(explicit.expiresAt) <= now.getTime()) return { status: 'stale', reason: 'expired' };
    return { status: explicitStatus, reason: explicit.reason || null };
  }
  const expiresAt = item && (item.expiresAt || explicit.expiresAt);
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) return { status: 'stale', reason: 'expired' };
  const observed = item && (item.lastVerifiedAt || explicit.lastVerifiedAt || item.observedAt || explicit.observedAt);
  if (!observed) return { status: 'unknown', reason: 'missing observation date' };
  const category = sourceKind(item) || key || targetForClaim(item && (item.question || item.claim));
  const policy = policyFor(record, category, policyOverride || record && record.freshnessPolicy);
  const expiry = Date.parse(observed) + policy.days * 86400000;
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) return { status: 'stale', reason: 'expired under ' + policy.policyVersion };
  return { status: 'current', reason: null };
}

function candidateSupports(candidate, question) {
  if (!candidate) return false;
  if (question.id === 'Q-scope') return true;
  const qid = String(question.id || '').toLowerCase();
  const claim = String(question.claim || '').toLowerCase();
  if (candidate.questionId && String(candidate.questionId).toLowerCase() === qid) return true;
  if (candidate.id && String(candidate.id).toLowerCase() === qid) return true;
  if (candidate.claims && candidate.claims.some(item => String(item).toLowerCase() === qid || claim.includes(String(item).toLowerCase()))) return true;
  const text = String(candidate.question || candidate.finding || candidate.title || '').toLowerCase();
  if (!text) return false;
  const words = claim.split(/[^a-z0-9]+/).filter(word => word.length > 3);
  return words.length > 0 && words.filter(word => text.includes(word)).length >= Math.min(2, words.length);
}

function candidateDecision(candidate, question, record, now, policyOverride) {
  const requested = question.scope || {};
  const applicability = candidate && candidate.applicability || { status: Object.keys(candidateScope(candidate)).length ? 'known' : 'unknown' };
  const comparison = scopeComparison(candidateScope(candidate), requested);
  if (comparison.status === 'mismatch') {
    const objectiveOnly = comparison.reasons.length > 0 && comparison.reasons.every(reason => /different (objective|funnelStage)/.test(reason));
    const historicalMetric = question.historical || /(historical|view|reach|impression|like|metric|observed)/i.test(question.claim || '');
    const semantics = String(candidate.semantics || '').toUpperCase();
    if (objectiveOnly && historicalMetric && ['FACT', 'OBSERVATION', ''].includes(semantics)) {
      return { decision: 'adapt', reason: 'historical observation does not establish the new objective', applicability: 'known', validity: 'current' };
    }
    return { decision: 'excluded', reason: comparison.reasons.join(', ') || 'evidence is outside the requested scope', applicability: 'excluded' };
  }
  if (comparison.status === 'unknown' || applicability.status === 'unknown') {
    return { decision: 'excluded', reason: comparison.reasons.join(', ') || 'legacy applicability is unknown', applicability: 'unknown' };
  }
  const validity = evidenceValidity(candidate, now, record, targetForClaim(question.claim), policyOverride);
  if (validity.status === 'historical' && question.historical) {
    return { decision: 'reuse', reason: 'historical evidence is valid for the requested historical analysis', applicability: 'known', validity: validity.status };
  }
  if (validity.status === 'superseded' || validity.status === 'disputed' || validity.status === 'stale' || validity.status === 'unknown') {
    return { decision: 'refresh', reason: validity.reason || validity.status, applicability: 'known', validity: validity.status };
  }
  const explicit = String(candidate.decision || '').toLowerCase();
  if (explicit === 'adapt' || candidate.semantics === 'INFERENCE' || candidate.semantics === 'HYPOTHESIS') {
    return { decision: 'adapt', reason: 'underlying evidence applies but the recommendation needs a labeled inference', applicability: 'known', validity: validity.status };
  }
  if (candidate.scope && typeof candidate.scope === 'object' && candidate.scope.objective && requested.objective &&
      dimensionValues(candidate.scope.objective)[0] !== dimensionValues(requested.objective)[0]) {
    return { decision: 'adapt', reason: 'historical observation does not establish the new objective', applicability: 'known', validity: validity.status };
  }
  return { decision: 'reuse', reason: 'matching evidence is current and in scope', applicability: 'known', validity: validity.status };
}

function allCandidates(record) {
  const rows = (record.evidenceMatrix || []).map(row => ({ ...row, _type: 'evidence', _ref: row.id }));
  const sources = (record.sources || []).map(source => ({ ...source, _type: 'source', _ref: source.sourceId || source.url }));
  const findings = Object.entries(record.findings || {})
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([key, value]) => ({ ...value, _type: 'finding', _ref: 'finding:' + key, question: value.question || key }));
  return [...rows, ...sources, ...findings];
}

function evidenceDecision(recordOrDir, options = {}) {
  const record = typeof recordOrDir === 'string' ? read(recordOrDir, { now: options.now, clock: options.clock }) : normalizeRecord(recordOrDir);
  const now = clockNow(options);
  const scope = normalizeScope(options.scope || {});
  let questions = Array.isArray(options.questions) ? options.questions.map((question, index) => normalizeQuestion(question, index, scope)) : [];
  if (!questions.length && options.brief && typeof options.brief === 'object') {
    questions = [normalizeQuestion({ id: 'Q-brief', claim: options.brief.request || options.brief.objective || 'Requested campaign evidence', scope: options.brief.scope || scope }, 0, scope)];
  }
  if (!questions.length && Object.keys(scope).length) questions = [normalizeQuestion({ id: 'Q-scope', claim: 'Evidence for the requested scope', scope }, 0, scope)];
  if (!record) {
    const gaps = questions.filter(question => question.material !== false).map(question => ({ questionId: question.id, scope: question.scope, question: question.claim, reason: 'No saved research.', required: question.material !== false, decision: 'missing' }));
    return {
      action: gaps.length ? 'dispatch' : 'reuse',
      zeroCall: !gaps.length,
      workRequired: Boolean(gaps.length),
      policyVersion: options.policyVersion || options.policy && options.policy.policyVersion || POLICY_VERSION,
      consideredEvidence: [], acceptedEvidence: [], refreshRequired: [], gaps,
      questions: questions.map(question => ({ ...question, decision: 'missing', reason: 'No saved research.' })),
      counts: { reused: 0, adapted: 0, refreshed: 0, missing: gaps.length, excluded: 0 },
      reasons: gaps.map(gap => ({ questionId: gap.questionId, reason: gap.reason })),
      stop: gaps.length ? 'required_gap' : 'all_material_questions_covered',
    };
  }
  const candidates = allCandidates(record);
  const consideredEvidence = [];
  const acceptedEvidence = [];
  const refreshRequired = [];
  const gaps = [];
  const resultQuestions = [];
  const counts = { reused: 0, adapted: 0, refreshed: 0, missing: 0, excluded: 0 };
  for (const question of questions.filter(item => item.material !== false)) {
    const matching = candidates.filter(candidate => candidateSupports(candidate, question));
    const evaluated = matching.map(candidate => ({ candidate, ...candidateDecision(candidate, question, record, now, options.policy) }));
    evaluated.forEach(item => consideredEvidence.push({
      id: item.candidate._ref,
      questionId: question.id,
      type: item.candidate._type,
      decision: item.decision,
      reason: item.reason,
      applicability: item.applicability,
      validity: item.validity || null,
    }));
    const accepted = evaluated.find(item => item.decision === 'reuse' || item.decision === 'adapt');
    let outcome;
    if (accepted) {
      outcome = accepted;
      counts[accepted.decision === 'reuse' ? 'reused' : 'adapted'] += 1;
      acceptedEvidence.push({
        id: accepted.candidate._ref,
        questionId: question.id,
        decision: accepted.decision,
        sourceId: accepted.candidate.sourceId || accepted.candidate._ref,
        source: accepted.candidate.source || accepted.candidate.url || null,
        observedAt: accepted.candidate.observedAt || null,
        reason: accepted.reason,
      });
    } else if (evaluated.some(item => item.decision === 'refresh')) {
      const stale = evaluated.find(item => item.decision === 'refresh');
      outcome = stale;
      counts.refreshed += 1;
      const target = targetForClaim(question.claim);
      refreshRequired.push({ questionId: question.id, target, reason: stale.reason, evidenceId: stale.candidate._ref });
      gaps.push({ questionId: question.id, scope: question.scope, question: question.claim, reason: stale.reason, required: question.material !== false, decision: 'refresh' });
    } else if (evaluated.length) {
      const excluded = evaluated[0];
      outcome = excluded;
      counts.excluded += 1;
      gaps.push({ questionId: question.id, scope: question.scope, question: question.claim, reason: excluded.reason, required: question.material !== false, decision: 'excluded' });
    } else {
      outcome = { decision: 'missing', reason: 'No adequate evidence supports this question.' };
      counts.missing += 1;
      gaps.push({ questionId: question.id, scope: question.scope, question: question.claim, reason: outcome.reason, required: question.material !== false, decision: 'missing' });
    }
    resultQuestions.push({ ...question, decision: outcome.decision, reason: outcome.reason, evidenceId: outcome.candidate && outcome.candidate._ref || null });
  }
  const work = resultQuestions.filter(question => ['refresh', 'missing', 'excluded'].includes(question.decision));
  return {
    action: work.length ? 'dispatch' : 'reuse',
    zeroCall: work.length === 0,
    workRequired: work.length > 0,
    policyVersion: options.policyVersion || options.policy && options.policy.policyVersion || record.policyVersion || POLICY_VERSION,
    consideredEvidence,
    acceptedEvidence,
    refreshRequired,
    gaps,
    questions: resultQuestions,
    counts,
    reasons: gaps.map(gap => ({ questionId: gap.questionId, reason: gap.reason, decision: gap.decision })),
    stop: work.length ? null : 'all_material_questions_covered',
  };
}

function relevantFindings(record, brief, scope, now, policy) {
  if (!record || !record.findings) return {};
  if (!brief || typeof brief !== 'object') {
    if (!scope || !Object.keys(scope).length) return clone(record.findings || {});
    brief = { objective: scope.objective || 'requested evidence' };
  }
  const text = JSON.stringify(brief).toLowerCase();
  const keys = new Set(['summary']);
  if (/(voice|tone|copy|caption|script)/.test(text)) keys.add('voice');
  if (/(visual|image|video|design)/.test(text)) keys.add('visualIdentity');
  if (/(pillar|strategy|objective)/.test(text)) { keys.add('strategy'); keys.add('contentPillars'); }
  if (/(post|competitor|trend|platform)/.test(text)) { keys.add('postAudit'); keys.add('competitorRationale'); }
  if (/(hook|offer|format|cta|campaign)/.test(text)) keys.add('campaignDecomposition');
  const out = {};
  for (const key of keys) {
    if (record.findings[key] === undefined) continue;
    const value = record.findings[key];
    if (!scope || !Object.keys(scope).length) { out[key] = clone(value); continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const comparison = scopeComparison(candidateScope(value), scope);
    const validity = evidenceValidity(value, now, record, targetForClaim(key), policy);
    if (comparison.status === 'known' && (validity.status === 'current' || validity.status === 'historical')) out[key] = clone(value);
  }
  return out;
}

function sourceMatchesScope(source, scope) {
  if (!scope || !Object.keys(scope).length) return true;
  const comparison = scopeComparison(candidateScope(source), scope);
  return comparison.status === 'known';
}

function filterEvidenceRows(record, decision, scope, now, policy) {
  if (!record) return [];
  const accepted = new Set((decision && decision.acceptedEvidence || []).map(item => item.id));
  if (decision && decision.questions && decision.questions.length) return (record.evidenceMatrix || []).filter(row => accepted.has(row.id));
  return (record.evidenceMatrix || []).filter(row => sourceMatchesScope(row, scope) && evidenceValidity(row, now, record, targetForClaim(row.question), policy).status === 'current');
}

function filterSources(record, decision, scope, now, policy) {
  if (!record) return [];
  const accepted = new Set((decision && decision.acceptedEvidence || []).map(item => item.id));
  const acceptedUrls = new Set((decision && decision.acceptedEvidence || []).map(item => item.source).filter(Boolean));
  if (decision && decision.questions && decision.questions.length) {
    return (record.sources || []).filter(source =>
      (accepted.has(source.sourceId) || acceptedUrls.has(source.url)) &&
      sourceMatchesScope(source, scope) &&
      source.applicability && source.applicability.status !== 'unknown' &&
      evidenceValidity(source, now, record, sourceKind(source) || 'product_claims', policy).status === 'current');
  }
  return (record.sources || []).filter(source => sourceMatchesScope(source, scope) && evidenceValidity(source, now, record, sourceKind(source) || 'product_claims', policy).status === 'current');
}

function taskContext(dir, options = {}) {
  const profile = profiles.context(dir);
  const now = clockNow(options);
  const record = read(dir, { ...options, now });
  const decision = record ? evidenceDecision(record, { ...options, now }) : evidenceDecision(null, { ...options, now });
  const scopedSources = filterSources(record, decision, normalizeScope(options.scope || {}), now, options.policy);
  const scopedEvidence = filterEvidenceRows(record, decision, normalizeScope(options.scope || {}), now, options.policy);
  const findings = record ? relevantFindings(record, options.brief, normalizeScope(options.scope || {}), now, options.policy) : {};
  const decisionGaps = decision && decision.gaps || [];
  const gaps = mergeByIdentity(record && record.gaps || [], decisionGaps, item => item.id || item.questionId + ':' + item.question);
  const compactDecision = decision ? {
    action: decision.action,
    zeroCall: decision.zeroCall,
    counts: decision.counts,
    reasons: decision.reasons,
    refreshRequired: decision.refreshRequired,
  } : null;
  const out = {
    declaredProfile: profile,
    researchedInterpretation: record ? {
      scope: clone(record.scope),
      competitors: clone(record.competitors),
      competitorDetails: clone(record.competitorDetails || []),
      findings,
      evidence: clone(scopedEvidence),
      sources: clone(scopedSources).map(source => ({
        sourceId: source.sourceId,
        url: source.url,
        observedAt: source.observedAt,
        claims: source.claims || [],
        limitation: source.limitation || null,
        validity: source.validity || null,
        applicability: source.applicability || null,
      })),
      gaps,
      freshness: clone(record.freshness || {}),
      current: Boolean(record.current),
      decision: compactDecision,
    } : null,
    brief: clone(options.brief || null),
    constraints: clone(options.constraints || []),
    approvals: clone(options.approvals || []),
    expectedOutput: options.expectedOutput || null,
  };
  Object.defineProperty(out, 'profile', { value: out.declaredProfile, enumerable: false });
  Object.defineProperty(out, 'research', { value: out.researchedInterpretation, enumerable: false });
  out.evidence = out.research ? out.research.evidence : [];
  out.gaps = out.research ? out.research.gaps : [];
  const text = JSON.stringify(out);
  if (text.length > 30000 && out.research) {
    out.research.sources = out.research.sources.slice(0, 20);
    out.research.evidence = out.research.evidence.slice(0, 40);
    out.research.findings = { summary: out.research.findings.summary || '' };
  }
  return out;
}

function refreshPlan(dir, request = {}) {
  const existing = rawResearch(dir);
  const record = normalizeRecord(existing);
  const profile = profiles.read(dir);
  const now = clockNow(request);
  const targets = new Set();
  const reasons = [];
  const changedClaims = request.changedClaims || request.changed || request.claims || [];
  if (Array.isArray(changedClaims)) {
    for (const claim of changedClaims) {
      const target = targetForClaim(claim);
      targets.add(target);
      reasons.push({ target, reason: String(claim), decision: 'refresh' });
    }
  }
  const scope = request.scope ? normalizeScope(request.scope) : {};
  const questions = request.questions || request.evidencePlan && request.evidencePlan.questions || [];
  const decision = record ? evidenceDecision(record, { ...request, scope, questions, now }) : evidenceDecision(null, { ...request, scope, questions, now });
  for (const item of decision.refreshRequired || []) {
    targets.add(item.target || targetForClaim(item.reason));
    reasons.push({ target: item.target || targetForClaim(item.reason), reason: item.reason, decision: 'refresh', questionId: item.questionId });
  }
  for (const gap of decision.gaps || []) {
    if (!gap.required) continue;
    const target = targetForClaim(gap.question);
    targets.add(target);
    reasons.push({ target, reason: gap.reason, decision: gap.decision || 'missing', questionId: gap.questionId });
  }
  if (request.competitors || request.discoverCompetitors || request.changedScope === 'competitors') {
    if (!record || !record.competitors || !record.competitors.length || request.discoverCompetitors) {
      targets.add('competitor_discovery');
      reasons.push({ target: 'competitor_discovery', reason: 'A supported shortlist is missing or explicitly requested.', decision: 'missing' });
    }
  }
  if (!targets.size && Object.keys(scope).length === 0 && !questions.length && record) {
    const current = read(dir, { now });
    for (const key of current && current.refreshTargets || []) targets.add(key);
    for (const [key, item] of Object.entries(current && current.freshness || {})) if (item.status === 'stale') targets.add(key);
  }
  if (!record) {
    targets.add('initial_research');
    reasons.push({ target: 'initial_research', reason: 'No saved research.', decision: 'missing' });
  }
  const competitorDiscovery = targets.has('competitor_discovery');
  return {
    targets: [...targets].filter(Boolean),
    reasons,
    scope,
    decision,
    consideredEvidence: decision.consideredEvidence || [],
    acceptedEvidence: decision.acceptedEvidence || [],
    refreshRequired: decision.refreshRequired || [],
    reuse: {
      competitors: Boolean(record && record.competitors && record.competitors.length && !competitorDiscovery),
      unavailableChannels: profile && profile.researchPolicy && profile.researchPolicy.skipAccountDiscovery || [],
    },
    gapCount: record && Array.isArray(record.gaps) ? record.gaps.length : decision.gaps.length,
  };
}

function needsRefresh(dir, scope, options = {}) {
  const actualScope = scope !== undefined ? scope : options.scope;
  const current = read(dir, { ...options, scope: actualScope });
  if (!current) return { required: true, targets: ['initial_research'], reasons: ['No saved research.'], current: false, refreshRequired: [] };
  const plan = refreshPlan(dir, { ...options, scope: actualScope, questions: options.questions });
  const reasons = [...(current.changedProfileFields || []), ...(plan.reasons || []).map(item => item.reason)];
  return {
    required: !current.current || plan.targets.length > 0,
    current: current.current,
    targets: plan.targets,
    reasons,
    gaps: current.gaps || [],
    decision: plan.decision,
    refreshRequired: plan.decision.refreshRequired || [],
  };
}

function routeDecision(dir, options = {}) {
  const job = options.job || {};
  execution.assertExecutionAvailable({ job });
  const questions = questionsForJob(job, options);
  const scope = questions[0] && questions[0].scope || normalizeScope(options.scope || {});
  const record = rawResearch(dir);
  const decision = evidenceDecision(record, { ...options, scope, questions, now: options.now || new Date() });
  const workRequired = decision.workRequired;
  const depth = workRequired ? (['paid', 'both'].includes(job.distribution) || (job.deliverables || []).some(item => ['ugc', 'brand_video', 'video', 'motion_graphic'].includes(item.creativeDiscipline)) ? 'full' : 'lite') : 'reuse';
  const budget = budgets.createBudget({
    kind: job.kind === 'paid_campaign' || ['paid', 'both'].includes(job.distribution) ? 'campaign' : 'simple_post',
    jobId: job.jobId,
    budgetRef: job.jobId ? 'research-' + job.jobId : null,
    now: options.now instanceof Date ? options.now : options.now ? new Date(options.now) : new Date(),
    policyVersion: decision.policyVersion,
  }).result();
  return {
    action: workRequired ? 'dispatch' : 'reuse',
    zeroCall: !workRequired,
    workRequired,
    researchDepth: depth,
    questionIds: questions.filter(question => question.material !== false).map(question => question.id),
    questions: decision.questions || [],
    counts: decision.counts,
    reasons: decision.reasons,
    consideredEvidence: decision.consideredEvidence,
    acceptedEvidence: decision.acceptedEvidence,
    refreshRequired: decision.refreshRequired,
    gaps: decision.gaps,
    policyVersion: decision.policyVersion,
    budget,
    stop: decision.stop,
  };
}

function saveResearchResult(dir, result, options = {}) {
  if (!result || typeof result !== 'object') throw new Error('Expected a research task result.');
  const expectedRevision = options.expectedRevision !== undefined ? options.expectedRevision : result.inputRevision !== undefined ? result.inputRevision : result.baseRevision;
  const fields = {
    expectedRevision,
    sources: result.sources,
    evidenceMatrix: result.evidenceMatrix,
    findings: result.findings,
    gaps: result.gaps,
    competitors: result.competitors,
    competitorDetails: result.competitorDetails,
    scope: result.scope,
    refreshTargets: result.refreshTargets,
    freshness: result.freshness,
    authorization: options.authorization || result.authorization,
    replaceCompetitors: result.replaceCompetitors,
  };
  for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key];
  return save(dir, fields, options);
}

module.exports = {
  MAX_RESEARCH_BYTES,
  POLICY_VERSION,
  DEFAULT_FRESHNESS_DAYS,
  FINDING_KEYS,
  DECISIONS,
  read,
  readResearch: read,
  save,
  saveResearch: save,
  saveResearchResult,
  needsRefresh,
  refreshPlan,
  freshnessStatus,
  evidenceDecision,
  evaluateEvidence: evidenceDecision,
  researchDecision: evidenceDecision,
  routeDecision,
  questionsForJob,
  taskContext,
  buildContext: taskContext,
  buildTaskContext: taskContext,
  compactContext: taskContext,
  context: taskContext,
  normalizeScope,
  normalizeSources,
  normalizeEvidenceMatrix,
  normalizeCompetitors,
  normalizeCompetitorDetails,
  normalizeGaps,
  sourceDate,
  targetForClaim,
  publicUrl: capabilities.publicUrl,
  createCapabilityBoundary: capabilities.createBoundary,
  sourceContent: capabilities.sourceContent,
  createResearchBudget: budgets.createBudget,
  loadResearchBudget: budgets.load,
  withSharedResearchBudget: budgets.withSharedBudget,
};
