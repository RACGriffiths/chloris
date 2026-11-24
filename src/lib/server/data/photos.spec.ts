import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { addMember, insertUser, markPhotoDeleted, testJpeg, useTestDatabase } from '../testing';
import { listCareEvents, logCareWithPhoto } from './care-events';
import { createHome } from './homes';
import {
	addPhoto,
	addPhotoWith,
	deletePhoto,
	getPhoto,
	listPhotoFiles,
	listPhotos,
	purgeDeletedPhotos,
	readPhoto,
	takenAtFrom,
	updatePhoto,
	type Photo,
	type PhotoChangeInput,
	type PhotoEditor,
	type PhotoInput
} from './photos';
import { createPlant } from './plants';
import { createRoom } from './rooms';

const folders = useTestDatabase();

/**
 * Two homes, each with an owner and a plant. Alice's is in London, Bob's in Paris. Carol sits
 * Alice's plants: she can add photos but not edit plants.
 */
let alice: string;
let bob: string;
let carol: string;
let aliceHome: string;
let bobHome: string;
let fern: string;
let cactus: string;

/** 10:00 in London (BST) on a Monday. */
const now = new Date('2026-06-15T09:00:00Z');

let jpeg: Buffer;

/** Who changes photos: the owners, who may edit plants, and Carol, who may not (D40). */
let asAlice: PhotoEditor;
let asBob: PhotoEditor;
let asCarol: PhotoEditor;

beforeEach(async () => {
	alice = insertUser('alice@example.com', { canCreateHome: true });
	bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
	fern = addPlant(aliceHome, 'Fern');
	cactus = addPlant(bobHome, 'Cactus');
	carol = insertUser('carol@example.com');
	addMember(aliceHome, carol, 'sitter');
	asAlice = { userId: alice, anyPhoto: true };
	asBob = { userId: bob, anyPhoto: true };
	asCarol = { userId: carol, anyPhoto: false };
	jpeg = await testJpeg();
});

function addPlant(homeId: string, nickname: string): string {
	const room = createRoom(homeId, { name: `${nickname}'s room` });
	if (!room.ok) throw new Error('Room refused');
	const plant = createPlant(homeId, { nickname, roomId: room.room.id });
	if (!plant) throw new Error('Plant refused');
	return plant.id;
}

/** Adds a photo that must be accepted. */
async function add(
	homeId: string,
	userId: string,
	plantId: string,
	input: PhotoInput = {},
	file: Uint8Array = jpeg,
	at = now
): Promise<Photo> {
	const result = await addPhoto(homeId, userId, plantId, input, file, at);
	if (!result.ok) throw new Error(`Photo refused: ${result.reason}`);
	return result.photo;
}

/** Every file in the photo folder, by its path within it. */
function filesOnDisk(): string[] {
	return fs
		.readdirSync(folders.photosDir, { recursive: true, encoding: 'utf8' })
		.filter((name) => fs.statSync(path.join(folders.photosDir, name)).isFile())
		.sort();
}

describe('addPhoto', () => {
	it('records the photo, with who added it, and stores a file for each size', async () => {
		const photo = await add(aliceHome, alice, fern, { caption: '  New leaf!  ' });

		expect(photo).toMatchObject({
			plantId: fern,
			takenAt: now,
			width: 600,
			height: 400,
			caption: 'New leaf!',
			userId: alice,
			userName: 'alice'
		});
		const files = filesOnDisk();
		expect(files).toHaveLength(3);
		expect(files.every((file) => file.startsWith(`${aliceHome}${path.sep}`))).toBe(true);
	});

	it("names files with a key of their own, not the photo's id", async () => {
		const photo = await add(aliceHome, alice, fern);

		expect(filesOnDisk().some((file) => file.includes(photo.id))).toBe(false);
	});

	it("won't add a photo to another home's plant, and stores nothing", async () => {
		expect(await addPhoto(aliceHome, alice, cactus, {}, jpeg, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});

		expect(listPhotos(aliceHome, cactus)).toEqual([]);
		expect(listPhotos(bobHome, cactus)).toEqual([]);
		expect(filesOnDisk()).toEqual([]);
	});

	it('refuses a file that is not a photo the server takes, and stores nothing', async () => {
		const gif = await sharp(jpeg).gif().toBuffer();

		expect(await addPhoto(aliceHome, alice, fern, {}, gif, now)).toEqual({
			ok: false,
			reason: 'unsupported'
		});
		expect(listPhotos(aliceHome, fern)).toEqual([]);
		expect(filesOnDisk()).toEqual([]);
	});

	it('refuses a caption that is too long', async () => {
		await expect(
			addPhoto(aliceHome, alice, fern, { caption: 'x'.repeat(201) }, jpeg)
		).rejects.toThrow(ZodError);
	});
});

describe('when a photo was taken', () => {
	it("prefers the date in the photo's own EXIF data over what the browser sent", async () => {
		const dated = await testJpeg({
			exif: { IFD2: { DateTimeOriginal: '2025:05:03 14:22:10', OffsetTimeOriginal: '+02:00' } }
		});

		const photo = await add(aliceHome, alice, fern, { takenAt: '2024-01-01T00:00:00' }, dated);

		expect(photo.takenAt).toEqual(new Date('2025-05-03T12:22:10Z'));
	});

	it("takes the date the browser read, in the home's time zone when it has no offset", async () => {
		// The browser's resized copy has no EXIF data of its own.
		const london = await add(aliceHome, alice, fern, { takenAt: '2025-05-03T14:22:10' });
		const paris = await add(bobHome, bob, cactus, { takenAt: '2025-05-03T14:22:10' });
		const offset = await add(aliceHome, alice, fern, { takenAt: '2025-05-03T14:22:10-04:00' });

		expect(london.takenAt).toEqual(new Date('2025-05-03T13:22:10Z'));
		expect(paris.takenAt).toEqual(new Date('2025-05-03T12:22:10Z'));
		expect(offset.takenAt).toEqual(new Date('2025-05-03T18:22:10Z'));
	});

	it('uses the time it was added when the date is missing, malformed or implausible', async () => {
		for (const takenAt of ['', 'last Tuesday', '1989-12-31T23:00:00', '2026-06-16T09:00:00']) {
			const photo = await add(aliceHome, alice, fern, { takenAt });
			expect(photo.takenAt, takenAt).toEqual(now);
		}
	});

	it("reads a date through a change of the clocks in the home's time zone", () => {
		// 01:30 on 29 March 2026 never happens in London: clocks go from 01:00 to 02:00.
		const taken = takenAtFrom({ local: '2026-03-29T01:30:00', offset: null }, 'Europe/London', now);

		expect(taken).toEqual(new Date('2026-03-29T01:30:00Z'));
	});
});

describe('listPhotos', () => {
	it("lists a plant's photos, the latest taken first, never another home's", async () => {
		const older = await add(aliceHome, alice, fern, { takenAt: '2025-01-01T12:00:00' });
		const newer = await add(aliceHome, alice, fern, { takenAt: '2025-06-01T12:00:00' });
		const bobs = await add(bobHome, bob, cactus);

		expect(listPhotos(aliceHome, fern)).toEqual([newer, older]);
		expect(listPhotos(bobHome, cactus)).toEqual([bobs]);
		expect(listPhotos(bobHome, fern)).toEqual([]);
	});

	it('leaves out deleted photos', async () => {
		const kept = await add(aliceHome, alice, fern);
		const deleted = await add(aliceHome, alice, fern);

		markPhotoDeleted(deleted.id);

		expect(listPhotos(aliceHome, fern)).toEqual([kept]);
	});
});

describe('readPhoto', () => {
	it('reads each size of a photo in the home', async () => {
		const photo = await add(aliceHome, alice, fern);

		for (const [size, width] of [
			['thumb', 400],
			['medium', 600],
			['full', 600]
		] as const) {
			const result = await readPhoto(aliceHome, photo.id, size);
			if (!result.ok) throw new Error(`Not read: ${result.reason}`);
			expect((await sharp(result.bytes).metadata()).width, size).toBe(width);
		}
	});

	it("knows nothing of another home's photo", async () => {
		const photo = await add(aliceHome, alice, fern);

		expect(await readPhoto(bobHome, photo.id, 'full')).toEqual({ ok: false, reason: 'not-found' });
	});

	it('knows nothing of a deleted photo, though its files are still on disk', async () => {
		const photo = await add(aliceHome, alice, fern);

		markPhotoDeleted(photo.id);

		expect(await readPhoto(aliceHome, photo.id, 'full')).toEqual({
			ok: false,
			reason: 'not-found'
		});
		expect(filesOnDisk()).toHaveLength(3);
	});

	it('says when the file is missing from disk, so a placeholder can be shown', async () => {
		const photo = await add(aliceHome, alice, fern);
		fs.rmSync(path.join(folders.photosDir, aliceHome), { recursive: true });

		expect(await readPhoto(aliceHome, photo.id, 'thumb')).toEqual({ ok: false, reason: 'missing' });
	});
});

describe('addPhotoWith', () => {
	it('stores neither the photo nor its files when what comes with it fails', async () => {
		await expect(
			addPhotoWith(aliceHome, alice, fern, {}, jpeg, { now }, () => {
				throw new Error('Refused');
			})
		).rejects.toThrow('Refused');

		expect(listPhotos(aliceHome, fern)).toEqual([]);
		expect(filesOnDisk()).toEqual([]);
	});

	it('dates a photo with no date of its own as it is told to', async () => {
		const careTime = new Date('2026-06-14T08:00:00Z');

		const result = await addPhotoWith(
			aliceHome,
			alice,
			fern,
			{},
			jpeg,
			{ now, undated: careTime },
			(_tx, photo) => photo.id
		);

		if (!result.ok) throw new Error(`Photo refused: ${result.reason}`);
		expect(result.photo.takenAt).toEqual(careTime);
		expect(result.recorded).toBe(result.photo.id);
	});
});

describe('getPhoto', () => {
	it("gives a photo of the plant, never another home's or another plant's", async () => {
		const photo = await add(aliceHome, alice, fern, { caption: 'New leaf' });
		const ivy = addPlant(aliceHome, 'Ivy');

		expect(getPhoto(aliceHome, fern, photo.id)).toEqual({ ...photo, care: null });
		expect(getPhoto(aliceHome, ivy, photo.id)).toBeNull();
		expect(getPhoto(bobHome, fern, photo.id)).toBeNull();
		expect(getPhoto(bobHome, cactus, photo.id)).toBeNull();
	});

	it('knows nothing of a deleted photo', async () => {
		const photo = await add(aliceHome, alice, fern);

		markPhotoDeleted(photo.id);

		expect(getPhoto(aliceHome, fern, photo.id)).toBeNull();
	});
});

describe('updatePhoto', () => {
	/** Changes a photo, as `editor`, at `now`. */
	const change = (photo: Photo, editor: PhotoEditor, input: PhotoChangeInput, homeId = aliceHome) =>
		updatePhoto(homeId, photo.plantId, photo.id, editor, input, now);

	it("changes the caption, and when it was taken in the home's time zone", async () => {
		const photo = await add(aliceHome, alice, fern, { caption: 'Old caption' });

		const result = change(photo, asAlice, { caption: '  Repotted  ', takenAt: '2026-05-10T09:30' });

		// 09:30 in London in May is 08:30 UTC.
		const changed = { ...photo, caption: 'Repotted', takenAt: new Date('2026-05-10T08:30:00Z') };
		expect(result).toEqual({ ok: true, photo: changed });
		expect(getPhoto(aliceHome, fern, photo.id)).toEqual({ ...changed, care: null });
	});

	it('moves the photo in the timeline, and an empty caption removes it', async () => {
		const older = await add(aliceHome, alice, fern, { takenAt: '2025-01-01T12:00:00' });
		const newer = await add(aliceHome, alice, fern, { takenAt: '2025-06-01T12:00:00' });

		const result = change(older, asAlice, { caption: '', takenAt: '2025-07-01T12:00' });

		if (!result.ok) throw new Error(`Change refused: ${result.reason}`);
		expect(listPhotos(aliceHome, fern)).toEqual([result.photo, newer]);
		expect(result.photo.caption).toBeNull();
	});

	it('keeps the seconds of a time left as the form showed it', async () => {
		const photo = await add(aliceHome, alice, fern, { takenAt: '2025-05-03T14:22:10' });

		const result = change(photo, asAlice, { caption: 'Same time', takenAt: '2025-05-03T14:22' });

		expect(result).toMatchObject({ ok: true, photo: { takenAt: photo.takenAt } });
	});

	it('refuses a time still to come, or before 1990, and changes nothing', async () => {
		const photo = await add(aliceHome, alice, fern, { caption: 'Kept' });

		// Now is 10:00 in London.
		expect(change(photo, asAlice, { caption: 'No', takenAt: '2026-06-15T10:30' })).toEqual({
			ok: false,
			reason: 'in-the-future'
		});
		expect(change(photo, asAlice, { caption: 'No', takenAt: '1989-12-31T23:00' })).toEqual({
			ok: false,
			reason: 'too-early'
		});
		expect(getPhoto(aliceHome, fern, photo.id)).toEqual({ ...photo, care: null });
	});

	it('refuses a date that is not one, and a caption that is too long', async () => {
		const photo = await add(aliceHome, alice, fern);

		expect(() => change(photo, asAlice, { takenAt: '' })).toThrow('Enter a date and time.');
		expect(() =>
			change(photo, asAlice, { caption: 'x'.repeat(201), takenAt: '2026-06-01T09:00' })
		).toThrow(ZodError);
	});

	it('lets someone who cannot edit plants change only the photos they added', async () => {
		const alices = await add(aliceHome, alice, fern);
		const carols = await add(aliceHome, carol, fern);
		const input = { caption: 'Changed', takenAt: '2026-06-01T09:00' };

		expect(change(alices, asCarol, input)).toEqual({ ok: false, reason: 'not-yours' });
		expect(getPhoto(aliceHome, fern, alices.id)?.caption).toBeNull();
		expect(change(carols, asCarol, input)).toMatchObject({ ok: true });
		expect(change(carols, asAlice, { ...input, caption: 'Alice too' })).toMatchObject({ ok: true });
	});

	it("can't change another home's photo, even with its plant's id", async () => {
		const photo = await add(aliceHome, alice, fern, { caption: 'Kept' });
		const input = { caption: 'Taken over', takenAt: '2026-06-01T09:00' };

		expect(change(photo, asBob, input, bobHome)).toEqual({ ok: false, reason: 'not-found' });
		expect(updatePhoto(bobHome, cactus, photo.id, asBob, input, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});
		expect(getPhoto(aliceHome, fern, photo.id)).toEqual({ ...photo, care: null });
	});
});

describe('deletePhoto', () => {
	it('takes the photo off the timeline, but keeps its files through the grace period', async () => {
		const kept = await add(aliceHome, alice, fern);
		const photo = await add(aliceHome, alice, fern);

		expect(deletePhoto(aliceHome, fern, photo.id, asAlice, now)).toEqual({ ok: true, photo });

		expect(listPhotos(aliceHome, fern)).toEqual([kept]);
		expect(getPhoto(aliceHome, fern, photo.id)).toBeNull();
		expect(await readPhoto(aliceHome, photo.id, 'thumb')).toEqual({
			ok: false,
			reason: 'not-found'
		});
		expect(filesOnDisk()).toHaveLength(6);
		expect(deletePhoto(aliceHome, fern, photo.id, asAlice, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});
	});

	it('lets someone who cannot edit plants delete only the photos they added', async () => {
		const alices = await add(aliceHome, alice, fern);
		const carols = await add(aliceHome, carol, fern);

		expect(deletePhoto(aliceHome, fern, alices.id, asCarol, now)).toEqual({
			ok: false,
			reason: 'not-yours'
		});
		expect(deletePhoto(aliceHome, fern, carols.id, asCarol, now)).toMatchObject({ ok: true });
		expect(listPhotos(aliceHome, fern)).toEqual([alices]);
	});

	it("can't delete another home's photo, even with its plant's id", async () => {
		const photo = await add(aliceHome, alice, fern);

		expect(deletePhoto(bobHome, fern, photo.id, asBob, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});
		expect(deletePhoto(bobHome, cactus, photo.id, asBob, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});
		expect(listPhotos(aliceHome, fern)).toEqual([photo]);
	});
});

describe('listPhotoFiles', () => {
	it("lists the home's photos with their file keys, deleted ones too, never another home's", async () => {
		const kept = await add(aliceHome, alice, fern, {}, jpeg, new Date(now.getTime() - 1000));
		const gone = await add(aliceHome, alice, fern);
		const bobs = await add(bobHome, bob, cactus);
		markPhotoDeleted(gone.id, now);

		const alices = listPhotoFiles(aliceHome);

		expect(alices).toMatchObject([
			{ id: kept.id, plantId: fern, deletedAt: null },
			{ id: gone.id, plantId: fern, deletedAt: now }
		]);
		expect(listPhotoFiles(bobHome)).toMatchObject([{ id: bobs.id, plantId: cactus }]);
		// The keys name the files on disk, in each home's own folder.
		for (const photo of alices) {
			expect(filesOnDisk()).toContain(path.join(aliceHome, `${photo.fileKey}-full.jpg`));
		}
	});
});

describe('purgeDeletedPhotos', () => {
	const day = 24 * 60 * 60 * 1000;
	const daysAgo = (days: number) => new Date(now.getTime() - days * day);

	it('removes the files and rows of photos deleted before the grace period began', async () => {
		const kept = await add(aliceHome, alice, fern, {}, jpeg, daysAgo(50));
		const recent = await add(aliceHome, alice, fern, {}, jpeg, daysAgo(40));
		const old = await add(aliceHome, alice, fern, {}, jpeg, daysAgo(40));
		markPhotoDeleted(recent.id, daysAgo(29));
		markPhotoDeleted(old.id, daysAgo(31));

		expect(await purgeDeletedPhotos(aliceHome, daysAgo(30))).toEqual({ removed: 1, failed: [] });

		expect(listPhotoFiles(aliceHome).map((photo) => photo.id)).toEqual([kept.id, recent.id]);
		expect(filesOnDisk()).toHaveLength(6);
		expect(listPhotos(aliceHome, fern)).toEqual([kept]);
	});

	it("never removes another home's photos, however long ago they were deleted", async () => {
		const bobs = await add(bobHome, bob, cactus);
		markPhotoDeleted(bobs.id, daysAgo(365));

		expect(await purgeDeletedPhotos(aliceHome, now)).toEqual({ removed: 0, failed: [] });

		expect(listPhotoFiles(bobHome).map((photo) => photo.id)).toEqual([bobs.id]);
		expect(filesOnDisk()).toHaveLength(3);
	});

	it('finishes a photo whose files are already gone, and keeps the care logged with it', async () => {
		const logged = await logCareWithPhoto(aliceHome, alice, fern, { type: 'repot' }, jpeg, now);
		if (!logged.ok) throw new Error('Care refused');
		expect(deletePhoto(aliceHome, fern, logged.photoId, asAlice, daysAgo(40)).ok).toBe(true);
		for (const file of filesOnDisk()) fs.rmSync(path.join(folders.photosDir, file));

		expect(await purgeDeletedPhotos(aliceHome, daysAgo(30))).toEqual({ removed: 1, failed: [] });

		expect(listPhotoFiles(aliceHome)).toEqual([]);
		expect(listCareEvents(aliceHome, fern).events).toMatchObject([
			{ id: logged.event.id, type: 'repot', photoId: null }
		]);
	});

	it("keeps the row of a photo whose files can't be removed, to try again", async () => {
		const photo = await add(aliceHome, alice, fern);
		markPhotoDeleted(photo.id, daysAgo(31));
		// Root can remove files from any folder, so this only means something for other users.
		if (process.getuid?.() === 0) return;
		const folder = path.join(folders.photosDir, aliceHome);
		fs.chmodSync(folder, 0o555);
		try {
			const result = await purgeDeletedPhotos(aliceHome, daysAgo(30));

			expect(result).toMatchObject({ removed: 0, failed: [{ photoId: photo.id }] });
			expect(listPhotoFiles(aliceHome).map((row) => row.id)).toEqual([photo.id]);
		} finally {
			fs.chmodSync(folder, 0o755);
		}
	});
});
