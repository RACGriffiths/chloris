import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getConnection, initDatabase, openDatabase } from './index';

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
