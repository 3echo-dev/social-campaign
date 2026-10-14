/**
 * What is installed in the research helper's virtual environment, read from the files pip leaves behind.
 *
 * Nothing here starts a process, so it answers in milliseconds and is safe to call from the session start hook and from
 * a tool that must reply in a few seconds. It does four things:
 *
 *  1. Lists the installed distributions and their versions (the *.dist-info folder names).
 *  2. Reads each distribution's declared requirements (its METADATA) to work out which installed packages only a retired
 *     package pulled in: Crawl4AI, Instaloader and TikTok-Api were installed by earlier releases and nothing calls them
 *     any more. `planPrune` names those packages (and only those) so the installer can uninstall them from this
 *     environment, and never anything the kept packages still need.
 *  3. Measures how much disk a set of packages uses (from the RECORD files), so the saving can be told in plain numbers.
 *  4. Keeps a small cache of the newest version of each package, as `pip index versions` last reported it, so the tools
 *     check can say what is outdated without ever waiting on the network.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Packages earlier releases installed that no code calls now. Crawl4AI drove the browser worker that the stealth reader
 * (Scrapling) replaced; Instaloader and TikTok-Api were the two discovery routes retired on 2026-10-13. Normalised names.
 */
export const STALE_PACKAGES = Object.freeze(['crawl4ai', 'instaloader', 'tiktokapi']);

/** How a retired package is named to the person (the doctor and the tools check say what an update removes). */
export const STALE_LABELS = Object.freeze({ crawl4ai: 'Crawl4AI', instaloader: 'Instaloader', tiktokapi: 'TikTok-Api' });

/** Never removed, whatever a stale package depended on. Normalised names. */
export const PROTECTED_PACKAGES = Object.freeze(['pip', 'setuptools', 'wheel', 'pkg-resources']);

/**
 * Normalise a distribution name the way pip does (case, dashes, dots and underscores).
 * @param {string} name
 * @returns {string}
 */
export function normalizeDistName(name) {
  return String(name).toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * The site-packages folder of a virtual environment, or null.
 * @param {string} environmentRoot
 * @returns {string|null}
 */
export function sitePackagesOf(environmentRoot) {
  try {
    const windows = join(environmentRoot, 'Lib', 'site-packages');
    if (existsSync(windows)) return windows;
    const lib = join(environmentRoot, 'lib');
    for (const entry of readdirSync(lib)) {
      const candidate = join(lib, entry, 'site-packages');
      if (/^python3/.test(entry) && existsSync(candidate)) return candidate;
    }
  } catch {
    // no such environment
  }
  return null;
}

/**
 * Installed package versions read from the *.dist-info folder names: no process is started.
 * @param {string} environmentRoot
 * @returns {Map<string, string>|null} null when the environment has no site-packages.
 */
export function installedVersions(environmentRoot) {
  const site = sitePackagesOf(environmentRoot);
  if (!site) return null;
  /** @type {Map<string, string>} */
  const versions = new Map();
  try {
    for (const entry of readdirSync(site)) {
      const match = entry.match(/^(.+?)-(\d[^-]*)\.dist-info$/);
      if (match) versions.set(normalizeDistName(match[1]), match[2]);
    }
  } catch {
    return null;
  }
  return versions;
}

// --- the dependency graph ---

/**
 * @typedef {object} Requirement
 * @property {string} name normalised.
 * @property {string[]} extras the extras asked of that package, normalised.
 * @property {string[]} onlyForExtras the extras of the declaring package this requirement belongs to; empty when it always applies.
 */

/**
 * @typedef {object} Distribution
 * @property {string} name normalised.
 * @property {string} version
 * @property {string} dir the *.dist-info folder.
 * @property {Requirement[]} requires
 */

const REQUIREMENT_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[([^\]]*)\])?\s*([^;]*?)\s*(?:;\s*(.*))?$/;
const MARKER_EXTRA = /extra\s*==\s*['"]([^'"]+)['"]/gi;

/**
 * Parse one `Requires-Dist` value, for example `playwright>=1.62.0; extra == "fetchers"`.
 * @param {string} value
 * @returns {Requirement|null}
 */
export function parseRequirement(value) {
  const match = REQUIREMENT_LINE.exec(String(value));
  if (!match) return null;
  const extras = match[2] ? match[2].split(',').map((item) => normalizeDistName(item.trim())).filter(Boolean) : [];
  const onlyForExtras = [];
  for (const found of String(match[4] ?? '').matchAll(MARKER_EXTRA)) onlyForExtras.push(normalizeDistName(found[1]));
  return { name: normalizeDistName(match[1]), extras, onlyForExtras };
}

/**
 * Every installed distribution with its declared requirements.
 * @param {string} environmentRoot
 * @returns {Map<string, Distribution>|null} null when the environment cannot be read at all.
 */
export function readDistributions(environmentRoot) {
  const site = sitePackagesOf(environmentRoot);
  if (!site) return null;
  /** @type {Map<string, Distribution>} */
  const found = new Map();
  let entries;
  try {
    entries = readdirSync(site);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const match = entry.match(/^(.+?)-(\d[^-]*)\.dist-info$/);
    if (!match) continue;
    const dir = join(site, entry);
    /** @type {Requirement[]} */
    const requires = [];
    try {
      const metadata = readFileSync(join(dir, 'METADATA'), 'utf8');
      for (const line of metadata.split(/\r?\n/)) {
        // The headers end at the first blank line; the long description after it is never read.
        if (line === '') break;
        if (!line.startsWith('Requires-Dist:')) continue;
        const requirement = parseRequirement(line.slice('Requires-Dist:'.length));
        if (requirement) requires.push(requirement);
      }
    } catch {
      // A distribution whose metadata cannot be read counts as having no requirements; planPrune checks for that.
    }
    found.set(normalizeDistName(match[1]), { name: normalizeDistName(match[1]), version: match[2], dir, requires });
  }
  return found;
}

/**
 * Every installed distribution reachable from the roots, the roots included.
 * A requirement that belongs to an extra applies only when that extra was asked for; every other marker (Python version,
 * platform) is treated as applying, which can only keep more, never less.
 * @param {Map<string, Distribution>} dists
 * @param {Array<{name: string, extras?: string[]}>} roots
 * @returns {Set<string>}
 */
export function closureOf(dists, roots) {
  /** @type {Map<string, Set<string>>} extras already followed, per distribution. */
  const followed = new Map();
  const queue = roots.map((root) => ({ name: normalizeDistName(root.name), extras: (root.extras ?? []).map(normalizeDistName) }));
  while (queue.length > 0) {
    const { name, extras } = /** @type {{name: string, extras: string[]}} */ (queue.pop());
    const dist = dists.get(name);
    if (!dist) continue;
    let seen = followed.get(name);
    const first = !seen;
    if (!seen) {
      seen = new Set();
      followed.set(name, seen);
    }
    const fresh = extras.filter((extra) => !seen.has(extra));
    if (!first && fresh.length === 0) continue;
    for (const extra of fresh) seen.add(extra);
    for (const requirement of dist.requires) {
      if (requirement.onlyForExtras.length > 0) {
        // On a revisit only the newly asked extras can add anything.
        const wanted = first ? extras : fresh;
        if (!requirement.onlyForExtras.some((extra) => wanted.includes(extra))) continue;
      } else if (!first) {
        continue;
      }
      queue.push({ name: requirement.name, extras: requirement.extras });
    }
  }
  return new Set(followed.keys());
}

/**
 * The packages that must stay: what the helper itself needs, as pip's roots with the extras they are installed with.
 * @param {{speech?: boolean}} [options]
 * @returns {Array<{name: string, extras: string[]}>}
 */
export function keepRoots(options = {}) {
  return [
    { name: 'scrapling', extras: ['fetchers'] },
    { name: 'playwright', extras: [] },
    { name: 'patchright', extras: [] },
    { name: 'curl-cffi', extras: [] },
    { name: 'yt-dlp', extras: ['default', 'curl-cffi'] },
    ...(options.speech ? [{ name: 'faster-whisper', extras: [] }] : []),
  ];
}

/**
 * @typedef {object} PrunePlan
 * @property {boolean} ok false when the environment cannot be read well enough to remove anything safely.
 * @property {string|null} reason why not.
 * @property {string[]} stale the retired packages that are installed.
 * @property {string[]} remove every package to uninstall: the retired ones and what only they needed.
 */

/**
 * Which installed packages only a retired package needed.
 *
 * The plan is bounded on purpose: only packages reachable from a retired package can be named, and none that the kept
 * packages (the helper's own roots) can reach. Anything else in the environment is left alone. It refuses to name
 * anything when a kept root is not installed or a retired package's metadata cannot be read, because then the picture of
 * what is still needed would be incomplete.
 * @param {string} environmentRoot
 * @param {{speech?: boolean, stale?: readonly string[]}} [options]
 * @returns {PrunePlan}
 */
export function planPrune(environmentRoot, options = {}) {
  const dists = readDistributions(environmentRoot);
  if (!dists) return { ok: false, reason: 'The environment could not be read.', stale: [], remove: [] };
  const staleNames = (options.stale ?? STALE_PACKAGES).map(normalizeDistName);
  const stale = staleNames.filter((name) => dists.has(name));
  if (stale.length === 0) return { ok: true, reason: null, stale: [], remove: [] };
  const roots = keepRoots({ speech: options.speech && dists.has('faster-whisper') });
  const missingRoot = roots.find((root) => root.name !== 'yt-dlp' && !dists.has(root.name));
  if (missingRoot) {
    return { ok: false, reason: `${missingRoot.name} is not installed, so what is still needed cannot be told yet.`, stale, remove: [] };
  }
  const keep = closureOf(dists, [...roots, ...PROTECTED_PACKAGES.map((name) => ({ name }))]);
  const drop = closureOf(dists, stale.map((name) => ({ name })));
  const remove = [...drop].filter((name) => !keep.has(name) && !PROTECTED_PACKAGES.includes(name)).sort();
  return { ok: true, reason: null, stale, remove };
}

/**
 * The bytes a set of installed packages occupy, from their RECORD files. A package without a readable RECORD counts as 0.
 * @param {string} environmentRoot
 * @param {string[]} names normalised distribution names.
 * @returns {number}
 */
export function packagesSizeBytes(environmentRoot, names) {
  const dists = readDistributions(environmentRoot);
  if (!dists) return 0;
  let total = 0;
  for (const name of names) {
    const dist = dists.get(normalizeDistName(name));
    if (!dist) continue;
    try {
      for (const line of readFileSync(join(dist.dir, 'RECORD'), 'utf8').split(/\r?\n/)) {
        const size = Number(line.split(',').at(-1));
        if (Number.isFinite(size) && size > 0) total += size;
      }
    } catch {
      // no RECORD
    }
  }
  return total;
}

// --- the newest versions, cached ---

/** How long a cached answer about the newest versions is trusted. */
export const LATEST_TTL_MS = 24 * 60 * 60_000;

/** The packages whose newest version is looked up. */
export const TRACKED_PACKAGES = Object.freeze(['scrapling', 'playwright', 'patchright', 'curl-cffi', 'yt-dlp', 'faster-whisper']);

/**
 * Compare two version strings numerically, segment by segment (2026.9.29 against 2026.10.1). A pre-release suffix sorts
 * below the same release. Good enough to tell newer from older; not a full PEP 440 parser.
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const parts = (/** @type {string} */ value) => {
    const [release, pre] = String(value).trim().split(/(?<=\d)(?=[a-zA-Z])/, 2);
    return { numbers: release.split('.').map((part) => Number.parseInt(part, 10) || 0), pre: Boolean(pre) };
  };
  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const x = left.numbers[index] ?? 0;
    const y = right.numbers[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (left.pre !== right.pre) return left.pre ? -1 : 1;
  return 0;
}

/**
 * The newest version in `pip index versions <package>` output:
 *
 *     scrapling (0.4.16)
 *     Available versions: 0.4.16, 0.4.15, ...
 *       INSTALLED: 0.4.15
 *       LATEST:    0.4.16
 * @param {string} stdout
 * @returns {string|null}
 */
export function parsePipIndexVersions(stdout) {
  const text = String(stdout ?? '');
  const latest = text.match(/^\s*LATEST:\s*(\S+)/m);
  if (latest) return latest[1];
  const head = text.match(/^\s*[A-Za-z0-9][A-Za-z0-9._-]*\s*\(([^)\s]+)\)/m);
  return head ? head[1] : null;
}

/**
 * Where the answers are kept: beside the environment, so uninstalling the plugin removes them with it.
 * @param {string} environmentRoot
 * @returns {string}
 */
export function latestCachePath(environmentRoot) {
  return join(dirname(environmentRoot), 'latest-versions.json');
}

/**
 * The cached newest versions, and whether they are still fresh. Never touches the network.
 * @param {string} environmentRoot
 * @param {number} [now]
 * @returns {{checkedAt: string, versions: Record<string, string>, fresh: boolean}|null}
 */
export function readLatestVersions(environmentRoot, now = Date.now()) {
  try {
    const parsed = JSON.parse(readFileSync(latestCachePath(environmentRoot), 'utf8'));
    const checkedAt = typeof parsed?.checked_at === 'string' ? parsed.checked_at : null;
    const versions = parsed?.versions && typeof parsed.versions === 'object' ? parsed.versions : null;
    if (!checkedAt || !versions) return null;
    const age = now - Date.parse(checkedAt);
    return { checkedAt, versions: Object.fromEntries(Object.entries(versions).filter(([, value]) => typeof value === 'string')), fresh: Number.isFinite(age) && age >= 0 && age < LATEST_TTL_MS };
  } catch {
    return null;
  }
}

/** @type {Map<string, Promise<Record<string, string>|null>>} */
const refreshing = new Map();

/**
 * Ask pip for the newest version of each tracked package and keep the answers. Runs `pip index versions` once per
 * package, all at once, each with its own short deadline. A package pip cannot answer for (offline, an old pip, a
 * mirror without the index command) simply keeps its earlier answer. It never rejects and never writes anything when no
 * package answered. At most one refresh per environment runs at a time.
 * @param {object} options
 * @param {string} options.environmentRoot
 * @param {string[]} options.command the environment's Python, as a command array.
 * @param {(command: string[], args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv) => Promise<{ok: boolean, stdout: string}>} options.runner
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {readonly string[]} [options.packages]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.now]
 * @returns {Promise<Record<string, string>|null>} the versions now cached, or null when nothing answered.
 */
export function refreshLatestVersions(options) {
  const key = options.environmentRoot;
  const running = refreshing.get(key);
  if (running) return running;
  const work = (async () => {
    try {
      const packages = options.packages ?? TRACKED_PACKAGES;
      const answers = await Promise.all(
        packages.map(async (pkg) => {
          const out = await options.runner(options.command, ['-m', 'pip', 'index', 'versions', pkg, '--disable-pip-version-check'], options.timeoutMs ?? 25_000, options.env);
          return [pkg, out.ok ? parsePipIndexVersions(out.stdout) : null];
        }),
      );
      const found = Object.fromEntries(answers.filter(([, version]) => version));
      if (Object.keys(found).length === 0) return null;
      const previous = readLatestVersions(options.environmentRoot, options.now)?.versions ?? {};
      const versions = { ...previous, ...found };
      mkdirSync(dirname(latestCachePath(options.environmentRoot)), { recursive: true });
      writeFileSync(
        latestCachePath(options.environmentRoot),
        `${JSON.stringify({ checked_at: new Date(options.now ?? Date.now()).toISOString(), versions }, null, 2)}\n`,
      );
      return versions;
    } catch {
      return null;
    } finally {
      refreshing.delete(key);
    }
  })();
  refreshing.set(key, work);
  return work;
}

/** Wait for the refresh in flight for one environment, if any. Tests use this; nothing in the server ever waits on it. */
export function whenLatestSettles(environmentRoot) {
  return refreshing.get(environmentRoot) ?? Promise.resolve(null);
}
