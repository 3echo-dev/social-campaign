/**
 * Non destructive migration helpers for the legacy Social Campaign SQLite
 * workspace.  Inventory and dry runs only read the legacy database.  Apply
 * writes a new pipeline representation beside the old files, checkpoints every
 * item, verifies copied hashes and leaves the legacy workflow frozen for jobs
 * that were imported.
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { initializeWorkspace, runtimeConstants } from './runtime.mjs';

const SCHEMA_VERSION = '1.0';
const MIGRATION_VERSION = 1;
const LEGACY_DIR = '.social-campaign';
const RUNTIME_DIR = '.social-pipeline';
const MIGRATIONS_DIR = 'migrations';
const POINTER_FILE = 'active-pointer.json';
const DATE_RE = /^(\d{4})[-_]?([01]\d)[-_]?([0-3]\d)/;

const now = () => new Date().toISOString();
const text = (value) => (value == null ? '' : String(value));
const forward = (value) => text(value).split(sep).join('/');
const shortHash = (value, size = 12) => createHash('sha256').update(String(value)).digest('hex').slice(0, size);

function writeJsonAtomic(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function absoluteRoot(value) {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value)) {
    throw new TypeError('Migration requires an explicit absolute legacy workspace root.');
  }
  return resolve(value);
}

function databaseFor(options = {}) {
  if (options.dbPath) {
    if (!isAbsolute(options.dbPath)) throw new TypeError('dbPath must be absolute.');
    const dbPath = resolve(options.dbPath);
    return { root: options.root ? absoluteRoot(options.root) : resolve(dirname(dirname(dbPath))), dbPath };
  }
  const root = absoluteRoot(options.root);
  return { root, dbPath: join(root, LEGACY_DIR, 'creative.db') };
}

function tables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((row) => text(row.name));
}

function quoteIdentifier(name) {
  return `"${text(name).replaceAll('"', '""')}"`;
}

function rowCount(db, table) {
  try { return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get()?.count || 0); }
  catch { return null; }
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(text(value)); }
  catch { return fallback; }
}

function publicValue(value) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Buffer.isBuffer(value)) return { bytes: value.length, sha256: createHash('sha256').update(value).digest('hex') };
  return text(value);
}

function sampleRows(db, table, limit = 10) {
  try {
    return db.prepare(`SELECT * FROM ${quoteIdentifier(table)} LIMIT ?`).all(limit)
      .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, publicValue(value)])));
  } catch { return []; }
}

function legacyRows(db, table) {
  if (!table) return [];
  try { return db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all(); }
  catch { return []; }
}

function legacyDate(value, fallback = '19700101') {
  const match = text(value).match(DATE_RE);
  if (!match) return fallback;
  return `${match[1]}${match[2]}${match[3]}`;
}

function stableBrandId(legacyId) { return `brand-legacy-${shortHash(legacyId, 20)}`; }
function stableJobId(legacyId, createdAt) { return `job-${legacyDate(createdAt)}-legacy-${shortHash(legacyId, 18)}`; }

function stableSlug(value, fallback) {
  const slug = text(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function legacyStatus(value) {
  return text(value).trim().toLowerCase() || 'unknown';
}

function sourceIdentity(value) {
  if (value == null) return null;
  return text(value);
}

function readLegacyIdentity(root) {
  const integrations = readJson(join(root, LEGACY_DIR, 'integrations.json'), {});
  const owner = integrations?.threeecho_studio?.user || integrations?.threeecho_studio?.identity || null;
  return {
    source: existsSync(join(root, LEGACY_DIR, 'integrations.json')) ? 'integrations.json' : null,
    ownerUserId: owner?.userId || owner?.id || null,
    ownerEmail: owner?.email || null,
    verified: false,
    note: 'Legacy identity is not treated as Studio verification.',
  };
}

/**
 * Read the legacy SQLite workspace without creating or changing any file.
 */
export function inventoryLegacyWorkspace(options = {}) {
  const { root, dbPath } = databaseFor(options);
  const report = {
    schemaVersion: SCHEMA_VERSION,
    migrationVersion: MIGRATION_VERSION,
    kind: 'legacy-inventory',
    generatedAt: now(),
    legacyRoot: root,
    dbPath,
    exists: existsSync(dbPath),
    runtime: runtimeConstants,
    counts: {},
    tables: [],
    brands: [],
    jobs: [],
    assets: [],
    approvals: [],
    artifacts: [],
    identities: readLegacyIdentity(root),
    unmapped: [],
  };
  if (!report.exists) {
    report.unmapped.push({ kind: 'database', reason: 'Legacy creative.db was not found.' });
    return report;
  }

  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); }
  catch (error) {
    report.openError = error.message;
    report.unmapped.push({ kind: 'database', reason: 'Database could not be opened read-only.' });
    return report;
  }
  try {
    report.tables = tables(db).map((name) => ({ name, count: rowCount(db, name), sample: sampleRows(db, name, 3) }));
    report.counts = Object.fromEntries(report.tables.map((table) => [table.name, table.count]));
    const brandRows = legacyRows(db, report.counts.brands != null ? 'brands' : null);
    const campaignRows = legacyRows(db, report.counts.campaigns != null ? 'campaigns' : null);
    const assetRows = legacyRows(db, report.counts.assets != null ? 'assets' : null);
    const artifactRows = legacyRows(db, report.counts.artifacts != null ? 'artifacts' : null);
    const reviewRows = legacyRows(db, report.counts.reviews != null ? 'reviews' : null);

    report.brands = brandRows.map((row) => ({
      legacyId: sourceIdentity(row.id),
      brandId: stableBrandId(row.id),
      slug: stableSlug(row.slug || row.name, `legacy-${shortHash(row.id, 8)}`),
      name: text(row.name || row.slug || row.id || 'Legacy brand'),
      status: text(row.status || 'active'),
      website: row.website || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      ownerStatus: 'unverified',
    }));
    const brandIds = new Set(report.brands.map((row) => row.legacyId));
    const campaignById = new Map();
    report.jobs = campaignRows.map((row) => {
      const job = {
        legacyId: sourceIdentity(row.id),
        brandLegacyId: sourceIdentity(row.brand_id),
        brandId: row.brand_id != null ? stableBrandId(row.brand_id) : null,
        jobId: stableJobId(row.id, row.created_at),
        title: row.title || `Legacy job ${row.id}`,
        legacyJobType: row.job_type || null,
        startingPoint: row.starting_point || null,
        platforms: parseJson(row.platforms, []),
        legacyStatus: legacyStatus(row.status),
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        ownerStatus: 'unverified',
      };
      campaignById.set(job.legacyId, job);
      if (job.brandLegacyId && !brandIds.has(job.brandLegacyId)) {
        report.unmapped.push({ kind: 'job', legacyId: job.legacyId, reason: 'campaign references a brand that is absent from brands.' });
      }
      return job;
    });
    report.assets = assetRows.map((row) => {
      const campaign = campaignById.get(sourceIdentity(row.campaign_id));
      const asset = {
        legacyId: sourceIdentity(row.id),
        campaignLegacyId: sourceIdentity(row.campaign_id),
        jobId: campaign?.jobId || null,
        brandId: campaign?.brandId || (row.brand_id ? stableBrandId(row.brand_id) : null),
        path: row.path || null,
        sha256: row.sha256 || null,
        bytes: row.bytes == null ? null : Number(row.bytes),
        kind: row.kind || 'other',
        origin: row.origin || 'reference',
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      };
      if (!asset.jobId && !asset.brandId) report.unmapped.push({ kind: 'asset', legacyId: asset.legacyId, reason: 'asset has no mappable campaign or brand.' });
      return asset;
    });
    report.artifacts = artifactRows.map((row) => ({
      legacyId: sourceIdentity(row.id),
      campaignLegacyId: sourceIdentity(row.campaign_id),
      jobId: campaignById.get(sourceIdentity(row.campaign_id))?.jobId || null,
      kind: row.kind || 'legacy-artifact',
      path: row.path || null,
      json: parseJson(row.json, row.json == null ? null : { raw: text(row.json) }),
      version: row.version == null ? 1 : Number(row.version),
      createdAt: row.created_at || null,
    }));
    report.approvals = reviewRows.map((row) => ({
      legacyId: sourceIdentity(row.id),
      campaignLegacyId: sourceIdentity(row.campaign_id),
      jobId: campaignById.get(sourceIdentity(row.campaign_id))?.jobId || null,
      kind: row.kind || 'legacy',
      payload: parseJson(row.payload, row.payload == null ? null : { raw: text(row.payload) }),
      decision: row.decision == null ? null : parseJson(row.decision, row.decision),
      status: row.status || 'pending',
      createdAt: row.created_at || null,
      resolvedAt: row.resolved_at || null,
      verifiedApproval: false,
    }));
    for (const row of report.artifacts) {
      if (row.jobId == null) report.unmapped.push({ kind: 'artifact', legacyId: row.legacyId, reason: 'artifact references a campaign that cannot be mapped.' });
    }
    for (const row of report.approvals) {
      if (row.jobId == null) report.unmapped.push({ kind: 'approval', legacyId: row.legacyId, reason: 'approval references a campaign that cannot be mapped.' });
    }
  } finally {
    db.close();
  }
  report.mappingSummary = {
    brands: report.brands.length,
    jobs: report.jobs.length,
    assets: report.assets.filter((item) => item.jobId || item.brandId).length,
    approvals: report.approvals.filter((item) => item.jobId).length,
    artifacts: report.artifacts.filter((item) => item.jobId).length,
    unmapped: report.unmapped.length,
    verifiedOwners: 0,
  };
  return report;
}

function migrationDir(root) { return join(root, RUNTIME_DIR, 'migrations'); }
function reportPath(root, migrationId) { return join(migrationDir(root), `${migrationId}.json`); }
function checkpointPath(root, migrationId) { return join(migrationDir(root), `${migrationId}.checkpoint.json`); }

export function dryRunMigration(options = {}) {
  const inventory = inventoryLegacyWorkspace(options);
  const migrationId = options.migrationId || `migration-${shortHash(`${inventory.dbPath}:${inventory.generatedAt}`, 16)}`;
  const report = {
    ...inventory,
    kind: 'legacy-dry-run',
    migrationId,
    destinationRoot: inventory.legacyRoot,
    pointer: {
      ready: false,
      switched: false,
      file: forward(join(RUNTIME_DIR, MIGRATIONS_DIR, POINTER_FILE)),
      reason: 'Dry run does not create or switch a runtime pointer.',
    },
    executionPolicy: {
      legacyExecutionFrozenOnApply: true,
      importedJobsStartBlocked: true,
      approvalsAreHistoryUntilStudioReverification: true,
    },
    plan: {
      brands: inventory.brands.map((brand) => ({
        legacyId: brand.legacyId,
        brandId: brand.brandId,
        destination: forward(join('workspaces', brand.slug)),
        action: 'create-if-absent',
      })),
      jobs: inventory.jobs.map((job) => ({
        legacyId: job.legacyId,
        jobId: job.jobId,
        destination: forward(join('workspaces', inventory.brands.find((brand) => brand.brandId === job.brandId)?.slug || 'legacy-unmapped', 'jobs', job.jobId)),
        action: 'create-if-absent-blocked',
      })),
    },
  };
  if (options.reportPath) writeJsonAtomic(options.reportPath, report);
  return report;
}

function hashFile(filePath) {
  try { return createHash('sha256').update(readFileSync(filePath)).digest('hex'); }
  catch { return null; }
}

function backupLegacyDatabase(root, dbPath, migrationId) {
  const backupDir = join(root, LEGACY_DIR, 'backups');
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, `legacy-${migrationId}.db`);
  if (existsSync(target)) return { path: target, sha256: hashFile(target), reused: true };
  let source;
  let restored;
  try {
    source = new DatabaseSync(dbPath, { readOnly: true });
    source.prepare('VACUUM INTO ?').run(target);
    source.close();
    source = null;
    restored = new DatabaseSync(target, { readOnly: true });
    const check = restored.prepare('PRAGMA quick_check').get();
    if (!check || check.quick_check !== 'ok') throw new Error('SQLite quick_check did not return ok.');
    restored.close();
    restored = null;
    return { path: target, sha256: hashFile(target), reused: false };
  } finally {
    try { source?.close(); } catch { /* preserve original error */ }
    try { restored?.close(); } catch { /* preserve original error */ }
  }
}

function ownerClaim(options, legacyId, kind) {
  const claims = options.ownerClaims && typeof options.ownerClaims === 'object' ? options.ownerClaims : {};
  const claim = claims[`${kind}:${legacyId}`] || claims[legacyId];
  if (!claim || claim.verified !== true || !claim.userId) {
    return { userId: null, email: null, status: 'unverified', source: null };
  }
  return { userId: text(claim.userId), email: claim.email ? text(claim.email).toLowerCase() : null, status: 'verified', source: 'migration-owner-claim' };
}

function ensureBrand(root, row, options, migrationId) {
  const dir = join(root, 'workspaces', row.slug);
  const existing = readJson(join(dir, 'workspace.json'));
  if (existing) {
    if (existing.legacySourceId !== row.legacyId && existing.brandId !== row.brandId) {
      return { ok: false, conflict: true, path: dir, reason: 'destination brand slug already belongs to another record.' };
    }
    return { ok: true, created: false, path: dir, brand: existing };
  }
  mkdirSync(join(dir, 'brand'), { recursive: true });
  mkdirSync(join(dir, 'jobs'), { recursive: true });
  mkdirSync(join(root, 'inputs', row.slug), { recursive: true });
  const owner = ownerClaim(options, row.legacyId, 'brand');
  const brand = {
    schemaVersion: SCHEMA_VERSION,
    brandId: row.brandId,
    legacySourceId: row.legacyId,
    brand: row.slug,
    name: row.name,
    status: row.status === 'archived' ? 'archived' : 'active',
    timezone: null,
    approver: null,
    ownerUserId: owner.userId,
    ownerEmail: owner.email,
    ownershipStatus: owner.status,
    created: row.createdAt || null,
    migratedAt: now(),
    migrationId,
    accounts: { facebook: { handle: null, pageId: null, url: null, state: 'unknown', notes: '' }, instagram: { handle: null, url: null, state: 'unknown', notes: '' }, tiktok: { handle: null, url: null, state: 'unknown', notes: '' } },
    cadence: { facebook: null, instagram: null, tiktok: null },
    brandFilesReviewed: false,
    brandFiles: { 'brand-voice': 1, audience: 1, positioning: 1, 'platform-playbook': 1 },
    policies: { namedTestimonials: 'paraphrase_only_until_permission_confirmed', syntheticPeopleDisclosure: 'always' },
    legacy: { sourceId: row.legacyId, website: row.website, updatedAt: row.updatedAt },
  };
  writeJsonAtomic(join(dir, 'workspace.json'), brand);
  for (const stem of ['brand-voice', 'audience', 'positioning', 'platform-playbook']) {
    const source = join(runtimeConstants.pipelineRoot, 'templates', 'brand', `${stem}.md`);
    if (existsSync(source)) writeFileSync(join(dir, 'brand', `${stem}.md`), readFileSync(source, 'utf8'), 'utf8');
  }
  return { ok: true, created: true, path: dir, brand };
}

function mapKind(legacyType) {
  if (legacyType === 'ad_campaign') return { kind: 'paid_campaign', distribution: 'paid' };
  if (legacyType === 'ugc') return { kind: 'ugc_creative', distribution: 'organic' };
  if (legacyType === 'analyze_existing') return { kind: 'content_repurpose', distribution: 'organic' };
  return { kind: 'organic_post', distribution: 'organic' };
}

function statusMarkdown(job, brandSlug, reason) {
  return `# Job status: ${job.jobId}\n\n**Brand:** ${brandSlug}\n**Job:** \`${job.jobId}\`\n**Title:** ${job.title}\n**Current state:** \`BLOCKED\`\n**Revision:** \`0\`\n**Last updated:** ${now()}\n**Next action:** Verify this imported legacy record before resuming.\n**Blocked on:** ${reason}\n\n---\n\nThis job was imported from legacy SQLite data. No approval or completion state was inferred.\n`;
}

function ensureJob(root, brand, row, options, migrationId, intakeArtifact) {
  const dir = join(root, 'workspaces', brand.slug, 'jobs', row.jobId);
  const existing = readJson(join(dir, 'job.json'));
  if (existing) {
    if (existing.legacySourceId !== row.legacyId) return { ok: false, conflict: true, path: dir, reason: 'destination job already belongs to another record.' };
    return { ok: true, created: false, path: dir, job: existing };
  }
  for (const part of ['research', 'drafts', 'media', 'validation', 'revisions', 'approvals', 'handoff', 'campaign', 'legacy']) mkdirSync(join(dir, part), { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), '', 'utf8');
  const mapped = mapKind(row.legacyJobType);
  const owner = ownerClaim(options, row.legacyId, 'job');
  const intake = intakeArtifact && typeof intakeArtifact.json === 'object' ? intakeArtifact.json : {};
  const job = {
    schemaVersion: SCHEMA_VERSION,
    jobId: row.jobId,
    brand: brand.slug,
    brandId: brand.brandId,
    legacySourceId: row.legacyId,
    title: text(row.title),
    request: text(intake.request || intake.goal || ''),
    kind: mapped.kind,
    distribution: mapped.distribution,
    objective: 'engagement',
    platforms: Array.isArray(row.platforms) ? row.platforms : [],
    deliverables: [],
    audience: { description: '', personas: [] },
    offer: null,
    landingPageUrl: null,
    sourceRefs: [],
    evidence: { supplied: false },
    requiredClaims: [],
    prohibitedClaims: [],
    schedule: null,
    budget: null,
    requestedAt: row.createdAt || now(),
    ownerUserId: owner.userId,
    ownerEmail: owner.email,
    ownershipStatus: owner.status,
    inputRevision: null,
    inputRevisions: [],
    migratedAt: now(),
    migrationId,
    legacyMapping: { jobType: row.legacyJobType, startingPoint: row.startingPoint, status: row.legacyStatus, inferred: ['kind', 'distribution', 'objective'] },
  };
  writeJsonAtomic(join(dir, 'job.json'), job);
  writeJsonAtomic(join(dir, 'route.json'), {
    schemaVersion: SCHEMA_VERSION,
    jobId: row.jobId,
    status: 'BLOCKED',
    workflowId: null,
    workflowVersion: null,
    requiredDisciplines: [],
    owner: null,
    support: [],
    riskFlags: [],
    modelAddedRiskFlags: [],
    gates: [],
    confidence: 0,
    missingFields: [],
    unsupported: [],
    rationale: ['Legacy record imported for inspection. Re-verify intake and ownership before routing.'],
    blockers: ['legacy ownership and execution state require verification'],
    createdAt: now(),
    migrationId,
  });
  writeFileSync(join(dir, 'status.md'), statusMarkdown(job, brand.slug, 'Studio ownership verification and migration review'), 'utf8');
  return { ok: true, created: true, path: dir, job };
}

function copyLegacyAsset(root, brand, job, asset, migrationId, files) {
  if (!asset.path || !job) return { copied: false, reason: 'no mapped path or job' };
  const candidates = [];
  if (isAbsolute(text(asset.path))) candidates.push(resolve(text(asset.path)));
  else {
    candidates.push(resolve(root, text(asset.path)));
    candidates.push(resolve(text(asset.path)));
  }
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) return { copied: false, reason: 'legacy asset path is not readable', sourcePath: text(asset.path) };
  try {
    if (lstatSync(source).isSymbolicLink()) return { copied: false, reason: 'legacy symbolic link was not copied', sourcePath: forward(source) };
    const revisionId = `legacy-${migrationId}`;
    const destinationDir = join(root, 'inputs', brand.slug, job.jobId, 'revisions', revisionId, 'files', 'legacy-assets');
    mkdirSync(destinationDir, { recursive: true });
    const filename = `${shortHash(asset.legacyId, 10)}-${basename(source)}`;
    const destination = join(destinationDir, filename);
    if (!existsSync(destination)) copyFileSync(source, destination);
    const sourceHash = hashFile(source);
    const destinationHash = hashFile(destination);
    const copied = Boolean(sourceHash && destinationHash && sourceHash === destinationHash);
    const row = { legacyAssetId: asset.legacyId, sourcePath: forward(source), path: forward(relative(root, destination)), sha256: destinationHash, copied, origin: asset.origin, kind: asset.kind };
    files.push(row);
    return copied ? { copied: true, row } : { copied: false, row, reason: 'copied hash did not match source hash' };
  } catch (error) {
    return { copied: false, reason: error.message, sourcePath: forward(source) };
  }
}

function writeLegacyAssets(root, brand, job, assets, migrationId) {
  const files = [];
  const failures = [];
  for (const asset of assets) {
    const result = copyLegacyAsset(root, brand, job, asset, migrationId, files);
    if (!result.copied) failures.push({ legacyAssetId: asset.legacyId, ...result });
  }
  if (!files.length && !failures.length) return null;
  const revisionId = `legacy-${migrationId}`;
  const destination = join(root, 'inputs', brand.slug, job.jobId, 'revisions', revisionId);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    revisionId,
    brandId: brand.brandId,
    brand: brand.slug,
    jobId: job.jobId,
    route: 'legacy-migration',
    importedAt: now(),
    sourcePaths: assets.map((asset) => asset.path).filter(Boolean),
    files,
    unreadable: failures,
    skipped: [],
    previousRevisionId: null,
    migrationId,
  };
  writeJsonAtomic(join(destination, 'manifest.json'), manifest);
  writeJsonAtomic(join(dirname(destination), '..', 'manifest.json'), {
    schemaVersion: SCHEMA_VERSION,
    brand: brand.slug,
    jobId: job.jobId,
    currentRevisionId: revisionId,
    revisions: [{ revisionId, manifestPath: forward(relative(root, join(destination, 'manifest.json'))) }],
    updatedAt: now(),
  });
  return manifest;
}

function writeLegacyArtifacts(root, job, artifacts) {
  if (!job || !artifacts.length) return [];
  const destination = join(root, 'workspaces', job.brand, 'jobs', job.jobId, 'legacy', 'artifacts');
  const written = [];
  for (const artifact of artifacts) {
    const filename = `${stableSlug(artifact.kind, 'artifact')}-v${artifact.version}-${shortHash(artifact.legacyId, 8)}.json`;
    const target = join(destination, filename);
    if (!existsSync(target)) {
      writeJsonAtomic(target, {
        legacySourceId: artifact.legacyId,
        kind: artifact.kind,
        version: artifact.version,
        sourcePath: artifact.path,
        value: artifact.json,
        createdAt: artifact.createdAt,
      });
    }
    written.push({ legacySourceId: artifact.legacyId, path: forward(relative(root, target)), sha256: hashFile(target) });
  }
  return written;
}

function writeLegacyApprovals(root, job, approvals) {
  if (!job || !approvals.length) return [];
  const destination = join(root, 'workspaces', job.brand, 'jobs', job.jobId, 'approvals');
  const written = [];
  for (const approval of approvals) {
    const target = join(destination, `legacy-${shortHash(approval.legacyId, 16)}.json`);
    if (!existsSync(target)) {
      writeJsonAtomic(target, { ...approval, importedAsHistory: true, verifiedApproval: false });
    }
    written.push({ legacySourceId: approval.legacyId, path: forward(relative(root, target)), sha256: hashFile(target), verifiedApproval: false });
  }
  return written;
}

function writeLegacyEvents(root, job, options) {
  if (!job || !options.events?.length) return 0;
  const target = join(root, 'workspaces', job.brand, 'jobs', job.jobId, 'events.jsonl');
  const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const lines = options.events.filter((event) => !existing.includes(`"legacySourceId":"${event.id}"`)).map((event) => JSON.stringify({
    ...event.payload,
    name: event.name,
    legacySourceId: event.id,
    createdAt: event.created_at,
    importedAsHistory: true,
  }));
  if (lines.length) writeFileSync(target, `${lines.join('\n')}${lines.length ? '\n' : ''}`, { encoding: 'utf8', flag: existsSync(target) ? 'a' : 'w' });
  return lines.length;
}

function updateCheckpoint(filePath, value) { writeJsonAtomic(filePath, value); }

/**
 * Import the legacy workspace beside its existing files.  Set switchPointer to
 * true only after the generated report has verified all copied hashes.
 */
export function migrateLegacyWorkspace(options = {}) {
  const inventory = inventoryLegacyWorkspace(options);
  const root = inventory.legacyRoot;
  if (!inventory.exists) throw new Error(`Legacy database not found: ${inventory.dbPath}`);
  const migrationId = options.migrationId || `migration-${shortHash(`${inventory.dbPath}:${inventory.counts.events || 0}:${inventory.counts.artifacts || 0}`, 16)}`;
  const reportFile = reportPath(root, migrationId);
  const checkpointFile = checkpointPath(root, migrationId);
  const existingReport = readJson(reportFile);
  if (existingReport?.complete && !options.force) return existingReport;
  initializeWorkspace({ root, ownerUserId: options.ownerUserId, ownerEmail: options.ownerEmail });
  const checkpoint = readJson(checkpointFile, {
    schemaVersion: SCHEMA_VERSION,
    migrationId,
    phase: 'inventory',
    brands: {},
    jobs: {},
    processed: 0,
  });
  const report = {
    ...inventory,
    kind: 'legacy-migration',
    migrationId,
    startedAt: checkpoint.startedAt || now(),
    destinationRoot: root,
    backup: checkpoint.backup || null,
    mappings: { brands: [], jobs: [], assets: [], artifacts: [], approvals: [], owners: [] },
    checkpoints: checkpoint,
    complete: false,
    pointer: { ready: false, switched: false, file: forward(join(RUNTIME_DIR, MIGRATIONS_DIR, POINTER_FILE)) },
    executionPolicy: { legacyExecutionFrozenOnApply: true, importedJobsStartBlocked: true, approvalsAreHistoryUntilStudioReverification: true },
  };
  const sourceHashBefore = checkpoint.sourceHashBefore || hashFile(inventory.dbPath);
  checkpoint.sourceHashBefore = sourceHashBefore;
  checkpoint.startedAt = report.startedAt;
  checkpoint.phase = 'inventory';
  writeJsonAtomic(reportFile, report);
  updateCheckpoint(checkpointFile, checkpoint);

  const backup = checkpoint.backup || backupLegacyDatabase(root, inventory.dbPath, migrationId);
  report.backup = backup;
  checkpoint.backup = backup;
  checkpoint.phase = 'backup_verified';
  updateCheckpoint(checkpointFile, checkpoint);
  report.checkpoints = checkpoint;
  writeJsonAtomic(reportFile, report);

  const brandMap = new Map();
  for (const row of inventory.brands) {
    const result = ensureBrand(root, row, options, migrationId);
    report.mappings.brands.push({ legacySourceId: row.legacyId, brandId: row.brandId, slug: row.slug, ...result });
    report.mappings.owners.push({ kind: 'brand', legacySourceId: row.legacyId, ...ownerClaim(options, row.legacyId, 'brand') });
    if (result.ok) brandMap.set(row.legacyId, {
      ...row,
      path: result.path,
      slug: row.slug,
      brandId: row.brandId,
      brand: result.brand || readJson(join(result.path, 'workspace.json')),
    });
    checkpoint.brands[row.legacyId] = { done: result.ok, path: result.path, conflict: result.conflict || false };
    checkpoint.processed = Number(checkpoint.processed || 0) + 1;
    updateCheckpoint(checkpointFile, checkpoint);
    if (options.failAfter && checkpoint.processed >= Number(options.failAfter)) throw new Error(`Migration interrupted after checkpoint ${checkpoint.processed}.`);
  }
  checkpoint.phase = 'brands';
  updateCheckpoint(checkpointFile, checkpoint);

  const artifactsByJob = new Map();
  for (const artifact of inventory.artifacts) {
    if (!artifact.jobId) continue;
    const list = artifactsByJob.get(artifact.jobId) || [];
    list.push(artifact);
    artifactsByJob.set(artifact.jobId, list);
  }
  const approvalsByJob = new Map();
  for (const approval of inventory.approvals) {
    if (!approval.jobId) continue;
    const list = approvalsByJob.get(approval.jobId) || [];
    list.push(approval);
    approvalsByJob.set(approval.jobId, list);
  }

  let db;
  try { db = new DatabaseSync(inventory.dbPath, { readOnly: true }); } catch (error) { throw new Error(`Legacy database changed before migration: ${error.message}`); }
  const eventRows = new Map();
  try {
    if (inventory.counts.events != null) {
      for (const row of legacyRows(db, 'events')) {
        const list = eventRows.get(sourceIdentity(row.campaign_id)) || [];
        list.push(row);
        eventRows.set(sourceIdentity(row.campaign_id), list);
      }
    }
    for (const row of inventory.jobs) {
      const brand = brandMap.get(row.brandLegacyId);
      if (!brand) {
        report.mappings.jobs.push({ legacySourceId: row.legacyId, jobId: row.jobId, ok: false, reason: 'brand was not mapped' });
        continue;
      }
      const intake = (artifactsByJob.get(row.jobId) || []).find((artifact) => artifact.kind === 'JobIntake');
      const result = ensureJob(root, brand, row, options, migrationId, intake);
      report.mappings.jobs.push({ legacySourceId: row.legacyId, jobId: row.jobId, brandId: brand.brandId, ...result });
      report.mappings.owners.push({ kind: 'job', legacySourceId: row.legacyId, ...ownerClaim(options, row.legacyId, 'job') });
      const job = result.job || readJson(join(result.path, 'job.json'));
      const assets = inventory.assets.filter((asset) => asset.jobId === row.jobId);
      const manifest = writeLegacyAssets(root, brand, job, assets, migrationId);
      if (manifest) report.mappings.assets.push({ jobId: row.jobId, revisionId: manifest.revisionId, files: manifest.files.length, unreadable: manifest.unreadable.length });
      const artifactFiles = writeLegacyArtifacts(root, job, artifactsByJob.get(row.jobId) || []);
      report.mappings.artifacts.push(...artifactFiles.map((entry) => ({ jobId: row.jobId, ...entry })));
      const approvals = writeLegacyApprovals(root, job, approvalsByJob.get(row.jobId) || []);
      report.mappings.approvals.push(...approvals.map((entry) => ({ jobId: row.jobId, ...entry })));
      writeLegacyEvents(root, job, { events: eventRows.get(row.legacyId) || [] });
      checkpoint.jobs[row.legacyId] = { done: result.ok, path: result.path, conflict: result.conflict || false };
      checkpoint.processed = Number(checkpoint.processed || 0) + 1;
      updateCheckpoint(checkpointFile, checkpoint);
      if (options.failAfter && checkpoint.processed >= Number(options.failAfter)) throw new Error(`Migration interrupted after checkpoint ${checkpoint.processed}.`);
    }
  } finally {
    db.close();
  }
  checkpoint.phase = 'jobs';
  updateCheckpoint(checkpointFile, checkpoint);

  const sourceHashAfter = hashFile(inventory.dbPath);
  checkpoint.sourceHashAfter = sourceHashAfter;
  const verification = {
    backupVerified: Boolean(report.backup?.sha256),
    legacyDatabaseUnchanged: Boolean(sourceHashBefore && sourceHashAfter && sourceHashBefore === sourceHashAfter),
    mappedBrands: report.mappings.brands.filter((item) => item.ok).length,
    mappedJobs: report.mappings.jobs.filter((item) => item.ok).length,
    copiedAssets: report.mappings.assets.reduce((total, item) => total + Number(item.files || 0), 0),
    mappedArtifacts: report.mappings.artifacts.length,
    mappedApprovals: report.mappings.approvals.length,
    conflicts: [...report.mappings.brands, ...report.mappings.jobs].filter((item) => item.conflict).length,
  };
  report.verification = verification;
  if (!verification.backupVerified || !verification.legacyDatabaseUnchanged || verification.conflicts > 0) {
    report.pointer = { ready: false, switched: false, file: forward(join(RUNTIME_DIR, MIGRATIONS_DIR, POINTER_FILE)), reason: 'Verification did not pass; pointer was not changed.' };
    report.complete = false;
    checkpoint.phase = 'verification_failed';
    updateCheckpoint(checkpointFile, checkpoint);
    writeJsonAtomic(reportFile, report);
    return report;
  }

  const freeze = {
    schemaVersion: SCHEMA_VERSION,
    migrationId,
    createdAt: now(),
    legacyRoot: root,
    legacyDatabase: inventory.dbPath,
    legacyExecutionDisabled: true,
    jobs: report.mappings.jobs.filter((item) => item.ok).map((item) => ({ legacySourceId: item.legacySourceId, jobId: item.jobId, blocked: true })),
    reason: 'Imported jobs must run only through the verified local pipeline after adoption.',
  };
  writeJsonAtomic(join(migrationDir(root), `${migrationId}.legacy-freeze.json`), freeze);
  const pointer = {
    schemaVersion: SCHEMA_VERSION,
    migrationId,
    legacyRoot: root,
    activeRoot: root,
    legacyDatabase: inventory.dbPath,
    runtimeConfig: forward(join(RUNTIME_DIR, 'config.json')),
    freezeFile: forward(join(RUNTIME_DIR, MIGRATIONS_DIR, `${migrationId}.legacy-freeze.json`)),
    switchedAt: now(),
  };
  if (options.switchPointer === true) {
    writeJsonAtomic(join(migrationDir(root), POINTER_FILE), pointer);
    report.pointer = { ready: true, switched: true, file: forward(join(RUNTIME_DIR, MIGRATIONS_DIR, POINTER_FILE)), value: pointer };
    checkpoint.phase = 'pointer_switched';
  } else {
    report.pointer = { ready: true, switched: false, file: forward(join(RUNTIME_DIR, MIGRATIONS_DIR, POINTER_FILE)), value: pointer, reason: 'Set switchPointer:true after reviewing this report.' };
    checkpoint.phase = 'verified';
  }
  report.complete = true;
  report.finishedAt = now();
  checkpoint.complete = true;
  updateCheckpoint(checkpointFile, checkpoint);
  report.checkpoints = checkpoint;
  writeJsonAtomic(reportFile, report);
  return report;
}

export function readMigrationReport({ root, migrationId, path: explicitPath } = {}) {
  if (explicitPath) return readJson(explicitPath);
  const abs = absoluteRoot(root);
  if (migrationId) return readJson(reportPath(abs, migrationId));
  const dir = migrationDir(abs);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => /^migration-.+\.json$/.test(name) && !name.includes('.checkpoint.') && !name.includes('.legacy-freeze.'))
    .sort();
  return files.length ? readJson(join(dir, files.at(-1))) : null;
}

export const inventory = inventoryLegacyWorkspace;
export const dryRun = dryRunMigration;
export const migrate = migrateLegacyWorkspace;

export default {
  inventoryLegacyWorkspace,
  dryRunMigration,
  migrateLegacyWorkspace,
  readMigrationReport,
};
