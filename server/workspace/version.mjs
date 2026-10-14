/**
 * Plugin version stamping and the boot log.
 *
 * A workspace records the plugin version that last opened it, in workspace_meta
 * under `plugin_version`. On every boot the server compares that with the version in
 * .claude-plugin/plugin.json. Migrations themselves are applied by db/migrate.mjs
 * when storage is opened, backup and all; this module's job is to notice the version
 * change, write the new version down, and leave a readable trail.
 *
 * The trail is <workspace>/.social-campaign/logs/boot.log: one JSON object per boot,
 * rotated at 1 MB, so a support session can read a workspace's whole upgrade history
 * without asking the user to find anything.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendRotating, log } from '../lib/log.mjs';
import { bootLogPath } from '../lib/paths.mjs';
import { nowIso } from '../lib/ids.mjs';
import { readSwapFailure, samePath } from '../../scripts/lib/plugin-versions.mjs';

const require = createRequire(import.meta.url);
const manifest = require('../../.claude-plugin/plugin.json');
const pkg = require('../../package.json');

/** The version a user sees, and the one stamped into the workspace. */
export const PLUGIN_VERSION = String(manifest.version ?? pkg.version);

/** The workspace_meta key holding the plugin version the workspace last saw. */
export const PLUGIN_VERSION_KEY = 'plugin_version';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * True when this running server is a superseded install that could not hand over to the newer
 * one: its folder carries .orphaned_at, or the launcher that owns this process recorded that its
 * swap to the newer version failed. After a successful swap the new server is not orphaned, so
 * this is false and nobody is told to open a new chat.
 */
export function updateWaiting(root = SERVER_ROOT) {
  if (existsSync(join(root, '.orphaned_at'))) return true;
  return swapFailure(root) !== null;
}

/** The launcher's record of a failed swap away from this server, else null. */
export function swapFailure(root = SERVER_ROOT) {
  try {
    return readSwapFailure(process.ppid, root);
  } catch {
    return null;
  }
}

/**
 * What the launcher told this process. launchRoot is the version folder the chat started with,
 * which is where its skills and agents text came from; swapped is true when this server is a
 * different version than that.
 */
export function swapState(root = SERVER_ROOT) {
  const launchRoot = process.env.SOCIAL_CAMPAIGN_LAUNCH_ROOT || '';
  const swapped = Boolean(launchRoot) && !samePath(launchRoot, root);
  return { swapped, launchRoot: launchRoot || null, launchVersion: process.env.SOCIAL_CAMPAIGN_LAUNCH_VERSION || null };
}

/**
 * The version fields every status reply carries. pluginVersion and updateWaiting are the old pair;
 * runningVersion, skillsRoot and swapped tell the Director that this server moved on to a newer
 * version than the skills it is reading, and where the newer skills are.
 */
export function versionState(root = SERVER_ROOT) {
  const { swapped, launchVersion } = swapState(root);
  const failure = swapFailure(root);
  return {
    pluginVersion: PLUGIN_VERSION,
    runningVersion: PLUGIN_VERSION,
    updateWaiting: updateWaiting(root),
    swapped,
    skillsRoot: join(root, 'skills'),
    ...(swapped && launchVersion ? { skillsVersion: launchVersion } : {}),
    ...(failure ? { swapFailed: { toVersion: failure.toVersion ?? null, reason: String(failure.error ?? 'unknown').slice(0, 200) } } : {}),
  };
}

/**
 * Stamp the plugin version onto the workspace and write one boot line.
 *
 * @param {import('./index.mjs').Workspace} workspace
 * @returns {{previousVersion: string|null, version: string, upgraded: boolean}}
 */
export function recordBoot(workspace) {
  const previousVersion = workspace.db ? workspace.readMeta(PLUGIN_VERSION_KEY) : null;
  const upgraded = Boolean(workspace.db) && previousVersion !== PLUGIN_VERSION;
  if (workspace.db) workspace.writeMeta(PLUGIN_VERSION_KEY, PLUGIN_VERSION);

  if (workspace.root) {
    appendRotating(
      bootLogPath(workspace.root),
      JSON.stringify({
        ts: nowIso(),
        version: PLUGIN_VERSION,
        previous_version: previousVersion,
        upgraded,
        migrations_applied: workspace.lastApplied ?? [],
        backup: workspace.lastBackupPath ?? null,
        node: process.version,
      }),
    );
  }
  if (upgraded) {
    log.info('workspace version recorded', {
      from: previousVersion,
      to: PLUGIN_VERSION,
      applied: workspace.lastApplied,
    });
  }
  return { previousVersion, version: PLUGIN_VERSION, upgraded };
}
