import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHome } from '../data/homes';
import { addPhoto, type Photo } from '../data/photos';
import { createPlant } from '../data/plants';
import { createRoom } from '../data/rooms';
import { openExistingDatabase } from '../db';
import { insertUser, testJpeg, useTestDatabase } from '../testing';
import { BackupError, makeBackup, type BackupOptions } from './backup';
import { checkIntegrity } from './check';

const folders = useTestDatabase();

let destination: string;
let alice: string;
let aliceHome: string;
let fern: string;

const first = new Date('2026-11-24T03:00:00Z');
const second = new Date('2026-11-25T03:00:00Z');
const third = new Date('2026-11-26T03:00:00Z');

beforeEach(() => {
	destination = fs.mkdtempSync(path.join(os.tmpdir(), 'chloris-backups-'));
	alice = insertUser('alice@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	const room = createRoom(aliceHome, { name: 'Kitchen' });
	if (!room.ok) throw new Error('Room refused');
	const plant = createPlant(aliceHome, { nickname: 'Fern', roomId: room.room.id });
	if (!plant) throw new Error('Plant refused');
	fern = plant.id;
});

afterEach(() => {
	fs.rmSync(destination, { recursive: true, force: true });
});

async function add(): Promise<Photo> {
	const added = await addPhoto(aliceHome, alice, fern, {}, await testJpeg());
	if (!added.ok) throw new Error('Photo refused');
	return added.photo;
}

function backup(options: Partial<BackupOptions> = {}) {
	return makeBackup({ photosDir: folders.photosDir, destination, now: first, ...options });
}

/** The files in a backup's photo folder, by their path in it. */
function backedUpPhotos(folder: string): string[] {
	const photos = path.join(folder, 'photos');
	return fs
		.readdirSync(photos, { recursive: true, encoding: 'utf8' })
		.filter((name) => fs.statSync(path.join(photos, name)).isFile())
		.sort();
}

/** The photo rows in a backup's copy of the database. */
function backedUpRows(folder: string): number {
	const copy = new Database(path.join(folder, 'chloris.db'), { readonly: true });
	try {
		return (copy.prepare('SELECT count(*) AS n FROM photo').get() as { n: number }).n;
	} finally {
		copy.close();
	}
}

describe('makeBackup', () => {
	it('copies the database, then the photos, into a folder named for the time', async () => {
		await add();

		const result = await backup();

		const folder = path.join(destination, 'chloris-2026-11-24T03-00-00Z');
		expect(result).toMatchObject({
			folder,
			copied: 3,
			linked: 0,
			linkedFrom: null,
			missing: [],
			removed: [],
			unfinished: []
		});
		expect(result.databaseBytes).toBe(fs.statSync(path.join(folder, 'chloris.db')).size);
		expect(backedUpRows(folder)).toBe(1);
		expect(backedUpPhotos(folder)).toHaveLength(3);
		expect(backedUpPhotos(folder).every((file) => file.startsWith(`${aliceHome}/`))).toBe(true);
		expect(fs.readdirSync(destination)).toEqual(['chloris-2026-11-24T03-00-00Z']);
		// The database holds everyone's sessions, so only whoever made the backup can read it.
		expect(fs.statSync(folder).mode & 0o777).toBe(0o700);
	});

	it('makes a backup that passes the integrity check when used as DATA_DIR', async () => {
		await add();
		await add();
		const { folder } = await backup();

		openExistingDatabase(folder);
		const report = await checkIntegrity(path.join(folder, 'photos'));

		expect(report.ok).toBe(true);
		expect(report.photos).toMatchObject({ photos: 2, files: 6, unreferenced: [] });
	});

	it('links photos already in the previous backup, and copies only new ones', async () => {
		await add();
		const earlier = await backup();
		await add();

		const later = await backup({ now: second });

		expect(later).toMatchObject({ copied: 3, linked: 3, linkedFrom: earlier.folder });
		expect(backedUpPhotos(later.folder)).toHaveLength(6);
		for (const file of backedUpPhotos(earlier.folder)) {
			const before = fs.statSync(path.join(earlier.folder, 'photos', file));
			const after = fs.statSync(path.join(later.folder, 'photos', file));
			expect(after.ino).toBe(before.ino);
		}
		// Each backup stands on its own: removing the earlier one leaves the later one whole.
		fs.rmSync(earlier.folder, { recursive: true });
		expect(backedUpPhotos(later.folder)).toHaveLength(6);
	});

	it("copies a file again if the previous backup's copy isn't the same size", async () => {
		await add();
		const earlier = await backup();
		const [damaged] = backedUpPhotos(earlier.folder);
		fs.truncateSync(path.join(earlier.folder, 'photos', damaged), 10);

		const later = await backup({ now: second });

		expect(later).toMatchObject({ copied: 1, linked: 2 });
		expect(fs.statSync(path.join(later.folder, 'photos', damaged)).size).toBe(
			fs.statSync(path.join(folders.photosDir, damaged)).size
		);
	});

	it('removes the oldest backups beyond --keep, and nothing else', async () => {
		fs.mkdirSync(path.join(destination, 'notes'));
		fs.mkdirSync(path.join(destination, 'chloris-2020-01-01T00-00-00Z-before-migration'));
		await add();
		const oldest = await backup();
		await backup({ now: second });

		const latest = await backup({ now: third, keep: 2 });

		expect(latest.removed).toEqual([oldest.folder]);
		expect(fs.readdirSync(destination).sort()).toEqual([
			'chloris-2020-01-01T00-00-00Z-before-migration',
			'chloris-2026-11-25T03-00-00Z',
			'chloris-2026-11-26T03-00-00Z',
			'notes'
		]);
	});

	it('says which photos it could not back up because their files were already missing', async () => {
		const photo = await add();
		const [file] = fs.readdirSync(path.join(folders.photosDir, aliceHome));
		fs.rmSync(path.join(folders.photosDir, aliceHome, file));

		const result = await backup();

		expect(result.missing).toEqual([
			{ homeId: aliceHome, plantId: fern, photoId: photo.id, files: [`${aliceHome}/${file}`] }
		]);
		expect(backedUpPhotos(result.folder)).toHaveLength(2);
	});

	it("refuses a backup folder or photo folder that doesn't exist, rather than making it", async () => {
		const missing = path.join(destination, 'mnt', 'backups');

		await expect(backup({ destination: missing })).rejects.toThrow(BackupError);
		await expect(backup({ destination: missing })).rejects.toThrow(/doesn't exist/);
		await expect(backup({ photosDir: missing })).rejects.toThrow(/photo folder .* doesn't exist/);
		expect(fs.existsSync(missing)).toBe(false);
		expect(fs.readdirSync(destination)).toEqual([]);
	});

	it('refuses to back up into the photo folder', async () => {
		const inside = path.join(folders.photosDir, 'backups');
		fs.mkdirSync(inside);

		await expect(backup({ destination: inside })).rejects.toThrow(/inside the photo folder/);
		await expect(backup({ destination: folders.photosDir })).rejects.toThrow(
			/inside the photo folder/
		);
	});

	it('removes a backup that fails part way, and lists those left by runs that stopped', async () => {
		await add();
		const stopped = path.join(destination, 'chloris-2026-11-23T03-00-00Z.partial');
		fs.mkdirSync(stopped);
		expect((await backup()).unfinished).toEqual([stopped]);

		// Root can read any folder, so this only means something for other users.
		if (process.getuid?.() === 0) return;
		const homeFolder = path.join(folders.photosDir, aliceHome);
		fs.chmodSync(homeFolder, 0o000);
		try {
			await expect(backup({ now: second })).rejects.toThrow(/EACCES/);
		} finally {
			fs.chmodSync(homeFolder, 0o755);
		}
		expect(fs.readdirSync(destination).sort()).toEqual([
			'chloris-2026-11-23T03-00-00Z.partial',
			'chloris-2026-11-24T03-00-00Z'
		]);
	});
});
