/**
 * The workspace.
 *
 * A workspace is a folder the user picked. Everything Social Campaign knows lives
 * inside it. A small pointer file in the user's home folder remembers historical
 * folders and explicit project selections, so a restart can reuse the right one.
 *
 *   ~/.social-campaign/config.json          { workspaceRoot, version }
 *   <workspace>/.social-campaign/config.json  the workspace's own settings
 *
 * This module owns config, the folder tree, the database handle and the health
 * report. Tools ask it questions; they never touch the filesystem layout directly.
 */

import { accessSync, constants, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { nowIso } from '../lib/ids.mjs';
import { log, setLogFile } from '../lib/log.mjs';
import { readJsonFile, updateJsonFile, writeJsonFile } from '../lib/json.mjs';
import { InvalidInputError, WorkspaceNotConfiguredError } from '../lib/errors.mjs';
import {
  WORKSPACE_TREE,
  databasePath,
  defaultWorkspaceRoot,
  expandUserPath,
  globalConfigDir,
  globalConfigPath,
  integrationsPath,
  serverLogPath,
  workspaceConfigPath,
  workspaceDir,
} from '../lib/paths.mjs';
import { currentVersion, openAndMigrate, writeSchemaDump } from '../db/migrate.mjs';
import { initializeWorkspace as initializePipelineWorkspace } from '../pipeline/runtime.mjs';

/** Config format version. Bumped only when the config shape itself changes. */
export const CONFIG_VERSION = 1;

/** How many workspaces the global "known workspaces" list remembers. */
const KNOWN_WORKSPACES_LIMIT = 50;
/** The default child name used when a project chooses its own workspace folder. */
const PROJECT_WORKSPACE_NAME = basename(defaultWorkspaceRoot());

/**
 * The folder override a caller (or a test) can set to skip resolution entirely.
 * @returns {string|null}
 */
function envOverrideRoot() {
  const raw = process.env.SOCIAL_CAMPAIGN_WORKSPACE;
  if (!raw || raw.trim().length === 0) return null;
  return expandUserPath(raw);
}

/**
 * Whether two paths name the same folder. Normalizes separators and trailing
 * slashes, and compares case insensitively on Windows, where `C:\Users\x` and
 * `c:\users\X` are the same folder.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = resolve(a);
  const right = resolve(b);
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

/**
 * Whether a `.social-campaign/config.json` document is the per-computer
 * pointer file rather than a workspace's own settings. The pointer (written
 * to `globalConfigPath()`, normally `<home>/.social-campaign/config.json`)
 * is the only document of this shape that ever carries `known_workspaces` or
 * `project_workspaces`; a workspace's own config, written by
 * `Workspace.initialize`, never has either field. This is a content check,
 * independent of location, so it holds even when a session's HOME override
 * does not cover wherever this particular pointer file physically is.
 * @param {unknown} config
 * @returns {boolean}
 */
function isPerComputerPointerShape(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  return Array.isArray(config.known_workspaces) || Array.isArray(config.project_workspaces);
}

/**
 * Whether dir genuinely is a Social Campaign workspace root.
 *
 * A folder holding `<dir>/.social-campaign/config.json` counts even when that
 * file's own `workspaceRoot` field names a different (older or moved) folder:
 * a workspace is found by the config file inside it, not by a saved path, so
 * it keeps working after the folder is moved, renamed, or copied elsewhere.
 * The workspace-open path (`Workspace.load`/`activate`) repairs a stale
 * `workspaceRoot` once the workspace is actually opened; this function never
 * writes anything itself. A folder holding only `<dir>/.social-pipeline/config.json`
 * with a stable `workspaceId` counts the same way, for the same reason.
 *
 * Two independent guards keep this from ever mistaking the per-computer
 * pointer file for a workspace, since that file lives at exactly the path
 * this function otherwise treats as workspace evidence
 * (`<home>/.social-campaign/config.json`):
 *  - By folder identity: the folder that holds the global pointer file
 *    (normally the user's home folder) is always excluded first. An earlier
 *    version accepted "there is a `creative.db` in that folder", which meant
 *    a single stray database left in the global settings folder by a bug
 *    turned the user's whole home folder into a workspace root, and every
 *    session started anywhere under home resolved to it.
 *  - By content: even when a session's own HOME/SOCIAL_CAMPAIGN_HOME override
 *    does not cover wherever the real pointer file happens to be (for
 *    example, an ancestor walk from a temp folder that climbs past an
 *    isolated test home into the real one), a document carrying
 *    `known_workspaces` or `project_workspaces` is recognized as the pointer
 *    itself and is never treated as a workspace, regardless of location.
 * Neither guard depends on the other: folder identity alone was not enough
 * to protect a session whose HOME points elsewhere, which is why the content
 * check exists too.
 *
 * The `.social-pipeline/config.json` fallback stays strict about location
 * for an old-style config that still names an absolute `root`: that value
 * must equal `dir`, exactly as before, so an unrelated stray pipeline config
 * anywhere else on disk (for example on a real ancestor of a temp folder)
 * never masquerades as a workspace. A pipeline config already migrated to
 * the location-independent form (`root: "."`, see reconcileWorkspaceLocation
 * in server/pipeline/runtime.mjs) needs no such check: by construction, its
 * relative root always resolves to the very folder the config file is in.
 * @param {string} dir
 * @returns {boolean}
 */
export function isWorkspaceRoot(dir) {
  const target = resolve(dir);
  const homePointerDir = resolve(dirname(globalConfigDir()));
  if (samePath(target, homePointerDir)) return false;
  const configPath = workspaceConfigPath(dir);
  if (existsSync(configPath)) {
    const config = readJsonFile(configPath, {});
    if (isPerComputerPointerShape(config)) return false;
    return true;
  }
  const pipelineConfig = readJsonFile(join(dir, '.social-pipeline', 'config.json'), {});
  if (!pipelineConfig || typeof pipelineConfig !== 'object') return false;
  if (typeof pipelineConfig.workspaceId !== 'string' || !pipelineConfig.workspaceId.trim()) return false;
  const pipelineRoot = typeof pipelineConfig.root === 'string' ? pipelineConfig.root.trim() : '';
  if (pipelineRoot === '.') return true;
  return samePath(resolve(dir, pipelineRoot || '.'), dir);
}

/**
 * Walk up from startDir looking for a folder that is genuinely a Social Campaign
 * workspace root. The folder holding the global pointer file (the parent of
 * `globalConfigDir()`, normally the user's home folder) is never considered a
 * candidate here, since every session under the home folder would otherwise
 * resolve to home itself.
 * @param {string} startDir
 * @returns {{root: string, isAncestor: boolean}|null}
 */
export function findWorkspaceInAncestors(startDir) {
  const excludedDir = dirname(globalConfigDir());
  let dir = startDir;
  let isAncestor = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!samePath(dir, excludedDir) && isWorkspaceRoot(dir)) {
      return { root: dir, isAncestor };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
    isAncestor = true;
  }
}

/**
 * Read the global "known workspaces" list, newest used first.
 * @returns {{root: string, name: string, lastUsed: string}[]}
 */
export function listKnownWorkspaces() {
  const pointer = readJsonFile(globalConfigPath(), /** @type {{known_workspaces?: any[]}} */ ({}));
  return Array.isArray(pointer.known_workspaces) ? pointer.known_workspaces : [];
}

/**
 * Whether a candidate lives in a project root or one of its descendants.
 * @param {string} projectRoot
 * @param {string} candidate
 * @returns {boolean}
 */
function isWithinProject(projectRoot, candidate) {
  const base = resolve(projectRoot);
  const target = resolve(candidate);
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  if (process.platform === 'win32') {
    return samePath(base, target) || target.toLowerCase().startsWith(prefix.toLowerCase());
  }
  return samePath(base, target) || target.startsWith(prefix);
}

/**
 * Read project bindings without exposing the machine-wide history to ordinary status calls.
 * @returns {{projectRoot: string, workspaceRoot: string, lastUsed?: string}[]}
 */
function listProjectWorkspaceBindings() {
  const pointer = readJsonFile(globalConfigPath(), /** @type {{project_workspaces?: any[]}} */ ({}));
  if (!Array.isArray(pointer.project_workspaces)) return [];
  return pointer.project_workspaces.filter(
    (entry) => entry && typeof entry.projectRoot === 'string' && typeof entry.workspaceRoot === 'string',
  );
}

/**
 * Remember the workspace explicitly selected for a project folder.
 * @param {string} projectRoot
 * @param {string} workspaceRoot
 * @returns {{projectRoot: string, workspaceRoot: string, lastUsed?: string}[]}
 */
export function recordProjectWorkspace(projectRoot, workspaceRoot) {
  const project = resolve(projectRoot);
  const workspace = resolve(workspaceRoot);
  const pointer = readJsonFile(globalConfigPath(), /** @type {Record<string, unknown>} */ ({}));
  const updated = updateJsonFile(
    globalConfigPath(),
    (current) => {
      const existing = Array.isArray(current.project_workspaces) ? current.project_workspaces : [];
      const kept = existing.filter((entry) => entry && typeof entry.projectRoot === 'string' && !samePath(entry.projectRoot, project));
      kept.unshift({ projectRoot: project, workspaceRoot: workspace, lastUsed: nowIso() });
      // Project bindings are durable routing state.  Keep every explicit
      // project selection even when the historical workspace list is trimmed.
      return { ...current, project_workspaces: kept };
    },
    pointer,
  );
  return Array.isArray(updated.project_workspaces) ? updated.project_workspaces : [];
}

/**
 * Find the most specific explicit project binding for a session folder.
 * @param {string|null|undefined} cwd
 * @returns {{projectRoot: string, workspaceRoot: string, lastUsed?: string}|null}
 */
function findProjectWorkspaceBinding(cwd) {
  if (!cwd) return null;
  const target = resolve(cwd);
  return (
    listProjectWorkspaceBindings()
      .filter((entry) => isWithinProject(entry.projectRoot, target))
      .sort((left, right) => resolve(right.projectRoot).length - resolve(left.projectRoot).length)[0] ?? null
  );
}

/**
 * Find the conventional child workspace for the current project folder.
 * This keeps a restart in a project beside `Social Campaign Workspace` on that
 * same root without allowing a sibling or home-folder child to hijack a new
 * project.  Nested sessions use an explicit project binding instead.
 * @param {string|null|undefined} cwd
 * @returns {{root: string, projectRoot: string}|null}
 */
function findProjectChildWorkspace(cwd) {
  if (!cwd) return null;
  const projectRoot = resolve(cwd);
  const child = join(projectRoot, PROJECT_WORKSPACE_NAME);
  return !samePath(child, projectRoot) && isWorkspaceRoot(child) ? { root: child, projectRoot } : null;
}

/**
 * Offer one deterministic workspace folder for an unbound project.
 * @param {string|null|undefined} cwd
 * @returns {{root: string, projectRoot: string}|null}
 */
function suggestedProjectWorkspace(cwd) {
  if (!cwd) return null;
  const projectRoot = resolve(cwd);
  if (basename(projectRoot).toLowerCase() === PROJECT_WORKSPACE_NAME.toLowerCase()) {
    return { root: projectRoot, projectRoot };
  }
  return { root: join(projectRoot, PROJECT_WORKSPACE_NAME), projectRoot };
}

/**
 * Upsert a workspace into the global "known workspaces" list with a fresh lastUsed.
 * @param {string} root
 * @returns {{root: string, name: string, lastUsed: string}[]}
 */
export function recordKnownWorkspace(root) {
  const pointer = readJsonFile(globalConfigPath(), /** @type {{known_workspaces?: any[]}} */ ({}));
  const updated = updateJsonFile(
    globalConfigPath(),
    (current) => {
      const existing = Array.isArray(current.known_workspaces) ? current.known_workspaces : [];
      const kept = existing.filter((entry) => entry && entry.root !== root);
      kept.unshift({ root, name: basename(root), lastUsed: nowIso() });
      return { ...current, known_workspaces: kept.slice(0, KNOWN_WORKSPACES_LIMIT) };
    },
    pointer,
  );
  return Array.isArray(updated.known_workspaces) ? updated.known_workspaces : [];
}

/**
 * Drop a workspace from the "known workspaces" list. Never touches its files.
 * @param {string} root
 * @returns {{root: string, name: string, lastUsed: string}[]}
 */
export function removeKnownWorkspace(root) {
  const updated = updateJsonFile(
    globalConfigPath(),
    (current) => {
      const existing = Array.isArray(current.known_workspaces) ? current.known_workspaces : [];
      return { ...current, known_workspaces: existing.filter((entry) => entry && entry.root !== root) };
    },
    /** @type {Record<string, unknown>} */ ({}),
  );
  return Array.isArray(updated.known_workspaces) ? updated.known_workspaces : [];
}

/**
 * Work out which workspace this session should use, and why, without touching
 * the filesystem beyond existence checks.
 *
 * Resolution order: an explicit SOCIAL_CAMPAIGN_WORKSPACE override; an explicit
 * project binding; a workspace rooted at `cwd` or any ancestor; an existing
 * conventional child workspace; otherwise no workspace. The machine-wide pointer
 * remains available to the explicit switch/reconnect flow and is never an implicit
 * selection for an unbound project.
 *
 * When a project binding's folder no longer exists at its saved path, that
 * binding is set aside (returned as `staleProjectBinding`, not `projectBinding`)
 * and resolution falls through to the ancestor and child rules below, since the
 * workspace folder may simply have moved. If one of those finds it, the caller
 * is expected to reconnect the project binding to the new path; if nothing is
 * found, `projectBinding` reports the stale binding so status can explain it.
 * @param {string|null} cwd
 * @returns {{root: string|null, projectRoot: string|null, resolvedBy: string, suggestion: {root: string, projectRoot: string}|null, projectBinding: {projectRoot: string, workspaceRoot: string, lastUsed?: string}|null, staleProjectBinding: {projectRoot: string, workspaceRoot: string, lastUsed?: string}|null, historicalWorkspaceAvailable: boolean}}
 */
export function resolveActiveWorkspace(cwd) {
  const projectRoot = cwd ? resolve(cwd) : null;
  const pointer = readJsonFile(globalConfigPath(), /** @type {{workspaceRoot?: string}} */ ({}));
  const globalRoot = typeof pointer.workspaceRoot === 'string' ? pointer.workspaceRoot : null;
  const historicalWorkspaceAvailable = Boolean(globalRoot || listKnownWorkspaces().length > 0);
  const envRoot = envOverrideRoot();
  if (envRoot) {
    return {
      root: envRoot,
      projectRoot,
      resolvedBy: `An environment override (SOCIAL_CAMPAIGN_WORKSPACE) points this session at ${envRoot}.`,
      suggestion: null,
      projectBinding: null,
      staleProjectBinding: null,
      historicalWorkspaceAvailable,
    };
  }

  const projectBinding = findProjectWorkspaceBinding(cwd);
  let staleProjectBinding = null;
  if (projectBinding) {
    if (existsSync(projectBinding.workspaceRoot)) {
      return {
        root: projectBinding.workspaceRoot,
        projectRoot: projectBinding.projectRoot,
        resolvedBy: `This project is explicitly bound to the Social Campaign workspace at ${projectBinding.workspaceRoot}.`,
        suggestion: null,
        projectBinding,
        staleProjectBinding: null,
        historicalWorkspaceAvailable,
      };
    }
    // The bound folder no longer exists at that saved path. Do not fail here:
    // fall through to the same discovery rules an unbound project would use,
    // since the workspace folder may simply have been moved or renamed.
    staleProjectBinding = projectBinding;
  }

  const ancestorMatch = cwd ? findWorkspaceInAncestors(cwd) : null;
  if (ancestorMatch) {
    return {
      root: ancestorMatch.root,
      projectRoot,
      resolvedBy: ancestorMatch.isAncestor
        ? `A Social Campaign workspace was found above the folder this session started in, at ${ancestorMatch.root}.`
        : `The folder this session started in is already a Social Campaign workspace.`,
      suggestion: null,
      projectBinding: null,
      staleProjectBinding,
      historicalWorkspaceAvailable,
    };
  }

  const childMatch = findProjectChildWorkspace(cwd);
  if (childMatch) {
    return {
      root: childMatch.root,
      projectRoot: childMatch.projectRoot,
      resolvedBy: `This project already has a Social Campaign workspace at ${childMatch.root}.`,
      suggestion: null,
      projectBinding: null,
      staleProjectBinding,
      historicalWorkspaceAvailable,
    };
  }

  if (staleProjectBinding) {
    // Keep the same "no suggestion" behavior an authoritative binding has
    // always had: this project already has an intended workspace, so this
    // is a missing-folder problem to solve, not an invitation to create a
    // new one.
    return {
      root: null,
      projectRoot,
      resolvedBy: `This project was bound to a Social Campaign workspace at ${staleProjectBinding.workspaceRoot}, but that folder no longer exists there.`,
      suggestion: null,
      projectBinding: staleProjectBinding,
      staleProjectBinding,
      historicalWorkspaceAvailable,
    };
  }

  const suggestion = suggestedProjectWorkspace(cwd);
  return {
    root: null,
    projectRoot,
    resolvedBy: projectRoot
      ? `This project has no Social Campaign workspace yet. Choose a folder to create or use one.`
      : 'No workspace has been set up yet.',
    suggestion,
    projectBinding: null,
    staleProjectBinding: null,
    historicalWorkspaceAvailable,
  };
}

/**
 * Repair `.social-campaign/config.json`'s own `workspaceRoot` field once a
 * workspace is actually opened at `root`. isWorkspaceRoot recognizes the
 * folder by the presence of this config file alone, so a stale field left
 * behind by a move, rename, or copy never blocks discovery; this only keeps
 * the field itself truthful for anything that still reads it directly.
 * Never called from isWorkspaceRoot, which must stay read-only.
 * @param {string} root
 */
function reconcileCampaignConfigLocation(root) {
  const configPath = workspaceConfigPath(root);
  if (!existsSync(configPath)) return;
  const config = readJsonFile(configPath, /** @type {{workspaceRoot?: string}} */ ({}));
  if (typeof config.workspaceRoot === 'string' && samePath(config.workspaceRoot, root)) return;
  updateJsonFile(
    configPath,
    (current) => ({
      ...current,
      workspaceRoot: root,
      version: typeof current.version === 'number' ? current.version : CONFIG_VERSION,
    }),
    /** @type {Record<string, unknown>} */ ({}),
  );
}

/**
 * @typedef {object} WorkspaceStatus
 * @property {boolean} configured
 * @property {string|null} workspaceRoot
 * @property {string|null} projectRoot
 * @property {{projectRoot:string,workspaceRoot:string,lastUsed?:string}|null} projectBinding
 * @property {boolean} dbOk
 * @property {number} version schema version, 0 when there is no database.
 * @property {string[]} issues plain language problems, empty when healthy.
 * @property {string|null} suggestedRoot one folder to offer for this project when it is unbound.
 * @property {number} knownWorkspaceCount number of historical workspaces available through explicit switch.
 */

/**
 * Holds the live workspace state for one server process.
 */
export class Workspace {
  constructor() {
    /** @type {string|null} */
    this.root = null;
    /** @type {string|null} the project folder that owns the current selection. */
    this.projectRoot = null;
    /** @type {{projectRoot: string, workspaceRoot: string, lastUsed?: string}|null} */
    this.projectBinding = null;
    /** @type {import('node:sqlite').DatabaseSync|null} */
    this.db = null;
    /** @type {Map<string, import('node:sqlite').DatabaseSync>} */
    this.databases = new Map();
    /** @type {string[]} */
    this.issues = [];
    /** @type {string[]} migrations applied during the last open, for the boot log. */
    this.lastApplied = [];
    /** @type {string|null} the backup taken before those migrations, if any. */
    this.lastBackupPath = null;
    /** @type {string} plain sentence explaining which rule picked the active workspace. */
    this.resolvedBy = 'No workspace has been set up yet.';
    /** @type {{root: string, projectRoot: string}|null} one folder offered for an unbound project. */
    this.suggestion = null;
    /** @type {boolean} whether the machine has a historical workspace available for explicit reconnect. */
    this.historicalWorkspaceAvailable = false;
  }

  /**
   * Resolve and load the active workspace, opening its database if one is found.
   * Never throws: a broken workspace shows up as issues on status().
   * @param {string} [cwd] the folder this session started in.
   * @returns {WorkspaceStatus}
   */
  load(cwd = process.cwd()) {
    this.issues = [];
    this.root = null;
    this.db = null;
    this.projectRoot = cwd ? resolve(cwd) : null;
    const resolution = resolveActiveWorkspace(cwd);
    this.resolvedBy = resolution.resolvedBy;
    this.suggestion = resolution.suggestion;
    this.projectRoot = resolution.projectRoot ?? this.projectRoot;
    this.projectBinding = resolution.projectBinding;
    this.historicalWorkspaceAvailable = resolution.historicalWorkspaceAvailable;
    const root = resolution.root;
    if (!root) {
      if (resolution.staleProjectBinding) {
        this.issues.push(
          `The saved workspace folder is missing: ${resolution.staleProjectBinding.workspaceRoot}. ` +
            'It may have been moved or renamed. Opening Claude in its new folder will reconnect it.',
        );
      }
      return this.status();
    }

    if (!existsSync(root)) {
      this.issues.push(`The saved workspace folder is missing: ${root}.`);
      return this.status();
    }
    if (resolution.projectBinding && !isWorkspaceRoot(root)) {
      this.issues.push(`The current project is bound to ${root}, but that folder is not a valid Social Campaign workspace.`);
      return this.status();
    }
    if (resolution.staleProjectBinding && !samePath(resolution.staleProjectBinding.workspaceRoot, root)) {
      // The bound folder moved and discovery found it at a new location.
      // Reconnect this project's binding so a future session resolves
      // straight to it again, without stopping at the stale saved path.
      recordProjectWorkspace(this.projectRoot, root);
      this.projectBinding = { projectRoot: this.projectRoot, workspaceRoot: root, lastUsed: nowIso() };
    }
    this.root = root;
    setLogFile(serverLogPath(root));
    reconcileCampaignConfigLocation(root);
    try {
      this.#openDb();
      recordKnownWorkspace(root);
    } catch (error) {
      this.issues.push('The workspace database could not be opened.');
      log.error('workspace db open failed', { error: String(error) });
    }
    return this.status();
  }

  /**
   * Switch the live server to a different, already initialized workspace: close
   * and reopen the database, point the global pointer at it, and clear the caches
   * this process holds so every subsequent read comes from the new workspace.
   * @param {string} rawRoot
   * @returns {WorkspaceStatus}
   */
  activate(rawRoot) {
    const root = expandUserPath(rawRoot);
    if (!root || !existsSync(root) || !isWorkspaceRoot(root)) {
      throw new InvalidInputError('That folder is not a Social Campaign workspace yet.', {
        fix: 'Choose a workspace from the list, or set one up in that folder first.',
      });
    }

    // Keep previously opened handles alive for work that captured the old
    // workspace context. Current reads switch to the target handle below; closing
    // the old handle here would make an in-flight browser or provider operation
    // fail halfway through and tempt its caller to write into the new workspace.
    this.db = null;
    this.issues = [];
    this.root = root;
    if (!this.projectRoot) this.projectRoot = resolve(process.cwd());
    setLogFile(serverLogPath(root));
    reconcileCampaignConfigLocation(root);
    this.#openDb();

    updateJsonFile(
      globalConfigPath(),
      (pointer) => ({ ...pointer, workspaceRoot: root, version: CONFIG_VERSION }),
      /** @type {Record<string, unknown>} */ ({}),
    );
    recordKnownWorkspace(root);
    if (this.projectRoot) recordProjectWorkspace(this.projectRoot, root);
    this.resolvedBy = `Switched to this workspace during the session, at ${root}.`;
    this.suggestion = null;
    this.projectBinding = { projectRoot: this.projectRoot, workspaceRoot: root, lastUsed: nowIso() };
    this.historicalWorkspaceAvailable = true;

    log.info('workspace activated', { root });
    return this.status();
  }

  /**
   * Create or adopt a workspace at root: validate, build the tree, migrate the
   * database, write both config files and the schema dump.
   * @param {string} rawRoot
   * @returns {{root: string, created: string[], applied: string[], version: number, backupPath: string|null, schemaPath: string}}
   */
  initialize(rawRoot) {
    const root = expandUserPath(rawRoot || defaultWorkspaceRoot());
    if (!root) {
      throw new InvalidInputError('Please choose a folder for your Social Campaign workspace.');
    }
    assertUsableFolder(root);
    initializePipelineWorkspace({ root });

    /** @type {string[]} */
    const created = [];
    for (const relative of WORKSPACE_TREE) {
      const target = join(root, ...relative.split('/'));
      if (!existsSync(target)) {
        mkdirSync(target, { recursive: true });
        created.push(relative);
      }
    }

    this.root = root;
    if (!this.projectRoot) this.projectRoot = resolve(process.cwd());
    setLogFile(serverLogPath(root));

    const existing = this.databases.get(root);
    const opened = existing
      ? {
          db: existing,
          applied: [],
          backupPath: null,
          version: currentVersion(existing),
        }
      : openAndMigrate({ dbPath: databasePath(root), workspaceRoot: root });
    this.db = opened.db;
    this.databases.set(root, opened.db);
    this.lastApplied = opened.applied;
    this.lastBackupPath = opened.backupPath;
    this.#stampMeta();

    const schemaPath = writeSchemaDump(this.db, root);

    updateJsonFile(
      workspaceConfigPath(root),
      (current) => ({
        ...current,
        version: CONFIG_VERSION,
        workspaceRoot: root,
        createdAt: typeof current.createdAt === 'string' ? current.createdAt : nowIso(),
      }),
      {
        version: CONFIG_VERSION,
        workspaceRoot: root,
        createdAt: nowIso(),
      },
    );
    updateJsonFile(
      globalConfigPath(),
      (existingPointer) => ({ ...existingPointer, workspaceRoot: root, version: CONFIG_VERSION }),
      /** @type {Record<string, unknown>} */ ({}),
    );
    if (!existsSync(integrationsPath(root))) {
      writeJsonFile(integrationsPath(root), { providers: {} });
    }
    recordKnownWorkspace(root);
    if (this.projectRoot) recordProjectWorkspace(this.projectRoot, root);

    this.issues = [];
    this.resolvedBy = `Just set up in this session, at ${root}.`;
    this.suggestion = null;
    this.projectBinding = { projectRoot: this.projectRoot, workspaceRoot: root, lastUsed: nowIso() };
    this.historicalWorkspaceAvailable = true;
    log.info('workspace initialized', { root, applied: opened.applied.length });
    return {
      root,
      created,
      applied: opened.applied,
      version: opened.version,
      backupPath: opened.backupPath,
      schemaPath,
    };
  }

  /**
   * @param {{includeKnownWorkspaces?: boolean}} [options]
   * @returns {WorkspaceStatus & {knownWorkspaces?: {root: string, name: string, lastUsed: string}[]}}
   */
  status(options = {}) {
    const status = {
      configured: Boolean(this.root && this.db),
      workspaceRoot: this.root,
      projectRoot: this.projectRoot,
      projectBinding: this.projectBinding
        ? {
            projectRoot: this.projectBinding.projectRoot,
            workspaceRoot: this.projectBinding.workspaceRoot,
            lastUsed: this.projectBinding.lastUsed,
          }
        : null,
      dbOk: Boolean(this.db),
      version: this.db ? currentVersion(this.db) : 0,
      issues: [...this.issues],
      resolvedBy: this.resolvedBy,
      suggestion: this.suggestion,
      suggestedRoot: this.suggestion?.root ?? null,
      knownWorkspaceCount: listKnownWorkspaces().length,
      historicalWorkspaceAvailable: this.historicalWorkspaceAvailable,
    };
    if (options.includeKnownWorkspaces) status.knownWorkspaces = listKnownWorkspaces();
    return status;
  }

  /**
   * @returns {import('node:sqlite').DatabaseSync}
   */
  requireDb() {
    if (!this.db) throw new WorkspaceNotConfiguredError();
    return this.db;
  }

  /**
   * @returns {string}
   */
  requireRoot() {
    if (!this.root) throw new WorkspaceNotConfiguredError();
    return this.root;
  }

  /**
   * Read the workspace's own settings file.
   * @returns {Record<string, unknown>}
   */
  readConfig() {
    if (!this.root) return {};
    return readJsonFile(workspaceConfigPath(this.root), {});
  }

  /**
   * Merge values into the workspace settings file.
   * @param {Record<string, unknown>} patch
   */
  patchConfig(patch) {
    if (!this.root) return;
    updateJsonFile(
      workspaceConfigPath(this.root),
      (current) => ({ ...current, ...patch }),
      /** @type {Record<string, unknown>} */ ({}),
    );
  }

  /**
   * Connection state for the optional providers, as written by
   * integration_mark_connected.
   * @returns {Record<string, {state: string, updated_at?: string, detail?: string}>}
   */
  readIntegrations() {
    if (!this.root) return {};
    const file = readJsonFile(integrationsPath(this.root), /** @type {{providers?: Record<string, any>}} */ ({}));
    return file.providers && typeof file.providers === 'object' ? file.providers : {};
  }

  /**
   * @param {string} provider
   * @param {string} state
   * @param {string} [detail]
   * @returns {Record<string, unknown>}
   */
  writeIntegration(provider, state, detail) {
    const root = this.requireRoot();
    const updated = updateJsonFile(
      integrationsPath(root),
      (current) => {
        const providers = current.providers && typeof current.providers === 'object' ? { ...current.providers } : {};
        // A connection note replaces the state, never the brands saved from Metricool.
        const previous = providers[provider] && typeof providers[provider] === 'object' ? providers[provider] : {};
        const kept = provider === 'metricool' && Array.isArray(previous.brands) ? { brands: previous.brands, ...(previous.brands_updated_at ? { brands_updated_at: previous.brands_updated_at } : {}) } : {};
        providers[provider] = { state, detail: detail ?? null, updated_at: nowIso(), ...kept };
        return { ...current, providers };
      },
      /** @type {Record<string, unknown>} */ ({ providers: {} }),
    );
    return updated.providers && typeof updated.providers === 'object' ? updated.providers : {};
  }

  /** Close the database. Used by tests and on shutdown. */
  close() {
    for (const db of this.databases.values()) safeClose(db);
    this.databases.clear();
    this.db = null;
  }

  /**
   * Capture an immutable context for work that may outlive a workspace switch.
   * Callers should use `context.db` and `context.root` throughout that operation,
   * rather than reading this mutable Workspace object again later.
   * @returns {CapturedWorkspace}
   */
  captureContext() {
    const root = this.requireRoot();
    const db = this.requireDb();
    return new CapturedWorkspace(this, Object.freeze({ workspaceId: root, root, db, capturedAt: nowIso() }));
  }

  /**
   * Read one value out of workspace_meta.
   * @param {string} key
   * @returns {string|null}
   */
  readMeta(key) {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT value FROM workspace_meta WHERE key = ?').get(key);
    return row && row.value != null ? String(row.value) : null;
  }

  /**
   * Write one value into workspace_meta.
   * @param {string} key
   * @param {string} value
   */
  writeMeta(key, value) {
    if (!this.db) return;
    this.db
      .prepare(
        'INSERT INTO workspace_meta (key, value, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(key, value, nowIso());
  }

  #openDb() {
    const root = this.requireRoot();
    const existing = this.databases.get(root);
    if (existing) {
      this.db = existing;
      this.lastApplied = [];
      this.lastBackupPath = null;
      this.#stampMeta();
      return;
    }
    const opened = openAndMigrate({ dbPath: databasePath(root), workspaceRoot: root });
    this.db = opened.db;
    this.databases.set(root, opened.db);
    this.lastApplied = opened.applied;
    this.lastBackupPath = opened.backupPath;
    if (opened.applied.length > 0) {
      writeSchemaDump(this.db, root);
      log.info('workspace database updated', { applied: opened.applied });
    }
    this.#stampMeta();
  }

  #stampMeta() {
    if (!this.db) return;
    const statement = this.db.prepare(
      'INSERT INTO workspace_meta (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    );
    statement.run('workspace_root', String(this.root), nowIso());
    statement.run('config_version', String(CONFIG_VERSION), nowIso());
  }
}

/**
 * A request-scoped view of a workspace.
 *
 * The live Workspace changes when another request activates a different root.
 * Long-running tools must keep using the database and filesystem root they saw at
 * request start, so the view stores those values directly and never reads them from
 * the mutable owner again.
 */
export class CapturedWorkspace {
  /**
   * @param {Workspace} live
   * @param {{workspaceId: string, root: string, db: import('node:sqlite').DatabaseSync, capturedAt: string}} snapshot
   */
  constructor(live, snapshot) {
    this.live = live;
    this.workspaceId = snapshot.workspaceId;
    this.root = snapshot.root;
    this.projectRoot = live.projectRoot;
    this.projectBinding = live.projectBinding;
    this.db = snapshot.db;
    this.capturedAt = snapshot.capturedAt;
    this.issues = [];
    this.lastApplied = [];
    this.lastBackupPath = null;
    this.resolvedBy = `Captured at ${snapshot.capturedAt}.`;
    this.suggestion = null;
    this.historicalWorkspaceAvailable = live.historicalWorkspaceAvailable;
    Object.freeze(this);
  }

  /** @returns {import('node:sqlite').DatabaseSync} */
  requireDb() {
    if (!this.db) throw new WorkspaceNotConfiguredError();
    return this.db;
  }

  /** @returns {string} */
  requireRoot() {
    if (!this.root) throw new WorkspaceNotConfiguredError();
    return this.root;
  }

  /** @param {{includeKnownWorkspaces?: boolean}} [options] @returns {WorkspaceStatus & {knownWorkspaces?: {root: string, name: string, lastUsed: string}[]}} */
  status(options = {}) {
    const status = {
      configured: Boolean(this.root && this.db),
      workspaceRoot: this.root,
      projectRoot: this.projectRoot,
      projectBinding: this.projectBinding
        ? {
            projectRoot: this.projectBinding.projectRoot,
            workspaceRoot: this.projectBinding.workspaceRoot,
            lastUsed: this.projectBinding.lastUsed,
          }
        : null,
      dbOk: Boolean(this.db),
      version: this.db ? currentVersion(this.db) : 0,
      issues: [...this.issues],
      resolvedBy: this.resolvedBy,
      suggestion: this.suggestion,
      suggestedRoot: this.suggestion?.root ?? null,
      knownWorkspaceCount: listKnownWorkspaces().length,
      historicalWorkspaceAvailable: this.historicalWorkspaceAvailable,
    };
    if (options.includeKnownWorkspaces) status.knownWorkspaces = listKnownWorkspaces();
    return status;
  }

  /** @returns {Record<string, unknown>} */
  readConfig() {
    return readJsonFile(workspaceConfigPath(this.requireRoot()), {});
  }

  /** @param {Record<string, unknown>} patch */
  patchConfig(patch) {
    const root = this.requireRoot();
    updateJsonFile(workspaceConfigPath(root), (current) => ({ ...current, ...patch }), {});
  }

  /** @returns {Record<string, {state: string, updated_at?: string, detail?: string}>} */
  readIntegrations() {
    const file = readJsonFile(integrationsPath(this.requireRoot()), /** @type {{providers?: Record<string, any>}} */ ({}));
    return file.providers && typeof file.providers === 'object' ? file.providers : {};
  }

  /**
   * @param {string} provider
   * @param {string} state
   * @param {string} [detail]
   * @returns {Record<string, unknown>}
   */
  writeIntegration(provider, state, detail) {
    const root = this.requireRoot();
    const updated = updateJsonFile(
      integrationsPath(root),
      (current) => {
        const providers = current.providers && typeof current.providers === 'object' ? { ...current.providers } : {};
        // A connection note replaces the state, never the brands saved from Metricool.
        const previous = providers[provider] && typeof providers[provider] === 'object' ? providers[provider] : {};
        const kept = provider === 'metricool' && Array.isArray(previous.brands) ? { brands: previous.brands, ...(previous.brands_updated_at ? { brands_updated_at: previous.brands_updated_at } : {}) } : {};
        providers[provider] = { state, detail: detail ?? null, updated_at: nowIso(), ...kept };
        return { ...current, providers };
      },
      /** @type {Record<string, unknown>} */ ({ providers: {} }),
    );
    return updated.providers && typeof updated.providers === 'object' ? updated.providers : {};
  }

  /** @param {string} key @returns {string|null} */
  readMeta(key) {
    const row = this.requireDb().prepare('SELECT value FROM workspace_meta WHERE key = ?').get(key);
    return row && row.value != null ? String(row.value) : null;
  }

  /** @param {string} key @param {string} value */
  writeMeta(key, value) {
    this.requireDb()
      .prepare(
        'INSERT INTO workspace_meta (key, value, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(key, value, nowIso());
  }

  /** @returns {CapturedWorkspace} */
  captureContext() {
    return this;
  }

  // Workspace-changing operations belong to the live owner. They are exposed only
  // for compatibility with callers that receive a captured view accidentally; the
  // transport routes control tools through the live Workspace explicitly.
  /** @param {string} root @returns {WorkspaceStatus} */
  activate(root) {
    return this.live.activate(root);
  }

  /** @param {string} root @returns {ReturnType<Workspace['initialize']>} */
  initialize(root) {
    return this.live.initialize(root);
  }

  /** @param {string} [cwd] @returns {WorkspaceStatus} */
  load(cwd) {
    return this.live.load(cwd);
  }

  /** Close all live workspace handles. */
  close() {
    this.live.close();
  }
}

/**
 * Throw a friendly error unless root is a folder we can write into, creating it when
 * the parent allows.
 * @param {string} root
 */
export function assertUsableFolder(root) {
  if (existsSync(root)) {
    if (!statSync(root).isDirectory()) {
      throw new InvalidInputError('That path is a file, not a folder. Please choose a folder.');
    }
  } else {
    try {
      mkdirSync(root, { recursive: true });
    } catch {
      throw new InvalidInputError('That folder could not be created. Please choose another location.');
    }
  }
  try {
    accessSync(root, constants.W_OK);
  } catch {
    throw new InvalidInputError('That folder cannot be written to. Please choose another location.');
  }
  // accessSync is advisory on Windows, so prove writability with a real file.
  const probe = join(root, '.social-campaign-write-test');
  try {
    writeFileSync(probe, 'ok', 'utf8');
    rmSync(probe, { force: true });
  } catch {
    throw new InvalidInputError('That folder cannot be written to. Please choose another location.');
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function safeClose(db) {
  try {
    db.close();
  } catch {
    // a database that refuses to close is not worth failing a tool call over
  }
}

export { defaultWorkspaceRoot, workspaceDir };
