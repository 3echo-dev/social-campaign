/**
 * Which installed version of this plugin should be running?
 *
 * Shared by the MCP launcher (server/index.mjs) and the hook forwarder
 * (scripts/hooks/forward.mjs). It has no dependencies outside node: both callers live in the
 * version folder a chat started with, which may be a version or two behind the newest one.
 *
 * Layout, from https://code.claude.com/docs/en/plugins/loading ("Find plugins on disk"):
 *
 *   <plugins root>/cache/<marketplace>/<plugin>/<version>/   one folder per installed version
 *   <plugins root>/installed_plugins.json                    { version, plugins: { "<plugin>@<marketplace>": [ { scope, installPath, version } ] } }
 *   <version folder>/.orphaned_at                            written when an update or uninstall replaces it,
 *                                                             removed by Claude Code 14 days later
 *
 * <plugins root> is ~/.claude/plugins unless CLAUDE_CODE_PLUGIN_CACHE_DIR moves it. When this code
 * runs from a folder that is not shaped like that (a git checkout, --plugin-dir, a local-directory
 * marketplace) there are no sibling versions and the answer is always the folder itself.
 *
 * Paths are handled as strings first, so a Windows path (C:\Users\me\.claude\plugins\cache\...)
 * parses the same on every platform, and compared case-insensitively with both slash styles.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** What a version folder must contain for the launcher to run it. */
export const SERVER_ENTRY = 'server/main.mjs';

const LAYOUT = /^(.*)[\\/]cache[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]([^\\/]+)$/i;

/** Slash style and case folded, trailing slashes dropped: two spellings of one folder compare equal. */
export function pathKey(value) {
  if (typeof value !== 'string' || !value) return '';
  let text = value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  if (/^[a-z]:/i.test(text) || process.platform === 'win32' || process.platform === 'darwin') text = text.toLowerCase();
  return text;
}

/** Same folder: equal after normalising, or the same place once symlinks are resolved. */
export function samePath(a, b) {
  const [left, right] = [pathKey(a), pathKey(b)];
  if (!left || !right) return false;
  if (left === right) return true;
  try {
    return pathKey(realpathSync(a)) === pathKey(realpathSync(b));
  } catch {
    return false;
  }
}

/**
 * Pick a root apart when it is a version folder in the plugin cache, else null.
 * String based: nothing here touches the disk.
 * @returns {{pluginsRoot:string, marketplace:string, plugin:string, version:string, pluginDir:string}|null}
 */
export function parseCacheLayout(root) {
  const text = typeof root === 'string' ? root.replace(/[\\/]+$/, '') : '';
  const match = LAYOUT.exec(text);
  if (!match) return null;
  const [, pluginsRoot, marketplace, plugin, version] = match;
  return { pluginsRoot, marketplace, plugin, version, pluginDir: text.slice(0, text.length - version.length - 1) };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function readManifest(root) {
  const manifest = readJson(join(root, '.claude-plugin', 'plugin.json'));
  return manifest && typeof manifest === 'object' ? manifest : null;
}

export const isOrphaned = root => existsSync(join(root, '.orphaned_at'));

const SEMVER = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/;

/**
 * Order two version strings: 1 when a is newer, -1 when older, 0 when equal or not comparable.
 * Release beats prerelease of the same numbers. Anything that is not semver-shaped (a commit sha,
 * "unknown") is not comparable.
 */
export function compareVersions(a, b) {
  const [left, right] = [SEMVER.exec(String(a ?? '').trim()), SEMVER.exec(String(b ?? '').trim())];
  if (!left || !right) return 0;
  const [x, y] = [left[1].split('.').map(Number), right[1].split('.').map(Number)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  if (left[2] && !right[2]) return -1;
  if (!left[2] && right[2]) return 1;
  if (left[2] && right[2]) return left[2] === right[2] ? 0 : left[2] > right[2] ? 1 : -1;
  return 0;
}

function mtimeOf(root) {
  try {
    return statSync(join(root, '.claude-plugin', 'plugin.json')).mtimeMs;
  } catch {
    return 0;
  }
}

/** A candidate is usable when it holds a manifest for this plugin and the file the caller will run. */
function describe(root, entry, pluginName) {
  try {
    if (!statSync(root).isDirectory()) return null;
    const manifest = readManifest(root);
    if (!manifest || (pluginName && manifest.name && manifest.name !== pluginName)) return null;
    if (entry && !existsSync(join(root, entry))) return null;
    return { root, version: String(manifest.version ?? ''), orphaned: isOrphaned(root), mtime: mtimeOf(root) };
  } catch {
    return null;
  }
}

/** Newest first: semver when both sides have it, otherwise the manifest's mtime (install order). */
function byNewest(a, b) {
  const order = compareVersions(b.version, a.version);
  return order || b.mtime - a.mtime;
}

function installRecordRoots(pluginsRoot, layout) {
  const record = readJson(join(pluginsRoot, 'installed_plugins.json'));
  const plugins = record && typeof record.plugins === 'object' && record.plugins ? record.plugins : {};
  const exact = `${layout.plugin}@${layout.marketplace}`.toLowerCase();
  const keys = Object.keys(plugins);
  const wanted = keys.filter(key => key.toLowerCase() === exact);
  const keyed = wanted.length ? wanted : keys.filter(key => key.toLowerCase().startsWith(`${layout.plugin.toLowerCase()}@`));
  const paths = [];
  for (const key of keyed) {
    const installs = Array.isArray(plugins[key]) ? plugins[key] : [plugins[key]];
    for (const install of installs) if (install && typeof install.installPath === 'string') paths.push(install.installPath);
  }
  return paths;
}

/**
 * Work out which version folder should run.
 *
 *   1. the version(s) installed_plugins.json records for this plugin (newest if several scopes)
 *   2. otherwise the newest sibling folder in the cache
 * Folders with .orphaned_at are skipped, and so is a folder without the entry file the caller
 * will run. When nothing else qualifies the answer is the folder passed in, and only when that
 * is gone too, the newest orphaned one.
 *
 * Never throws: any failure answers with ownRoot.
 *
 * @param {string} ownRoot the version folder the caller is running from
 * @param {{entry?:string, pluginsRoot?:string}} [options]
 * @returns {{root:string, version:string, source:'own'|'installed'|'sibling'|'orphaned', cache:boolean}}
 */
export function resolveNewestRoot(ownRoot, { entry = SERVER_ENTRY, pluginsRoot } = {}) {
  const own = typeof ownRoot === 'string' ? ownRoot.replace(/[\\/]+$/, '') : '';
  const fallback = { root: own, version: String(readManifest(own)?.version ?? ''), source: 'own', cache: false };
  try {
    const layout = parseCacheLayout(own);
    if (!layout) return fallback;
    const ownManifest = readManifest(own);
    const pluginName = ownManifest?.name ?? layout.plugin;
    const plugins = pluginsRoot ?? layout.pluginsRoot;
    const seen = new Set();
    const usable = [];
    const consider = (root, source) => {
      const key = pathKey(root);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const found = describe(root, entry, pluginName);
      if (found) usable.push({ ...found, source });
    };

    for (const installPath of installRecordRoots(plugins, layout)) consider(resolve(installPath), 'installed');
    const installed = usable.filter(item => !item.orphaned).sort(byNewest);
    if (installed.length) return { root: installed[0].root, version: installed[0].version, source: 'installed', cache: true };

    let siblings = [];
    try {
      siblings = readdirSync(layout.pluginDir, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => join(layout.pluginDir, item.name));
    } catch {
      siblings = [];
    }
    for (const folder of siblings) consider(folder, 'sibling');
    consider(own, 'own');
    const live = usable.filter(item => !item.orphaned);
    if (live.length) {
      const best = live.sort(byNewest)[0];
      // A sibling without a record never outranks the folder already running unless it is newer.
      const self = live.find(item => samePath(item.root, own));
      const pick = self && byNewest(self, best) <= 0 ? self : best;
      return { root: pick.root, version: pick.version, source: samePath(pick.root, own) ? 'own' : 'sibling', cache: true };
    }
    const ownUsable = usable.find(item => samePath(item.root, own));
    if (ownUsable) return { root: ownUsable.root, version: ownUsable.version, source: 'own', cache: true };
    const orphaned = usable.sort(byNewest)[0];
    if (orphaned) return { root: orphaned.root, version: orphaned.version, source: 'orphaned', cache: true };
    return { ...fallback, cache: true };
  } catch {
    return fallback;
  }
}

/* ---------- swap failure record: how a running server learns that its launcher could not move on ---------- */

/** A folder that survives plugin updates when Claude Code set one, else the system temp folder. */
function stateDir() {
  const base = process.env.SOCIAL_CAMPAIGN_DATA_DIR || process.env.CLAUDE_PLUGIN_DATA;
  return base ? join(base, 'swap') : join(tmpdir(), 'social-campaign-swap');
}

const failureFile = launcherPid => join(stateDir(), `swap-failed-${launcherPid}.json`);
const STALE_MS = 7 * 24 * 3600 * 1000;

/** Written by the launcher when it could not start the newer server. Read by the server it left running. */
export function recordSwapFailure(launcherPid, failure) {
  try {
    mkdirSync(stateDir(), { recursive: true });
    for (const name of readdirSync(stateDir())) {
      if (!/^swap-failed-\d+\.json$/.test(name)) continue;
      try {
        if (Date.now() - statSync(join(stateDir(), name)).mtimeMs > STALE_MS) rmSync(join(stateDir(), name), { force: true });
      } catch { /* best effort */ }
    }
    const file = failureFile(launcherPid);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ ...failure, at: new Date().toISOString() }));
    renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

export function clearSwapFailure(launcherPid) {
  try {
    rmSync(failureFile(launcherPid), { force: true });
  } catch { /* best effort */ }
}

/** The failure the launcher with this pid recorded for the server running from `root`, else null. */
export function readSwapFailure(launcherPid, root) {
  const record = readJson(failureFile(launcherPid));
  return record && samePath(record.fromRoot, root) ? record : null;
}

