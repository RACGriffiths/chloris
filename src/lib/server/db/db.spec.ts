import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	backupDatabase,
	closeDatabase,
	getConnection,
	initDatabase,
	openDatabase,
	openExistingDatabase
} from './index';

interface FixtureMigration {
	tag: string;
	when: number;
	statements: string[];
}

/** Writes migrations in the layout drizzle-kit generates. */
function writeMigrations(folder: string, migrations: FixtureMigration[]) {
	fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
	for (const migration of migrations) {
		fs.writeFileSync(
			path.join(folder, `${migration.tag}.sql`),
			migration.statements.join('\n--> statement-breakpoint\n')
		);
	}
	const entries = migrations.map((m, idx) => ({
		idx,
		version: '6',
		when: m.when,
		tag: m.tag,
		breakpoints: true
	}));
	fs.writeFileSync(
		path.join(folder, 'meta', '_journal.json'),
		JSON.stringify({ version: '7', dialect: 'sqlite', entries })
	);
}

const createRooms: FixtureMigration = {
	tag: '0000_rooms',
	when: 1_700_000_000_000,
	statements: [
		'CREATE TABLE `room` (`id` integer PRIMARY KEY NOT NULL, `name` text NOT NULL);',
		'CREATE TABLE `plant` (`id` integer PRIMARY KEY NOT NULL, `room_id` integer NOT NULL REFERENCES `room`(`id`) ON DELETE CASCADE);'
	]
};

/** A table rebuild as drizzle-kit writes it, e.g. to change a column. */
const rebuildRooms: FixtureMigration = {
	tag: '0001_rebuild_rooms',
	when: 1_700_000_100_000,
	statements: [
		'PRAGMA foreign_keys=OFF;',
		"CREATE TABLE `__new_room` (`id` integer PRIMARY KEY NOT NULL, `name` text NOT NULL, `light` text DEFAULT 'medium' NOT NULL);",
		'INSERT INTO `__new_room`("id", "name") SELECT "id", "name" FROM `room`;',
		'DROP TABLE `room`;',
		'ALTER TABLE `__new_room` RENAME TO `room`;',
		'PRAGMA foreign_keys=ON;'
	]
};

let dataDir: string;
let migrationsFolder: string;

beforeEach(() => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chloris-db-'));
	dataDir = path.join(root, 'data');
	migrationsFolder = path.join(root, 'migrations');
});

afterEach(() => {
	closeDatabase();
	fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
});

const backups = () =>
	fs.existsSync(path.join(dataDir, 'backups')) ? fs.readdirSync(path.join(dataDir, 'backups')) : [];

describe('openDatabase', () => {
	it('uses write-ahead logging and enforces foreign keys', () => {
		fs.mkdirSync(dataDir, { recursive: true });
		const { sqlite } = openDatabase(path.join(dataDir, 'test.db'));

		expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
		sqlite.close();
	});
});

describe('initDatabase', () => {
	it('creates the data folder and database when there are no migrations yet', async () => {
		const result = await initDatabase(dataDir, migrationsFolder);

		expect(result).toEqual({ applied: 0, backupFile: null });
		expect(fs.existsSync(path.join(dataDir, 'chloris.db'))).toBe(true);
		// Only the user running Chloris may open it: it holds every home's data.
		expect(fs.statSync(dataDir).mode & 0o777).toBe(0o700);
		expect(getConnection().sqlite.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
	});

	it('migrates a new database without taking a backup', async () => {
		writeMigrations(migrationsFolder, [createRooms]);

		const result = await initDatabase(dataDir, migrationsFolder);

		expect(result).toEqual({ applied: 1, backupFile: null });
		expect(backups()).toEqual([]);
		getConnection().sqlite.prepare("INSERT INTO room (name) VALUES ('Kitchen')").run();
	});

	it('does nothing on a restart with no new migrations', async () => {
		writeMigrations(migrationsFolder, [createRooms]);
		await initDatabase(dataDir, migrationsFolder);

		const result = await initDatabase(dataDir, migrationsFolder);

		expect(result).toEqual({ applied: 0, backupFile: null });
		expect(backups()).toEqual([]);
	});

	it('backs up an existing database before applying new migrations', async () => {
		writeMigrations(migrationsFolder, [createRooms]);
		await initDatabase(dataDir, migrationsFolder);
		getConnection().sqlite.prepare("INSERT INTO room (name) VALUES ('Kitchen')").run();
		closeDatabase();

		writeMigrations(migrationsFolder, [createRooms, rebuildRooms]);
		const result = await initDatabase(dataDir, migrationsFolder);

		expect(result.applied).toBe(1);
		expect(result.backupFile).toMatch(/backups\/chloris-.+-before-migration\.db$/);
		expect(fs.statSync(path.dirname(result.backupFile!)).mode & 0o777).toBe(0o700);
		const backup = new Database(result.backupFile!, { readonly: true });
		const columns = backup.prepare('SELECT name FROM pragma_table_info(?)').all('room');
		expect(columns).toEqual([{ name: 'id' }, { name: 'name' }]);
		expect(backup.prepare('SELECT name FROM room').all()).toEqual([{ name: 'Kitchen' }]);
		backup.close();
	});

	it('keeps rows that reference a table rebuilt by a migration', async () => {
		writeMigrations(migrationsFolder, [createRooms]);
		await initDatabase(dataDir, migrationsFolder);
		const { sqlite } = getConnection();
		sqlite.prepare("INSERT INTO room (id, name) VALUES (1, 'Kitchen')").run();
		sqlite.prepare('INSERT INTO plant (id, room_id) VALUES (1, 1)').run();
		closeDatabase();

		writeMigrations(migrationsFolder, [createRooms, rebuildRooms]);
		await initDatabase(dataDir, migrationsFolder);

		const after = getConnection().sqlite;
		expect(after.prepare('SELECT id, room_id FROM plant').all()).toEqual([{ id: 1, room_id: 1 }]);
		expect(after.prepare('SELECT light FROM room').get()).toEqual({ light: 'medium' });
		expect(after.pragma('foreign_keys', { simple: true })).toBe(1);
	});
});

describe('openExistingDatabase', () => {
	it('opens the database as it is, never migrating it, even with migrations waiting', async () => {
		writeMigrations(migrationsFolder, [createRooms]);
		await initDatabase(dataDir, migrationsFolder);
		closeDatabase();
		// A newer build of the command-line tool, beside a server that hasn't restarted yet.
		writeMigrations(migrationsFolder, [createRooms, rebuildRooms]);

		openExistingDatabase(dataDir);

		const columns = getConnection()
			.sqlite.prepare('SELECT name FROM pragma_table_info(?)')
			.all('room');
		expect(columns).toEqual([{ name: 'id' }, { name: 'name' }]);
		expect(backups()).toEqual([]);
	});

	it('refuses a folder with no database, rather than making one', () => {
		expect(() => openExistingDatabase(dataDir)).toThrow(/there is no database at/);
		expect(fs.existsSync(dataDir)).toBe(false);
	});

	it("refuses a file that isn't a Chloris database", () => {
		fs.mkdirSync(dataDir);
		new Database(path.join(dataDir, 'chloris.db')).close();
		expect(() => openExistingDatabase(dataDir)).toThrow(/isn't a Chloris database/);

		fs.writeFileSync(path.join(dataDir, 'chloris.db'), 'Not a database at all, just some text.');
		expect(() => openExistingDatabase(dataDir)).toThrow(/isn't a Chloris database/);
	});
});

describe('backupDatabase', () => {
	it('copies the database while it stays open, and checks the copy', async () => {
		writeMigrations(migrationsFolder, [createRooms]);
		await initDatabase(dataDir, migrationsFolder);
		getConnection().sqlite.prepare("INSERT INTO room (name) VALUES ('Kitchen')").run();
		const file = path.join(path.dirname(dataDir), 'copy.db');

		await backupDatabase(file);

		getConnection().sqlite.prepare("INSERT INTO room (name) VALUES ('Study')").run();
		const copy = new Database(file, { readonly: true });
		expect(copy.prepare('SELECT name FROM room').all()).toEqual([{ name: 'Kitchen' }]);
		copy.close();
	});
});
