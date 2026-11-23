import fs from 'node:fs';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';

export interface MigrationResult {
	/** How many migrations were applied. */
	applied: number;
	/** The backup taken before applying them, or `null` if none was needed. */
	backupFile: string | null;
}

interface MigrateOptions {
	sqlite: BetterSqlite3.Database;
	db: BetterSQLite3Database<Record<string, unknown>>;
	migrationsFolder: string;
	backupsDir: string;
	now?: Date;
}

/** Drizzle's bookkeeping table: one row per applied migration, keyed by its journal timestamp. */
const MIGRATIONS_TABLE = '__drizzle_migrations';

/** Counts migrations Drizzle would apply, using the same rule as its migrator. */
function countPending(sqlite: BetterSqlite3.Database, migrationsFolder: string): number {
	const migrations = readMigrationFiles({ migrationsFolder });
	const tableExists = sqlite
		.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
		.get(MIGRATIONS_TABLE);
	const last = tableExists
		? (sqlite
				.prepare(`SELECT created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`)
				.get() as { created_at: number | string } | undefined)
		: undefined;
	return migrations.filter((m) => !last || Number(last.created_at) < m.folderMillis).length;
}

function hasTables(sqlite: BetterSqlite3.Database): boolean {
	return Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get());
}

/**
 * Applies pending migrations. If the database already holds data, it is first copied to
 * `backupsDir` with SQLite's online backup, so a failed or unwanted upgrade can be undone.
 */
export async function migrateWithBackup({
	sqlite,
	db,
	migrationsFolder,
	backupsDir,
	now = new Date()
}: MigrateOptions): Promise<MigrationResult> {
	if (!fs.existsSync(path.join(migrationsFolder, 'meta', '_journal.json'))) {
		return { applied: 0, backupFile: null };
	}

	const pending = countPending(sqlite, migrationsFolder);
	if (pending === 0) return { applied: 0, backupFile: null };

	let backupFile: string | null = null;
	if (hasTables(sqlite)) {
		fs.mkdirSync(backupsDir, { recursive: true });
		const stamp = now
			.toISOString()
			.replaceAll(':', '-')
			.replace(/\.\d+Z$/, 'Z');
		backupFile = path.join(backupsDir, `chloris-${stamp}-before-migration.db`);
		await sqlite.backup(backupFile);
	}

	// Drizzle runs all pending migrations in one transaction, where SQLite ignores
	// `PRAGMA foreign_keys`. Rebuilding a table with foreign keys on would cascade deletes into
	// the tables that reference it, so switch them off for the duration and check afterwards
	// (the procedure in https://www.sqlite.org/lang_altertable.html#otheralter).
	sqlite.pragma('foreign_keys = OFF');
	try {
		migrate(db, { migrationsFolder });
		const violations = sqlite.pragma('foreign_key_check') as unknown[];
		if (violations.length > 0) {
			throw new Error(
				`Migrations left ${violations.length} foreign key violation(s). ` +
					(backupFile ? `The database before migrating is in ${backupFile}.` : '')
			);
		}
	} finally {
		sqlite.pragma('foreign_keys = ON');
	}

	return { applied: pending, backupFile };
}
