/**
 * Brand identity memory.
 *
 * brands holds the identity row; brand_fields holds every other fact, with
 * provenance handled by provenance.mjs. Specialists never write brand_fields
 * directly: they call proposeBrandUpdate, which applies the precedence rule and
 * queues anything that loses it as a memory_proposals row (spec section 19).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { newId, nowIso } from '../lib/ids.mjs';
import { toJsonColumn, parseJson } from '../lib/json.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { isTooBroadSourceFolder } from '../lib/paths.mjs';
import { getLiveField, listLiveFields, writeField, correctField } from './provenance.mjs';
import { getCreativeProfile } from './creative.mjs';

const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'tiktok'];

/** The four pillars a person sees and edits. Order matters: it is the display order. */
const PILLAR_KEYS = ['brand_voice', 'audience', 'positioning', 'platform_playbook'];

const PILLAR_TITLES = {
  brand_voice: 'Brand Voice',
  audience: 'Audience',
  positioning: 'Positioning',
  platform_playbook: 'Platform Playbook',
};

/** One short line of what each pillar is for, shown under its label on the screen. */
export const PILLAR_HELP = {
  brand_voice: 'How the brand sounds: tone, words it uses and words it avoids.',
  audience: 'Who this is for: their situation, what they want and what holds them back.',
  positioning: 'What makes this brand the right choice, and against what alternative.',
  platform_playbook: 'How to show up on Facebook, Instagram and TikTok specifically.',
};

export { PILLAR_KEYS };

/**
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
  const base = String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : 'brand';
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} name
 * @returns {string}
 */
function uniqueSlug(db, name) {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  const exists = (value) => db.prepare('SELECT 1 FROM brands WHERE slug = ?').get(value);
  while (exists(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{name: string, website?: string, socials?: Record<string, string>, guidelines_text?: string, files?: string[]}} input
 * @returns {Record<string, any>}
 */
export function createBrand(db, input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new InvalidInputError('A brand needs a name.');
  if (typeof input.source_media_folder === 'string' && input.source_media_folder.trim()
      && isTooBroadSourceFolder(input.source_media_folder.trim(), input.workspaceRoot)) {
    throw new InvalidInputError('That source media folder is too broad to index. Choose a specific folder rather than the home directory, a drive root or the workspace root.');
  }
  const id = newId();
  const slug = uniqueSlug(db, name);
  const now = nowIso();
  const website = typeof input.website === 'string' && input.website.trim() ? input.website.trim() : null;
  db.prepare(
    'INSERT INTO brands (id, name, slug, website, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, name, slug, website, 'active', now, now);

  if (website) {
    writeField(db, {
      brandId: id,
      fieldPath: 'identity.website',
      value: website,
      sourceType: 'user_brand_guide',
      sourceRef: 'brand_create',
      confidence: 0.9,
    });
  }
  const socials = input.socials && typeof input.socials === 'object' ? input.socials : {};
  for (const platform of SOCIAL_PLATFORMS) {
    const handle = socials[platform];
    if (typeof handle === 'string' && handle.trim()) {
      writeField(db, {
        brandId: id,
        fieldPath: `social.${platform}`,
        value: handle.trim(),
        sourceType: 'user_brand_guide',
        sourceRef: 'brand_create',
        confidence: 0.9,
      });
    }
  }
  if (typeof input.guidelines_text === 'string' && input.guidelines_text.trim()) {
    writeField(db, {
      brandId: id,
      fieldPath: 'identity.guidelines_text',
      value: input.guidelines_text.trim(),
      sourceType: 'user_brand_guide',
      sourceRef: 'brand_create',
      confidence: 0.95,
    });
  }
  if (Array.isArray(input.files) && input.files.length > 0) {
    writeField(db, {
      brandId: id,
      fieldPath: 'identity.files',
      value: input.files.map(String),
      sourceType: 'user_brand_guide',
      sourceRef: 'brand_create',
      confidence: 0.9,
    });
  }
  if (typeof input.brief === 'string' && input.brief.trim()) {
    writeField(db, {
      brandId: id,
      fieldPath: 'identity.brief',
      value: input.brief.trim(),
      sourceType: 'user_brand_guide',
      sourceRef: 'brand_create',
      confidence: 0.95,
    });
  }
  if (Array.isArray(input.creative_references) && input.creative_references.length > 0) {
    writeField(db, {
      brandId: id,
      fieldPath: 'identity.creative_references',
      value: input.creative_references.map(String),
      sourceType: 'user_brand_guide',
      sourceRef: 'brand_create',
      confidence: 0.9,
    });
  }
  if (typeof input.source_media_folder === 'string' && input.source_media_folder.trim()) {
    writeField(db, {
      brandId: id,
      fieldPath: 'identity.source_media_folder',
      value: input.source_media_folder.trim(),
      sourceType: 'user_brand_guide',
      sourceRef: 'brand_create',
      confidence: 0.9,
    });
  }
  return getBrand(db, id);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Record<string, any>[]}
 */
export function listBrands(db) {
  return db.prepare('SELECT * FROM brands ORDER BY created_at DESC').all();
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} brandId
 * @returns {Record<string, any>}
 */
export function requireBrandRow(db, brandId) {
  const row = db.prepare('SELECT * FROM brands WHERE id = ?').get(brandId);
  if (!row) throw new InvalidInputError(`There is no brand with id "${brandId}".`);
  return row;
}

/**
 * Identity, fields with provenance, creative profile and social profiles for a brand.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} brandId
 * @returns {Record<string, any>}
 */
export function getBrand(db, brandId) {
  const brand = requireBrandRow(db, brandId);
  const fields = listLiveFields(db, brandId);
  const socialProfiles = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const field = fields.find((entry) => entry.field_path === `social.${platform}`);
    socialProfiles[platform] = field ? field.value : null;
  }
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    website: brand.website,
    status: brand.status,
    created_at: brand.created_at,
    updated_at: brand.updated_at,
    fields: fields.map((field) => ({
      field_path: field.field_path,
      value: field.value,
      source_type: field.source_type,
      source_ref: field.source_ref,
      observed_at: field.observed_at,
      last_verified_at: field.last_verified_at,
      confidence: field.confidence,
    })),
    creative_profile: getCreativeProfile(db, brandId),
    social_profiles: socialProfiles,
  };
}

/**
 * Apply the precedence rule per field, queueing anything that loses as a proposal.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{brand_id: string, fields: Array<Record<string, any>>, proposed_by: string}} input
 * @returns {{applied: Array<Record<string, any>>, queued: Array<Record<string, any>>}}
 */
export function proposeBrandUpdate(db, input) {
  const brandId = String(input.brand_id ?? '');
  requireBrandRow(db, brandId);
  const fields = Array.isArray(input.fields) ? input.fields : [];
  const proposedBy = String(input.proposed_by ?? 'unknown');
  const applied = [];
  const queued = [];

  for (const field of fields) {
    const fieldPath = String(field.key ?? field.field_path ?? '');
    if (!fieldPath) throw new InvalidInputError('Every proposed field needs a key.');
    const sourceType = String(field.source_type ?? 'model_inference');
    const result = writeField(db, {
      brandId,
      fieldPath,
      value: field.value,
      sourceType,
      sourceRef: field.source_ref ?? null,
      observedAt: field.observed_at,
      confidence: typeof field.confidence === 'number' ? field.confidence : 0.5,
    });
    if (result.applied) {
      if (fieldPath === 'identity.website' && typeof field.value === 'string') {
        db.prepare('UPDATE brands SET website = ?, updated_at = ? WHERE id = ?').run(field.value, nowIso(), brandId);
      }
      applied.push({ field_path: fieldPath, value: field.value, reason: result.reason });
    } else {
      const proposalId = newId();
      db.prepare(
        `INSERT INTO memory_proposals (id, target, brand_id, json, status, proposed_by, reason, created_at)
         VALUES (?, 'brand', ?, ?, 'proposed', ?, ?, ?)`,
      ).run(
        proposalId,
        brandId,
        toJsonColumn({
          field_path: fieldPath,
          value: field.value,
          source_type: sourceType,
          source_ref: field.source_ref ?? null,
          observed_at: field.observed_at ?? nowIso(),
          confidence: typeof field.confidence === 'number' ? field.confidence : 0.5,
        }),
        proposedBy,
        result.reason,
        nowIso(),
      );
      queued.push({ proposal_id: proposalId, field_path: fieldPath, reason: result.reason });
    }
  }
  return { applied, queued };
}

/**
 * A user correction, top precedence, always applied.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{brand_id: string, key: string, value: unknown}} input
 * @returns {Record<string, any>}
 */
export function correctBrandField(db, input) {
  const brandId = String(input.brand_id ?? '');
  requireBrandRow(db, brandId);
  const fieldPath = String(input.key ?? '');
  if (!fieldPath) throw new InvalidInputError('A correction needs a field key.');
  const field = correctField(db, { brandId, fieldPath, value: input.value, sourceRef: 'user_correction' });
  if (fieldPath === 'identity.website' && typeof input.value === 'string') {
    db.prepare('UPDATE brands SET website = ?, updated_at = ? WHERE id = ?').run(input.value, nowIso(), brandId);
  }
  return field;
}

/**
 * Render the filesystem wiki for a brand: brands/<slug>/brand-profile.md and
 * creative-profile.md, from the database (spec section 26). This is a read model,
 * never a source of truth: the database is always authoritative.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} workspaceRoot
 * @param {string} brandId
 * @returns {{brand_profile_path: string, creative_profile_path: string}}
 */
export function writeBrandWiki(db, workspaceRoot, brandId) {
  const brand = getBrand(db, brandId);
  const dir = join(workspaceRoot, 'brands', brand.slug);
  mkdirSync(dir, { recursive: true });

  const lines = [`# ${brand.name}`, ''];
  lines.push(`Website: ${brand.website ?? 'not known'}`);
  lines.push('');
  lines.push('## Social profiles');
  lines.push('');
  for (const platform of SOCIAL_PLATFORMS) {
    lines.push(`- ${platform}: ${brand.social_profiles[platform] ?? 'not known'}`);
  }
  lines.push('');
  lines.push('## Brand facts');
  lines.push('');
  if (brand.fields.length === 0) {
    lines.push('No brand facts have been recorded yet.');
  } else {
    for (const field of brand.fields) {
      const value = typeof field.value === 'string' ? field.value : JSON.stringify(field.value);
      lines.push(`- **${field.field_path}**: ${value}`);
      lines.push(`  Source: ${field.source_type}${field.source_ref ? ` (${field.source_ref})` : ''}, confidence ${field.confidence}.`);
    }
  }
  lines.push('');
  const brandProfilePath = join(dir, 'brand-profile.md');
  writeFileSync(brandProfilePath, `${lines.join('\n')}\n`, 'utf8');

  const creativeLines = [`# ${brand.name} - Creative Profile`, ''];
  if (!brand.creative_profile) {
    creativeLines.push('No creative profile has been built yet.');
  } else {
    const profile = brand.creative_profile.profile;
    creativeLines.push(`Version ${brand.creative_profile.version}.`);
    creativeLines.push('');
    if (profile.summary) {
      creativeLines.push(String(profile.summary));
      creativeLines.push('');
    }
    if (Array.isArray(profile.formats) && profile.formats.length > 0) {
      creativeLines.push('## Formats');
      creativeLines.push('');
      for (const format of profile.formats) creativeLines.push(`- ${format.format}${format.frequency ? ` (${format.frequency})` : ''}`);
      creativeLines.push('');
    }
    if (Array.isArray(profile.hooks) && profile.hooks.length > 0) {
      creativeLines.push('## Hooks');
      creativeLines.push('');
      for (const hook of profile.hooks) creativeLines.push(`- ${hook.family}${hook.frequency ? ` (${hook.frequency})` : ''}`);
      creativeLines.push('');
    }
  }
  creativeLines.push('');
  const creativeProfilePath = join(dir, 'creative-profile.md');
  writeFileSync(creativeProfilePath, `${creativeLines.join('\n')}\n`, 'utf8');

  return { brand_profile_path: brandProfilePath, creative_profile_path: creativeProfilePath };
}

/**
 * The four pillars for a brand, each with its current value, the source behind it,
 * and whether it is still a gap (no research and no edit has filled it in yet).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} brandId
 * @returns {Record<string, {value: string, source_type: string|null, gap: boolean}>}
 */
export function getPillars(db, brandId) {
  requireBrandRow(db, brandId);
  const fields = listLiveFields(db, brandId);
  /** @type {Record<string, {value: string, source_type: string|null, gap: boolean}>} */
  const pillars = {};
  for (const key of PILLAR_KEYS) {
    const field = fields.find((entry) => entry.field_path === `pillars.${key}`);
    const value = field && typeof field.value === 'string' ? field.value : '';
    pillars[key] = { value, source_type: field ? field.source_type : null, gap: value.trim().length === 0 };
  }
  return pillars;
}

/**
 * Save the person's edits to the four pillars. Each edited pillar is recorded as a
 * user correction, the top precedence source, so it outranks whatever research
 * proposed there before. Then the pillar markdown files are (re)written and the
 * wiki is refreshed so every read model reflects the edit.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} workspaceRoot
 * @param {{brand_id: string, pillars: Record<string, string>}} input
 * @returns {{applied: Array<{field_path: string, value: string}>, files: Record<string, string>}}
 */
export function savePillars(db, workspaceRoot, input) {
  const brandId = String(input.brand_id ?? '');
  requireBrandRow(db, brandId);
  const pillars = input.pillars && typeof input.pillars === 'object' ? input.pillars : {};
  const applied = [];
  for (const key of PILLAR_KEYS) {
    if (typeof pillars[key] !== 'string') continue;
    const field = correctField(db, {
      brandId,
      fieldPath: `pillars.${key}`,
      value: pillars[key],
      sourceRef: 'user_correction',
    });
    applied.push({ field_path: field.field_path, value: field.value });
  }
  const files = writePillarFiles(db, workspaceRoot, brandId);
  return { applied, files };
}

/**
 * Write brands/<slug>/brand-voice.md, audience.md, positioning.md and
 * platform-playbook.md from the live pillar values.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} workspaceRoot
 * @param {string} brandId
 * @returns {Record<string, string>}
 */
export function writePillarFiles(db, workspaceRoot, brandId) {
  const brand = requireBrandRow(db, brandId);
  const pillars = getPillars(db, brandId);
  const dir = join(workspaceRoot, 'brands', brand.slug);
  mkdirSync(dir, { recursive: true });
  /** @type {Record<string, string>} */
  const paths = {};
  for (const key of PILLAR_KEYS) {
    const body = pillars[key].value.trim().length > 0 ? pillars[key].value.trim() : 'Not yet known.';
    const path = join(dir, `${key.replace(/_/g, '-')}.md`);
    writeFileSync(path, `# ${PILLAR_TITLES[key]}\n\n${body}\n`, 'utf8');
    paths[key] = path;
  }
  return paths;
}

export { getLiveField };
