// Capability checks for task-contract dispatch.
//
// Agent instructions are useful context, not a security boundary.  A producer or a
// dispatcher can call these checks before opening a path, provider or connector.  They
// reject cross-task and cross-brand access before the operation happens and preserve a
// small structured denial that can be recorded without copying secrets.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { isSafeRef } = require('./lib-task-contracts.js');
const execution = require('./lib-execution-availability.js');

class CapabilityError extends Error {
  constructor(message, code = 'CAPABILITY_DENIED', details = {}) {
    super(message);
    this.name = 'CapabilityError';
    this.code = code;
    this.audit = { code, ...details };
  }
}

function deny(code, message, details = {}) {
  throw new CapabilityError(message, code, details);
}

function hasCapability(contract, capability) {
  return Boolean(contract && Array.isArray(contract.allowedCapabilities) &&
    contract.allowedCapabilities.includes(capability));
}

function assertTaskExecutionAvailable(contract) {
  if (contract && contract.taskKey) execution.assertExecutionAvailable({ contract, taskKey: contract.taskKey, row: contract });
  return true;
}

function assertCapability(contract, capability, details = {}) {
  assertTaskExecutionAvailable(contract);
  if (!hasCapability(contract, capability)) {
    deny('CAPABILITY_NOT_GRANTED', 'Task ' + (contract && contract.taskKey || '?') +
      ' is not allowed to use capability ' + capability + '.', { capability, taskKey: contract && contract.taskKey, ...details });
  }
  return true;
}

function normalizeRef(ref) {
  return String(ref || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function realPathIfExists(value) {
  try { return fs.realpathSync.native(value); } catch { return path.resolve(value); }
}

function realPathOfExistingAncestor(value) {
  let current = path.resolve(value);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(value);
    current = parent;
  }
  const resolved = realPathIfExists(current);
  const suffix = path.relative(current, path.resolve(value));
  return suffix ? path.resolve(resolved, suffix) : resolved;
}

function within(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(base + path.sep);
}

function assignedRefs(contract, mode) {
  if (!contract) return [];
  const refs = mode === 'write' ? contract.outputRefs :
    mode === 'context' ? contract.contextRefs : contract.inputRefs;
  return Array.isArray(refs) ? refs.map(normalizeRef) : [];
}

function refMatches(assigned, requested) {
  const a = normalizeRef(assigned);
  const r = normalizeRef(requested);
  if (a === r) return true;
  if (a.endsWith('/') && r.startsWith(a)) return true;
  if (a.includes('*')) {
    const pattern = '^' + a.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
    return new RegExp(pattern).test(r);
  }
  return false;
}

function assertAssignedPath(contract, jobDir, ref, mode = 'read') {
  const capability = mode === 'write' ? 'write_task_output' : 'read_assigned_inputs';
  assertCapability(contract, capability, { ref: normalizeRef(ref), mode });
  const requested = normalizeRef(ref);
  if (!isSafeRef(requested)) deny('PATH_DENIED', 'Unsafe task path: ' + requested, { ref: requested, mode });
  const refs = assignedRefs(contract, mode);
  if (!refs.some(assigned => refMatches(assigned, requested))) {
    deny('PATH_NOT_ASSIGNED', 'Task ' + contract.taskKey + ' is not assigned ' + mode + ' access to ' + requested + '.',
      { taskKey: contract.taskKey, ref: requested, mode });
  }
  const root = path.resolve(jobDir);
  const target = path.resolve(root, requested);
  if (!within(root, target)) deny('PATH_DENIED', 'Task path leaves the assigned job: ' + requested, { ref: requested, mode });
  const existingParent = fs.existsSync(target) ? target : path.dirname(target);
  const resolvedRoot = realPathIfExists(root);
  const resolvedParent = realPathOfExistingAncestor(existingParent);
  if (!within(resolvedRoot, resolvedParent)) {
    deny('SYMLINK_ESCAPE', 'Task path resolves outside the assigned job: ' + requested,
      { ref: requested, mode });
  }
  return target;
}

function privateAddress(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const octets = host.split('.').map(Number);
    return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168);
  }
  if (ipVersion === 6) {
    return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') ||
      /^fe[89ab]/i.test(host);
  }
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host.endsWith('.internal') || host === 'metadata.google.internal';
}

// Public fetching is a mediated capability.  Callers validate every redirect target
// before following it; this helper never follows redirects or performs DNS resolution.
function assertPublicUrl(contract, value, options = {}) {
  assertCapability(contract, options.capability || 'fetch_public', { url: String(value || '') });
  let parsed;
  try { parsed = new URL(String(value)); } catch { deny('FETCH_URL_DENIED', 'Fetch target is not a valid URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      !parsed.hostname || privateAddress(parsed.hostname)) {
    deny('FETCH_URL_DENIED', 'Fetch target is not a permitted public URL.', { scheme: parsed && parsed.protocol });
  }
  const redirects = Array.isArray(options.redirects) ? options.redirects : [];
  if (redirects.length > (options.maxRedirects ?? 5)) {
    deny('FETCH_REDIRECT_DENIED', 'Fetch redirect limit exceeded.', { maxRedirects: options.maxRedirects ?? 5 });
  }
  for (const redirect of redirects) assertPublicUrl(contract, redirect, { ...options, redirects: [], maxRedirects: 0 });
  return parsed.toString();
}

function assertBrandScope(contract, requestedBrand, expectedBrand) {
  if (requestedBrand && expectedBrand && String(requestedBrand) !== String(expectedBrand)) {
    deny('CROSS_BRAND_DENIED', 'Task cannot access another brand.', { taskKey: contract && contract.taskKey });
  }
  return true;
}

function assertProvider(contract, provider, options = {}) {
  const name = String(provider || '').trim();
  const allowed = Array.isArray(options.allowedProviders) ? options.allowedProviders.map(String) : [];
  const producerOnly = options.producerOnly !== false;
  if (producerOnly && (!contract || contract.agent !== 'producer')) {
    deny('PROVIDER_MEDIATED', 'Provider calls are producer-mediated for this task.', { provider: name, taskKey: contract && contract.taskKey });
  }
  assertCapability(contract, options.capability || 'generate_media', { provider: name });
  if (allowed.length && !allowed.includes(name)) {
    deny('PROVIDER_NOT_APPROVED', 'Provider is not approved for this task.', { provider: name, taskKey: contract && contract.taskKey });
  }
  if (options.accountScope && options.expectedAccountScope && options.accountScope !== options.expectedAccountScope) {
    deny('ACCOUNT_SCOPE_DENIED', 'Provider account is outside the approved scope.', { provider: name, taskKey: contract && contract.taskKey });
  }
  return true;
}

function denialRecord(error, extra = {}) {
  return {
    event: 'capability.denied',
    code: error && error.code || 'CAPABILITY_DENIED',
    taskKey: error && error.audit && error.audit.taskKey || extra.taskKey || null,
    capability: error && error.audit && error.audit.capability || extra.capability || null,
    ref: error && error.audit && error.audit.ref || extra.ref || null,
    // Never include the error message by default: fetched content or paths can contain
    // secrets.  The bounded code is enough for the audit trail.
    at: new Date().toISOString(),
  };
}

module.exports = {
  CapabilityError,
  hasCapability,
  assertTaskExecutionAvailable,
  assertCapability,
  assertAssignedPath,
  assertPublicUrl,
  assertBrandScope,
  assertProvider,
  denialRecord,
  normalizeRef,
  refMatches,
};
