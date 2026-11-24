import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CARE_TYPES, TASKS, isTask, type CareType, type Task } from '../../care';
import { zonedTime } from '../../dates';
import { getConnection, type Db } from '../db';
import { careEvent, careSchedule, home, plant, user } from '../db/schema';
import { optionalText } from './fields';

/**
 * The care log: each watering, feed, check and so on, with who logged it and when it was done
 * (docs/spec.md, Care log and schedules). Reading it needs `home:view`; logging and undoing care
 * needs `care:log`. Callers check `can()` first.
 *
 * When each task is next due is worked out from this log (`schedules.ts`), so logging care or
 * undoing it moves the due date with nothing else to update (CLAUDE.md rule 4). The one stored
 * thing logging changes is a snooze: doing or checking a task ends it (D31).
 */

export const MAX_NOTE_LENGTH = 500;

/** How far ahead of the server's clock a time may be, for a phone whose clock runs a little fast. */
const CLOCK_SLACK_MS = 5 * 60_000;

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

/** The outcome of logging care. A refused entry logs nothing. */
export type LogCareResult =
	{ ok: true; event: CareEvent } | { ok: false; reason: 'not-found' | 'in-the-future' };

/** The outcome of undoing care: the event that was removed, or why nothing was. */
export type UndoCareResult =
	{ ok: true; event: CareEvent } | { ok: false; reason: 'not-found' | 'not-yours' };

const notFound = { ok: false, reason: 'not-found' } as const;

type Tx = Pick<Db, 'select'>;

/** Care events with who logged them. The caller adds the `where`. */
function selectEvents(tx: Tx) {
	return tx
		.select({
			id: careEvent.id,
			plantId: careEvent.plantId,
			type: careEvent.type,
			checkedTask: careEvent.checkedTask,
			doneAt: careEvent.doneAt,
			note: careEvent.note,
			userId: careEvent.userId,
			userName: user.name
		})
		.from(careEvent)
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

/**
 * Logs care given to a plant in `homeId` by `userId`: now, or at an earlier time the input gives.
 * Doing or checking a task ends its snooze. Refused if the home has no such plant, or the time is
 * in the future. Callers check `can(user, homeId, 'care:log')` first. Throws a `ZodError` if the
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
		const found = tx
			.select({ timeZone: home.timeZone })
			.from(plant)
			.innerJoin(home, eq(home.id, plant.homeId))
			.where(and(eq(plant.id, plantId), eq(plant.homeId, homeId)))
			.get();
		if (!found) return notFound;

		const doneAt = values.doneAt ? zonedTime(values.doneAt, found.timeZone) : now;
		if (doneAt.getTime() > now.getTime() + CLOCK_SLACK_MS) {
			return { ok: false, reason: 'in-the-future' } as const;
		}

		const id = randomUUID();
		tx.insert(careEvent)
			.values({
				id,
				homeId,
				plantId,
				userId,
				type: values.type,
				checkedTask,
				doneAt,
				note: values.note,
				createdAt: now
			})
			.run();

		// Doing or checking a task ends its snooze (D31). A move has no schedule.
		const task = checkedTask ?? values.type;
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

		const event = findEvent(tx, homeId, plantId, id);
		if (!event) throw new Error('The care event just logged has gone');
		return { ok: true, event } as const;
	});
}

/**
 * A plant's care history in `homeId`, latest first: at most `limit` events, and whether there are
 * more. Empty if the home has no such plant. Callers check `can(user, homeId, 'home:view')` first.
 */
export function listCareEvents(
	homeId: string,
	plantId: string,
	limit = 50
): { events: CareEvent[]; more: boolean } {
	const rows = selectEvents(getConnection().db)
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
