import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addPhoto, deletePhoto, listPhotoFiles } from '../data/photos';
import { createHome } from '../data/homes';
import { createPlant } from '../data/plants';
import { createRoom } from '../data/rooms';
import { insertUser, testJpeg, useTestDatabase } from '../testing';
import { removeDeletedPhotos } from './photos';

const folders = useTestDatabase();

const now = new Date('2026-06-15T09:00:00Z');
const day = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * day);

let alice: string;
let aliceHome: string;
let bob: string;
let bobHome: string;

beforeEach(() => {
	alice = insertUser('alice@example.com', { canCreateHome: true });
	bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
	vi.spyOn(console, 'info').mockImplementation(() => {});
});

/** Adds a photo to a new plant in `homeId`, deleted `deletedDaysAgo` days before `now`. */
async function deletedPhoto(homeId: string, userId: string, deletedDaysAgo: number) {
	const room = createRoom(homeId, { name: `Room ${deletedDaysAgo}` });
	if (!room.ok) throw new Error('Room refused');
	const plant = createPlant(homeId, { nickname: 'Fern', roomId: room.room.id });
	if (!plant) throw new Error('Plant refused');
	const added = await addPhoto(homeId, userId, plant.id, {}, await testJpeg(), daysAgo(60));
	if (!added.ok) throw new Error('Photo refused');
	const editor = { userId, anyPhoto: true };
	if (!deletePhoto(homeId, plant.id, added.photo.id, editor, daysAgo(deletedDaysAgo)).ok) {
		throw new Error('Delete refused');
	}
	return added.photo.id;
}

const photoFiles = () => fs.readdirSync(folders.photosDir, { recursive: true }).length;

describe('removeDeletedPhotos', () => {
	it('removes photos deleted longer ago than the grace period, in every home', async () => {
		await deletedPhoto(aliceHome, alice, 31);
		const aliceRecent = await deletedPhoto(aliceHome, alice, 29);
		await deletedPhoto(bobHome, bob, 45);
		expect(photoFiles()).toBe(2 + 9); // A folder for each home, and three files per photo.

		expect(await removeDeletedPhotos(30, now)).toEqual({ removed: 2, failed: 0 });

		expect(listPhotoFiles(aliceHome).map((photo) => photo.id)).toEqual([aliceRecent]);
		expect(listPhotoFiles(bobHome)).toEqual([]);
		expect(photoFiles()).toBe(2 + 3);
	});

	it('removes every deleted photo at once with no grace period, and nothing twice', async () => {
		await deletedPhoto(aliceHome, alice, 0);

		expect(await removeDeletedPhotos(0, new Date(now.getTime() + 1))).toEqual({
			removed: 1,
			failed: 0
		});
		expect(await removeDeletedPhotos(0, new Date(now.getTime() + 1))).toEqual({
			removed: 0,
			failed: 0
		});
	});
});
