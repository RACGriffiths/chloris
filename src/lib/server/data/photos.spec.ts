import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertUser, markPhotoDeleted, testJpeg, useTestDatabase } from '../testing';
import { createHome } from './homes';
import {
	addPhoto,
	listPhotos,
	readPhoto,
	takenAtFrom,
	type Photo,
	type PhotoInput
} from './photos';
import { createPlant } from './plants';
import { createRoom } from './rooms';

const folders = useTestDatabase();

/** Two homes, each with an owner and a plant. Alice's is in London, Bob's in Paris. */
let alice: string;
let bob: string;
let aliceHome: string;
let bobHome: string;
let fern: string;
let cactus: string;

/** 10:00 in London (BST) on a Monday. */
const now = new Date('2026-06-15T09:00:00Z');

let jpeg: Buffer;

beforeEach(async () => {
	alice = insertUser('alice@example.com', { canCreateHome: true });
	bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
	fern = addPlant(aliceHome, 'Fern');
	cactus = addPlant(bobHome, 'Cactus');
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
