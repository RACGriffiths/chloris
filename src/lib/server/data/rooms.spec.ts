import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { getConnection } from '../db';
import { home, plant } from '../db/schema';
import { insertUser, useTestDatabase } from '../testing';
import { createHome } from './homes';
import { createPlant, getPlant, listPlants } from './plants';
import { createRoom, deleteRoom, getRoom, listRooms, updateRoom, type Room } from './rooms';

useTestDatabase();

/** Two homes with an owner each. */
let aliceHome: string;
let bobHome: string;

beforeEach(() => {
	const alice = insertUser('alice@example.com', { canCreateHome: true });
	const bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
});

/** Adds a room that must be accepted. */
function addRoom(
	homeId: string,
	name: string,
	fields: { setting?: 'outdoor'; light?: 'low' } = {}
) {
	const result = createRoom(homeId, { name, ...fields });
	if (!result.ok) throw new Error(`Room ${name} was refused: ${result.reason}`);
	return result.room;
}

const summary = (room: Room, plantCount = 0) => ({ ...room, plantCount });

describe('createRoom', () => {
	it('adds a room, indoors with no light level unless given', () => {
		const result = createRoom(aliceHome, { name: '  Kitchen ' });

		expect(result).toMatchObject({
			ok: true,
			room: { name: 'Kitchen', setting: 'indoor', light: null }
		});
		const balcony = addRoom(aliceHome, 'Balcony', { setting: 'outdoor', light: 'low' });
		expect(balcony).toMatchObject({ setting: 'outdoor', light: 'low' });
		expect(createRoom(aliceHome, { name: 'Hall', light: '' })).toMatchObject({
			room: { light: null }
		});
	});

	it("puts the room in its own home and not in another's", () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');

		expect(listRooms(aliceHome)).toEqual([summary(kitchen)]);
		expect(listRooms(bobHome)).toEqual([]);
		expect(getRoom(bobHome, kitchen.id)).toBeNull();
	});

	it('refuses a name the home already has, ignoring case, but not one in another home', () => {
		addRoom(aliceHome, 'Kitchen');

		expect(createRoom(aliceHome, { name: 'KITCHEN' })).toEqual({
			ok: false,
			reason: 'name-taken'
		});
		expect(listRooms(aliceHome)).toHaveLength(1);
		expect(createRoom(bobHome, { name: 'Kitchen' })).toMatchObject({ ok: true });
	});

	it('checks its input, with messages for the form', () => {
		const message = (input: Parameters<typeof createRoom>[1]) => {
			try {
				createRoom(aliceHome, input);
			} catch (error) {
				if (error instanceof ZodError) return error.issues.map((issue) => issue.message);
			}
			return [];
		};

		expect(message({ name: '   ' })).toEqual(['Give the room a name.']);
		expect(message({ name: 'x'.repeat(61) })).toEqual(['Keep the name to 60 characters or fewer.']);
		expect(message({ name: 'Shed', setting: 'garden' })).toEqual(['Choose indoors or outdoors.']);
		expect(message({ name: 'Shed', light: 'dim' })).toEqual(['Choose a light level.']);
		expect(listRooms(aliceHome)).toEqual([]);
	});
});

describe('listRooms', () => {
	it("lists only the home's own rooms, never another's", () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');
		const study = addRoom(bobHome, 'Study');

		expect(listRooms(aliceHome)).toEqual([summary(kitchen)]);
		expect(listRooms(bobHome)).toEqual([summary(study)]);
	});

	it('lists rooms alphabetically, ignoring case and with numbers in order', () => {
		const shelf10 = addRoom(aliceHome, 'Shelf 10');
		const bathroom = addRoom(aliceHome, 'bathroom');
		const shelf2 = addRoom(aliceHome, 'Shelf 2');
		const attic = addRoom(aliceHome, 'Attic');

		expect(listRooms(aliceHome).map((room) => room.id)).toEqual([
			attic.id,
			bathroom.id,
			shelf2.id,
			shelf10.id
		]);
	});

	it("counts each room's active plants, and none of another home's", () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');
		const hall = addRoom(aliceHome, 'Hall');
		createPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id });
		const basil = createPlant(aliceHome, { nickname: 'Basil', roomId: kitchen.id });
		getConnection().db.update(plant).set({ status: 'died' }).where(eq(plant.id, basil!.id)).run();
		createPlant(aliceHome, { nickname: 'Ivy', roomId: kitchen.id });
		const study = addRoom(bobHome, 'Study');
		createPlant(bobHome, { nickname: 'Cactus', roomId: study.id });

		expect(listRooms(aliceHome)).toEqual([summary(hall, 0), summary(kitchen, 2)]);
		expect(listRooms(bobHome)).toEqual([summary(study, 1)]);
	});
});

describe('getRoom', () => {
	it("knows nothing of another home's room", () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');

		expect(getRoom(aliceHome, kitchen.id)).toEqual(kitchen);
		expect(getRoom(bobHome, kitchen.id)).toBeNull();
		expect(getRoom(aliceHome, 'no-such-room')).toBeNull();
	});
});

describe('updateRoom', () => {
	it('changes the name, setting and light level', () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');

		const result = updateRoom(aliceHome, kitchen.id, {
			name: 'Back garden',
			setting: 'outdoor',
			light: 'direct-sun'
		});

		const changed = {
			id: kitchen.id,
			name: 'Back garden',
			setting: 'outdoor',
			light: 'direct-sun'
		};
		expect(result).toEqual({ ok: true, room: changed });
		expect(getRoom(aliceHome, kitchen.id)).toEqual(changed);
	});

	it("can't change another home's room", () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');

		expect(updateRoom(bobHome, kitchen.id, { name: 'Taken' })).toEqual({
			ok: false,
			reason: 'not-found'
		});

		expect(getRoom(aliceHome, kitchen.id)).toEqual(kitchen);
	});

	it("refuses another room's name, but a room may keep its own in a new case", () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');
		const hall = addRoom(aliceHome, 'Hall');
		addRoom(bobHome, 'Study');

		expect(updateRoom(aliceHome, hall.id, { name: 'kitchen' })).toEqual({
			ok: false,
			reason: 'name-taken'
		});
		expect(getRoom(aliceHome, hall.id)).toEqual(hall);
		expect(updateRoom(aliceHome, kitchen.id, { name: 'KITCHEN' })).toMatchObject({ ok: true });
		expect(updateRoom(aliceHome, hall.id, { name: 'Study' })).toMatchObject({ ok: true });
	});
});

describe('deleteRoom', () => {
	it('deletes an empty room', () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');

		expect(deleteRoom(aliceHome, kitchen.id)).toEqual({ ok: true });

		expect(getRoom(aliceHome, kitchen.id)).toBeNull();
		expect(listRooms(aliceHome)).toEqual([]);
	});

	it('refuses while the room holds plants, whatever their status', () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');
		const fern = createPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id })!;
		getConnection()
			.db.update(plant)
			.set({ status: 'given-away' })
			.where(eq(plant.id, fern.id))
			.run();

		expect(deleteRoom(aliceHome, kitchen.id)).toEqual({ ok: false, reason: 'has-plants' });

		expect(getRoom(aliceHome, kitchen.id)).toEqual(kitchen);
		expect(getPlant(aliceHome, fern.id)).toEqual(fern);
	});

	it("can't delete another home's room", () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');

		expect(deleteRoom(bobHome, kitchen.id)).toEqual({ ok: false, reason: 'not-found' });

		expect(getRoom(aliceHome, kitchen.id)).toEqual(kitchen);
	});
});

describe('deleting a home', () => {
	it('takes its rooms and plants with it, despite the rule that keeps a room with plants', () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');
		createPlant(aliceHome, { nickname: 'Fern', roomId: kitchen.id });
		const study = addRoom(bobHome, 'Study');
		const cactus = createPlant(bobHome, { nickname: 'Cactus', roomId: study.id })!;

		getConnection().db.delete(home).where(eq(home.id, aliceHome)).run();

		expect(getRoom(aliceHome, kitchen.id)).toBeNull();
		expect(listPlants(aliceHome)).toEqual([]);
		expect(listRooms(bobHome)).toEqual([summary(study, 1)]);
		expect(getPlant(bobHome, cactus.id)).toEqual(cactus);
	});
});
