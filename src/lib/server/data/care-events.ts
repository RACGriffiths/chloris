import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { CARE_TYPES, TASKS, isTask, type CareType, type Task } from '../../care';
import { addDays, calendarDate, zonedTime } from '../../dates';
import { getConnection, type Db } from '../db';
import { careEvent, careSchedule, home, photo, plant, user } from '../db/schema';
import type { PhotoProblem } from '../photos/process';
import { optionalText, stillToCome } from './fields';
import { compareNames } from './order';
import { addPhotoWith } from './photos';
import { findTasks } from './schedules';

/**
 * The care log: each watering, feed, check and so on, with who logged it and when it was done
 * (docs/spec.md, Care log and schedules). Reading it needs `home:view`; logging and undoing care
 * needs `care:log`. Callers check `can()` first.
 *
 * When each task is next due is worked out from this log (`schedules.ts`), so logging care or
 * undoing it moves the due date with nothing else to update (CLAUDE.md rule 4). The one stored
 * thing logging changes is a snooze: doing or checking a task ends it (D31).
 *
 * Care can be logged with a photo (D41), which also needs `photo:add`. The photo joins the
 * plant's timeline, and stays there if the care is undone.
 *
 * Care is logged only on active plants: one in the Memorial is refused (D44). Care logged before
 * it went there can still be undone.
 */

export const MAX_NOTE_LENGTH = 500;

/** How many plants one tap on the Today view can log a task on. */
export const MAX_PLANTS_AT_ONCE = 500;

export interface CareEvent {
	id: string;
	plantId: string;
	type: CareType;
	/** For a check, the task that wasn't needed. */
	checkedTask: Task | null;
	doneAt: Date;
	note: string | null;
	/** Who logged it, or `null` once their account is deleted. */
	userId: string | null;
	userName: string | null;
}

/**
 * What a person fills in to log care. `doneAt` is a `datetime-local` value in the home's time
 * zone, for care done earlier; empty means now. A check names the task it was for.
 */
export const careInput = z
	.object({
		type: z.enum(CARE_TYPES, 'Choose what you did.'),
		checkedTask: z
			.enum(['', ...TASKS], 'Choose the task you checked.')
			.optional()
			.transform((task) => task || null),
		doneAt: z
			.union([z.literal(''), z.iso.datetime({ local: true, error: 'Enter a date and time.' })])
			.optional()
			.transform((value) => value || null),
		note: optionalText(MAX_NOTE_LENGTH, `Keep the note to ${MAX_NOTE_LENGTH} characters or fewer.`)
	})
	.superRefine((values, ctx) => {
		if (values.type === 'checked' && !values.checkedTask) {
			ctx.addIssue({
				code: 'custom',
				path: ['checkedTask'],
				message: 'Choose the task you checked.'
			});
		}
	});

/** Care as a form sends it, before `careInput` has checked it. */
export type CareInput = { type: string; checkedTask?: string; doneAt?: string; note?: string };

/** A care event as a plant's history lists it, with the photo added with it. */
export interface CareHistoryEvent extends CareEvent {
	/** The photo added with it (D41), unless that photo was deleted. */
	photoId: string | null;
}

/** A care event with the plant it was for, as the Today view lists it. */
export interface CareEventOnPlant extends CareEvent {
	plantName: string;
}

/**
 * What the Today view's buttons send: a scheduled task, whether it was done or checked and not
 * needed, and the plants it's for. One plant for a task's own buttons; a room's for "Water all".
 */
export const dueCareInput = z.object({
	task: z.enum(TASKS, 'Choose a task.'),
	outcome: z.enum(['done', 'not-needed'], 'Choose done or not needed.'),
	plantIds: z
		.array(z.string().min(1, 'Choose a plant.'))
		.min(1, 'Choose a plant.')
		.max(MAX_PLANTS_AT_ONCE, `Choose ${MAX_PLANTS_AT_ONCE} plants or fewer.`)
});

export type DueCareInput = { task: string; outcome: string; plantIds: string[] };

/** A task logged on one plant by `logDueTasks`. */
export interface LoggedTask {
	eventId: string;
	plantId: string;
	plantName: string;
}

/**
 * The outcome of logging a task on several plants. Plants whose task was no longer due were left
 * alone; `not-found` means none of the plants is an active one in the home with that task.
 */
export type LogDueResult =
	| { ok: true; logged: LoggedTask[]; notDue: { plantId: string; plantName: string }[] }
	| { ok: false; reason: 'not-found' };

/** The outcome of logging care. A refused entry logs nothing. */
export type LogCareResult =
	| { ok: true; event: CareEvent }
	| { ok: false; reason: 'not-found' | 'in-the-memorial' | 'in-the-future' };

/** The outcome of logging care with a photo. A refused entry stores neither. */
export type LogCareWithPhotoResult =
	| { ok: true; event: CareEvent; photoId: string }
	| { ok: false; reason: 'not-found' | 'in-the-memorial' | 'in-the-future' | PhotoProblem };

/** The outcome of undoing care: the event that was removed, or why nothing was. */
export type UndoCareResult =
	{ ok: true; event: CareEvent } | { ok: false; reason: 'not-found' | 'not-yours' };

/** The outcome of undoing several events at once: those removed, or why none were. */
export type UndoCareEventsResult =
	{ ok: true; events: CareEventOnPlant[] } | { ok: false; reason: 'not-found' | 'not-yours' };

const notFound = { ok: false, reason: 'not-found' } as const;

type Tx = Pick<Db, 'select'>;

const eventColumns = {
	id: careEvent.id,
	plantId: careEvent.plantId,
	type: careEvent.type,
	checkedTask: careEvent.checkedTask,
	doneAt: careEvent.doneAt,
	note: careEvent.note,
	userId: careEvent.userId,
	userName: user.name
};

/** Care events with who logged them. The caller adds the `where`. */
function selectEvents(tx: Tx) {
	return tx.select(eventColumns).from(careEvent).leftJoin(user, eq(user.id, careEvent.userId));
}

/** Care events with who logged them and the plant's name. The caller adds the `where`. */
function selectEventsOnPlants(tx: Tx) {
	return tx
		.select({ ...eventColumns, plantName: plant.nickname })
		.from(careEvent)
		.innerJoin(plant, and(eq(plant.id, careEvent.plantId), eq(plant.homeId, careEvent.homeId)))
		.leftJoin(user, eq(user.id, careEvent.userId));
}

/** One event on a plant in `homeId`, or `null`. */
function findEvent(tx: Tx, homeId: string, plantId: string, eventId: string): CareEvent | null {
	const row = selectEvents(tx)
		.where(
			and(eq(careEvent.id, eventId), eq(careEvent.plantId, plantId), eq(careEvent.homeId, homeId))
		)
		.get();
	return row ?? null;
}

type WriteTx = Pick<Db, 'select' | 'insert' | 'update'>;

/**
 * Adds an event to the log of a plant already checked to be in `homeId`, and returns its id.
 * Doing or checking a task ends its snooze (D31); a move has no schedule.
 */
function insertCare(
	tx: WriteTx,
	homeId: string,
	userId: string,
	plantId: string,
	care: {
		type: CareType;
		checkedTask: Task | null;
		doneAt: Date;
		note: string | null;
		photoId?: string;
		now: Date;
	}
): string {
	const id = randomUUID();
	tx.insert(careEvent)
		.values({
			id,
			homeId,
			plantId,
			userId,
			type: care.type,
			checkedTask: care.checkedTask,
			doneAt: care.doneAt,
			note: care.note,
			photoId: care.photoId,
			createdAt: care.now
		})
		.run();

	const task = care.checkedTask ?? care.type;
	if (isTask(task)) {
		tx.update(careSchedule)
			.set({ snoozedUntil: null })
			.where(
				and(
					eq(careSchedule.plantId, plantId),
					eq(careSchedule.homeId, homeId),
					eq(careSchedule.task, task)
				)
			)
			.run();
	}
	return id;
}

/**
 * When care given to a plant in `homeId` was done: `doneAt`, a time in the home's time zone, or
 * else now. Refused if the home has no such plant, the plant is in the Memorial (D44), or the time
 * is still to come.
 */
function careTime(
	tx: Tx,
	homeId: string,
	plantId: string,
	doneAt: string | null,
	now: Date
):
	| { ok: true; doneAt: Date }
	| { ok: false; reason: 'not-found' | 'in-the-memorial' | 'in-the-future' } {
	const found = tx
		.select({ timeZone: home.timeZone, status: plant.status })
		.from(plant)
		.innerJoin(home, eq(home.id, plant.homeId))
		.where(and(eq(plant.id, plantId), eq(plant.homeId, homeId)))
		.get();
	if (!found) return notFound;
	if (found.status !== 'active') return { ok: false, reason: 'in-the-memorial' } as const;
	const time = doneAt ? zonedTime(doneAt, found.timeZone) : now;
	if (stillToCome(time, now)) return { ok: false, reason: 'in-the-future' } as const;
	return { ok: true, doneAt: time };
}

/**
 * Logs care given to a plant in `homeId` by `userId`: now, or at an earlier time the input gives.
 * Doing or checking a task ends its snooze. Refused if the home has no such plant, the plant is in
 * the Memorial, or the time is in the future. Callers check `can(user, homeId, 'care:log')` first. Throws a `ZodError` if the
 * input is invalid.
 */
export function logCare(
	homeId: string,
	userId: string,
	plantId: string,
	input: CareInput,
	now = new Date()
): LogCareResult {
	const values = careInput.parse(input);
	const checkedTask = values.type === 'checked' ? values.checkedTask : null;
	return getConnection().db.transaction((tx) => {
		const when = careTime(tx, homeId, plantId, values.doneAt, now);
		if (!when.ok) return when;

		const id = insertCare(tx, homeId, userId, plantId, {
			type: values.type,
			checkedTask,
			doneAt: when.doneAt,
			note: values.note,
			now
		});
		const event = findEvent(tx, homeId, plantId, id);
		if (!event) throw new Error('The care event just logged has gone');
		return { ok: true, event } as const;
	});
}

/**
 * Logs care as `logCare` does, with a photo of the plant taken at the time (D41): `file`, checked
 * and stored as `addPhoto` stores any photo, and dated by its own EXIF data, or else `takenAt`,
 * the date the browser read from it, or else when the care was done. Either both are stored or
 * neither is. Refused if the home has no such plant, the plant is in the Memorial, the time is in
 * the future, or the file isn't a photo the server accepts. Callers check `can(user, homeId, 'care:log')` and
 * `can(user, homeId, 'photo:add')` first. Throws a `ZodError` if the input is invalid.
 */
export async function logCareWithPhoto(
	homeId: string,
	userId: string,
	plantId: string,
	input: CareInput & { takenAt?: string },
	file: Uint8Array,
	now = new Date()
): Promise<LogCareWithPhotoResult> {
	const values = careInput.parse(input);
	const checkedTask = values.type === 'checked' ? values.checkedTask : null;
	// Checked first, so a refused time doesn't wait for the photo to be processed.
	const when = careTime(getConnection().db, homeId, plantId, values.doneAt, now);
	if (!when.ok) return when;

	const added = await addPhotoWith(
		homeId,
		userId,
		plantId,
		{ takenAt: input.takenAt },
		file,
		{ now, undated: when.doneAt },
		(tx, photo) => {
			const id = insertCare(tx, homeId, userId, plantId, {
				type: values.type,
				checkedTask,
				doneAt: when.doneAt,
				note: values.note,
				photoId: photo.id,
				now
			});
			const event = findEvent(tx, homeId, plantId, id);
			if (!event) throw new Error('The care event just logged has gone');
			return event;
		}
	);
	if (!added.ok) return added;
	return { ok: true, event: added.recorded, photoId: added.photo.id };
}

/**
 * A plant's care history in `homeId`, latest first: at most `limit` events, and whether there are
 * more. Empty if the home has no such plant. Callers check `can(user, homeId, 'home:view')` first.
 */
export function listCareEvents(
	homeId: string,
	plantId: string,
	limit = 50
): { events: CareHistoryEvent[]; more: boolean } {
	const rows = getConnection()
		.db.select({ ...eventColumns, photoId: photo.id })
		.from(careEvent)
		.leftJoin(user, eq(user.id, careEvent.userId))
		.leftJoin(
			photo,
			and(
				eq(photo.id, careEvent.photoId),
				eq(photo.homeId, careEvent.homeId),
				isNull(photo.deletedAt)
			)
		)
		.where(and(eq(careEvent.plantId, plantId), eq(careEvent.homeId, homeId)))
		.orderBy(desc(careEvent.doneAt), desc(careEvent.createdAt), desc(careEvent.id))
		.limit(limit + 1)
		.all();
	return { events: rows.slice(0, limit), more: rows.length > limit };
}

/**
 * Undoes care logged on a plant in `homeId`, deleting the event so the due date goes back to what
 * it was. Only the person who logged it may (D32). A snooze the event ended stays ended. Callers
 * check `can(user, homeId, 'care:log')` first.
 */
export function undoCare(
	homeId: string,
	userId: string,
	plantId: string,
	eventId: string
): UndoCareResult {
	return getConnection().db.transaction(
		(tx) => {
			const event = findEvent(tx, homeId, plantId, eventId);
			if (!event) return notFound;
			if (event.userId !== userId) return { ok: false, reason: 'not-yours' } as const;
			tx.delete(careEvent)
				.where(and(eq(careEvent.id, eventId), eq(careEvent.homeId, homeId)))
				.run();
			return { ok: true, event } as const;
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Logs a scheduled task as done, or checked and not needed, on each of `plantIds` in `homeId`
 * whose task is due today or overdue at `now`: the Today view's buttons, for one plant or a whole
 * room. A plant whose task isn't due any more, because someone did, checked or snoozed it since
 * the page was shown, is left alone and reported, so two people working from the same list don't
 * water a plant twice. Plants that aren't active ones in the home with that task are ignored.
 * Callers check `can(user, homeId, 'care:log')` first. Throws a `ZodError` if the input is
 * invalid.
 */
export function logDueTasks(
	homeId: string,
	userId: string,
	input: DueCareInput,
	now = new Date()
): LogDueResult {
	const { task, outcome, plantIds } = dueCareInput.parse(input);
	return getConnection().db.transaction(
		(tx) => {
			const tasks = findTasks(tx, homeId, task, [...new Set(plantIds)], now).sort(
				(a, b) => compareNames(a.plantName, b.plantName) || a.plantId.localeCompare(b.plantId)
			);
			if (tasks.length === 0) return notFound;

			const logged: LoggedTask[] = [];
			const notDue: { plantId: string; plantName: string }[] = [];
			for (const { plantId, plantName, daysAway } of tasks) {
				if (daysAway > 0) {
					notDue.push({ plantId, plantName });
					continue;
				}
				const eventId = insertCare(tx, homeId, userId, plantId, {
					type: outcome === 'done' ? task : 'checked',
					checkedTask: outcome === 'done' ? null : task,
					doneAt: now,
					note: null,
					now
				});
				logged.push({ eventId, plantId, plantName });
			}
			return { ok: true, logged, notDue } as const;
		},
		// Takes the write lock before working out what's due, so two people can't both log it.
		{ behavior: 'immediate' }
	);
}

/**
 * The care given today to the active plants in `homeId`, by anyone, latest first. Today is the
 * calendar date at `now` in the home's time zone; care logged today but backdated to an earlier
 * day isn't included. Callers check `can(user, homeId, 'home:view')` first.
 */
export function listCareToday(homeId: string, now = new Date()): CareEventOnPlant[] {
	const db = getConnection().db;
	const found = db.select({ timeZone: home.timeZone }).from(home).where(eq(home.id, homeId)).get();
	if (!found) return [];
	const today = calendarDate(now, found.timeZone);
	const start = zonedTime(`${today}T00:00`, found.timeZone);
	const end = zonedTime(`${addDays(today, 1)}T00:00`, found.timeZone);

	return selectEventsOnPlants(db)
		.where(
			and(
				eq(careEvent.homeId, homeId),
				eq(plant.status, 'active'),
				gte(careEvent.doneAt, start),
				lt(careEvent.doneAt, end)
			)
		)
		.orderBy(desc(careEvent.doneAt), desc(careEvent.createdAt), desc(careEvent.id))
		.all();
}

/**
 * Undoes several care events in `homeId` at once, such as a room's watering logged with one tap,
 * deleting them so the due dates go back. Only the person who logged them may (D32): if any isn't
 * theirs, none is removed. Events already removed are skipped; `not-found` means all were.
 * Callers check `can(user, homeId, 'care:log')` first.
 */
export function undoCareEvents(
	homeId: string,
	userId: string,
	eventIds: string[]
): UndoCareEventsResult {
	const ids = [...new Set(eventIds)].slice(0, MAX_PLANTS_AT_ONCE);
	if (ids.length === 0) return notFound;
	return getConnection().db.transaction(
		(tx) => {
			const events = selectEventsOnPlants(tx)
				.where(and(inArray(careEvent.id, ids), eq(careEvent.homeId, homeId)))
				.all()
				.sort((a, b) => compareNames(a.plantName, b.plantName) || a.id.localeCompare(b.id));
			if (events.length === 0) return notFound;
			if (events.some((event) => event.userId !== userId)) {
				return { ok: false, reason: 'not-yours' } as const;
			}
			tx.delete(careEvent)
				.where(
					and(
						inArray(
							careEvent.id,
							events.map((event) => event.id)
						),
						eq(careEvent.homeId, homeId)
					)
				)
				.run();
			return { ok: true, events } as const;
		},
		{ behavior: 'immediate' }
	);
}
