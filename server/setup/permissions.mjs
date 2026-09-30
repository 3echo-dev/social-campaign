import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { InvalidInputError } from '../lib/errors.mjs';

export const MCP_SERVER_RULE = 'mcp__plugin_social-campaign_core';

export const PERMISSION_RULES = Object.freeze([MCP_SERVER_RULE, 'ArtifactData', 'ArtifactComments', 'Artifact']);

export function permissionsSettingsPath(projectRoot) {
  return join(resolve(projectRoot), '.claude', 'settings.local.json');
}

function rulesHashFor(target) {
  return createHash('sha256').update(JSON.stringify({ target, rules: PERMISSION_RULES })).digest('hex');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSettingsFile(target) {
  if (!existsSync(target)) return { settings: {}, unreadable: false };
  let raw;
  try {
    raw = readFileSync(target, 'utf8');
  } catch {
    return { settings: null, unreadable: true };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { settings: null, unreadable: true };
  }
  if (!isPlainObject(parsed)) return { settings: null, unreadable: true };
  return { settings: parsed, unreadable: false };
}

function allowListOf(settings) {
  const permissions = isPlainObject(settings.permissions) ? settings.permissions : {};
  return Array.isArray(permissions.allow) ? permissions.allow : [];
}

function blockersFor(settings) {
  const permissions = isPlainObject(settings.permissions) ? settings.permissions : {};
  const deny = Array.isArray(permissions.deny) ? permissions.deny : [];
  const ask = Array.isArray(permissions.ask) ? permissions.ask : [];
  const blocking = [];
  for (const rule of PERMISSION_RULES) {
    if (deny.includes(rule)) blocking.push({ rule, list: 'deny' });
    else if (ask.includes(rule)) blocking.push({ rule, list: 'ask' });
  }
  return blocking;
}

function manualLines() {
  const last = PERMISSION_RULES.length - 1;
  const inner = PERMISSION_RULES.map((rule, index) => `    "${rule}"${index < last ? ',' : ''}`);
  return ['"permissions": {', '  "allow": [', ...inner, '  ]', '}'];
}

function writeSettingsAtomic(target, value) {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, target);
}

export function previewPermissionRules({ projectRoot }) {
  const target = permissionsSettingsPath(projectRoot);
  const rulesHash = rulesHashFor(target);
  const { settings, unreadable } = readSettingsFile(target);
  const safeSettings = unreadable ? {} : settings;
  const allow = allowListOf(safeSettings);
  const alreadyPresent = PERMISSION_RULES.filter((rule) => allow.includes(rule));
  const blockedBy = unreadable ? [] : blockersFor(safeSettings);
  return { target, rules: [...PERMISSION_RULES], rulesHash, alreadyPresent, blockedBy, unreadable };
}

export function applyPermissionRules({ projectRoot, rulesHash }) {
  const target = permissionsSettingsPath(projectRoot);
  const expectedHash = rulesHashFor(target);
  if (rulesHash !== expectedHash) {
    throw new InvalidInputError('Preview the permission rules again before applying them.');
  }
  const { settings, unreadable } = readSettingsFile(target);
  if (unreadable) return { status: 'manual', target, lines: manualLines() };

  const base = settings;
  const permissions = isPlainObject(base.permissions) ? base.permissions : {};
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  const alreadyPresent = PERMISSION_RULES.filter((rule) => allow.includes(rule));
  const added = PERMISSION_RULES.filter((rule) => !allow.includes(rule));
  const nextSettings = { ...base, permissions: { ...permissions, allow: [...allow, ...added] } };
  writeSettingsAtomic(target, nextSettings);
  const stillBlockedBy = blockersFor(nextSettings);
  return { status: 'applied', target, added, alreadyPresent, stillBlockedBy };
}
