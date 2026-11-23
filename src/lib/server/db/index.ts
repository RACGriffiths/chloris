import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrateWithBackup, type MigrationResult } from './migrate';
import { MIGRATIONS_DIR, backupsDir, databaseFile } from './paths';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export interface Connection {
	sqlite: Database.Database;
	db: Db;
}

/** Opens a SQLite file with the settings Chloris relies on. */
export function openDatabase(file: string): Connection {
	const sqlite = new Database(file);
	// Write-ahead logging: readers don't block the writer, and backups can run while the app does.
	sqlite.pragma('journal_mode = WAL');
	// Safe with WAL; a power cut can lose the last transactions but never corrupts the file.
	sqlite.pragma('synchronous = NORMAL');
	sqlite.pragma('foreign_keys = ON');
	// Wait up to 5 seconds for a lock (e.g. the backup command) instead of failing at once.
	sqlite.pragma('busy_timeout = 5000');
	return { sqlite, db: drizzle(sqlite, { schema }) };
}

let connection: Connection | undefined;

/**
 * Opens the app's database in `dataDir` and brings its schema up to date, backing it up first
 * if there are migrations to apply. Called once from the server's `init` hook.
 */
export async function initDatabase(
	dataDir: string,
	migrationsFolder = path.resolve(MIGRATIONS_DIR)
): Promise<MigrationResult> {
	closeDatabase();
	fs.mkdirSync(dataDir, { recursive: true });
	const opened = openDatabase(databaseFile(dataDir));
	try {
		const result = await migrateWithBackup({
			...opened,
			migrationsFolder,
			backupsDir: backupsDir(dataDir)
		});
		connection = opened;
		return result;
	} catch (error) {
		opened.sqlite.close();
		throw error;
	}
}

/** The app's database. Only the data-access layer (`#lib/server/data`) should use it. */
export function getConnection(): Connection {
	if (!connection) throw new Error('Database is not open; initDatabase() runs at start-up');
	return connection;
}

export function closeDatabase(): void {
	connection?.sqlite.close();
	connection = undefined;
}
