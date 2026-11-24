import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHome } from '../data/homes';
import { addPhoto, deletePhoto, type Photo } from '../data/photos';
import { createPlant } from '../data/plants';
import { createRoom } from '../data/rooms';
import { getConnection } from '../db';
import { photo as photoTable } from '../db/schema';
import { insertUser, testJpeg, useTestDatabase } from '../testing';
import { checkIntegrity } from './check';

const folders = useTestDatabase();

let alice: string;
let aliceHome: string;
let fern: string;

beforeEach(() => {
	alice = insertUser('alice@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	const room = createRoom(aliceHome, { name: 'Kitchen' });
	if (!room.ok) throw new Error('Room refused');
	const plant = createPlant(aliceHome, { nickname: 'Fern', roomId: room.room.id });
	if (!plant) throw new Error('Plant refused');
	fern = plant.id;
});

async function add(): Promise<Photo> {
	const added = await addPhoto(aliceHome, alice, fern, {}, await testJpeg());
	if (!added.ok) throw new Error('Photo refused');
	return added.photo;
}

/** The paths, in the photo folder, of a photo's files: full, medium, thumb. */
function filesOf(photoId: string): string[] {
	const row = getConnection()
		.db.select({ fileKey: photoTable.fileKey })
		.from(photoTable)
		.where(eq(photoTable.id, photoId))
		.get();
	if (!row) throw new Error('No such photo');
	return fs
		.readdirSync(path.join(folders.photosDir, aliceHome))
		.filter((name) => name.startsWith(row.fileKey))
		.map((name) => `${aliceHome}/${name}`)
		.sort();
}

describe('checkIntegrity', () => {
	it('finds nothing wrong with a sound database and photo folder', async () => {
		await add();
		await add();

		expect(await checkIntegrity(folders.photosDir)).toEqual({
			database: [],
			photoFolderFound: true,
			photos: {
				photos: 2,
				deleted: 0,
				files: 6,
				missing: [],
				deletedWithoutFiles: 0,
				unreferenced: []
			},
			ok: true
		});
	});

	it('lists the missing files of photos that are not deleted', async () => {
		await add();
		const photo = await add();
		const [full, medium] = filesOf(photo.id);
		fs.rmSync(path.join(folders.photosDir, full));
		fs.rmSync(path.join(folders.photosDir, medium));

		const report = await checkIntegrity(folders.photosDir);

		expect(report.ok).toBe(false);
		// In the order of the sizes: thumb, medium, full.
		expect(report.photos.missing).toEqual([
			{ homeId: aliceHome, plantId: fern, photoId: photo.id, files: [medium, full] }
		]);
	});

	it('counts deleted photos whose files have gone, but that is no problem', async () => {
		const photo = await add();
		deletePhoto(aliceHome, fern, photo.id, { userId: alice, anyPhoto: true });
		for (const file of filesOf(photo.id)) fs.rmSync(path.join(folders.photosDir, file));

		const report = await checkIntegrity(folders.photosDir);

		expect(report.ok).toBe(true);
		expect(report.photos).toMatchObject({ photos: 1, deleted: 1, deletedWithoutFiles: 1 });
		expect(report.photos.missing).toEqual([]);
	});

	it("lists files in homes' folders that belong to no photo, and ignores everything else", async () => {
		await add();
		const strayHome = randomUUID();
		const stray = [
			`${aliceHome}/${randomUUID()}-full.jpg`,
			`${aliceHome}/notes.txt`,
			`${strayHome}/${randomUUID()}-thumb.jpg`
		];
		fs.mkdirSync(path.join(folders.photosDir, strayHome));
		for (const file of stray) fs.writeFileSync(path.join(folders.photosDir, file), 'stray');
		// What a mounted drive or a person might leave, which Chloris never writes.
		fs.mkdirSync(path.join(folders.photosDir, 'lost+found'));
		fs.writeFileSync(path.join(folders.photosDir, 'lost+found', 'a.jpg'), '');
		fs.writeFileSync(path.join(folders.photosDir, 'README'), '');
		fs.mkdirSync(path.join(folders.photosDir, aliceHome, 'old'));

		const report = await checkIntegrity(folders.photosDir);

		expect(report.ok).toBe(true);
		expect(report.photos.unreferenced.sort()).toEqual(stray.sort());
		expect(report.photos.files).toBe(6);
	});

	it('says when the photo folder is not there, and every photo is missing', async () => {
		const photo = await add();
		fs.renameSync(folders.photosDir, `${folders.photosDir}-elsewhere`);

		const report = await checkIntegrity(folders.photosDir);

		expect(report).toMatchObject({ ok: false, photoFolderFound: false });
		expect(report.photos.missing).toMatchObject([{ photoId: photo.id }]);
		fs.renameSync(`${folders.photosDir}-elsewhere`, folders.photosDir);
	});

	it('reports rows that refer to rows that are not there', async () => {
		const photo = await add();
		const { sqlite } = getConnection();
		sqlite.pragma('foreign_keys = OFF');
		sqlite.prepare('UPDATE photo SET plant_id = ? WHERE id = ?').run('no-such-plant', photo.id);
		sqlite.pragma('foreign_keys = ON');

		const report = await checkIntegrity(folders.photosDir);

		expect(report.ok).toBe(false);
		expect(report.database).toEqual([
			expect.stringMatching(/^A row in photo \(rowid \d+\) refers to a row of plant/)
		]);
	});
});
