import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getConnection, type Db } from '../db';
import { plant, room } from '../db/schema';
import { optionalText } from './fields';
import { byName } from './order';

/**
 * The plants in a home (docs/spec.md, Data model; D29). Reading them needs `home:view`; adding
 * and changing them needs `plant:edit`. Callers check `can()` first. Plants aren't deleted: the
 * Memorial view will take plants that died or left (D30).
 *
 * A plant's status, status date and note, and its parent plant, are stored but not yet set by
 * anything here. Their screens come with the Memorial view and the family tree. When parent
 * plants become editable, check that the parent is in the same home, as `createPlant` checks
 * the room.
 */

/** Tags on one plant, and how long each may be. */
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 30;

/** A plant as its page shows it. */
export interface Plant {
	id: string;
	nickname: string;
	species: string | null;
	roomId: string;
	roomName: string;
	/** `YYYY-MM-DD`, or `null` if not given. */
	acquiredOn: string | null;
	source: string | null;
	pot: string | null;
	soil: string | null;
	tags: string[];
	notes: string | null;
}

/** A plant as the Plants page lists it. */
export interface PlantSummary {
	id: string;
	nickname: string;
	species: string | null;
	roomId: string;
	tags: string[];
}

/**
 * Tags as typed: separated by commas, in lower case, with spaces tidied and repeats dropped.
 * `"Pet safe,  trailing , pet SAFE"` becomes `["pet safe", "trailing"]`.
 */
export function parseTags(value: string): string[] {
	const tags = value
		.split(',')
		.map((tag) => tag.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en'))
		.filter(Boolean);
	return [...new Set(tags)];
}

/** What a person fills in to add or change a plant. Tags come as one comma-separated string. */
export const plantInput = z.object({
	nickname: z
		.string()
		.trim()
		.min(1, 'Give the plant a name.')
		.max(60, 'Keep the name to 60 characters or fewer.'),
	roomId: z.string().min(1, 'Choose a room.'),
	species: optionalText(100, 'Keep the species to 100 characters or fewer.'),
	acquiredOn: z
		.union([z.literal(''), z.iso.date('Enter a date, like 2025-03-14.')])
		.optional()
		.transform((date) => date || null),
	source: optionalText(100, 'Keep where it came from to 100 characters or fewer.'),
	pot: optionalText(100, 'Keep the pot to 100 characters or fewer.'),
	soil: optionalText(100, 'Keep the soil to 100 characters or fewer.'),
	tags: z
		.string()
		.optional()
		.transform((value) => parseTags(value ?? ''))
		.refine((tags) => tags.length <= MAX_TAGS, `Use ${MAX_TAGS} tags or fewer.`)
		.refine(
			(tags) => tags.every((tag) => tag.length <= MAX_TAG_LENGTH),
			`Keep each tag to ${MAX_TAG_LENGTH} characters or fewer.`
		),
	notes: optionalText(2000, 'Keep the notes to 2,000 characters or fewer.')
});

export type PlantInput = z.input<typeof plantInput>;

/** The outcome of changing a plant. A refused change leaves the plant as it was. */
export type UpdatePlantResult =
	{ ok: true; plant: Plant } | { ok: false; reason: 'not-found' | 'no-such-room' };

/** Filters for the Plants page. Unset filters match every plant. */
export interface PlantFilter {
	roomId?: string | null;
	tag?: string | null;
}

const columns = {
	id: plant.id,
	nickname: plant.nickname,
	species: plant.species,
	roomId: plant.roomId,
	acquiredOn: plant.acquiredOn,
	source: plant.source,
	pot: plant.pot,
	soil: plant.soil,
	tags: plant.tags,
	notes: plant.notes
};

type Tx = Pick<Db, 'select'>;

/** The name of a room in `homeId`, or `null` if the home has no such room. */
function roomName(tx: Tx, homeId: string, roomId: string): string | null {
	const found = tx
		.select({ name: room.name })
		.from(room)
		.where(and(eq(room.id, roomId), eq(room.homeId, homeId)))
		.get();
	return found?.name ?? null;
}

/**
 * Adds a plant to a room in `homeId`. Returns `null`, and adds nothing, if the home has no such
 * room. Callers check `can(user, homeId, 'plant:edit')` first. Throws a `ZodError` if the input
 * is invalid.
 */
export function createPlant(homeId: string, input: PlantInput): Plant | null {
	const values = plantInput.parse(input);
	return getConnection().db.transaction((tx) => {
		const name = roomName(tx, homeId, values.roomId);
		if (name === null) return null;
		const created = tx
			.insert(plant)
			.values({ id: randomUUID(), homeId, ...values })
			.returning(columns)
			.get();
		return { ...created, roomName: name };
	});
}

/** One plant in `homeId`, whatever its status, or `null` if it has none with that id. */
export function getPlant(homeId: string, plantId: string): Plant | null {
	const row = getConnection()
		.db.select({ ...columns, roomName: room.name })
		.from(plant)
		.innerJoin(room, and(eq(room.id, plant.roomId), eq(room.homeId, plant.homeId)))
		.where(and(eq(plant.id, plantId), eq(plant.homeId, homeId)))
		.get();
	return row ?? null;
}

/**
 * The active plants in `homeId` in alphabetical order, optionally only those in one room or with
 * one tag. Callers check `can(user, homeId, 'home:view')` first.
 */
export function listPlants(homeId: string, filter: PlantFilter = {}): PlantSummary[] {
	const conditions = [eq(plant.homeId, homeId), eq(plant.status, 'active')];
	if (filter.roomId) conditions.push(eq(plant.roomId, filter.roomId));
	if (filter.tag) {
		const tag = filter.tag.toLocaleLowerCase('en');
		conditions.push(sql`exists (select 1 from json_each(${plant.tags}) where value = ${tag})`);
	}
	return getConnection()
		.db.select({
			id: plant.id,
			nickname: plant.nickname,
			species: plant.species,
			roomId: plant.roomId,
			tags: plant.tags
		})
		.from(plant)
		.where(and(...conditions))
		.all()
		.sort(byName((row) => row.nickname));
}

/**
 * Changes a plant in `homeId`, including moving it to another of the home's rooms. Callers check
 * `can(user, homeId, 'plant:edit')` first. Throws a `ZodError` if the input is invalid.
 */
export function updatePlant(homeId: string, plantId: string, input: PlantInput): UpdatePlantResult {
	const values = plantInput.parse(input);
	const inHome = and(eq(plant.id, plantId), eq(plant.homeId, homeId));
	return getConnection().db.transaction((tx) => {
		if (!tx.select({ id: plant.id }).from(plant).where(inHome).get()) {
			return { ok: false, reason: 'not-found' } as const;
		}
		const name = roomName(tx, homeId, values.roomId);
		if (name === null) return { ok: false, reason: 'no-such-room' } as const;
		const updated = tx.update(plant).set(values).where(inHome).returning(columns).get();
		return { ok: true, plant: { ...updated, roomName: name } } as const;
	});
}
