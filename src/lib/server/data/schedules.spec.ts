import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertUser, useTestDatabase } from '../testing';
import { logCare, type CareInput } from './care-events';
import { createHome } from './homes';
import { createPlant, memorialisePlant } from './plants';
import { createRoom } from './rooms';
import {
	cancelSnooze,
	createSchedule,
	deleteSchedule,
	getSchedule,
	listSchedules,
	listTasks,
	nextDue,
	snoozeTask,
	updateSchedule,
	type Schedule,
	type ScheduleInput
} from './schedules';

useTestDatabase();

/** Two homes, each with an owner and a plant. Alice's is in London, Bob's in Paris. */
let alice: string;
let bob: string;
let aliceHome: string;
let bobHome: string;
let fern: string;
let cactus: string;

/** 10:00 in London (BST) on Monday 15 June 2026. */
const now = new Date('2026-06-15T09:00:00Z');
const today = '2026-06-15';

beforeEach(() => {
	alice = insertUser('alice@example.com', { canCreateHome: true });
	bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
	fern = addPlant(aliceHome, 'Fern');
	cactus = addPlant(bobHome, 'Cactus');
});

function addPlant(homeId: string, nickname: string, roomId?: string): string {
	const room = roomId ?? addRoom(homeId, `${nickname}'s room`);
	const plant = createPlant(homeId, { nickname, roomId: room });
	if (!plant) throw new Error('Plant refused');
	return plant.id;
}

function addRoom(homeId: string, name: string): string {
	const room = createRoom(homeId, { name });
	if (!room.ok) throw new Error('Room refused');
	return room.room.id;
}

const watering: ScheduleInput = { task: 'water', intervalDays: '7', recheckDays: '2' };

/** Adds a schedule that must be accepted. */
function schedule(homeId: string, plantId: string, input: ScheduleInput, at = now): Schedule {
	const result = createSchedule(homeId, plantId, input, at);
	if (!result.ok) throw new Error(`Schedule refused: ${result.reason}`);
	return result.schedule;
}

function log(homeId: string, userId: string, plantId: string, input: CareInput, at = now) {
	const result = logCare(homeId, userId, plantId, input, at);
	if (!result.ok) throw new Error(`Care refused: ${result.reason}`);
	return result.event;
}

/** The first schedule on Alice's fern, as listed at `at`. */
const fernWatering = (at = now) => listSchedules(aliceHome, fern, at)[0];

function messages(run: () => unknown): string[] {
	try {
		run();
	} catch (error) {
		if (error instanceof ZodError) return error.issues.map((issue) => issue.message);
		throw error;
	}
	return [];
}

describe('nextDue', () => {
	const zone = 'Europe/London';
	const weekly = { intervalDays: 7, recheckDays: 2, snoozedUntil: null };
	const added = new Date('2026-06-01T09:00:00Z');

	it('counts the interval from the day the schedule was added until the task is done (D20)', () => {
		expect(nextDue(weekly, { createdAt: added, lastDone: null, lastChecked: null }, zone)).toEqual({
			due: '2026-06-08',
			reason: 'interval'
		});
	});

	it('counts the interval from the day the task was last done', () => {
		const lastDone = new Date('2026-06-10T21:00:00Z');
		expect(nextDue(weekly, { createdAt: added, lastDone, lastChecked: null }, zone)).toEqual({
			due: '2026-06-17',
			reason: 'interval'
		});
	});

	it('uses the day in the home’s time zone, not the server’s', () => {
		// 22:30 UTC on the 10th is 23:30 in London (BST), and already the 11th in Paris (CEST).
		const lastDone = new Date('2026-06-10T22:30:00Z');
		const history = { createdAt: added, lastDone, lastChecked: null };
		expect(nextDue(weekly, history, 'Europe/London').due).toBe('2026-06-17');
		expect(nextDue(weekly, history, 'Europe/Paris').due).toBe('2026-06-18');
	});

	it('puts the task off by the recheck delay after a check since it was last done', () => {
		const lastDone = new Date('2026-06-01T09:00:00Z');
		const lastChecked = new Date('2026-06-08T09:00:00Z');
		expect(nextDue(weekly, { createdAt: added, lastDone, lastChecked }, zone)).toEqual({
			due: '2026-06-10',
			reason: 'checked'
		});
	});

	it('ignores a check from before the task was last done', () => {
		const lastChecked = new Date('2026-06-08T09:00:00Z');
		const lastDone = new Date('2026-06-09T09:00:00Z');
		const longRecheck = { ...weekly, intervalDays: 1, recheckDays: 5 };
		expect(nextDue(longRecheck, { createdAt: added, lastDone, lastChecked }, zone)).toEqual({
			due: '2026-06-10',
			reason: 'interval'
		});
	});

	it('takes a snooze when it is later than everything else', () => {
		const snoozed = { ...weekly, snoozedUntil: '2026-06-12' };
		expect(nextDue(snoozed, { createdAt: added, lastDone: null, lastChecked: null }, zone)).toEqual(
			{ due: '2026-06-12', reason: 'snoozed' }
		);
		const early = { ...weekly, snoozedUntil: '2026-06-05' };
		expect(nextDue(early, { createdAt: added, lastDone: null, lastChecked: null }, zone)).toEqual({
			due: '2026-06-08',
			reason: 'interval'
		});
	});
});

describe('createSchedule', () => {
	it('adds a schedule, due one interval after it was added', () => {
		const added = schedule(aliceHome, fern, { ...watering, intervalDays: ' 10 ' });

		expect(added).toEqual<Schedule>({
			id: added.id,
			plantId: fern,
			task: 'water',
			intervalDays: 10,
			recheckDays: 2,
			snoozedUntil: null
		});
		expect(fernWatering()).toMatchObject({
			lastDone: null,
			due: '2026-06-25',
			dueReason: 'interval',
			daysAway: 10
		});
	});

	it('allows one schedule per task on a plant', () => {
		schedule(aliceHome, fern, watering);

		expect(createSchedule(aliceHome, fern, { ...watering, intervalDays: '3' }, now)).toEqual({
			ok: false,
			reason: 'task-taken'
		});
		expect(listSchedules(aliceHome, fern, now)).toHaveLength(1);
		expect(createSchedule(aliceHome, fern, { ...watering, task: 'feed' }, now)).toMatchObject({
			ok: true
		});
	});

	it('explains what is wrong with the input', () => {
		expect(messages(() => createSchedule(aliceHome, fern, { ...watering, task: 'dance' }))).toEqual(
			['Choose a task.']
		);
		expect(messages(() => createSchedule(aliceHome, fern, { ...watering, task: 'move' }))).toEqual([
			'Choose a task.'
		]);
		for (const intervalDays of ['', '0', '2.5', 'weekly', '731']) {
			expect(
				messages(() => createSchedule(aliceHome, fern, { ...watering, intervalDays }))
			).toEqual(['Enter a number of days from 1 to 730.']);
		}
		expect(
			messages(() => createSchedule(aliceHome, fern, { ...watering, recheckDays: '61' }))
		).toEqual(['Enter a number of days from 1 to 60.']);
	});

	it("won't add a schedule to another home's plant", () => {
		expect(createSchedule(bobHome, fern, watering, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});

		expect(listSchedules(aliceHome, fern, now)).toEqual([]);
		expect(listSchedules(bobHome, fern, now)).toEqual([]);
	});
});

describe('listSchedules', () => {
	it('lists a plant’s schedules in task order, with when each was last done and is due', () => {
		schedule(aliceHome, fern, { task: 'repot', intervalDays: '365', recheckDays: '2' });
		schedule(aliceHome, fern, watering);
		const watered = log(aliceHome, alice, fern, { type: 'water', doneAt: '2026-06-10T08:00' });
		// Care of another kind, or on another plant, doesn't count.
		log(aliceHome, alice, fern, { type: 'mist' });

		const [water, repot] = listSchedules(aliceHome, fern, now);
		expect(water).toMatchObject({
			task: 'water',
			lastDone: watered.doneAt,
			due: '2026-06-17',
			dueReason: 'interval',
			daysAway: 2
		});
		expect(repot).toMatchObject({ task: 'repot', lastDone: null, due: '2027-06-15' });
	});

	it('shows a task overdue as days pass', () => {
		schedule(aliceHome, fern, watering);
		expect(fernWatering(new Date('2026-06-22T09:00:00Z'))).toMatchObject({ daysAway: 0 });
		expect(fernWatering(new Date('2026-06-25T09:00:00Z'))).toMatchObject({ daysAway: -3 });
	});

	it('moves the due date on after "checked, not needed"', () => {
		schedule(aliceHome, fern, watering, new Date('2026-06-01T09:00:00Z'));
		expect(fernWatering()).toMatchObject({ due: '2026-06-08', daysAway: -7 });

		log(aliceHome, alice, fern, { type: 'checked', checkedTask: 'water' });

		expect(fernWatering()).toMatchObject({ due: '2026-06-17', dueReason: 'checked', daysAway: 2 });
	});

	it("lists only the home's own schedules, never another's", () => {
		schedule(aliceHome, fern, watering);
		schedule(bobHome, cactus, { ...watering, intervalDays: '30' });

		expect(listSchedules(aliceHome, fern, now).map((s) => s.intervalDays)).toEqual([7]);
		expect(listSchedules(bobHome, cactus, now).map((s) => s.intervalDays)).toEqual([30]);
		expect(listSchedules(bobHome, fern, now)).toEqual([]);
	});
});

describe('listTasks', () => {
	it('lists every task in the home, soonest first, with its plant and room', () => {
		const kitchen = addRoom(aliceHome, 'Kitchen');
		const ivy = addPlant(aliceHome, 'ivy', kitchen);
		const basil = addPlant(aliceHome, 'Basil', kitchen);
		const added = new Date('2026-06-01T09:00:00Z');
		schedule(aliceHome, ivy, watering, added);
		schedule(aliceHome, basil, { ...watering, task: 'mist', intervalDays: '3' }, added);
		schedule(aliceHome, basil, watering, added);
		schedule(aliceHome, fern, { ...watering, intervalDays: '30' }, added);
		log(aliceHome, alice, basil, { type: 'mist', doneAt: '2026-06-14T09:00' });

		expect(
			listTasks(aliceHome, now).map((task) => [task.plantName, task.task, task.daysAway])
		).toEqual([
			// Overdue first, by plant name ignoring case, then in task order.
			['Basil', 'water', -7],
			['ivy', 'water', -7],
			['Basil', 'mist', 2],
			['Fern', 'water', 16]
		]);
		expect(listTasks(aliceHome, now)[0]).toMatchObject({
			plantId: basil,
			plantName: 'Basil',
			roomId: kitchen,
			roomName: 'Kitchen',
			due: '2026-06-08',
			dueReason: 'interval'
		});
	});

	it('leaves out plants that are no longer active', () => {
		schedule(aliceHome, fern, watering);
		memorialisePlant(aliceHome, fern, { status: 'died', statusOn: today }, now);

		expect(listTasks(aliceHome, now)).toEqual([]);
		// The plant's own page still shows its schedules.
		expect(listSchedules(aliceHome, fern, now)).toHaveLength(1);
	});

	it("lists only the home's own tasks, never another's", () => {
		schedule(aliceHome, fern, watering);
		schedule(bobHome, cactus, { ...watering, intervalDays: '30' });

		expect(listTasks(aliceHome, now).map((task) => task.plantName)).toEqual(['Fern']);
		expect(listTasks(bobHome, now).map((task) => task.plantName)).toEqual(['Cactus']);
	});
});

describe('getSchedule', () => {
	it("knows nothing of another home's schedule", () => {
		const added = schedule(aliceHome, fern, watering);

		expect(getSchedule(aliceHome, fern, added.id)).toEqual(added);
		expect(getSchedule(bobHome, fern, added.id)).toBeNull();
		expect(getSchedule(bobHome, cactus, added.id)).toBeNull();
	});
});

describe('updateSchedule', () => {
	it('changes the interval and recheck delay, and the due date follows', () => {
		const added = schedule(aliceHome, fern, watering);

		expect(updateSchedule(aliceHome, fern, added.id, { intervalDays: '3', recheckDays: '1' })).toBe(
			true
		);

		expect(fernWatering()).toMatchObject({ intervalDays: 3, recheckDays: 1, due: '2026-06-18' });
	});

	it("can't change another home's schedule", () => {
		const added = schedule(aliceHome, fern, watering);

		const change = { intervalDays: '1', recheckDays: '1' };
		expect(updateSchedule(bobHome, fern, added.id, change)).toBe(false);
		expect(updateSchedule(bobHome, cactus, added.id, change)).toBe(false);

		expect(getSchedule(aliceHome, fern, added.id)).toEqual(added);
	});
});

describe('deleteSchedule', () => {
	it('removes a schedule and keeps the care logged', () => {
		const added = schedule(aliceHome, fern, watering);
		log(aliceHome, alice, fern, { type: 'water' });

		expect(deleteSchedule(aliceHome, fern, added.id)).toBe(true);

		expect(listSchedules(aliceHome, fern, now)).toEqual([]);
		// Adding it again picks up from the care already logged.
		schedule(aliceHome, fern, watering);
		expect(fernWatering()).toMatchObject({ lastDone: now, due: '2026-06-22' });
	});

	it("can't remove another home's schedule", () => {
		const added = schedule(aliceHome, fern, watering);

		expect(deleteSchedule(bobHome, fern, added.id)).toBe(false);
		expect(deleteSchedule(bobHome, cactus, added.id)).toBe(false);

		expect(getSchedule(aliceHome, fern, added.id)).toEqual(added);
	});
});

describe('snoozeTask', () => {
	beforeEach(() => {
		// Added three weeks ago, so watering is two weeks overdue.
		schedule(aliceHome, fern, watering, new Date('2026-05-25T09:00:00Z'));
	});

	it('snoozes for a day or three from today, however overdue the task is', () => {
		expect(snoozeTask(aliceHome, fern, 'water', { days: '1' }, now)).toEqual({
			ok: true,
			until: '2026-06-16'
		});
		expect(fernWatering()).toMatchObject({ due: '2026-06-16', dueReason: 'snoozed', daysAway: 1 });

		expect(snoozeTask(aliceHome, fern, 'water', { days: '3', until: '' }, now)).toEqual({
			ok: true,
			until: '2026-06-18'
		});
	});

	it('snoozes until a chosen date after today, within a year', () => {
		expect(snoozeTask(aliceHome, fern, 'water', { days: '', until: '2026-07-01' }, now)).toEqual({
			ok: true,
			until: '2026-07-01'
		});

		for (const until of [today, '2026-06-01']) {
			expect(snoozeTask(aliceHome, fern, 'water', { until }, now)).toEqual({
				ok: false,
				reason: 'not-after-today'
			});
		}
		expect(snoozeTask(aliceHome, fern, 'water', { until: '2027-06-16' }, now)).toEqual({
			ok: false,
			reason: 'too-far'
		});
		expect(fernWatering().snoozedUntil).toBe('2026-07-01');
	});

	it('refuses a plant in the Memorial, changing nothing', () => {
		memorialisePlant(aliceHome, fern, { status: 'given-away', statusOn: today }, now);

		expect(snoozeTask(aliceHome, fern, 'water', { days: '1' }, now)).toEqual({
			ok: false,
			reason: 'in-the-memorial'
		});
		expect(fernWatering().snoozedUntil).toBeNull();
	});

	it('counts today in the home’s time zone', () => {
		// 23:30 UTC is already the 16th in Paris.
		schedule(bobHome, cactus, watering);
		const lateEvening = new Date('2026-06-15T23:30:00Z');
		expect(snoozeTask(bobHome, cactus, 'water', { days: '1' }, lateEvening)).toEqual({
			ok: true,
			until: '2026-06-17'
		});
	});

	it('explains what is wrong with the input', () => {
		expect(messages(() => snoozeTask(aliceHome, fern, 'water', {}))).toEqual(['Choose a date.']);
		expect(messages(() => snoozeTask(aliceHome, fern, 'water', { days: '2' }))).toEqual([
			'Choose how long to snooze for.'
		]);
		expect(messages(() => snoozeTask(aliceHome, fern, 'water', { until: '2026-06-31' }))).toEqual([
			'Enter a date.'
		]);
	});

	it('refuses a task the plant has no schedule for', () => {
		expect(snoozeTask(aliceHome, fern, 'feed', { days: '1' }, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});
		expect(snoozeTask(aliceHome, fern, 'move', { days: '1' }, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});
	});

	it("can't snooze another home's task", () => {
		expect(snoozeTask(bobHome, fern, 'water', { days: '3' }, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});

		expect(fernWatering().snoozedUntil).toBeNull();
	});
});

describe('cancelSnooze', () => {
	beforeEach(() => {
		schedule(aliceHome, fern, watering, new Date('2026-05-25T09:00:00Z'));
		snoozeTask(aliceHome, fern, 'water', { days: '3' }, now);
	});

	it('ends the snooze, so the task is due as before', () => {
		expect(cancelSnooze(aliceHome, fern, 'water')).toBe(true);

		expect(fernWatering()).toMatchObject({ snoozedUntil: null, due: '2026-06-01' });
	});

	it("can't end a snooze in another home", () => {
		expect(cancelSnooze(bobHome, fern, 'water')).toBe(false);
		expect(cancelSnooze(aliceHome, fern, 'feed')).toBe(false);

		expect(fernWatering().snoozedUntil).toBe('2026-06-18');
	});
});
