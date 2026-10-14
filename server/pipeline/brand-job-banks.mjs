/**
 * What a job's researchers learned about the audience, filed in the brand's banks when the job is filed (fileJob in brand-library.mjs).
 *
 * The researcher and the Trend Scout have no tool that writes the bank, and they should not: they write a file of their own beside their
 * research, `research/banks-<workstream>.json` (for example `research/banks-audience.json`), in the shape of a research draft's `banks`
 * (brand-onboarding-banks.mjs documents it): pains, desires, objections, angles, captions and ctas, each with the quotes or text copied from a
 * page the job saved in `research/raw/`. When the job is filed:
 *
 *   - every quote and text is looked for in the saved pages of the job; a page counts when its first lines carry the page's address, which
 *     is how the research skill asks every capture to begin. A quote that is not found is dropped, and an item left with no quote is not filed;
 *   - what stands goes into the proven bank through addToBank, the call brand_bank_save makes, with the job's id. The same pain found again
 *     gains its new quotes and count; the same file filed twice adds nothing;
 *   - a file that is not valid JSON, or names nothing that can be shown, is skipped without a word: the job's filing never depends on it.
 *
 * The banks reach the next job twice over: in the library block every agent's brief carries, and as the Strategy gate's Problem and Angle rows.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// brand-onboarding-banks.mjs imports brand-library.mjs, which imports this file: every use below is inside a function, never at load time.
import { banksProblems, bankItemCount, existingPainTexts, fileBanks } from './brand-onboarding-banks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const evidence = require(join(HERE, '..', '..', 'pipeline', 'scripts', 'lib-onboarding-evidence.js'));

const FILE_NAME = /^banks-[a-z0-9][a-z0-9-]*\.json$/;
const MAX_FILES = 4;
const MAX_CAPTURES = 80;
const MAX_CAPTURE_BYTES = 400000;
const ADDRESS = /https?:\/\/[^\s)>\]"'`]+/i;

/** The pages the job saved under research/raw, by address: { squashed, day }. A page without its address in its first lines is not one. */
function savedPages(jobDir) {
  const pages = new Map();
  let seen = 0;
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (seen >= MAX_CAPTURES) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < 3) walk(path, depth + 1); continue; }
      if (!entry.isFile() || !/\.(?:md|txt)$/i.test(entry.name)) continue;
      seen += 1;
      let text = '';
      let day = null;
      try {
        const stat = statSync(path);
        if (stat.size > MAX_CAPTURE_BYTES * 4) continue;
        text = readFileSync(path, 'utf8').slice(0, MAX_CAPTURE_BYTES);
        day = stat.mtime.toISOString().slice(0, 10);
      } catch { continue; }
      const address = ADDRESS.exec(text.slice(0, 600));
      if (!address) continue;
      const folder = /(\d{4}-\d{2}-\d{2})/.exec(path.slice(jobDir.length));
      const key = evidence.normUrl(address[0].replace(/[.,;]+$/, ''));
      const before = pages.get(key);
      pages.set(key, { squashed: `${before ? before.squashed : ''}${evidence.squash(text)}`, day: folder ? folder[1] : (before ? before.day : day) });
    }
  };
  walk(join(jobDir, 'research', 'raw'), 0);
  return pages;
}

/**
 * File the banks a job's researchers left. `job` is { dir, jobId } (facts.jobAt). Returns null when the job left none, else
 * { files, items, saved, merged, existing, skipped }. Never throws for a bad file; the caller wraps the rest.
 */
export function ingestJobBanks({ root, brand, job, now } = {}) {
  const dir = join(job.dir, 'research');
  if (!existsSync(dir)) return null;
  let names = [];
  try { names = readdirSync(dir).filter((name) => FILE_NAME.test(name)).sort().slice(0, MAX_FILES); } catch { return null; }
  if (!names.length) return null;
  const pages = savedPages(job.dir);
  const when = now instanceof Date ? now : new Date(now ?? Date.now());
  const total = { files: 0, items: 0, saved: 0, merged: 0, existing: 0, skipped: 0 };
  for (const name of names) {
    let draft = null;
    try { draft = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { continue; }
    const checked = banksProblems(draft, {
      captureFor: (url) => pages.get(evidence.normUrl(url)) ?? null,
      observedDay: (url) => (pages.get(evidence.normUrl(url)) || {}).day ?? null,
      posts: null, competitors: null, painTexts: existingPainTexts({ root, brand }), now: when, drop: true,
    });
    const items = bankItemCount(checked.value);
    if (!items) continue;
    const filed = fileBanks({ root, brand, banks: checked.value, jobId: job.jobId, now: when });
    total.files += 1;
    total.items += items;
    for (const key of ['saved', 'merged', 'existing', 'skipped']) total[key] += filed[key];
  }
  return total.files ? total : null;
}
