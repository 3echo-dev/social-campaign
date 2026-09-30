/** Machine-owned credentials. Workspace files contain references, never keys. */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { globalConfigDir } from './paths.mjs';
import { readJsonFile, writeJsonFile } from './json.mjs';

const SERVICE = 'social-campaign';
const REF = /^sc-[a-f0-9-]{36}$/;
const cached = new Map();
const DPAPI = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding
[Console]::OutputEncoding = New-Object Text.UTF8Encoding
Add-Type -AssemblyName System.Security
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($request.operation -eq 'protect') {
  $bytes = [Text.Encoding]::UTF8.GetBytes($request.value)
  [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope))
} else {
  $bytes = [Convert]::FromBase64String($request.value)
  [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope))
}
`;

function location() {
  return join(globalConfigDir(), 'credentials');
}

function backend() {
  // Test children inherit NODE_TEST_CONTEXT. Refuse to touch native stores from
  // tests, and require a temporary isolated home for the encrypted test fixture.
  if (process.env.NODE_TEST_CONTEXT) {
    const home = globalConfigDir();
    const rel = relative(tmpdir(), home);
    if (!process.env.SOCIAL_CAMPAIGN_HOME || !rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Credential tests require an isolated temporary SOCIAL_CAMPAIGN_HOME.');
    }
    return 'fixture';
  }
  if (process.platform === 'win32') return 'dpapi';
  if (process.platform === 'darwin') return 'keychain';
  return 'secret-service';
}

function run(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    // Child stderr can contain a secret. Report only a fixed actionable message.
    throw new Error('The operating system credential store is unavailable. Unlock it and reconnect the publishing service.');
  }
  return result.stdout.replace(/\r?\n$/, '');
}

function protect(value, mode, decrypt = false) {
  if (mode === 'dpapi') {
    return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', DPAPI], JSON.stringify({ operation: decrypt ? 'unprotect' : 'protect', value }));
  }
  const keyPath = join(location(), 'fixture.key');
  try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const key = readFileSync(keyPath);
  if (decrypt) {
    const bytes = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString('base64');
}

/** Store a secret outside portable workspace data, optionally with an expiry. */
export function putCredential(secret, { expiresAt = null } = {}) {
  if (typeof secret !== 'string' || !secret) throw new Error('A credential value is required.');
  if (expiresAt !== null && !Number.isFinite(Date.parse(expiresAt))) throw new Error('The credential expiry must be a valid date.');
  const mode = backend();
  const ref = `sc-${randomUUID()}`;
  mkdirSync(location(), { recursive: true, mode: 0o700 });
  const record = { version: 1, backend: mode, expires_at: expiresAt };
  if (mode === 'dpapi' || mode === 'fixture') record.encrypted = protect(secret, mode);
  else if (mode === 'keychain') {
    // security's interactive input keeps the key out of process arguments.
    if (/[\r\n\0]/.test(secret)) throw new Error('The publishing key must be a single line.');
    const quoted = `"${secret.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    run('security', ['-i'], `add-generic-password -U -a ${ref} -s ${SERVICE} -w ${quoted}\n`);
    if (run('security', ['find-generic-password', '-a', ref, '-s', SERVICE, '-w']) !== secret) {
      throw new Error('The keychain did not retain this credential. Reconnect the publishing service.');
    }
  } else run('secret-tool', ['store', '--label=Social Campaign', 'service', SERVICE, 'reference', ref], secret);
  try { writeJsonFile(join(location(), `${ref}.json`), record); }
  catch (error) {
    if (mode === 'keychain') run('security', ['delete-generic-password', '-a', ref, '-s', SERVICE]);
    if (mode === 'secret-service') run('secret-tool', ['clear', 'service', SERVICE, 'reference', ref]);
    throw error;
  }
  remember(join(location(), `${ref}.json`), secret);
  return ref;
}

function remember(file, value) {
  if (cached.size >= 256) cached.delete(cached.keys().next().value);
  cached.set(file, { value, until: Date.now() + 30000 });
  return value;
}

/** Resolve a credential only inside server-side connection/dispatch code. */
export function getCredential(ref) {
  if (!REF.test(ref ?? '')) return null;
  const file = join(location(), `${ref}.json`);
  const record = readJsonFile(file, null);
  if (!record) { cached.delete(file); return null; }
  if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) {
    deleteCredential(ref);
    return null;
  }
  const mode = backend();
  if (record.backend !== mode) return null;
  const entry = cached.get(file);
  if (entry?.until > Date.now()) return entry.value;
  if (mode === 'dpapi' || mode === 'fixture') return remember(file, protect(record.encrypted, mode, true));
  if (mode === 'keychain') return remember(file, run('security', ['find-generic-password', '-a', ref, '-s', SERVICE, '-w']));
  return remember(file, run('secret-tool', ['lookup', 'service', SERVICE, 'reference', ref]));
}

export function deleteCredential(ref) {
  if (!REF.test(ref ?? '')) return;
  const file = join(location(), `${ref}.json`);
  cached.delete(file);
  const record = readJsonFile(file, null);
  if (!record) return;
  if (record.backend === 'keychain') run('security', ['delete-generic-password', '-a', ref, '-s', SERVICE]);
  if (record.backend === 'secret-service') run('secret-tool', ['clear', 'service', SERVICE, 'reference', ref]);
  rmSync(file, { force: true });
}

/** Remove abandoned, expired connection submissions at startup and on receipt. */
export function cleanupExpiredCredentials() {
  let names;
  try { names = readdirSync(location()); } catch { return { removed: 0, failed: 0 }; }
  let removed = 0;
  let failed = 0;
  for (const name of names) {
    if (!name.endsWith('.json') || !REF.test(name.slice(0, -5))) continue;
    const record = readJsonFile(join(location(), name), null);
    if (record?.expires_at && Date.parse(record.expires_at) <= Date.now()) {
      try { deleteCredential(name.slice(0, -5)); removed += 1; }
      catch { failed += 1; }
    }
  }
  return { removed, failed };
}
