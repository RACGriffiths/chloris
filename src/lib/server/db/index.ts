import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { ConfigError } from '../config';
import { MIGRATIONS_TABLE, migrateWithBackup, type MigrationResult } from './migrate';
import { MIGRATIONS_DIR, PRIVATE_FOLDER, backupsDir, databaseFile } from './paths';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export interface Connection {
	sqlite: Database.Database;
	db: Db;
}

/**
 * Opens a SQLite file with the settings Chloris relies on. With `mustExist`, a missing file is an
 * error rather than a new, empty database.
 */
export function openDatabase(file: string, { mustExist = false } = {}): Connection {
	const sqlite = new Database(file, { fileMustExist: mustExist });
	try {
		// Write-ahead logging: readers don't block the writer, and backups can run while the app does.
		sqlite.pragma('journal_mode = WAL');
		// Safe with WAL; a power cut can lose the last transactions but never corrupts the file.
		sqlite.pragma('synchronous = NORMAL');
		sqlite.pragma('foreign_keys = ON');
		// Wait up to 5 seconds for a lock (e.g. the backup command) instead of failing at once.
		sqlite.pragma('busy_timeout = 5000');
	} catch (error) {
		sqlite.close();
		throw error;
	}
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
	// Only this user may open a folder made here: the database holds every home's data.
	fs.mkdirSync(dataDir, { recursive: true, mode: PRIVATE_FOLDER });
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

/**
 * Opens the app's database in `dataDir` as it is, without applying migrations: for the
 * command-line tool's backup and check, which may run beside a server of another version and
 * mustn't change the schema under it. Throws a `ConfigError` if there's no database there, rather
 * than creating an empty one.
 */
export function openExistingDatabase(dataDir: string): void {
	closeDatabase();
	const file = databaseFile(dataDir);
	if (!fs.existsSync(file)) {
		throw new ConfigError([
			`DATA_DIR: there is no database at ${file}. Check DATA_DIR is the folder the server uses.`
		]);
	}
	const notChloris = new ConfigError([
		`DATA_DIR: ${file} isn't a Chloris database. Check DATA_DIR is the folder the server ` +
			'uses, and that the server has started on it at least once.'
	]);
	let opened: Connection;
	try {
		opened = openDatabase(file, { mustExist: true });
	} catch (error) {
		if ((error as { code?: unknown }).code === 'SQLITE_NOTADB') throw notChloris;
		throw error;
	}
	const migrated = opened.sqlite
		.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
		.get(MIGRATIONS_TABLE);
	if (!migrated) {
		opened.sqlite.close();
		throw notChloris;
	}
	connection = opened;
}

/** What `sqlite.backup()` copies per step: every page, in one step. */
const ALL_PAGES = 0x7fffffff;

/**
 * Copies the app's database to `file`, which mustn't exist yet, with SQLite's online backup
 * (D22): a consistent copy, taken while the server goes on using the database. Then opens the
 * copy and checks it, throwing if it isn't sound.
 */
export async function backupDatabase(file: string): Promise<void> {
	// Every page in one step, which reads one snapshot. In small steps, a write by the server
	// between two of them would start the copy again from the beginning.
	await getConnection().sqlite.backup(file, { progress: () => ALL_PAGES });
	const copy = openDatabase(file, { mustExist: true });
	let problems: string[];
	try {
		problems = databaseProblems(copy.sqlite);
	} finally {
		copy.sqlite.close();
	}
	if (problems.length > 0) {
		throw new Error(`The copy of the database in ${file} isn't sound:\n  ${problems.join('\n  ')}`);
	}
}

/**
 * Checks the app's database with SQLite's own checks: `integrity_check`, for damage to the file,
 * and `foreign_key_check`, for rows that refer to rows that aren't there. Returns what they found,
 * or an empty list if all is well. Reads only.
 */
export function checkDatabase(): string[] {
	return databaseProblems(getConnection().sqlite);
}

function databaseProblems(sqlite: Database.Database): string[] {
	const integrity = sqlite.pragma('integrity_check') as { integrity_check: string }[];
	const problems = integrity.map((row) => row.integrity_check).filter((text) => text !== 'ok');
	const broken = sqlite.pragma('foreign_key_check') as {
		table: string;
		rowid: number | null;
		parent: string;
	}[];
	for (const row of broken) {
		problems.push(
			`A row in ${row.table} (rowid ${row.rowid ?? 'unknown'}) refers to a row of ${row.parent} that isn't there.`
		);
	}
	return problems;
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
