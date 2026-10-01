// Validation for the production handoff boundary.
//
// A handoff directory is an output package, not evidence that a platform post happened.
// Completion therefore requires a valid package, approvals that still cover the source
// artifacts, and a separately recorded delivery reference.  This module is shared by the
// completion command, the capacity guard and compatibility migration so those paths cannot
// quietly grow different definitions of "delivered".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const durable = require('./lib-durable.js');
const events = require('./lib-events.js');
const { hashFile } = require('./hash-artifact.js');
const availability = require('./lib-execution-availability.js');
const states = require('./lib-states.js');

const MANIFEST_REL = 'handoff/manifest.json';
const DELIVERY_REL = 'handoff/delivery.json';
const ACTIVE_APPROVAL_GATES = Object.freeze(
  ['content', 'publish', 'campaign_proposal', 'campaign_activation', 'findings'].filter(gate => states.GATE_IDS.includes(gate))
);
const DELIVERY_STATES = new Set([
  'HANDOFF_READY', 'HANDED_OFF', 'METRICS_PENDING', 'REPORT_DRAFTED',
  'AWAITING_REPORT_APPROVAL', 'COMPLETE',
]);

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function safeRelative(value) {
  const ref = String(value || '').replace(/\\/g, '/').trim();
  if (!ref || ref.startsWith('/') || /^[A-Za-z]:[\\/]/.test(ref) || ref.split('/').includes('..') || ref.includes('\0')) return null;
  return ref.replace(/^\.\//, '');
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function fileHash(file) {
  try { return hashFile(file); } catch { return null; }
}

function manifestHash(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest));
  delete copy.builtAt;
  return crypto.createHash('sha256').update(JSON.stringify(copy)).digest('hex');
}

function assertAvailableJob(jobDir) {
  const result = availability.checkJobDirectory(jobDir, { requireJob: true, requireRoute: true });
  if (!result.available) throw new availability.ExecutionAvailabilityError(result);
  return result;
}

function requiredGates(jobDir, route) {
  const named = Array.isArray(route && route.gates) ? route.gates : [];
  return ACTIVE_APPROVAL_GATES.filter(gate => named.includes(gate));
}

function approvalFiles(jobDir, gate) {
  const dir = path.join(jobDir, 'approvals');
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  return files.filter(file => file.startsWith(gate + '-') && file.endsWith('.json'))
    .map(file => ({ file, record: readJson(path.join(dir, file)) }))
    .filter(item => item.record && Number.isSafeInteger(Number(item.record.round)))
    .sort((a, b) => Number(a.record.round) - Number(b.record.round) || a.file.localeCompare(b.file));
}

function validateApproval(jobDir, brand, jobId, gate) {
  const latest = approvalFiles(jobDir, gate).pop();
  if (!latest) return { gate, valid: false, reason: 'no approval record' };
  const record = latest.record;
  const result = {
    gate,
    valid: false,
    approvalId: record.approvalId || latest.file.replace(/\.json$/, ''),
    decision: record.decision || null,
    changed: [],
    missing: [],
  };
  if (record.decision !== 'approved') {
    result.reason = 'latest record is ' + String(record.decision || 'unknown');
    return result;
  }
  if (record.jobId && String(record.jobId) !== String(jobId)) {
    result.reason = 'approval belongs to another job';
    return result;
  }
  if (brand && record.brand && String(record.brand) !== String(brand)) {
    result.reason = 'approval belongs to another brand';
    return result;
  }
  if (!Array.isArray(record.artifacts) || !record.artifacts.length) {
    result.reason = 'approval has no artifact hashes';
    return result;
  }
  for (const artifact of record.artifacts) {
    const ref = safeRelative(artifact && artifact.path);
    if (!ref) { result.changed.push({ path: String(artifact && artifact.path || ''), reason: 'unsafe path' }); continue; }
    const file = path.join(jobDir, ref);
    if (!inside(jobDir, file) || !fs.existsSync(file)) { result.missing.push(ref); continue; }
    const actual = fileHash(file);
    if (!actual || actual.sha256 !== artifact.sha256 || Number(actual.bytes) !== Number(artifact.bytes)) {
      result.changed.push({ path: ref, approved: String(artifact.sha256 || '').slice(0, 12), now: actual && actual.sha256 ? actual.sha256.slice(0, 12) : null });
    }
  }
  result.valid = !result.changed.length && !result.missing.length;
  if (!result.valid && !result.reason) result.reason = 'approved artifacts changed';
  return result;
}

function readManifest(jobDir, manifestRel = MANIFEST_REL) {
  const ref = safeRelative(manifestRel);
  if (!ref) return { manifest: null, file: null, errors: ['manifest path is unsafe'] };
  const file = path.join(jobDir, ref);
  if (!inside(jobDir, file)) return { manifest: null, file, errors: ['manifest path leaves the job'] };
  const manifest = readJson(file);
  return manifest ? { manifest, file, errors: [] } : { manifest: null, file, errors: ['handoff manifest is missing or invalid JSON'] };
}

function validateManifest(jobDir, brand, jobId, manifestRel = MANIFEST_REL) {
  const read = readManifest(jobDir, manifestRel);
  const errors = read.errors.slice();
  const manifest = read.manifest;
  if (!manifest) return { ok: false, errors, manifest: null, manifestFile: read.file, manifestHash: null };
  if (String(manifest.schemaVersion || '') !== '1.0') errors.push('handoff manifest schema version is not supported');
  if (manifest.jobId && String(manifest.jobId) !== String(jobId)) errors.push('handoff manifest belongs to another job');
  if (manifest.brand && brand && String(manifest.brand) !== String(brand)) errors.push('handoff manifest belongs to another brand');
  if (!Array.isArray(manifest.files) || !manifest.files.length) errors.push('handoff manifest has no files');
  const handoffRoot = path.dirname(read.file);
  const seen = new Set();
  for (const item of manifest.files || []) {
    const ref = safeRelative(item && (item.path || item.file));
    if (!ref) { errors.push('handoff manifest contains an unsafe file path'); continue; }
    if (seen.has(ref)) { errors.push('handoff manifest repeats ' + ref); continue; }
    seen.add(ref);
    const file = path.join(handoffRoot, ref);
    let realFile = null;
    try { realFile = fs.realpathSync(file); } catch {}
    let isFile = false;
    try { isFile = Boolean(realFile && fs.statSync(realFile).isFile()); } catch {}
    if (!inside(handoffRoot, file) || !realFile || !inside(handoffRoot, realFile) || !isFile) {
      errors.push('handoff file is missing: ' + ref); continue;
    }
    const actual = fileHash(file);
    if (!actual || actual.sha256 !== item.sha256 || Number(actual.bytes) !== Number(item.bytes)) errors.push('handoff file changed: ' + ref);
  }
  return {
    ok: errors.length === 0,
    errors,
    manifest,
    manifestFile: read.file,
    manifestHash: manifestHash(manifest),
  };
}

function readDelivery(jobDir) {
  const file = path.join(jobDir, DELIVERY_REL);
  const record = readJson(file);
  return record ? { file, record } : { file, record: null };
}

function validateDeliveryReference(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const reference = value.trim();
  let kind = 'reference';
  if (/^https?:\/\//i.test(reference)) kind = 'url';
  else if (/^(?:local|file):/i.test(reference) || /^[A-Za-z]:[\\/]/.test(reference)) kind = 'file';
  else if (/^(?:op|operation)[-_:#]/i.test(reference)) kind = 'operation';
  return { reference, kind };
}

function deliveryRecordMatches(delivery, result, required) {
  if (!delivery || !result || !result.manifest) return false;
  if (String(delivery.schemaVersion || '') !== '1.0') return false;
  if (delivery.jobId && String(delivery.jobId) !== String(result.jobId)) return false;
  if (result.brand && delivery.brand && String(delivery.brand) !== String(result.brand)) return false;
  if (String(delivery.manifest || '').replace(/\\/g, '/') !== MANIFEST_REL) return false;
  if (!validateDeliveryReference(delivery.reference)) return false;
  if (delivery.manifestHash !== result.manifestHash) return false;
  if (!Number.isFinite(Date.parse(String(delivery.firstDeliveryAt || ''))) ||
      !/(?:Z|[+-]\d\d:\d\d)$/.test(String(delivery.firstDeliveryAt || ''))) return false;
  if (typeof delivery.recordedBy !== 'string' || !delivery.recordedBy.trim() ||
      !Number.isFinite(Date.parse(String(delivery.recordedAt || ''))) ||
      !/(?:Z|[+-]\d\d:\d\d)$/.test(String(delivery.recordedAt || ''))) return false;
  const ids = delivery.approvalIds;
  if (!ids || typeof ids !== 'object' || Array.isArray(ids)) return false;
  const manifestApprovals = result.manifest.approvals;
  for (const gate of required) {
    if (!ids[gate] || !manifestApprovals || ids[gate] !== manifestApprovals[gate]) return false;
  }
  return true;
}

function recordDelivery(jobDir, input = {}) {
  // Historical files remain readable through validateHandoff, but recording a new production
  // delivery is an execution mutation and must pass the shared availability policy.
  try {
    assertAvailableJob(jobDir);
  } catch (error) {
    const availabilityResult = error && error.availability;
    const historicalRecovery = input.compatibilityRecovery === true && availabilityResult &&
      availabilityResult.code === 'HISTORICAL_EXECUTION_UNAVAILABLE';
    if (!historicalRecovery) throw error;
  }
  const ref = validateDeliveryReference(input.deliveryRef || input.reference);
  if (!ref) throw new Error('A delivery reference is required. It may identify the delivered package, a message, or an external operation.');
  const verified = validateHandoff(jobDir, {
    brand: input.brand,
    jobId: input.jobId,
    manifestPath: input.manifestPath || MANIFEST_REL,
  });
  if (!verified.ok) throw new Error('Cannot record delivery: ' + verified.errors.join('; '));
  const file = path.join(jobDir, DELIVERY_REL);
  let saved;
  let verifiedCurrent = verified;
  durable.update(file, raw => {
    // Reconcile the package and approval hashes after taking the delivery lock. A producer or
    // approval writer may have changed an artifact between the preflight and this write.
    const fresh = validateHandoff(jobDir, {
      brand: input.brand, jobId: input.jobId, manifestPath: input.manifestPath || MANIFEST_REL,
    });
    if (!fresh.ok) throw new Error('Cannot record delivery: ' + fresh.errors.join('; '));
    verifiedCurrent = fresh;
    const current = raw.trim() ? JSON.parse(raw) : null;
    if (current) {
      if (current.manifestHash !== verifiedCurrent.manifestHash || current.reference !== ref.reference) {
        throw new Error('A different first delivery is already recorded for this handoff.');
      }
      saved = current;
      return raw;
    }
    const recordedAt = input.recordedAt || new Date().toISOString();
    if (!/(?:Z|[+-]\d\d:\d\d)$/.test(String(recordedAt)) || !Number.isFinite(Date.parse(recordedAt))) {
      throw new Error('Delivery time must be an ISO timestamp with an explicit timezone.');
    }
    saved = {
      schemaVersion: '1.0',
      jobId: input.jobId || path.basename(jobDir),
      ...(input.brand ? { brand: String(input.brand) } : {}),
      reference: ref.reference,
      referenceKind: ref.kind,
      manifest: String(input.manifestPath || MANIFEST_REL).replace(/\\/g, '/'),
      manifestHash: verifiedCurrent.manifestHash,
      approvalIds: Object.fromEntries((verified.approvals || []).map(item => [item.gate, item.approvalId])),
      firstDeliveryAt: new Date(recordedAt).toISOString(),
      recordedAt: new Date().toISOString(),
      recordedBy: String(input.recordedBy || input.by || 'producer'),
      externalPublication: 'unreported',
      ...(input.operationId ? { operationId: String(input.operationId).slice(0, 200) } : {}),
    };
    return JSON.stringify(saved, null, 2) + '\n';
  });
  // A source writer can race the delivery lock immediately after the locked preflight.  Do not
  // let the caller treat that write as a completed handoff until a final read still proves the
  // package and its approval bindings.  The sidecar is retained for reconciliation, but state
  // completion will remain guarded when this check fails.
  const after = validateHandoff(jobDir, {
    brand: input.brand, jobId: input.jobId, manifestPath: input.manifestPath || MANIFEST_REL,
  });
  if (!after.ok) throw new Error('The handoff changed while delivery was being recorded: ' + after.errors.join('; '));
  verifiedCurrent = after;
  if (saved && saved.manifestHash === verifiedCurrent.manifestHash && saved.reference === ref.reference) {
    // The event is idempotent through the stable manifest/reference key. It is intentionally
    // separate from status transition events so an offline sync cannot reopen production.
    const jobSpec = readJson(path.join(jobDir, 'job.json')) || {};
    const event = events.makeEvent(saved.jobId || path.basename(jobDir), 'delivery.recorded', saved.firstDeliveryAt,
      { type: 'job', id: saved.jobId || path.basename(jobDir) }, {
        milestone: 'first_delivery', status: 'recorded',
        deliverables: (verifiedCurrent.manifest.files || []).map(item => item.path).filter(Boolean).slice(0, 50),
      }, {
        dedupeKey: 'delivery:' + verifiedCurrent.manifestHash + ':' + ref.reference,
        workspaceId: jobSpec.workspaceId,
        brandId: jobSpec.brand,
        jobId: saved.jobId || path.basename(jobDir),
        ownerUserId: jobSpec.ownerUserId,
        ownerEmail: jobSpec.ownerEmailVerified === true ? jobSpec.ownerEmail : undefined,
        source: 'handoff', host: 'local', quality: 'measured',
      });
    durable.update(path.join(jobDir, 'events.jsonl'), raw => {
      for (const line of String(raw || '').split(/\r?\n/)) {
        try { if (JSON.parse(line).eventId === event.eventId) return raw; } catch {}
      }
      return String(raw || '') + (raw && !String(raw).endsWith('\n') ? '\n' : '') + JSON.stringify(event) + '\n';
    });
  }
  return saved;
}

// ---- Posts the person says they made themselves ("I'll post it myself") ---------------------
//
// The posting kit's "Mark as posted" is the person's word, never a platform's. Each mark is kept in
// publish/posted.json (post id to { source: 'person', at, link? }), with the rest of the publishing state,
// because build-handoff.js clears and rebuilds handoff/ whenever it runs. Once the hand-off is built the
// marks are copied into handoff/delivery.json under `posts`, together with the delivery record that names
// the kit (the same reference for every job), so the job can be completed with it.
const SELF_DELIVERY_REF = 'operation:posting-kit:self';
const POSTED_REL = 'publish/posted.json';
const PERSON_LINK_LIMIT = 500;
const POST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

// An https address of at most 500 characters with a host and nothing a person could not click, or null.
function validPersonLink(value) {
  if (typeof value !== 'string') return null;
  const link = value.trim();
  if (!link || link.length > PERSON_LINK_LIMIT || /[\u0000-\u0020\u007f]/.test(link)) return null;
  let url;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
  return link;
}

// One post's mark as the record keeps it, or null when it is not a well-formed person mark.
function validPersonPost(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.source !== 'person') return null;
  const at = String(entry.at || '');
  if (!Number.isFinite(Date.parse(at)) || !/(?:Z|[+-]\d\d:\d\d)$/.test(at)) return null;
  const clean = { source: 'person', at: new Date(at).toISOString() };
  if (entry.link !== undefined && entry.link !== null) {
    const link = validPersonLink(entry.link);
    if (!link) return null;
    clean.link = link;
  }
  if (typeof entry.requestId === 'string' && entry.requestId) clean.requestId = entry.requestId.slice(0, 200);
  return clean;
}

function validMarks(value) {
  const marks = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return marks;
  for (const [id, entry] of Object.entries(value)) {
    const clean = POST_ID.test(id) ? validPersonPost(entry) : null;
    if (clean) marks[id] = clean;
  }
  return marks;
}

// The valid person marks in publish/posted.json, by post id. A missing or unreadable file has none.
function readPersonPosts(jobDir) {
  return validMarks(readJson(path.join(jobDir, ...POSTED_REL.split('/'))));
}

// Record that the person posted one post, in publish/posted.json, written atomically. The caller holds the job's send lock
// (server/pipeline/board.mjs does). Throws a plain sentence when the mark is not valid. Marking a post again changes nothing:
// the first mark stays, and the answer says so (`already`). Returns { marks, already }.
function recordPersonPost(jobDir, input = {}) {
  const postId = String(input.postId || '');
  if (!POST_ID.test(postId)) throw new Error('Say which post this is.');
  const given = input.link !== undefined && input.link !== null && input.link !== '';
  const link = given ? validPersonLink(input.link) : null;
  if (given && !link) throw new Error('The link has to be a full https address of at most ' + PERSON_LINK_LIMIT + ' characters.');
  const at = input.at ? String(input.at) : new Date().toISOString();
  const entry = validPersonPost({ source: 'person', at, ...(link ? { link } : {}), ...(input.requestId ? { requestId: input.requestId } : {}) });
  if (!entry) throw new Error('The time this was posted is not valid.');
  let already = false;
  durable.update(path.join(jobDir, ...POSTED_REL.split('/')), raw => {
    let current = {};
    try { current = raw.trim() ? JSON.parse(raw) : {}; } catch { throw new Error('The record of posted posts could not be read, so nothing was marked.'); }
    const marks = validMarks(current);
    if (marks[postId]) { already = true; return JSON.stringify(marks, null, 2) + '\n'; }
    return JSON.stringify({ ...marks, [postId]: entry }, null, 2) + '\n';
  });
  return { marks: readPersonPosts(jobDir), already };
}

// Write the delivery record for a job whose posts are all out (sent through Metricool) or marked by the person, and copy the
// person's marks into it. Done after the hand-off package is built each time the job is closed, since a rebuild clears handoff/
// (and this record with it). `deliveryRef` is the reference the job is completed with (the posting kit's own, or the Metricool
// one that names every post). The first delivery is the earliest mark, else `at`, else now. Throws a plain sentence when it
// cannot be recorded (the package has to be built and still match its approvals). Returns the delivery record.
function recordPublishedDelivery(jobDir, input = {}) {
  const marks = readPersonPosts(jobDir);
  // The first delivery is the earliest of the marks and `at` (the earliest send), else now.
  const first = [...Object.values(marks).map(mark => mark.at), input.at].filter(at => Number.isFinite(Date.parse(at))).map(at => new Date(at).toISOString()).sort()[0] || new Date().toISOString();
  const ref = input.deliveryRef || SELF_DELIVERY_REF;
  const delivery = recordDelivery(jobDir, { brand: input.brand, jobId: input.jobId, deliveryRef: ref, recordedBy: input.by || 'The board', recordedAt: first });
  if (delivery.reference !== ref) throw new Error('This job was delivered another way, so it cannot be closed here.');
  let saved = delivery;
  durable.update(path.join(jobDir, DELIVERY_REL), raw => {
    const current = raw.trim() ? JSON.parse(raw) : delivery;
    saved = Object.keys(marks).length ? { ...current, posts: { ...validMarks(current.posts), ...marks } } : current;
    return JSON.stringify(saved, null, 2) + '\n';
  });
  return saved;
}

function validateHandoff(jobDir, options = {}) {
  const brand = options.brand || (readJson(path.join(jobDir, 'job.json')) || {}).brand || null;
  const jobId = options.jobId || (readJson(path.join(jobDir, 'job.json')) || {}).jobId || path.basename(jobDir);
  const routeFile = path.join(jobDir, 'route.json');
  const route = options.route || readJson(routeFile);
  const manifestResult = validateManifest(jobDir, brand, jobId, options.manifestPath || MANIFEST_REL);
  const errors = manifestResult.errors.slice();
  const routeValid = Boolean(route && typeof route === 'object' && !Array.isArray(route));
  if (!routeValid) errors.push('route.json is missing or invalid');
  if (routeValid && !Array.isArray(route.gates)) {
    errors.push('route.json has no valid gates list');
  }
  const approvals = [];
  const gates = requiredGates(jobDir, route || {});
  const manifestApprovals = manifestResult.manifest && manifestResult.manifest.approvals;
  if (gates.length && (!manifestApprovals || typeof manifestApprovals !== 'object' || Array.isArray(manifestApprovals))) {
    errors.push('handoff manifest has no approval binding map');
  }
  for (const gate of gates) {
    const result = validateApproval(jobDir, brand, jobId, gate);
    approvals.push(result);
    if (!result.valid) errors.push(gate + ': ' + (result.reason || 'approval is not current'));
    const manifestApproval = manifestApprovals && manifestApprovals[gate];
    if (!manifestApproval) errors.push(gate + ': handoff manifest does not bind an approval');
    else if (result.approvalId && manifestApproval !== result.approvalId) errors.push(gate + ': manifest approval does not match the current approval');
  }
  const deliveryRead = readDelivery(jobDir);
  let delivery = deliveryRead.record;
  if (options.deliveryRef) {
    const parsed = validateDeliveryReference(options.deliveryRef);
    if (!parsed) errors.push('delivery reference is invalid');
    else if (delivery && (delivery.reference !== parsed.reference || delivery.manifestHash !== manifestResult.manifestHash)) errors.push('recorded delivery does not match this handoff');
  }
  if (options.requireDelivery) {
    if (!delivery) errors.push('no delivery reference has been recorded');
    else if (delivery.manifestHash !== manifestResult.manifestHash) errors.push('delivery reference belongs to another handoff manifest');
    else if (!validateDeliveryReference(delivery.reference)) errors.push('recorded delivery reference is invalid');
    else if (!deliveryRecordMatches(delivery, {
      manifest: manifestResult.manifest, manifestHash: manifestResult.manifestHash,
      jobId, brand,
    }, gates)) errors.push('delivery record is not a validated first-delivery record');
  }
  return {
    ok: errors.length === 0,
    errors,
    brand,
    jobId,
    route,
    manifest: manifestResult.manifest,
    manifestFile: manifestResult.manifestFile,
    manifestHash: manifestResult.manifestHash,
    manifestValid: manifestResult.ok,
    routeValid,
    approvals,
    delivery,
    deliveryValid: deliveryRecordMatches(delivery, {
      manifest: manifestResult.manifest, manifestHash: manifestResult.manifestHash,
      jobId, brand,
    }, gates),
  };
}

// Capacity checks need evidence that a package really was delivered, but a later source edit
// must not make a previously delivered job consume a production slot. The immutable package and
// first-delivery record are the evidence here; completion still requires current approvals.
function isVerifiedDelivered(jobDir, options = {}) {
  const status = String(options.state || '').trim();
  if (status && !DELIVERY_STATES.has(status)) return false;
  const result = validateHandoff(jobDir, { ...options, requireDelivery: true });
  if (result.ok) return true;
  if (!result.delivery || !result.manifest) return false;
  return result.manifestValid && result.routeValid && result.deliveryValid;
}

module.exports = {
  MANIFEST_REL, DELIVERY_REL, ACTIVE_APPROVAL_GATES, DELIVERY_STATES,
  safeRelative, requiredGates, validateApproval, validateManifest, validateDeliveryReference,
  readDelivery, recordDelivery, validateHandoff, isVerifiedDelivered, manifestHash, assertAvailableJob,
  deliveryRecordMatches, SELF_DELIVERY_REF, POSTED_REL, PERSON_LINK_LIMIT, validPersonLink, validPersonPost, readPersonPosts, recordPersonPost, recordPublishedDelivery,
};
