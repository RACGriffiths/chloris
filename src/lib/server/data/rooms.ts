import { randomUUID } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { LIGHT_LEVELS, ROOM_SETTINGS, type LightLevel, type RoomSetting } from '../../rooms';
import { getConnection, type Db } from '../db';
import { plant, room } from '../db/schema';
import { byName, sameName } from './order';

/**
 * The rooms in a home (docs/spec.md, Data model; D30). Reading them needs `home:view`; adding,
 * changing and deleting them needs `home:configure`. Callers check `can()` first.
 */

export interface Room {
	id: string;
	name: string;
	setting: RoomSetting;
	light: LightLevel | null;
}

/** A room as the Rooms page lists it. */
export interface RoomSummary extends Room {
	/** How many active plants it holds. */
	plantCount: number;
}

/** What a person fills in to add or change a room. */
export const roomInput = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Give the room a name.')
		.max(60, 'Keep the name to 60 characters or fewer.'),
	setting: z.enum(ROOM_SETTINGS, 'Choose indoors or outdoors.').default('indoor'),
	/** Optional: an empty value means not given. */
	light: z
		.enum(['', ...LIGHT_LEVELS], 'Choose a light level.')
		.optional()
		.transform((light) => light || null)
});

/** A room's fields as a form sends them, before `roomInput` has checked them. */
export type RoomInput = { name: string; setting?: string; light?: string };

/** The outcome of adding or changing a room. A refused change leaves the room as it was. */
export type RoomResult =
	{ ok: true; room: Room } | { ok: false; reason: 'not-found' | 'name-taken' };

/** The outcome of deleting a room. Only an empty room can be deleted (D30). */
export type DeleteRoomResult = { ok: true } | { ok: false; reason: 'not-found' | 'has-plants' };

const notFound = { ok: false, reason: 'not-found' } as const;

const columns = { id: room.id, name: room.name, setting: room.setting, light: room.light };

type Tx = Pick<Db, 'select'>;

/** Whether `homeId` has a room called `name`, ignoring case, other than `exceptId`. */
function nameTaken(tx: Tx, homeId: string, name: string, exceptId?: string): boolean {
	return tx
		.select({ id: room.id, name: room.name })
		.from(room)
		.where(eq(room.homeId, homeId))
		.all()
		.some((other) => other.id !== exceptId && sameName(other.name, name));
}

/**
 * Adds a room to `homeId`. Refused if the home already has a room of that name, ignoring case.
 * Callers check `can(user, homeId, 'home:configure')` first. Throws a `ZodError` if the input is
 * invalid.
 */
export function createRoom(homeId: string, input: RoomInput): RoomResult {
	const values = roomInput.parse(input);
	return getConnection().db.transaction(
		(tx) => {
			if (nameTaken(tx, homeId, values.name)) return { ok: false, reason: 'name-taken' } as const;
			const created = tx
				.insert(room)
				.values({ id: randomUUID(), homeId, ...values })
				.returning(columns)
				.get();
			return { ok: true, room: created } as const;
		},
		// Takes the write lock before checking the name, so two rooms can't take it at once.
		{ behavior: 'immediate' }
	);
}

/**
 * The rooms in `homeId` in alphabetical order, each with how many active plants it holds.
 * Callers check `can(user, homeId, 'home:view')` first.
 */
export function listRooms(homeId: string): RoomSummary[] {
	return getConnection()
		.db.select({ ...columns, plantCount: count(plant.id) })
		.from(room)
		.leftJoin(
			plant,
			and(eq(plant.roomId, room.id), eq(plant.homeId, room.homeId), eq(plant.status, 'active'))
		)
		.where(eq(room.homeId, homeId))
		.groupBy(room.id)
		.all()
		.sort(byName((row) => row.name));
}

/** One room in `homeId`, or `null` if it has none with that id. Callers check `home:view`. */
export function getRoom(homeId: string, roomId: string): Room | null {
	const row = getConnection()
		.db.select(columns)
		.from(room)
		.where(and(eq(room.id, roomId), eq(room.homeId, homeId)))
		.get();
	return row ?? null;
}

/**
 * Changes a room in `homeId`. Refused if the home has no such room, or another room already has
 * the new name. Callers check `can(user, homeId, 'home:configure')` first. Throws a `ZodError`
 * if the input is invalid.
 */
export function updateRoom(homeId: string, roomId: string, input: RoomInput): RoomResult {
	const values = roomInput.parse(input);
	return getConnection().db.transaction(
		(tx) => {
			if (nameTaken(tx, homeId, values.name, roomId)) {
				return { ok: false, reason: 'name-taken' } as const;
			}
			const updated = tx
				.update(room)
				.set(values)
				.where(and(eq(room.id, roomId), eq(room.homeId, homeId)))
				.returning(columns)
				.get();
			return updated ? ({ ok: true, room: updated } as const) : notFound;
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Deletes a room in `homeId`, if it holds no plants, whatever their status (D30). Callers check
 * `can(user, homeId, 'home:configure')` first.
 */
export function deleteRoom(homeId: string, roomId: string): DeleteRoomResult {
	return getConnection().db.transaction(
		(tx) => {
			const found = tx
				.select({ id: room.id })
				.from(room)
				.where(and(eq(room.id, roomId), eq(room.homeId, homeId)))
				.get();
			if (!found) return notFound;
			const [{ plants }] = tx
				.select({ plants: count() })
				.from(plant)
				.where(and(eq(plant.roomId, roomId), eq(plant.homeId, homeId)))
				.all();
			if (plants > 0) return { ok: false, reason: 'has-plants' } as const;
			tx.delete(room)
				.where(and(eq(room.id, roomId), eq(room.homeId, homeId)))
				.run();
			return { ok: true } as const;
		},
		{ behavior: 'immediate' }
	);
}
