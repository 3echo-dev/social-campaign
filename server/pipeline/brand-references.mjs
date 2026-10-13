/**
 * Real photos of a brand's world (the place, the people, the product in use), saved at brand setup.
 *
 * They live in the brand's own folder, under brand/assets/references/, and are listed in the brand profile
 * as assets of kind "reference". They are optional: a brand finishes setup without them. Pictures made for
 * the brand attach them by default (see the make-image skill).
 *
 * Files are checked by the same rules as a job's reference pictures (real image bytes, size, type).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkReference } from './references.mjs';
import { renameReplacing } from '../lib/rename.mjs';

export const BRAND_REFERENCE_KIND = 'reference';
export const BRAND_REFERENCES_MAX = 5;
const FOLDER = join('assets', 'references');

/** The saved reference photos in a profile's assets: `[{ uri, name }]`. */
export function referenceAssets(assets) {
  return (Array.isArray(assets) ? assets : []).filter(item => item && typeof item === 'object' && item.kind === BRAND_REFERENCE_KIND && typeof item.uri === 'string');
}

/**
 * Save checked photos into <brandDir>/brand/assets/references/. The same picture twice is saved once.
 * `files` are `{ path | dataBase64, fileName }`. Returns the assets to list in the profile and what was left out.
 * @param {{ brandDir: string, files: Array<Record<string, any>>, existing?: Array<Record<string, any>> }} input
 */
export function saveBrandReferenceFiles({ brandDir, files, existing = [] }) {
  const kept = referenceAssets(existing).map(item => ({ uri: item.uri, kind: BRAND_REFERENCE_KIND, ...(item.name ? { name: item.name } : {}), ...(item.source ? { source: item.source } : {}) }));
  const skipped = [];
  const added = [];
  const dir = join(brandDir, 'brand', FOLDER);
  for (const file of Array.isArray(files) ? files : []) {
    const label = typeof file?.fileName === 'string' && file.fileName ? file.fileName : 'A photo';
    try {
      const checked = checkReference({ type: 'picture', fileName: file.fileName, path: file.path, dataBase64: file.dataBase64 });
      const sha = createHash('sha256').update(checked.buffer).digest('hex').slice(0, 12);
      const name = `ref-${sha}${checked.ext}`;
      const uri = join(FOLDER, name).split('\\').join('/');
      if ([...kept, ...added].some(item => item.uri === uri)) { skipped.push({ name: label, reason: 'It was already added.' }); continue; }
      if (kept.length + added.length >= BRAND_REFERENCES_MAX) { skipped.push({ name: label, reason: `A brand keeps up to ${BRAND_REFERENCES_MAX} photos.` }); continue; }
      mkdirSync(dir, { recursive: true });
      const target = join(dir, name);
      if (!existsSync(target)) {
        const temp = `${target}.tmp-${process.pid}`;
        writeFileSync(temp, checked.buffer);
        renameReplacing(temp, target);
      }
      added.push({ uri, kind: BRAND_REFERENCE_KIND, name: checked.fileName || name, source: 'upload' });
    } catch (error) {
      skipped.push({ name: label, reason: error instanceof Error ? error.message : 'It could not be saved.' });
    }
  }
  return { assets: [...kept, ...added], added, skipped };
}
