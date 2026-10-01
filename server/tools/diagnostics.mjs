/**
 * Diagnostics: capabilities_status, doctor and doctor_repair.
 *
 * capabilities_status answers "what can this machine do right now" for the Job
 * Planner. doctor answers "what is wrong and how do I fix it" for a human, and every
 * check it returns carries a `fix` written for someone who has never opened a
 * terminal. When a check can be put right without risking data, it also carries
 * `repairable: true` and doctor_repair will do it.
 *
 * What doctor_repair is allowed to do is deliberately small. It recreates folders,
 * finishes an interrupted storage update, rewrites the pointer file that says where
 * the workspace is, and restores the newest good backup
 * when storage is damaged. It never deletes a user's work, and a restore always
 * keeps the damaged file rather than overwriting it.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { defineTool } from '../mcp/registry.mjs';
import { PLUGIN_VERSION, updateWaiting } from '../workspace/version.mjs';
import { CAPABILITIES, CONNECTION_ROWS } from '../capabilities/registry.mjs';
import { probeBinary, resolveCapabilities } from '../capabilities/resolve.mjs';
import { currentVersion, listMigrations, openAndMigrate, writeSchemaDump } from '../db/migrate.mjs';
import {
  WORKSPACE_TREE,
  backupsDir,
  databasePath,
  defaultWorkspaceRoot,
  integrationsPath,
  workspaceConfigPath,
} from '../lib/paths.mjs';
import { timestampSlug } from '../lib/ids.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { log } from '../lib/log.mjs';
import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import { listLegacyCredentials, purgeLegacyCredential, sweepLegacyCredentials } from '../lib/legacy-credentials.mjs';
import { recordProjectWorkspace } from '../workspace/index.mjs';
import { readWorkspace as readPipelineWorkspace } from '../pipeline/runtime.mjs';
import { readArtifactBinding } from '../pipeline/artifact.mjs';
import { listBoardRequests } from '../pipeline/board.mjs';
import { buildBoard } from '../../scripts/build-board.mjs';
import { YtDlpBackend } from '../social/backends/ytdlp.mjs';
import { detect as detectResearchHelper, installProgress, manualCommands, readRecord, startInstall } from '../setup/research-helper.mjs';
import { hasUsableResearchHelperRecord } from '../setup/research-helper-record.mjs';
import {
  YTDLP_STALE_DAYS,
  installKindOf,
  ytdlpAgeDays,
  ytdlpLocation,
  ytdlpMissingFix,
  ytdlpUpdateFix,
} from '../lib/install-hints.mjs';

/**
 * @typedef {object} Check
 * @property {string} id a stable name doctor_repair takes.
 * @property {string} name what the user is shown.
 * @property {'ok'|'warn'|'fail'} status
 * @property {string} detail
 * @property {string|null} fix what a person can do about it, in plain language.
 * @property {boolean} repairable whether doctor_repair can do it for them.
 */

/** Shown, in the check and in the repair, when nothing can be found to link a project to. */
const NO_ADOPTABLE_WORKSPACE_FIX = 'Say "set up Social Campaign" and pick a folder to keep your work in.';

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const diagnosticsTools = [
  defineTool({
    name: 'capabilities_status',
    description:
      'Report the state of every Social Campaign capability: ready, not_connected, unavailable, degraded ' +
      'or not_needed. The Job Planner calls this and surfaces only the capabilities a job actually needs.',
    inputSchema: {
      type: 'object',
      properties: {
        required: {
          type: 'array',
          description: 'Optional. Limit the answer to these capability names and flag the blockers.',
        },
      },
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const { capabilities, details } = await resolveCapabilities(workspace);
      const required = Array.isArray(args.required) ? args.required.map(String) : null;

      if (!required) {
        return { capabilities, details, blockers: [], connections: connectionSummary(capabilities) };
      }

      /** @type {Record<string, string>} */
      const scoped = {};
      for (const capability of CAPABILITIES) {
        scoped[capability.name] = required.includes(capability.name)
          ? capabilities[capability.name]
          : 'not_needed';
      }
      const blockers = required
        .filter((name) => scoped[name] !== 'ready' && scoped[name] !== 'degraded')
        .map((name) => ({
          capability: name,
          state: scoped[name] ?? 'unavailable',
          provider: details[name]?.provider ?? 'unknown',
          detail: details[name]?.detail ?? null,
        }));
      return { capabilities: scoped, details, blockers, connections: connectionSummary(capabilities) };
    },
  }),

  defineTool({
    name: 'doctor',
    description:
      'Run the Social Campaign self check: workspace, folders, storage, media tools, yt-dlp (version and ' +
      'whether it can imitate a browser for TikTok) and every provider ' +
      'connection. Every item comes back with a plain language fix, and the ones Social Campaign can put ' +
      'right on its own are marked repairable so doctor_repair can be offered. Also returns pluginVersion and ' +
      'updateWaiting: when updateWaiting is true, or pluginVersion is missing, this running server is a ' +
      'superseded install waiting for the session to restart onto the newer one.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_args, { workspace }) => {
      const checks = await runChecks(workspace);
      const failing = checks.filter((check) => check.status === 'fail').length;
      const warning = checks.filter((check) => check.status === 'warn').length;
      return {
        checks,
        repairable: checks.filter((check) => check.repairable && check.status !== 'ok').map((check) => check.id),
        summary:
          failing > 0
            ? `${failing} problem${failing === 1 ? '' : 's'} need attention.`
            : warning > 0
              ? `Everything essential works. ${warning} optional item${warning === 1 ? ' needs' : 's need'} attention.`
              : 'Everything works.',
        healthy: failing === 0,
        pluginVersion: PLUGIN_VERSION,
        updateWaiting: updateWaiting(),
      };
    },
  }),

  defineTool({
    name: 'doctor_repair',
    description:
      'Fix one of the problems doctor found. Pass the check id doctor listed under repairable. Nothing a ' +
      'user made is ever deleted: damaged storage is set aside and replaced from the newest good backup, ' +
      'and everything else is a folder, a setting or a saved number being put back.',
    inputSchema: {
      type: 'object',
      properties: {
        check: {
          type: 'string',
          description: 'The check id to repair: workspace_pointer, workspace_folders, storage, storage_integrity, research_helper or legacy_publishing_credentials.',
        },
      },
      required: ['check'],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const { workspace } = context;
      const id = String(args.check);
      const repair = REPAIRS[id];
      if (!repair) {
        throw new InvalidInputError(`There is nothing called "${id}" to repair.`, {
          fix: 'Run the check first and use one of the items it says can be repaired.',
        });
      }
      const outcome = repair(workspace, context);
      log.info('doctor repair', { check: id, repaired: outcome.repaired });
      const checks = await runChecks(workspace);
      return {
        check: id,
        ...outcome,
        checks,
        healthy: checks.every((check) => check.status !== 'fail'),
      };
    },
  }),
];

/**
 * Build the whole checklist.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {Promise<Check[]>}
 */
async function runChecks(workspace) {
  /** @type {Check[]} */
  const checks = [];
  const status = workspace.status();
  const root = workspace.root;

  if (!root) {
    checks.push({
      id: 'workspace_pointer',
      name: 'Workspace',
      status: 'fail',
      detail: status.issues[0] ?? 'No workspace has been set up yet.',
      fix: findAdoptableRoot()
        ? 'There is a Social Campaign folder on this computer that is not linked up. Say yes and I will point Social Campaign back at it.'
        : NO_ADOPTABLE_WORKSPACE_FIX,
      repairable: Boolean(findAdoptableRoot()),
    });
  } else {
    checks.push({
      id: 'workspace_pointer',
      name: 'Workspace',
      status: 'ok',
      detail: `${root}${status.resolvedBy ? ` ${status.resolvedBy}` : ''}`,
      fix: null,
      repairable: false,
    });

    const pipelineWorkspace = readPipelineWorkspaceSafely(root);
    checks.push(pipelineWorkspaceCheck(pipelineWorkspace));

    const missing = WORKSPACE_TREE.filter((relative) => !existsSync(join(root, ...relative.split('/'))));
    checks.push({
      id: 'workspace_folders',
      name: 'Workspace folders',
      status: missing.length === 0 ? 'ok' : 'fail',
      detail:
        missing.length === 0
          ? 'All folders are in place.'
          : `${missing.length} folder${missing.length === 1 ? ' is' : 's are'} missing: ${missing.join(', ')}.`,
      fix: missing.length === 0 ? null : 'Say yes and I will create the missing folders. Nothing already there is touched.',
      repairable: missing.length > 0,
    });

    checks.push(boardCheck(root, pipelineWorkspace));
    checks.push(boardRequestsCheck(root));
  }

  if (workspace.db) {
    const migrations = listMigrations();
    const expected = migrations.length > 0 ? migrations.at(-1).version : 0;
    const actual = currentVersion(workspace.db);
    checks.push({
      id: 'storage',
      name: 'Storage',
      status: actual >= expected ? 'ok' : 'warn',
      detail: `Storage version ${actual} of ${expected}.`,
      fix:
        actual >= expected
          ? null
          : 'Storage has not finished updating. Say yes and I will finish it now, after copying everything aside first.',
      repairable: actual < expected,
    });

    const integrity = integrityOf(workspace.db);
    const backup = newestGoodBackup(root);
    checks.push({
      id: 'storage_integrity',
      name: 'Storage health',
      status: integrity.ok ? 'ok' : 'fail',
      detail: integrity.ok ? 'Everything Social Campaign has saved reads back cleanly.' : integrity.detail,
      fix: integrity.ok
        ? null
        : backup
          ? 'Some of what Social Campaign saved is damaged. Say yes and I will put back the most recent good copy, keeping the damaged one in case any of it can be recovered.'
          : 'Some of what Social Campaign saved is damaged and there is no earlier copy to put back. Set up a new workspace folder and start fresh, or ask for help before doing anything else.',
      repairable: !integrity.ok && Boolean(backup),
    });
  } else {
    checks.push({
      id: 'storage',
      name: 'Storage',
      status: 'fail',
      detail: 'Social Campaign cannot open the place it keeps your work.',
      fix: root
        ? 'Say yes and I will try to open it again, and put back the most recent good copy if it cannot be opened.'
        : 'Say "set up Social Campaign" and pick a folder to keep your work in.',
      repairable: Boolean(root),
    });
  }

  const [ffmpeg, ffprobe] = await Promise.all([probeBinary('ffmpeg'), probeBinary('ffprobe')]);
  checks.push({
    id: 'ffmpeg',
    name: 'FFmpeg',
    status: ffmpeg.present ? 'ok' : 'warn',
    detail: ffmpeg.present ? String(ffmpeg.version) : 'Not found on this computer.',
    fix: ffmpeg.present ? null : ffmpegFix(),
    repairable: false,
  });
  checks.push({
    id: 'ffprobe',
    name: 'FFprobe',
    status: ffprobe.present ? 'ok' : 'warn',
    detail: ffprobe.present ? String(ffprobe.version) : 'Not found on this computer.',
    fix: ffprobe.present ? null : ffmpegFix(),
    repairable: false,
  });

  checks.push(await ytdlpCheck());
  checks.push(await researchHelperCheck(workspace));
  const legacyKeys = legacyPublishingCredentialsCheck(root);
  if (legacyKeys) checks.push(legacyKeys);

  const { capabilities } = await resolveCapabilities(workspace);
  for (const row of CONNECTION_ROWS) {
    const state = capabilities[row.capabilities[0]];
    checks.push({
      id: `connection_${row.key}`,
      name: `${row.label} (${row.provider})`,
      status: state === 'ready' ? 'ok' : 'warn',
      detail: state === 'ready' ? 'Connected.' : 'Not connected.',
      fix:
        state === 'ready'
          ? null
          : `Ask Claude to connect ${row.provider}. Only needed when a job reaches the ${row.label.toLowerCase()} step.`,
      repairable: false,
    });
  }

  return checks;
}

/**
 * Read the vendored pipeline's own workspace config through its existing read path.
 * That path already self-heals a moved or copied folder (reconcileWorkspaceLocation
 * inside server/pipeline/runtime.mjs), so this never writes anything new itself.
 * @param {string} root
 * @returns {{ok: true, config: Record<string, any>}|{ok: false, error: Error}}
 */
function readPipelineWorkspaceSafely(root) {
  try {
    return { ok: true, config: readPipelineWorkspace({ root }) };
  } catch (error) {
    return { ok: false, error: /** @type {Error} */ (error) };
  }
}

/**
 * Whether a successfully read pipeline config is actually usable: local
 * storage and a real workspace ID. Shared by the pipeline workspace check
 * and the board check, so the two never disagree about what counts as valid.
 * @param {{ok: true, config: Record<string, any>}|{ok: false, error: Error}} pipelineWorkspace
 * @returns {{valid: boolean, workspaceId: string|null, mode: string|null}}
 */
function pipelineWorkspaceValidity(pipelineWorkspace) {
  if (!pipelineWorkspace.ok) return { valid: false, workspaceId: null, mode: null };
  const { config } = pipelineWorkspace;
  const mode = typeof config?.storage?.mode === 'string' ? config.storage.mode : null;
  const workspaceId = typeof config?.workspaceId === 'string' ? config.workspaceId.trim() : '';
  return { valid: mode === 'local' && Boolean(workspaceId), workspaceId: workspaceId || null, mode };
}

/**
 * @param {{ok: true, config: Record<string, any>}|{ok: false, error: Error}} pipelineWorkspace
 * @returns {Check}
 */
function pipelineWorkspaceCheck(pipelineWorkspace) {
  const base = { id: 'pipeline_workspace', name: 'Pipeline workspace', repairable: false };
  if (!pipelineWorkspace.ok) {
    return {
      ...base,
      status: 'fail',
      detail: `The pipeline workspace configuration could not be read: ${pipelineWorkspace.error.message || pipelineWorkspace.error}`,
      fix: 'Run /social-campaign:setup to set the pipeline workspace up again.',
    };
  }
  const { valid, workspaceId, mode } = pipelineWorkspaceValidity(pipelineWorkspace);
  if (!valid) {
    return {
      ...base,
      status: 'fail',
      detail:
        mode !== 'local'
          ? `The pipeline workspace storage mode is "${mode ?? 'unknown'}", not local.`
          : 'The pipeline workspace has no workspace ID.',
      fix: 'Run /social-campaign:setup to set the pipeline workspace up again.',
    };
  }
  return {
    ...base,
    status: 'ok',
    detail: `Local pipeline workspace, ID ${workspaceId}.`,
    fix: null,
  };
}

/**
 * The board binding, read only: never publishes a fresh source and never
 * rebinds. readArtifactBinding only reads the binding file (and the legacy
 * config fallback); building the comparison HTML in memory to check
 * freshness never touches disk either.
 * @param {string} root
 * @param {{ok: true, config: Record<string, any>}|{ok: false, error: Error}} pipelineWorkspace
 * @returns {Check}
 */
function boardCheck(root, pipelineWorkspace) {
  const base = { id: 'board', name: 'Board', repairable: false };
  const { valid, workspaceId } = pipelineWorkspaceValidity(pipelineWorkspace);
  if (!valid) {
    return {
      ...base,
      status: 'fail',
      detail: 'The board cannot be checked because the pipeline workspace is not set up correctly.',
      fix: 'Fix the pipeline workspace problem first, then check the board again.',
    };
  }
  let binding;
  try {
    binding = readArtifactBinding({ root, workspaceId });
  } catch (error) {
    return {
      ...base,
      status: 'fail',
      detail: `The saved board binding is corrupt, incomplete or invalid: ${error.message || error}`,
      fix: 'Run /social-campaign:setup --new to publish a fresh board for this workspace.',
    };
  }
  if (!binding) {
    return {
      ...base,
      status: 'warn',
      detail: 'No board has been published for this workspace yet.',
      fix: 'Ask Claude to publish and bind the board.',
    };
  }
  const currentHtml = buildBoard({ config: { workspaceId, mode: 'artifact' } });
  const currentSourceHash = createHash('sha256').update(currentHtml, 'utf8').digest('hex');
  const stale = Boolean(binding.sourceHash) && binding.sourceHash !== currentSourceHash;
  return {
    ...base,
    status: stale ? 'warn' : 'ok',
    detail: stale
      ? `Bound to ${binding.url}, but its published source needs refreshing.`
      : `Bound to ${binding.url}, and its source is current.`,
    fix: stale ? 'Ask Claude to refresh and republish the board.' : null,
  };
}

/**
 * Requests waiting on reconciliation. Read only: the requests folder is
 * inspected only when it already exists, so a workspace that has never
 * used the board never gets one created by running doctor.
 * @param {string} root
 * @returns {Check}
 */
function boardRequestsCheck(root) {
  const dir = join(root, '.social-pipeline', 'board', 'requests');
  let pending = [];
  if (existsSync(dir)) {
    try {
      pending = listBoardRequests({ root }).filter((item) => item.status === 'needs_reconciliation');
    } catch {
      pending = [];
    }
  }
  return {
    id: 'board_requests',
    name: 'Board requests',
    status: pending.length > 0 ? 'warn' : 'ok',
    detail: pending.length > 0
      ? `${pending.length} board request${pending.length === 1 ? '' : 's'} need reconciliation.`
      : 'Nothing is waiting on reconciliation.',
    fix: pending.length > 0 ? 'Ask Claude to reconcile the board requests that are stuck.' : null,
    repairable: false,
  };
}

/**
 * yt-dlp: whether it runs, its version, and whether it can imitate a browser, which
 * TikTok's bot check asks for on about half of all reads without it. Missing or old
 * is a warning, never a failure: social research falls back to web evidence plans.
 * @returns {Promise<Check>}
 */
async function ytdlpCheck() {
  const health = await new YtDlpBackend().health();
  const kind = installKindOf(ytdlpLocation());
  const base = { id: 'ytdlp', name: 'yt-dlp (social research and video addresses)', repairable: false };
  if (!health.present) {
    return {
      ...base,
      status: 'warn',
      detail: 'Not found on this computer. Social research falls back to web search, and video addresses cannot be watched.',
      fix: ytdlpMissingFix(),
    };
  }
  if (health.status !== 'ok') {
    return {
      ...base,
      status: 'warn',
      detail: health.status === 'timed_out' ? 'Installed, but it did not answer in time.' : 'Installed, but it does not run.',
      fix: ytdlpUpdateFix(kind),
    };
  }
  const version = health.version ?? 'unknown';
  const age = ytdlpAgeDays(health.version);
  const stale = age !== null && age > YTDLP_STALE_DAYS;
  const parts = [`Version ${version}`];
  if (health.impersonation === true) parts.push('with browser impersonation for TikTok');
  if (health.impersonation === false) parts.push('without browser impersonation, so TikTok answers about half of its reads with a bot check');
  if (health.impersonation === null) parts.push('browser impersonation could not be checked');
  let detail = `${parts.join(', ')}.`;
  if (stale) detail += ` It is ${age} days old, and platforms change often enough that older versions stop reading them.`;
  const healthy = health.impersonation !== false && !stale;
  return { ...base, status: healthy ? 'ok' : 'warn', detail, fix: healthy ? null : ytdlpUpdateFix(kind) };
}

/**
 * The browser based research helper: a recent enough Python, the page reader package
 * and the browser it drives. All three are optional, so a missing one is a warning
 * rather than a failure; research runs on public pages and web evidence plans without
 * it. Repairable, because doctor_repair can run the same install
 * research_helper_install offers.
 * @param {import('../workspace/index.mjs').Workspace} workspace
 * @returns {Promise<Check>}
 */
async function researchHelperCheck(workspace) {
  const base = { id: 'research_helper', name: 'Research helper (reading pages a plain reader cannot)', repairable: true };
  const progress = installProgress(workspace);
  if (progress.state === 'installing') {
    return {
      ...base,
      status: 'warn',
      detail: `Being set up now: ${progress.stepLabel.toLowerCase()}.`,
      fix: 'It is installing already. Give it a few minutes and check again.',
      repairable: false,
    };
  }
  const record = readRecord(workspace);
  const recordUsable = hasUsableResearchHelperRecord(record);
  const recordedCommand = recordUsable
    ? [[record.python, ...(Array.isArray(record.python_args) ? record.python_args : [])]]
    : null;
  const found = await detectResearchHelper(recordedCommand ?? undefined);
  if (recordUsable && found.state === 'connected' && found.crawl4ai.compatible) {
    return {
      ...base,
      status: 'ok',
      detail: `Installed, on Python ${found.python.version}.`,
      fix: null,
      repairable: false,
    };
  }
  // The last failure, in full, in whatever words the installer itself recorded, so a
  // person is never left guessing what actually went wrong.
  const lastFailure =
    record && typeof record.last_error === 'string' && record.last_error.trim() ? record.last_error.trim() : null;
  const [, second, third] = manualCommands();
  if (recordUsable && found.state === 'degraded') {
    return {
      ...base,
      status: 'warn',
      detail: lastFailure
        ? `The page reader is installed, but the browser it drives is not. Last time: ${lastFailure}`
        : 'The page reader is installed, but the browser it drives is not.',
      fix: `Say yes and I will finish setting it up. To do it yourself: ${third}`,
    };
  }
  const detail = !recordUsable && record?.state === 'connected'
    ? 'The saved research helper record is incomplete, so it cannot be used until setup runs again.'
    : !found.python.found
    ? found.python.storeStub
      ? 'Not installed. Windows is offering its Store placeholder instead of a real Python.'
      : found.python.xcodeStub
        ? 'Not installed. This Mac only offers to install the Command Line Tools placeholder, not a real Python.'
        : found.python.tooOld
          ? 'Not installed. The Python on this computer is older than version 3.10.'
          : 'Not installed.'
    : 'Not installed. Python is here, but the page reader is not.';
  return {
    ...base,
    status: 'warn',
    detail: lastFailure
      ? `${detail} Research still runs on public pages and web search. Last time: ${lastFailure}`
      : `${detail} Research still runs on public pages and web search.`,
    fix: `Say yes and I will set it up: a recent Python, the page reader and the browser it drives. To do it yourself: ${second} then ${third}`,
  };
}

/**
 * The install hint for whichever computer this is.
 * @returns {string}
 */
function ffmpegFix() {
  if (process.platform === 'win32') {
    return 'Video and audio need FFmpeg. Open the Start menu, type "Terminal", open it and paste: winget install Gyan.FFmpeg. Then start a new Claude session.';
  }
  if (process.platform === 'darwin') {
    return 'Video and audio need FFmpeg. Open the Terminal app and paste: brew install ffmpeg. Then start a new Claude session.';
  }
  return 'Video and audio need FFmpeg. Install it with your system package manager, for example: sudo apt install ffmpeg. Then start a new Claude session.';
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ok: boolean, detail: string}}
 */
function integrityOf(db) {
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    const first = rows.length > 0 ? String(Object.values(rows[0])[0]) : 'unknown';
    return first === 'ok' ? { ok: true, detail: 'ok' } : { ok: false, detail: first };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

/**
 * The newest backup file that opens and passes its own integrity check.
 * @param {string|null} root
 * @returns {string|null}
 */
function newestGoodBackup(root) {
  if (!root) return null;
  const dir = backupsDir(root);
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((file) => file.endsWith('.db'))
    .map((file) => join(dir, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const candidate of candidates) {
    let probe = null;
    try {
      probe = new DatabaseSync(candidate, { readOnly: true });
      if (integrityOf(probe).ok) return candidate;
    } catch {
      // an unreadable backup is simply not a candidate
    } finally {
      try {
        probe?.close();
      } catch {
        // nothing to do
      }
    }
  }
  return null;
}

/** The publishing services earlier versions could connect, as a person knows them. */
const LEGACY_PUBLISHERS = { blotato: 'Blotato', postiz: 'Postiz', buffer: 'Buffer' };

/**
 * The publishing record an earlier version left in a workspace's integrations.json,
 * read without touching any credential store.
 * @param {string|null} root
 * @returns {{credential_ref: string|null, hasKey: boolean, provider: string|null}|null}
 */
function legacyPublisherRecord(root) {
  if (!root) return null;
  const file = readJsonFile(integrationsPath(root), /** @type {any} */ ({}));
  const record = file?.providers && typeof file.providers === 'object' ? file.providers.publisher : null;
  if (!record || typeof record !== 'object') return null;
  return {
    credential_ref: typeof record.credential_ref === 'string' && record.credential_ref ? record.credential_ref : null,
    hasKey: Boolean(record.credential_ref || record.api_key),
    provider: Object.hasOwn(LEGACY_PUBLISHERS, String(record.provider)) ? LEGACY_PUBLISHERS[String(record.provider)] : null,
  };
}

/**
 * Publishing keys stored by earlier versions. Publishing no longer uses them, so the
 * only thing left to do is remove them; the check appears only while one is there.
 * @param {string|null} root
 * @returns {Check|null}
 */
function legacyPublishingCredentialsCheck(root) {
  const record = legacyPublisherRecord(root);
  // A bare record with no key in it is dropped quietly by the repair, never reported.
  if (!record?.hasKey && listLegacyCredentials().length === 0) return null;
  const service = record?.provider ?? 'your publishing service';
  return {
    id: 'legacy_publishing_credentials',
    name: 'Old publishing key',
    status: 'warn',
    detail: `An old ${service} key from an earlier version is still stored on this computer. Publishing no longer uses it.`,
    fix: `Say yes and I will remove it from this computer. The key itself will still work at ${service}, so revoke it there too.`,
    repairable: true,
  };
}

/**
 * A workspace folder on this computer that looks set up but is not pointed at.
 * @returns {string|null}
 */
function findAdoptableRoot() {
  const candidate = defaultWorkspaceRoot();
  return existsSync(workspaceConfigPath(candidate)) ? candidate : null;
}

/**
 * @typedef {(workspace: import('../workspace/index.mjs').Workspace, options?: {legacyCredentials?: import('../lib/legacy-credentials.mjs').PurgeOptions}) => {repaired: boolean, detail: string, restart_needed?: boolean}} Repair
 */

/** @type {Record<string, Repair>} */
const REPAIRS = {
  workspace_pointer(workspace) {
    if (workspace.root) {
      return { repaired: true, detail: `This project already uses ${workspace.root}.` };
    }
    const root = findAdoptableRoot();
    if (!root) {
      return { repaired: false, detail: NO_ADOPTABLE_WORKSPACE_FIX };
    }
    // Link this project to the folder discovery found, using the existing
    // project binding function, then reload so the live workspace reflects
    // it immediately. This never writes the machine-wide pointer
    // (globalConfigPath()'s `workspaceRoot` field): since 0.3.3 that field no
    // longer selects a workspace, so writing it never actually linked
    // anything up, only recorded a fact nothing read back.
    const projectRoot = workspace.projectRoot ?? resolve(process.cwd());
    recordProjectWorkspace(projectRoot, root);
    workspace.load(projectRoot);
    return {
      repaired: Boolean(workspace.root),
      detail: workspace.root
        ? `This project now uses ${workspace.root}.`
        : 'Could not link this project to a workspace.',
    };
  },

  workspace_folders(workspace) {
    const root = workspace.requireRoot();
    /** @type {string[]} */
    const created = [];
    for (const relative of WORKSPACE_TREE) {
      const target = join(root, ...relative.split('/'));
      if (!existsSync(target)) {
        mkdirSync(target, { recursive: true });
        created.push(relative);
      }
    }
    return {
      repaired: true,
      detail: created.length === 0 ? 'Every folder was already there.' : `Put back ${created.length} folder${created.length === 1 ? '' : 's'}.`,
    };
  },

  storage(workspace) {
    const root = workspace.requireRoot();
    workspace.close();
    /** @type {ReturnType<typeof openAndMigrate>} */
    let opened;
    try {
      opened = openAndMigrate({ dbPath: databasePath(root), workspaceRoot: root });
    } catch (error) {
      // Storage that will not open at all is the same problem as storage that opens
      // damaged, so hand it to the repair that knows how to put a backup back.
      log.warn('storage repair could not open the database', { error: String(error) });
      return REPAIRS.storage_integrity(workspace);
    }
    workspace.db = opened.db;
    workspace.lastApplied = opened.applied;
    workspace.lastBackupPath = opened.backupPath;
    workspace.issues = [];
    writeSchemaDump(opened.db, root);
    return {
      repaired: true,
      detail:
        opened.applied.length === 0
          ? 'Storage was already up to date.'
          : `Storage finished updating. A copy of everything was saved first.`,
    };
  },

  storage_integrity(workspace) {
    const root = workspace.requireRoot();
    const backup = newestGoodBackup(root);
    if (!backup) {
      return {
        repaired: false,
        detail: 'There is no earlier copy on this computer that reads back cleanly.',
      };
    }
    workspace.close();
    const live = databasePath(root);
    const damaged = join(backupsDir(root), `creative-damaged-${timestampSlug()}.db`);
    mkdirSync(backupsDir(root), { recursive: true });
    if (existsSync(live)) renameSync(live, damaged);
    // The write ahead log belongs to the file that has just been set aside.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${live}${suffix}`;
      if (existsSync(sidecar)) renameSync(sidecar, `${damaged}${suffix}`);
    }
    copyFileSync(backup, live);
    const opened = openAndMigrate({ dbPath: live, workspaceRoot: root });
    workspace.db = opened.db;
    workspace.lastApplied = opened.applied;
    workspace.lastBackupPath = backup;
    workspace.issues = [];
    writeSchemaDump(opened.db, root);
    return {
      repaired: true,
      detail: `Put back the copy saved on ${backupDateOf(backup)}. The damaged one is kept in the backups folder.`,
    };
  },

  research_helper(workspace) {
    // Kicked off, not waited on: the install takes minutes and no tool call is
    // allowed to sit on one. Running the doctor again is how a person watches it
    // finish.
    const state = startInstall(workspace);
    return {
      repaired: state.state === 'installing',
      detail:
        state.state === 'installing'
          ? 'Setting up the research helper now. It carries on in the background. Run the doctor again to see how it is going.'
          : 'The research helper is already set up.',
    };
  },

  legacy_publishing_credentials(workspace, options = {}) {
    const root = workspace.root;
    const record = legacyPublisherRecord(root);
    const credentialOptions = options.legacyCredentials ?? {};
    const keyFailure = (/** @type {number} */ count) => ({
      repaired: false,
      detail:
        count === 1
          ? 'One stored publishing key could not be removed. It may be locked or in use. Unlock the credential store on this computer and run the doctor again.'
          : `${count} stored publishing keys could not be removed. They may be locked or in use. Unlock the credential store on this computer and run the doctor again.`,
    });
    let removedKeys = 0;
    try {
      // The referenced key first, so a failure leaves the reference in place for a retry.
      if (record?.credential_ref && purgeLegacyCredential(record.credential_ref, credentialOptions)) removedKeys += 1;
      if (record && root) {
        updateJsonFile(integrationsPath(root), (file) => {
          const providers = { ...(file?.providers && typeof file.providers === 'object' ? file.providers : {}) };
          delete providers.publisher;
          return { ...file, providers };
        }, {});
      }
    } catch (error) {
      log.warn('legacy publishing key removal failed', { error: String(error) });
      return keyFailure(1);
    }
    const swept = sweepLegacyCredentials(credentialOptions);
    if (swept.failed > 0) return keyFailure(swept.failed);
    if (record?.hasKey || removedKeys + swept.removed > 0) {
      const where = record?.provider
        ? `at ${record.provider}, so revoke it in your ${record.provider} account settings`
        : 'at your publishing service, so revoke it there';
      return { repaired: true, detail: `Removed the old publishing key from this computer. The key still works ${where}.` };
    }
    if (record) return { repaired: true, detail: 'Removed an old publishing connection record.' };
    return { repaired: false, detail: 'Nothing to remove.' };
  },
};

/**
 * A date a person can read, from a backup file's own timestamp.
 * @param {string} filePath
 * @returns {string}
 */
function backupDateOf(filePath) {
  try {
    return new Date(statSync(filePath).mtimeMs).toLocaleString();
  } catch {
    return 'an earlier date';
  }
}

/**
 * @param {Record<string, string>} capabilities
 */
function connectionSummary(capabilities) {
  return CONNECTION_ROWS.map((row) => ({
    key: row.key,
    label: row.label,
    provider: row.provider,
    state: capabilities[row.capabilities[0]] ?? 'not_connected',
  }));
}
