import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { TASKS, isTask, type DueReason, type Task } from '../../care';
import { addDays, calendarDate, daysBetween } from '../../dates';
import { getConnection, type Db } from '../db';
import { careEvent, careSchedule, home, plant, room } from '../db/schema';
import { compareNames } from './order';

/**
 * Care schedules: how often each plant needs each task, and when it's next due (docs/spec.md,
 * Care log and schedules). Reading them needs `home:view`. Adding, changing and removing them
 * needs `home:configure`; snoozing a task needs `care:log`. Callers check `can()` first.
 *
 * When a task is next due is never stored. It's worked out from the care log each time it's read
 * (CLAUDE.md rule 4; D20, D31), in the home's time zone. Winter intervals are stored but not yet
 * used: they come with their screens (D33).
 */

export const MAX_INTERVAL_DAYS = 730;
export const MAX_RECHECK_DAYS = 60;
export const DEFAULT_RECHECK_DAYS = 2;
/** How far ahead a task can be snoozed. */
export const MAX_SNOOZE_DAYS = 365;

export interface Schedule {
	id: string;
	plantId: string;
	task: Task;
	intervalDays: number;
	recheckDays: number;
	/** `YYYY-MM-DD`, or `null` if not snoozed. */
	snoozedUntil: string | null;
}

/** A schedule with when its task was last done and is next due. */
export interface ScheduleStatus extends Schedule {
	/** When the task was last done, or `null` if it never has been. */
	lastDone: Date | null;
	/** The calendar date it's next due, `YYYY-MM-DD`, in the home's time zone. */
	due: string;
	/** What decided the due date. */
	dueReason: DueReason;
	/** How many days from today it's due: 0 for today, negative when overdue. */
	daysAway: number;
}

/** A scheduled task on one of the home's plants, as the Today view lists it. */
export interface HomeTask extends ScheduleStatus {
	plantName: string;
	roomId: string;
	roomName: string;
}

/** A whole number of days from 1 to `max`, typed into a form. */
const days = (max: number, message: string) =>
	z
		.string()
		.trim()
		.regex(/^\d+$/, message)
		.transform(Number)
		.pipe(z.number().int().min(1, message).max(max, message));

/** What a person fills in to add a schedule. */
export const scheduleInput = z.object({
	task: z.enum(TASKS, 'Choose a task.'),
	intervalDays: days(MAX_INTERVAL_DAYS, `Enter a number of days from 1 to ${MAX_INTERVAL_DAYS}.`),
	recheckDays: days(MAX_RECHECK_DAYS, `Enter a number of days from 1 to ${MAX_RECHECK_DAYS}.`)
});

/** What a person can change on a schedule: everything but its task. */
export const scheduleChangeInput = scheduleInput.omit({ task: true });

/** A schedule as a form sends it, before `scheduleInput` has checked it. */
export type ScheduleInput = { task: string; intervalDays: string; recheckDays: string };
export type ScheduleChangeInput = Omit<ScheduleInput, 'task'>;

/**
 * A snooze: for a number of days from today, or until a chosen date. The page's buttons send
 * `days`; its date field sends `until`.
 */
export const snoozeInput = z
	.object({
		days: z.enum(['', '1', '3'], 'Choose how long to snooze for.').optional(),
		until: z.union([z.literal(''), z.iso.date('Enter a date.')]).optional()
	})
	.refine((values) => values.days || values.until, {
		path: ['until'],
		message: 'Choose a date.'
	});

export type SnoozeInput = { days?: string; until?: string };

/** The outcome of adding a schedule. A refused one adds nothing. */
export type CreateScheduleResult =
	{ ok: true; schedule: Schedule } | { ok: false; reason: 'not-found' | 'task-taken' };

/** The outcome of snoozing a task: the date it's snoozed until, or why it wasn't. */
export type SnoozeResult =
	{ ok: true; until: string } | { ok: false; reason: 'not-found' | 'not-after-today' | 'too-far' };

const notFound = { ok: false, reason: 'not-found' } as const;

const columns = {
	id: careSchedule.id,
	plantId: careSchedule.plantId,
	task: careSchedule.task,
	intervalDays: careSchedule.intervalDays,
	recheckDays: careSchedule.recheckDays,
	snoozedUntil: careSchedule.snoozedUntil
};

export type Tx = Pick<Db, 'select'>;

const inHome = (homeId: string, plantId: string, scheduleId: string) =>
	and(
		eq(careSchedule.id, scheduleId),
		eq(careSchedule.plantId, plantId),
		eq(careSchedule.homeId, homeId)
	);

const taskInHome = (homeId: string, plantId: string, task: Task) =>
	and(
		eq(careSchedule.task, task),
		eq(careSchedule.plantId, plantId),
		eq(careSchedule.homeId, homeId)
	);

/** Whether `homeId` has a plant with this id. */
function plantInHome(tx: Tx, homeId: string, plantId: string): boolean {
	return !!tx
		.select({ id: plant.id })
		.from(plant)
		.where(and(eq(plant.id, plantId), eq(plant.homeId, homeId)))
		.get();
}

/**
 * When a task is next due, as a calendar date in `timeZone`: the latest of
 *
 * - the day it was last done plus its interval, with the day the schedule was added standing in
 *   until it's first done (D20);
 * - the day of the last check since then plus the recheck delay (D13);
 * - the day it's snoozed until.
 *
 * A check older than the last time the task was done no longer counts. Nor does a snooze, but
 * logging the task clears that already (D31).
 */
export function nextDue(
	schedule: { intervalDays: number; recheckDays: number; snoozedUntil: string | null },
	history: { createdAt: Date; lastDone: Date | null; lastChecked: Date | null },
	timeZone: string
): { due: string; reason: DueReason } {
	const since = history.lastDone ?? history.createdAt;
	let due = addDays(calendarDate(since, timeZone), schedule.intervalDays);
	let reason: DueReason = 'interval';

	if (history.lastChecked && history.lastChecked >= since) {
		const recheck = addDays(calendarDate(history.lastChecked, timeZone), schedule.recheckDays);
		if (recheck > due) [due, reason] = [recheck, 'checked'];
	}
	if (schedule.snoozedUntil && schedule.snoozedUntil > due) {
		[due, reason] = [schedule.snoozedUntil, 'snoozed'];
	}
	return { due, reason };
}

/** When a care event of this task (or a check of it) was last done on the schedule's plant. */
const latest = (type: 'task' | 'check') => sql<number | null>`(
	select max(${careEvent.doneAt}) from ${careEvent}
	where ${careEvent.plantId} = ${careSchedule.plantId}
		and ${careEvent.homeId} = ${careSchedule.homeId}
		and ${
			type === 'task'
				? sql`${careEvent.type} = ${careSchedule.task}`
				: sql`${careEvent.type} = 'checked' and ${careEvent.checkedTask} = ${careSchedule.task}`
		}
)`;

/**
 * Schedules in `homeId` matching `conditions`, with their plant and room, and when each task was
 * last done and is next due at `now`. Only plants and rooms in the same home are joined.
 */
function selectTasks(tx: Tx, homeId: string, conditions: SQL[], now: Date): HomeTask[] {
	const rows = tx
		.select({
			...columns,
			createdAt: careSchedule.createdAt,
			timeZone: home.timeZone,
			lastDone: latest('task'),
			lastChecked: latest('check'),
			plantName: plant.nickname,
			roomId: room.id,
			roomName: room.name
		})
		.from(careSchedule)
		.innerJoin(home, eq(home.id, careSchedule.homeId))
		.innerJoin(
			plant,
			and(eq(plant.id, careSchedule.plantId), eq(plant.homeId, careSchedule.homeId))
		)
		.innerJoin(room, and(eq(room.id, plant.roomId), eq(room.homeId, plant.homeId)))
		.where(and(eq(careSchedule.homeId, homeId), ...conditions))
		.all();

	return rows.map(({ createdAt, timeZone, lastDone, lastChecked, ...task }) => {
		const history = {
			createdAt,
			lastDone: lastDone === null ? null : new Date(lastDone),
			lastChecked: lastChecked === null ? null : new Date(lastChecked)
		};
		const { due, reason } = nextDue(task, history, timeZone);
		return {
			...task,
			lastDone: history.lastDone,
			due,
			dueReason: reason,
			daysAway: daysBetween(calendarDate(now, timeZone), due)
		};
	});
}

const taskOrder = (a: { task: Task }, b: { task: Task }) =>
	TASKS.indexOf(a.task) - TASKS.indexOf(b.task);

/**
 * A plant's schedules in `homeId`, in the order of `TASKS`, each with when it's next due. Empty if
 * the home has no such plant. Callers check `can(user, homeId, 'home:view')` first.
 */
export function listSchedules(homeId: string, plantId: string, now = new Date()): ScheduleStatus[] {
	return selectTasks(getConnection().db, homeId, [eq(careSchedule.plantId, plantId)], now)
		.map((task) => ({
			id: task.id,
			plantId: task.plantId,
			task: task.task,
			intervalDays: task.intervalDays,
			recheckDays: task.recheckDays,
			snoozedUntil: task.snoozedUntil,
			lastDone: task.lastDone,
			due: task.due,
			dueReason: task.dueReason,
			daysAway: task.daysAway
		}))
		.sort(taskOrder);
}

/**
 * Every scheduled task on the active plants in `homeId`, with when each is next due: soonest
 * first, then by plant name and in the order of `TASKS`. The Today view shows those due today or
 * earlier. Callers check `can(user, homeId, 'home:view')` first.
 */
export function listTasks(homeId: string, now = new Date()): HomeTask[] {
	return selectTasks(getConnection().db, homeId, [eq(plant.status, 'active')], now).sort(
		(a, b) =>
			a.daysAway - b.daysAway ||
			compareNames(a.plantName, b.plantName) ||
			a.plantId.localeCompare(b.plantId) ||
			taskOrder(a, b)
	);
}

/**
 * One task's schedules on some of the active plants in `homeId`, with when each is due at `now`,
 * for logging that task on them together (`logDueTasks` in `care-events.ts`). Plants that aren't
 * in the home, aren't active or have no schedule for the task are left out. Callers check
 * `can()` first.
 */
export function findTasks(
	tx: Tx,
	homeId: string,
	task: Task,
	plantIds: string[],
	now: Date
): HomeTask[] {
	if (plantIds.length === 0) return [];
	return selectTasks(
		tx,
		homeId,
		[
			eq(plant.status, 'active'),
			eq(careSchedule.task, task),
			inArray(careSchedule.plantId, plantIds)
		],
		now
	);
}

/** One schedule on a plant in `homeId`, or `null`. Callers check `home:view` first. */
export function getSchedule(homeId: string, plantId: string, scheduleId: string): Schedule | null {
	const row = getConnection()
		.db.select(columns)
		.from(careSchedule)
		.where(inHome(homeId, plantId, scheduleId))
		.get();
	return row ?? null;
}

/**
 * Adds a schedule to a plant in `homeId`. Until the task is first logged, it falls due one
 * interval after `now` (D20). Refused if the home has no such plant, or the plant already has a
 * schedule for this task. Callers check `can(user, homeId, 'home:configure')` first. Throws a
 * `ZodError` if the input is invalid.
 */
export function createSchedule(
	homeId: string,
	plantId: string,
	input: ScheduleInput,
	now = new Date()
): CreateScheduleResult {
	const values = scheduleInput.parse(input);
	return getConnection().db.transaction(
		(tx) => {
			if (!plantInHome(tx, homeId, plantId)) return notFound;
			if (
				tx
					.select({ id: careSchedule.id })
					.from(careSchedule)
					.where(taskInHome(homeId, plantId, values.task))
					.get()
			) {
				return { ok: false, reason: 'task-taken' } as const;
			}
			const schedule = tx
				.insert(careSchedule)
				.values({ id: randomUUID(), homeId, plantId, ...values, createdAt: now, updatedAt: now })
				.returning(columns)
				.get();
			return { ok: true, schedule } as const;
		},
		// Takes the write lock before checking the task, so two schedules can't take it at once.
		{ behavior: 'immediate' }
	);
}

/**
 * Changes a schedule's interval and recheck delay on a plant in `homeId`, returning whether there
 * was one to change. Callers check `can(user, homeId, 'home:configure')` first. Throws a
 * `ZodError` if the input is invalid.
 */
export function updateSchedule(
	homeId: string,
	plantId: string,
	scheduleId: string,
	input: ScheduleChangeInput
): boolean {
	const values = scheduleChangeInput.parse(input);
	const { changes } = getConnection()
		.db.update(careSchedule)
		.set(values)
		.where(inHome(homeId, plantId, scheduleId))
		.run();
	return changes > 0;
}

/**
 * Removes a schedule from a plant in `homeId`, returning whether there was one. The care already
 * logged stays in the plant's history. Callers check `can(user, homeId, 'home:configure')` first.
 */
export function deleteSchedule(homeId: string, plantId: string, scheduleId: string): boolean {
	const { changes } = getConnection()
		.db.delete(careSchedule)
		.where(inHome(homeId, plantId, scheduleId))
		.run();
	return changes > 0;
}

/**
 * Puts off a plant's scheduled task in `homeId`: for a day or three from today, or until a chosen
 * date, which must be after today and within `MAX_SNOOZE_DAYS`. Doing or checking the task ends
 * the snooze (D31). Callers check `can(user, homeId, 'care:log')` first. Throws a `ZodError` if
 * the input is invalid.
 */
export function snoozeTask(
	homeId: string,
	plantId: string,
	task: string,
	input: SnoozeInput,
	now = new Date()
): SnoozeResult {
	const values = snoozeInput.parse(input);
	if (!isTask(task)) return notFound;
	return getConnection().db.transaction((tx) => {
		const found = tx
			.select({ timeZone: home.timeZone })
			.from(careSchedule)
			.innerJoin(home, eq(home.id, careSchedule.homeId))
			.where(taskInHome(homeId, plantId, task))
			.get();
		if (!found) return notFound;

		const today = calendarDate(now, found.timeZone);
		const until = values.days ? addDays(today, Number(values.days)) : (values.until ?? '');
		if (until <= today) return { ok: false, reason: 'not-after-today' } as const;
		if (daysBetween(today, until) > MAX_SNOOZE_DAYS)
			return { ok: false, reason: 'too-far' } as const;

		tx.update(careSchedule)
			.set({ snoozedUntil: until })
			.where(taskInHome(homeId, plantId, task))
			.run();
		return { ok: true, until } as const;
	});
}

/**
 * Ends a snooze on a plant's scheduled task in `homeId`, returning whether the home has that
 * schedule. Callers check `can(user, homeId, 'care:log')` first.
 */
export function cancelSnooze(homeId: string, plantId: string, task: string): boolean {
	if (!isTask(task)) return false;
	const { changes } = getConnection()
		.db.update(careSchedule)
		.set({ snoozedUntil: null })
		.where(taskInHome(homeId, plantId, task))
		.run();
	return changes > 0;
}
