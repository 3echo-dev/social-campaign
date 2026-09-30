/**
 * Database open and migrate.
 *
 * Migrations are numbered SQL files in migrations/NNN_name.sql. They are applied in
 * numeric order inside a transaction and recorded in schema_migrations. Before any
 * pending migration touches an existing database a consistent SQLite snapshot is
 * written and checked in <workspace>/.social-campaign/backups/.
 *
 * A non technical user never sees any of this and never runs SQL.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../lib/log.mjs';
import { nowIso, timestampSlug } from '../lib/ids.mjs';
import { writeJsonFile } from '../lib/json.mjs';
import { backupsDir, schemaDumpPath } from '../lib/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The migrations folder shipped with the plugin. */
export const MIGRATIONS_DIR = join(HERE, '..', '..', 'migrations');

/**
 * @typedef {object} MigrationFile
 * @property {number} version
 * @property {string} name
 * @property {string} path
 */

/**
 * List migration files in apply order.
 * @param {string} [dir]
 * @returns {MigrationFile[]}
 */
export function listMigrations(dir = MIGRATIONS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^\d+_[^.]+\.sql$/.test(file))
    .map((file) => ({
      version: Number.parseInt(file.slice(0, file.indexOf('_')), 10),
      name: file,
      path: join(dir, file),
    }))
    .sort((a, b) => a.version - b.version);
}

/**
 * Open a database file, creating parent folders if needed.
 * @param {string} dbPath
 * @returns {DatabaseSync}
 */
export function openDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 15000;');
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
  } catch (error) {
    // A file that is not a database opens and then fails on the first statement.
    // Closing the handle here matters on Windows, where a leaked one keeps the file
    // locked and stops doctor_repair from setting it aside.
    try {
      db.close();
    } catch {
      // nothing left to do with a handle that will not close
    }
    throw error;
  }
  return db;
}

/**
 * @param {DatabaseSync} db
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/**
 * @param {DatabaseSync} db
 * @returns {Set<number>}
 */
export function appliedVersions(db) {
  ensureMigrationsTable(db);
  const rows = db.prepare('SELECT version FROM schema_migrations').all();
  return new Set(rows.map((row) => Number(row.version)));
}

/**
 * Apply every pending migration.
 *
 * @param {DatabaseSync} db an open database.
 * @param {{dbPath: string, workspaceRoot?: string|null, migrationsDir?: string}} options
 * @returns {{applied: string[], version: number, backupPath: string|null}}
 */
export function migrate(db, options) {
  const migrations = listMigrations(options.migrationsDir ?? MIGRATIONS_DIR);
  // The write reservation covers discovery, backup and every update. A second
  // process waits, then discovers the first process's committed schema version.
  db.exec('BEGIN IMMEDIATE');
  let backupPath = null;
  /** @type {string[]} */
  const applied = [];
  let activeMigration = null;
  try {
    const already = appliedVersions(db);
    const pending = migrations.filter((migration) => !already.has(migration.version));
    const hasExistingData = already.size > 0 || Boolean(db.prepare(
      "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name != 'schema_migrations' AND name NOT GLOB 'sqlite_*' LIMIT 1",
    ).get());
    if (pending.length && hasExistingData) {
      backupPath = backupDatabase(options.dbPath, options.workspaceRoot ?? dirname(options.dbPath));
      if (!backupPath) throw new Error('The required database backup could not be verified. The upgrade was stopped.');
    }
    for (const migration of pending) {
      activeMigration = migration.name;
      const sql = readFileSync(migration.path, 'utf8');
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        nowIso(),
      );
      applied.push(migration.name);
    }
    const version = currentVersion(db);
    db.exec('COMMIT');
    for (const name of applied) log.info('migration applied', { migration: name });
    return { applied, version, backupPath };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Preserve the original upgrade error. */ }
    log.error('migration failed', { migration: activeMigration, error: String(error) });
    throw new Error(`Could not apply database update${activeMigration ? ` ${activeMigration}` : ''}: ${String(error)}`, { cause: error });
  }
}

/**
 * Snapshot committed data, including WAL writes, and verify the standalone copy.
 * @param {string} dbPath
 * @param {string} workspaceRoot
 * @returns {string|null}
 */
export function backupDatabase(dbPath, workspaceRoot) {
  let source;
  let restored;
  let target;
  let verified = false;
  try {
    if (!existsSync(dbPath) || statSync(dbPath).size === 0) return null;
    const dir = backupsDir(workspaceRoot);
    mkdirSync(dir, { recursive: true });
    target = join(dir, `creative-${timestampSlug()}-${randomUUID()}.db`);
    // VACUUM INTO is synchronous on all supported Node versions and takes a
    // consistent SQLite read snapshot. A separate connection also works while
    // migrate() holds its write reservation on the original handle.
    source = new DatabaseSync(dbPath, { readOnly: true });
    source.exec('PRAGMA busy_timeout = 15000');
    source.prepare('VACUUM INTO ?').run(target);
    source.close();
    source = null;
    restored = new DatabaseSync(target, { readOnly: true });
    const checks = restored.prepare('PRAGMA quick_check').all();
    if (checks.length !== 1 || checks[0].quick_check !== 'ok') throw new Error('Snapshot integrity check failed.');
    restored.close();
    restored = null;
    verified = true;
    log.info('database backed up', { target });
    return target;
  } catch (error) {
    log.warn('database backup failed', { error: String(error) });
    return null;
  } finally {
    try { source?.close(); } catch { /* Preserve the backup error. */ }
    try { restored?.close(); } catch { /* Preserve the backup error. */ }
    // A failed snapshot must not appear as a usable recovery point.
    if (target && !verified) {
      try { rmSync(target, { force: true }); }
      catch { log.warn('incomplete database snapshot could not be removed', { target }); }
    }
  }
}

/**
 * @param {DatabaseSync} db
 * @returns {number} the highest applied migration version, or 0.
 */
export function currentVersion(db) {
  ensureMigrationsTable(db);
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  return row && row.version != null ? Number(row.version) : 0;
}

/**
 * List the user tables in the database, for the schema.json dump.
 * @param {DatabaseSync} db
 * @returns {Array<{name: string, columns: string[]}>}
 */
export function describeSchema(db) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return tables.map((table) => {
    const columns = db.prepare(`PRAGMA table_info(${String(table.name)})`).all();
    return { name: String(table.name), columns: columns.map((column) => String(column.name)) };
  });
}

/**
 * Write <workspace>/.social-campaign/schema.json, a plain description of what the
 * database currently holds. It exists so a human or a support session can see the
 * shape without opening SQLite.
 * @param {DatabaseSync} db
 * @param {string} workspaceRoot
 * @returns {string} the file written.
 */
export function writeSchemaDump(db, workspaceRoot) {
  const filePath = schemaDumpPath(workspaceRoot);
  writeJsonFile(filePath, {
    generated_at: nowIso(),
    schema_version: currentVersion(db),
    tables: describeSchema(db),
  });
  return filePath;
}

/**
 * Open, migrate and describe in one call. This is the only entry point other modules
 * should use.
 * @param {{dbPath: string, workspaceRoot?: string|null, migrationsDir?: string}} options
 * @returns {{db: DatabaseSync, applied: string[], version: number, backupPath: string|null}}
 */
export function openAndMigrate(options) {
  const db = openDatabase(options.dbPath);
  try {
    const result = migrate(db, options);
    return { db, ...result };
  } catch (error) {
    db.close();
    throw error;
  }
}
