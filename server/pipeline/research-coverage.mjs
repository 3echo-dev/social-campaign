/**
 * Which platforms the research step could read for a job: TikTok, Instagram, YouTube.
 *
 * A platform is "yes" when research saved a video from it (a reference in the job's manifest) or a search or
 * check on it returned something. It is "no" when research tried it and got nothing. A platform research never
 * tried is left out. Only free routes are involved, and this only records what they returned.
 */
import { join } from 'node:path';

import { readJsonFile, writeJsonFile } from '../lib/json.mjs';
import { readReferences } from './references.mjs';

export const RESEARCH_PLATFORMS = Object.freeze([
  ['tiktok', 'TikTok'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
]);

const file = jobDir => join(jobDir, 'research', 'data-coverage.json');

function platformOfRoute(route) {
  const name = String(route || '').toLowerCase();
  return RESEARCH_PLATFORMS.map(item => item[0]).find(platform => name.startsWith(platform)) || null;
}

/** What a search or check result says per platform: 'yes', 'no', or nothing for a route that was skipped. */
export function coverageFromSearch(result) {
  const seen = {};
  const note = (platform, state) => {
    if (!platform) return;
    if (state === 'yes' || !seen[platform]) seen[platform] = state;
  };
  for (const route of Array.isArray(result?.routes) ? result.routes : []) {
    if (route?.status === 'skipped') continue;
    note(platformOfRoute(route?.route), route?.status === 'ok' && route?.count > 0 ? 'yes' : 'no');
  }
  for (const row of Array.isArray(result?.results) ? result.results : []) {
    if (row?.status === 'not_a_video_url' || row?.status === 'invalid_url') continue;
    note(platformOfRoute(row?.platform), row?.status === 'ok' ? 'yes' : 'no');
  }
  return seen;
}

/** Remember a search or check result for the job. A yes is never turned back into a no. */
export function recordSearchCoverage(jobDir, result, now = new Date()) {
  const seen = coverageFromSearch(result);
  if (!Object.keys(seen).length) return null;
  const saved = readJsonFile(file(jobDir), null);
  const platforms = saved && typeof saved.platforms === 'object' && saved.platforms ? { ...saved.platforms } : {};
  for (const [platform, state] of Object.entries(seen)) {
    if (platforms[platform]?.state === 'yes' && state === 'no') continue;
    platforms[platform] = { state, at: now.toISOString() };
  }
  writeJsonFile(file(jobDir), { schemaVersion: 1, platforms });
  return platforms;
}

/**
 * The coverage for the board: `{ platforms: [{ platform, label, state }], line }`, or null when research has
 * recorded nothing for this job. Never throws.
 */
export function researchCoverage(jobDir) {
  try {
    const states = {};
    const saved = readJsonFile(file(jobDir), null);
    for (const [platform, entry] of Object.entries(saved?.platforms || {})) if (entry?.state === 'yes' || entry?.state === 'no') states[platform] = entry.state;
    for (const entry of readReferences(jobDir)) if (entry?.platform && entry.sourceUrl) states[String(entry.platform).toLowerCase()] = 'yes';
    const platforms = RESEARCH_PLATFORMS.filter(([platform]) => states[platform]).map(([platform, label]) => ({ platform, label, state: states[platform] }));
    if (!platforms.length) return null;
    return { platforms, line: `Research data: ${platforms.map(item => `${item.label} ${item.state}`).join(', ')}` };
  } catch { return null; }
}
