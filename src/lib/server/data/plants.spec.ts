import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { getConnection } from '../db';
import { plant } from '../db/schema';
import { insertUser, markPhotoDeleted, testJpeg, useTestDatabase } from '../testing';
import { createHome } from './homes';
import { addPhoto, deletePhoto, type Photo } from './photos';
import {
	MAX_TAGS,
	createPlant,
	getPlant,
	listPlants,
	parseTags,
	setCoverPhoto,
	updatePlant,
	type Plant,
	type PlantInput
} from './plants';
import { createRoom, type Room } from './rooms';

useTestDatabase();

/** Two homes with an owner and a room each. */
let alice: string;
let aliceHome: string;
let bobHome: string;
let kitchen: Room;
let study: Room;

beforeEach(() => {
	alice = insertUser('alice@example.com', { canCreateHome: true });
	const bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
	kitchen = addRoom(aliceHome, 'Kitchen');
	study = addRoom(bobHome, 'Study');
});

function addRoom(homeId: string, name: string): Room {
	const result = createRoom(homeId, { name });
	if (!result.ok) throw new Error(`Room ${name} was refused`);
	return result.room;
}

/** Adds a plant that must be accepted. */
function addPlant(homeId: string, input: PlantInput): Plant {
	const created = createPlant(homeId, input);
	if (!created) throw new Error(`Plant ${input.nickname} was refused`);
	return created;
}

/** How the Plants page lists a plant. */
const summary = ({ id, nickname, species, roomId, tags, coverPhotoId }: Plant) => ({
	id,
	nickname,
	species,
	roomId,
	tags,
	coverPhotoId
});

/** The form messages a ZodError carries, or `[]` if `run` doesn't throw one. */
function messages(run: () => unknown): string[] {
	try {
		run();
	} catch (error) {
		if (error instanceof ZodError) return error.issues.map((issue) => issue.message);
		throw error;
	}
	return [];
}

describe('parseTags', () => {
	it('splits on commas, tidies spaces, lower-cases and drops repeats', () => {
		expect(parseTags('Pet safe,  trailing , pet SAFE,, ')).toEqual(['pet safe', 'trailing']);
		expect(parseTags('  ')).toEqual([]);
	});
});

describe('createPlant', () => {
	it('adds a plant to a room, with every detail tidied', () => {
		const fern = createPlant(aliceHome, {
			nickname: ' Fern ',
			roomId: kitchen.id,
			species: ' Boston fern ',
			acquiredOn: '2025-03-14',
			source: 'Garden centre',
			pot: '15 cm terracotta',
			soil: 'Peat-free compost',
			tags: 'Humid, pet safe',
			notes: 'Likes the steam from the kettle.'
		});

		expect(fern).toMatchObject({
			nickname: 'Fern',
			species: 'Boston fern',
			roomId: kitchen.id,
			roomName: 'Kitchen',
			acquiredOn: '2025-03-14',
			source: 'Garden centre',
			pot: '15 cm terracotta',
			soil: 'Peat-free compost',
			tags: ['humid', 'pet safe'],
			notes: 'Likes the steam from the kettle.'
		});
		expect(getPlant(aliceHome, fern!.id)).toEqual(fern);
	});

	it('needs only a name and a room; blank details are stored as not given', () => {
		const fern = createPlant(aliceHome, {
			nickname: 'Fern',
			roomId: kitchen.id,
			species: ' ',
			acquiredOn: '',
			tags: ''
		});

		expect(fern).toMatchObject({
			species: null,
			acquiredOn: null,
			source: null,
			pot: null,
			soil: null,
			tags: [],
			notes: null
		});
	});

	it("puts the plant in its own home and not in another's", () => {
		const fern = addPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id });

		expect(listPlants(aliceHome)).toEqual([summary(fern)]);
		expect(listPlants(bobHome)).toEqual([]);
		expect(getPlant(bobHome, fern.id)).toBeNull();
	});

	it("won't put a plant in another home's room", () => {
		expect(createPlant(aliceHome, { nickname: 'Fern', roomId: study.id })).toBeNull();

		expect(listPlants(aliceHome)).toEqual([]);
		expect(listPlants(bobHome)).toEqual([]);
	});

	it('checks its input, with messages for the form', () => {
		const add = (input: Partial<PlantInput>) => () =>
			createPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id, ...input });

		expect(messages(add({ nickname: ' ' }))).toEqual(['Give the plant a name.']);
		expect(messages(add({ roomId: '' }))).toEqual(['Choose a room.']);
		expect(messages(add({ acquiredOn: '14/03/2025' }))).toEqual(['Enter a date, like 2025-03-14.']);
		expect(messages(add({ acquiredOn: '2025-02-30' }))).toEqual(['Enter a date, like 2025-03-14.']);
		expect(messages(add({ species: 'x'.repeat(101) }))).toEqual([
			'Keep the species to 100 characters or fewer.'
		]);
		expect(messages(add({ notes: 'x'.repeat(2001) }))).toEqual([
			'Keep the notes to 2,000 characters or fewer.'
		]);
		const tooMany = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `tag ${i}`).join(',');
		expect(messages(add({ tags: tooMany }))).toEqual([`Use ${MAX_TAGS} tags or fewer.`]);
		expect(messages(add({ tags: `ok, ${'x'.repeat(31)}` }))).toEqual([
			'Keep each tag to 30 characters or fewer.'
		]);
		expect(listPlants(aliceHome)).toEqual([]);
	});
});

describe('getPlant', () => {
	it("knows nothing of another home's plant", () => {
		const fern = addPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id });

		expect(getPlant(aliceHome, fern.id)).toEqual(fern);
		expect(getPlant(bobHome, fern.id)).toBeNull();
		expect(getPlant(aliceHome, 'no-such-plant')).toBeNull();
	});

	it('still finds a plant that is no longer active', () => {
		const fern = addPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id });
		getConnection().db.update(plant).set({ status: 'sold' }).where(eq(plant.id, fern.id)).run();

		expect(getPlant(aliceHome, fern.id)).toEqual(fern);
	});
});

describe('listPlants', () => {
	it("lists only the home's own plants, never another's", () => {
		const fern = addPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id });
		const cactus = addPlant(bobHome, { nickname: 'Cactus', roomId: study.id });

		expect(listPlants(aliceHome)).toEqual([summary(fern)]);
		expect(listPlants(bobHome)).toEqual([summary(cactus)]);
	});

	it('lists plants alphabetically, leaving out those no longer active', () => {
		const monstera = addPlant(aliceHome, { nickname: 'monstera', roomId: kitchen.id });
		const basil = addPlant(aliceHome, { nickname: 'Basil', roomId: kitchen.id });
		const ivy = addPlant(aliceHome, { nickname: 'Ivy', roomId: kitchen.id });
		getConnection().db.update(plant).set({ status: 'died' }).where(eq(plant.id, ivy.id)).run();

		expect(listPlants(aliceHome)).toEqual([summary(basil), summary(monstera)]);
	});

	it('filters by room and by tag, ignoring the case of the tag', () => {
		const hall = addRoom(aliceHome, 'Hall');
		const fern = addPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id, tags: 'pet safe' });
		const basil = addPlant(aliceHome, { nickname: 'Basil', roomId: kitchen.id, tags: 'herb' });
		const ivy = addPlant(aliceHome, { nickname: 'Ivy', roomId: hall.id, tags: 'Pet safe' });

		expect(listPlants(aliceHome, { roomId: kitchen.id })).toEqual([summary(basil), summary(fern)]);
		expect(listPlants(aliceHome, { tag: 'PET SAFE' })).toEqual([summary(fern), summary(ivy)]);
		expect(listPlants(aliceHome, { roomId: hall.id, tag: 'pet safe' })).toEqual([summary(ivy)]);
		expect(listPlants(aliceHome, { tag: 'pet' })).toEqual([]);
	});

	it("finds nothing when filtered by another home's room or tag", () => {
		addPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id, tags: 'pet safe' });
		addPlant(bobHome, { nickname: 'Cactus', roomId: study.id, tags: 'desert' });

		expect(listPlants(aliceHome, { roomId: study.id })).toEqual([]);
		expect(listPlants(aliceHome, { tag: 'desert' })).toEqual([]);
		expect(listPlants(bobHome, { roomId: kitchen.id })).toEqual([]);
	});
});

describe('updatePlant', () => {
	it('changes the details and moves the plant to another room', () => {
		const hall = addRoom(aliceHome, 'Hall');
		const fern = addPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id, tags: 'humid' });

		const result = updatePlant(aliceHome, fern.id, {
			nickname: 'Fernando',
			roomId: hall.id,
			species: 'Boston fern',
			tags: 'shade'
		});

		const changed = {
			...fern,
			nickname: 'Fernando',
			roomId: hall.id,
			roomName: 'Hall',
			species: 'Boston fern',
			tags: ['shade']
		};
		expect(result).toEqual({ ok: true, plant: changed });
		expect(getPlant(aliceHome, fern.id)).toEqual(changed);
		expect(listPlants(aliceHome, { roomId: kitchen.id })).toEqual([]);
	});

	it("can't change another home's plant", () => {
		const fern = addPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id });

		expect(updatePlant(bobHome, fern.id, { nickname: 'Taken', roomId: study.id })).toEqual({
			ok: false,
			reason: 'not-found'
		});

		expect(getPlant(aliceHome, fern.id)).toEqual(fern);
	});

	it("won't move a plant to another home's room", () => {
		const fern = addPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id });

		expect(updatePlant(aliceHome, fern.id, { nickname: 'Fern', roomId: study.id })).toEqual({
			ok: false,
			reason: 'no-such-room'
		});

		expect(getPlant(aliceHome, fern.id)).toEqual(fern);
		expect(listPlants(bobHome)).toEqual([]);
	});
});

describe('cover photos', () => {
	let jpeg: Buffer;
	let fern: Plant;

	beforeEach(async () => {
		jpeg = await testJpeg();
		fern = addPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id });
	});

	/** Adds a photo of one of Alice's plants, taken at `takenAt` in London. */
	async function photo(plantId: string, takenAt: string): Promise<Photo> {
		const result = await addPhoto(aliceHome, alice, plantId, { takenAt }, jpeg);
		if (!result.ok) throw new Error(`Photo refused: ${result.reason}`);
		return result.photo;
	}

	/** The photo one of Alice's plants shows, and whether it was chosen. */
	const cover = (plantId: string) => {
		const found = getPlant(aliceHome, plantId);
		return { id: found?.coverPhotoId, chosen: found?.coverChosen };
	};

	it('shows the latest photo until one is chosen, then the chosen one', async () => {
		expect(cover(fern.id)).toEqual({ id: null, chosen: false });
		const older = await photo(fern.id, '2025-01-01T12:00:00');
		const newer = await photo(fern.id, '2025-06-01T12:00:00');
		expect(cover(fern.id)).toEqual({ id: newer.id, chosen: false });
		expect(listPlants(aliceHome)[0].coverPhotoId).toBe(newer.id);

		expect(setCoverPhoto(aliceHome, fern.id, older.id)).toBe(true);

		expect(cover(fern.id)).toEqual({ id: older.id, chosen: true });
		expect(listPlants(aliceHome)[0].coverPhotoId).toBe(older.id);

		// A newer photo doesn't take over from a chosen cover.
		await photo(fern.id, '2025-07-01T12:00:00');
		expect(cover(fern.id)).toEqual({ id: older.id, chosen: true });
	});

	it('goes back to the latest photo when asked to', async () => {
		const older = await photo(fern.id, '2025-01-01T12:00:00');
		const newer = await photo(fern.id, '2025-06-01T12:00:00');
		setCoverPhoto(aliceHome, fern.id, older.id);

		expect(setCoverPhoto(aliceHome, fern.id, null)).toBe(true);

		expect(cover(fern.id)).toEqual({ id: newer.id, chosen: false });
	});

	it('goes back to the latest photo when the cover is deleted', async () => {
		const older = await photo(fern.id, '2025-01-01T12:00:00');
		const newer = await photo(fern.id, '2025-06-01T12:00:00');
		setCoverPhoto(aliceHome, fern.id, older.id);

		deletePhoto(aliceHome, fern.id, older.id, { userId: alice, anyPhoto: true });
		expect(cover(fern.id)).toEqual({ id: newer.id, chosen: false });

		// Even a photo marked deleted some other way is never shown.
		setCoverPhoto(aliceHome, fern.id, newer.id);
		markPhotoDeleted(newer.id);
		expect(cover(fern.id)).toEqual({ id: null, chosen: false });
	});

	it('keeps the cover when the plant is changed', async () => {
		const only = await photo(fern.id, '2025-01-01T12:00:00');
		setCoverPhoto(aliceHome, fern.id, only.id);

		const result = updatePlant(aliceHome, fern.id, { nickname: 'Maidenhair', roomId: kitchen.id });

		expect(result).toMatchObject({ ok: true, plant: { coverPhotoId: only.id, coverChosen: true } });
	});

	it("won't choose another plant's photo, or a deleted one, and changes nothing", async () => {
		const ivy = addPlant(aliceHome, { nickname: 'Ivy', roomId: kitchen.id });
		const ivys = await photo(ivy.id, '2025-01-01T12:00:00');
		const ferns = await photo(fern.id, '2025-01-01T12:00:00');
		const deleted = await photo(fern.id, '2025-02-01T12:00:00');
		markPhotoDeleted(deleted.id);

		expect(setCoverPhoto(aliceHome, fern.id, ivys.id)).toBe(false);
		expect(setCoverPhoto(aliceHome, fern.id, deleted.id)).toBe(false);
		expect(setCoverPhoto(aliceHome, fern.id, 'no-such-photo')).toBe(false);

		expect(cover(fern.id)).toEqual({ id: ferns.id, chosen: false });
	});

	it("can't choose the cover of another home's plant, or use another home's photo", async () => {
		const ferns = await photo(fern.id, '2025-01-01T12:00:00');
		const cactus = addPlant(bobHome, { nickname: 'Cactus', roomId: study.id });

		expect(setCoverPhoto(bobHome, fern.id, ferns.id)).toBe(false);
		expect(setCoverPhoto(bobHome, cactus.id, ferns.id)).toBe(false);

		expect(cover(fern.id)).toEqual({ id: ferns.id, chosen: false });
		expect(getPlant(bobHome, cactus.id)).toMatchObject({ coverPhotoId: null, coverChosen: false });
	});
});
