import { randomUUID } from 'node:crypto';
import { and, count, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { calendarDate } from '../../dates';
import { MEMORIAL_STATUSES, type MemorialStatus, type PlantStatus } from '../../plants';
import { getConnection, type Db } from '../db';
import { home, photo, plant, room } from '../db/schema';
import { optionalText } from './fields';
import { byName } from './order';

/**
 * The plants in a home (docs/spec.md, Data model; D29). Reading them needs `home:view`; adding,
 * changing, memorialising and restoring them needs `plant:edit`. Callers check `can()` first.
 * Plants aren't deleted (D30).
 *
 * A plant that died, was given away or was sold is in the Memorial: its status says which, with
 * the day and a note (D43). Only active plants are listed by `listPlants`, and only they have
 * care logged or due (D44); `getPlant` finds a plant whatever its status, and `listMemorial`
 * lists the others (D45).
 *
 * A plant's parent plant is stored but not yet set by anything here: its screens come with the
 * family tree. When parent plants become editable, check that the parent is in the same home, as
 * `createPlant` checks the room.
 *
 * A plant's tile shows its cover photo: one of its photos chosen on the timeline, or else its
 * latest (D42). Choosing one needs `plant:edit`.
 */

/** Tags on one plant, and how long each may be. */
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 30;

/** How long the note on a plant in the Memorial may be. */
export const MAX_STATUS_NOTE_LENGTH = 500;

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
	/** The photo its tile shows: the one chosen as its cover, or else its latest (D42). */
	coverPhotoId: string | null;
	/** Whether its cover was chosen, rather than being its latest photo. */
	coverChosen: boolean;
	/** `active`, or what happened to it if it's in the Memorial (D43). */
	status: PlantStatus;
	/** The day its status last changed, `YYYY-MM-DD`; `null` while active. */
	statusOn: string | null;
	/** A note about what happened to it; `null` while active or if none was given. */
	statusNote: string | null;
}

/** A plant as the Plants page lists it. */
export interface PlantSummary {
	id: string;
	nickname: string;
	species: string | null;
	roomId: string;
	tags: string[];
	/** The photo its tile shows, as for `Plant`. */
	coverPhotoId: string | null;
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

/** A plant as the Memorial view lists it (D45). */
export interface MemorialPlant {
	id: string;
	nickname: string;
	species: string | null;
	roomId: string;
	/** `YYYY-MM-DD`, or `null` if not given. */
	acquiredOn: string | null;
	status: MemorialStatus;
	/** The day it happened, `YYYY-MM-DD`. */
	statusOn: string | null;
	statusNote: string | null;
	/** The photo its tile shows, as for `Plant`. */
	coverPhotoId: string | null;
}

/**
 * What a person fills in to move a plant to the Memorial, or to correct its entry there: what
 * happened, on what day, and an optional note (D43).
 */
export const memorialInput = z.object({
	status: z.enum(MEMORIAL_STATUSES, 'Choose what happened.'),
	statusOn: z.iso.date('Enter a date, like 2025-03-14.'),
	statusNote: optionalText(
		MAX_STATUS_NOTE_LENGTH,
		`Keep the note to ${MAX_STATUS_NOTE_LENGTH} characters or fewer.`
	)
});

/** A Memorial entry as a form sends it, before `memorialInput` has checked it. */
export type MemorialInput = { status: string; statusOn: string; statusNote?: string };

/**
 * The outcome of moving a plant to the Memorial. A day still to come, or before the day the plant
 * was got, is refused, and a refused change leaves the plant as it was.
 */
export type MemorialiseResult =
	| { ok: true; plant: Plant }
	| { ok: false; reason: 'not-found' }
	| { ok: false; reason: 'in-the-future' }
	| { ok: false; reason: 'before-acquired'; acquiredOn: string };

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
	notes: plant.notes,
	status: plant.status,
	statusOn: plant.statusOn,
	statusNote: plant.statusNote
};

/** The plant's chosen cover, while it's still one of the plant's photos. */
const chosenCover = sql<string | null>`(
	select ${photo.id} from ${photo}
	where ${photo.id} = ${plant.coverPhotoId} and ${photo.plantId} = ${plant.id}
		and ${photo.homeId} = ${plant.homeId} and ${photo.deletedAt} is null
)`;

/** The plant's latest photo: the first in its timeline (`listPhotos`). */
const latestPhoto = sql<string | null>`(
	select ${photo.id} from ${photo}
	where ${photo.plantId} = ${plant.id} and ${photo.homeId} = ${plant.homeId}
		and ${photo.deletedAt} is null
	order by ${photo.takenAt} desc, ${photo.createdAt} desc, ${photo.id} desc
	limit 1
)`;

/** The photo a plant's tile shows (D42). */
const coverColumns = {
	coverPhotoId: sql<string | null>`coalesce(${chosenCover}, ${latestPhoto})`,
	coverChosen: sql<boolean>`${chosenCover} is not null`.mapWith(Boolean)
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
		return { ...created, roomName: name, coverPhotoId: null, coverChosen: false };
	});
}

/** One plant in `homeId`, with its room's name and its cover, or `null`. */
function findPlant(tx: Tx, homeId: string, plantId: string): Plant | null {
	const row = tx
		.select({ ...columns, roomName: room.name, ...coverColumns })
		.from(plant)
		.innerJoin(room, and(eq(room.id, plant.roomId), eq(room.homeId, plant.homeId)))
		.where(and(eq(plant.id, plantId), eq(plant.homeId, homeId)))
		.get();
	return row ?? null;
}

/** One plant in `homeId`, whatever its status, or `null` if it has none with that id. */
export function getPlant(homeId: string, plantId: string): Plant | null {
	return findPlant(getConnection().db, homeId, plantId);
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
			tags: plant.tags,
			coverPhotoId: coverColumns.coverPhotoId
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
		if (roomName(tx, homeId, values.roomId) === null) {
			return { ok: false, reason: 'no-such-room' } as const;
		}
		tx.update(plant).set(values).where(inHome).run();
		const updated = findPlant(tx, homeId, plantId);
		if (!updated) throw new Error('The plant just changed has gone');
		return { ok: true, plant: updated } as const;
	});
}

/**
 * Chooses one of a plant's photos in `homeId` as its cover, or with `null`, goes back to its
 * latest photo (D42). Returns `false`, changing nothing, if the home has no such plant, or the
 * photo isn't one of the plant's or was deleted. Callers check `can(user, homeId, 'plant:edit')`
 * first.
 */
export function setCoverPhoto(homeId: string, plantId: string, photoId: string | null): boolean {
	const inHome = and(eq(plant.id, plantId), eq(plant.homeId, homeId));
	return getConnection().db.transaction(
		(tx) => {
			if (!tx.select({ id: plant.id }).from(plant).where(inHome).get()) return false;
			if (photoId !== null) {
				const own = tx
					.select({ id: photo.id })
					.from(photo)
					.where(
						and(
							eq(photo.id, photoId),
							eq(photo.plantId, plantId),
							eq(photo.homeId, homeId),
							isNull(photo.deletedAt)
						)
					)
					.get();
				if (!own) return false;
			}
			tx.update(plant).set({ coverPhotoId: photoId }).where(inHome).run();
			return true;
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Moves a plant in `homeId` to the Memorial, saying what happened, on what day and with what note
 * (D43). For a plant already there, it corrects the entry. The day can't be after today in the
 * home's time zone at `now`, nor before the day the plant was got. Callers check
 * `can(user, homeId, 'plant:edit')` first. Throws a `ZodError` if the input is invalid.
 */
export function memorialisePlant(
	homeId: string,
	plantId: string,
	input: MemorialInput,
	now = new Date()
): MemorialiseResult {
	const values = memorialInput.parse(input);
	const inHome = and(eq(plant.id, plantId), eq(plant.homeId, homeId));
	return getConnection().db.transaction(
		(tx) => {
			const found = tx
				.select({ acquiredOn: plant.acquiredOn, timeZone: home.timeZone })
				.from(plant)
				.innerJoin(home, eq(home.id, plant.homeId))
				.where(inHome)
				.get();
			if (!found) return { ok: false, reason: 'not-found' } as const;
			if (values.statusOn > calendarDate(now, found.timeZone)) {
				return { ok: false, reason: 'in-the-future' } as const;
			}
			if (found.acquiredOn && values.statusOn < found.acquiredOn) {
				return { ok: false, reason: 'before-acquired', acquiredOn: found.acquiredOn } as const;
			}
			tx.update(plant).set(values).where(inHome).run();
			const updated = findPlant(tx, homeId, plantId);
			if (!updated) throw new Error('The plant just memorialised has gone');
			return { ok: true, plant: updated } as const;
		},
		// Takes the write lock before reading the acquired date, so an edit can't slip in between.
		{ behavior: 'immediate' }
	);
}

/**
 * Brings a plant in `homeId` back from the Memorial, clearing the day and the note (D43). Its
 * schedules were kept, so its tasks are due again as its log says. Returns `false` if the home has
 * no such plant; restoring an active plant changes nothing. Callers check
 * `can(user, homeId, 'plant:edit')` first.
 */
export function restorePlant(homeId: string, plantId: string): boolean {
	const inHome = and(eq(plant.id, plantId), eq(plant.homeId, homeId));
	return getConnection().db.transaction(
		(tx) => {
			if (!tx.select({ id: plant.id }).from(plant).where(inHome).get()) return false;
			tx.update(plant)
				.set({ status: 'active', statusOn: null, statusNote: null })
				.where(and(inHome, ne(plant.status, 'active')))
				.run();
			return true;
		},
		{ behavior: 'immediate' }
	);
}

/**
 * The plants in `homeId` that died, were given away or were sold: the most recent first, then in
 * alphabetical order (D45). Callers check `can(user, homeId, 'home:view')` first.
 */
export function listMemorial(homeId: string): MemorialPlant[] {
	const rows = getConnection()
		.db.select({
			id: plant.id,
			nickname: plant.nickname,
			species: plant.species,
			roomId: plant.roomId,
			acquiredOn: plant.acquiredOn,
			status: plant.status,
			statusOn: plant.statusOn,
			statusNote: plant.statusNote,
			coverPhotoId: coverColumns.coverPhotoId
		})
		.from(plant)
		.where(and(eq(plant.homeId, homeId), ne(plant.status, 'active')))
		.all();
	const sortName = byName<(typeof rows)[number]>((row) => row.nickname);
	return rows
		.sort((a, b) => latestFirst(a.statusOn, b.statusOn) || sortName(a, b))
		.map((row) => ({ ...row, status: memorialStatus(row.status) }));
}

/** How many plants in `homeId` are in the Memorial. Callers check `can(user, homeId, 'home:view')`. */
export function countMemorial(homeId: string): number {
	const [{ plants }] = getConnection()
		.db.select({ plants: count() })
		.from(plant)
		.where(and(eq(plant.homeId, homeId), ne(plant.status, 'active')))
		.all();
	return plants;
}

/** Compares two days for a list with the latest first, and a missing one last. */
function latestFirst(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a < b ? 1 : -1;
}

/** A status read from a plant already known to be in the Memorial. */
function memorialStatus(status: PlantStatus): MemorialStatus {
	if (status === 'active') throw new Error('An active plant is not in the Memorial');
	return status;
}
