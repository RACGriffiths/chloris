import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertUser, testJpeg, useTestDatabase } from '../testing';
import {
	listCareEvents,
	listCareToday,
	logCare,
	logCareWithPhoto,
	logDueTasks,
	undoCare,
	undoCareEvents,
	type CareEvent,
	type CareInput,
	type DueCareInput
} from './care-events';
import { createHome } from './homes';
import { deletePhoto, getPhoto, listPhotos } from './photos';
import { createPlant, memorialisePlant } from './plants';
import { createRoom } from './rooms';
import { createSchedule, listSchedules, snoozeTask } from './schedules';

const folders = useTestDatabase();

/** Two homes, each with an owner and a plant. Alice's is in London, Bob's in Paris. */
let alice: string;
let bob: string;
let aliceHome: string;
let bobHome: string;
let fern: string;
let cactus: string;

/** 10:00 in London (BST) on a Monday. */
const now = new Date('2026-06-15T09:00:00Z');

beforeEach(() => {
	alice = insertUser('alice@example.com', { canCreateHome: true });
	bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
	fern = addPlant(aliceHome, 'Fern');
	cactus = addPlant(bobHome, 'Cactus');
});

function addPlant(homeId: string, nickname: string): string {
	const room = createRoom(homeId, { name: `${nickname}'s room` });
	if (!room.ok) throw new Error('Room refused');
	const plant = createPlant(homeId, { nickname, roomId: room.room.id });
	if (!plant) throw new Error('Plant refused');
	return plant.id;
}

/** Waters a plant every 7 days from 1 June, so it's a week overdue on 15 June. */
function waterWeekly(homeId: string, plantId: string) {
	const added = new Date('2026-06-01T09:00:00Z');
	createSchedule(homeId, plantId, { task: 'water', intervalDays: '7', recheckDays: '2' }, added);
}

const due = (homeId: string, plantId: string) => listSchedules(homeId, plantId, now)[0];

/** Logs a due task that must be accepted. */
function logDue(homeId: string, userId: string, input: DueCareInput) {
	const result = logDueTasks(homeId, userId, input, now);
	if (!result.ok) throw new Error(`Care refused: ${result.reason}`);
	return result;
}

/** Logs care that must be accepted. */
function log(homeId: string, userId: string, plantId: string, input: CareInput, at = now) {
	const result = logCare(homeId, userId, plantId, input, at);
	if (!result.ok) throw new Error(`Care refused: ${result.reason}`);
	return result.event;
}

/**
 * A plant's care history, each event as `logCare` gave it. Only care logged with a photo has a
 * `photoId`, so it's checked and left out.
 */
const history = (homeId: string, plantId: string) =>
	listCareEvents(homeId, plantId).events.map(({ photoId, ...event }) => {
		expect(photoId).toBeNull();
		return event;
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

describe('logCare', () => {
	it('logs care now, with who did it and a tidied note', () => {
		const event = log(aliceHome, alice, fern, { type: 'water', note: '  Soaked it.  ' });

		expect(event).toEqual<CareEvent>({
			id: event.id,
			plantId: fern,
			type: 'water',
			checkedTask: null,
			doneAt: now,
			note: 'Soaked it.',
			userId: alice,
			userName: 'alice'
		});
		expect(history(aliceHome, fern)).toEqual([event]);
	});

	it('backdates care to a time read in the home’s time zone', () => {
		const event = log(aliceHome, alice, fern, { type: 'feed', doneAt: '2026-06-13T18:30' });
		// 18:30 BST is 17:30 UTC.
		expect(event.doneAt).toEqual(new Date('2026-06-13T17:30:00Z'));

		const parisEvent = log(bobHome, bob, cactus, { type: 'feed', doneAt: '2026-06-13T18:30' });
		expect(parisEvent.doneAt).toEqual(new Date('2026-06-13T16:30:00Z'));
	});

	it('refuses care in the future, allowing for a phone clock a few minutes fast', () => {
		expect(
			logCare(aliceHome, alice, fern, { type: 'water', doneAt: '2026-06-15T10:30' }, now)
		).toEqual({ ok: false, reason: 'in-the-future' });
		expect(history(aliceHome, fern)).toEqual([]);

		expect(
			logCare(aliceHome, alice, fern, { type: 'water', doneAt: '2026-06-15T10:04' }, now)
		).toMatchObject({ ok: true });
	});

	it('refuses a plant in the Memorial, but still undoes care logged before', () => {
		const event = log(aliceHome, alice, fern, { type: 'water' });
		memorialisePlant(aliceHome, fern, { status: 'died', statusOn: '2026-06-15' }, now);

		expect(logCare(aliceHome, alice, fern, { type: 'water' }, now)).toEqual({
			ok: false,
			reason: 'in-the-memorial'
		});
		expect(history(aliceHome, fern)).toEqual([event]);

		expect(undoCare(aliceHome, alice, fern, event.id)).toMatchObject({ ok: true });
		expect(history(aliceHome, fern)).toEqual([]);
	});

	it('records which task a check was for, and only for a check', () => {
		const check = log(aliceHome, alice, fern, { type: 'checked', checkedTask: 'water' });
		expect(check).toMatchObject({ type: 'checked', checkedTask: 'water' });

		const water = log(aliceHome, alice, fern, { type: 'water', checkedTask: 'feed' });
		expect(water.checkedTask).toBeNull();
	});

	it('explains what is wrong with the input', () => {
		expect(messages(() => logCare(aliceHome, alice, fern, { type: 'dance' }))).toEqual([
			'Choose what you did.'
		]);
		expect(messages(() => logCare(aliceHome, alice, fern, { type: 'checked' }))).toEqual([
			'Choose the task you checked.'
		]);
		expect(
			messages(() => logCare(aliceHome, alice, fern, { type: 'water', doneAt: '2026-02-30T10:00' }))
		).toEqual(['Enter a date and time.']);
		expect(
			messages(() => logCare(aliceHome, alice, fern, { type: 'water', note: 'x'.repeat(501) }))
		).toEqual(['Keep the note to 500 characters or fewer.']);
	});

	it('ends a snooze on the task done or checked, and no other', () => {
		createSchedule(aliceHome, fern, { task: 'water', intervalDays: '7', recheckDays: '2' }, now);
		createSchedule(aliceHome, fern, { task: 'feed', intervalDays: '30', recheckDays: '2' }, now);
		snoozeTask(aliceHome, fern, 'water', { until: '2026-07-01' }, now);
		snoozeTask(aliceHome, fern, 'feed', { until: '2026-08-01' }, now);

		log(aliceHome, alice, fern, { type: 'checked', checkedTask: 'water' });

		const [water, feed] = listSchedules(aliceHome, fern, now);
		expect(water.snoozedUntil).toBeNull();
		expect(feed.snoozedUntil).toBe('2026-08-01');
	});

	it("won't log care on another home's plant", () => {
		expect(logCare(bobHome, bob, fern, { type: 'water' }, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});

		expect(history(aliceHome, fern)).toEqual([]);
		expect(history(bobHome, fern)).toEqual([]);
	});

	it("doesn't end a snooze in another home", () => {
		createSchedule(aliceHome, fern, { task: 'water', intervalDays: '7', recheckDays: '2' }, now);
		snoozeTask(aliceHome, fern, 'water', { until: '2026-07-01' }, now);

		logCare(bobHome, bob, fern, { type: 'water' }, now);

		expect(listSchedules(aliceHome, fern, now)[0].snoozedUntil).toBe('2026-07-01');
	});
});

describe('listCareEvents', () => {
	it('lists the latest first, by when the care was done rather than logged', () => {
		const today = log(aliceHome, alice, fern, { type: 'water' });
		const lastWeek = log(aliceHome, alice, fern, { type: 'feed', doneAt: '2026-06-08T09:00' });
		const yesterday = log(aliceHome, alice, fern, { type: 'mist', doneAt: '2026-06-14T09:00' });

		expect(history(aliceHome, fern)).toEqual([today, yesterday, lastWeek]);
	});

	it('gives at most the number asked for, and says when there are more', () => {
		for (const day of ['10', '11', '12']) {
			log(aliceHome, alice, fern, { type: 'mist', doneAt: `2026-06-${day}T09:00` });
		}

		const first = listCareEvents(aliceHome, fern, 2);
		expect(first.events.map((event) => event.doneAt.getUTCDate())).toEqual([12, 11]);
		expect(first.more).toBe(true);
		expect(listCareEvents(aliceHome, fern, 3).more).toBe(false);
	});

	it("lists only the home's own care, never another's", () => {
		const watered = log(aliceHome, alice, fern, { type: 'water' });
		const fed = log(bobHome, bob, cactus, { type: 'feed' });

		expect(history(aliceHome, fern)).toEqual([watered]);
		expect(history(bobHome, cactus)).toEqual([fed]);
		expect(history(bobHome, fern)).toEqual([]);
		expect(history(aliceHome, cactus)).toEqual([]);
	});
});

describe('undoCare', () => {
	it('removes care the person logged, and the due date goes back', () => {
		createSchedule(aliceHome, fern, { task: 'water', intervalDays: '7', recheckDays: '2' }, now);
		const before = listSchedules(aliceHome, fern, now)[0].due;
		const event = log(aliceHome, alice, fern, { type: 'water', doneAt: '2026-06-15T09:00' });
		expect(listSchedules(aliceHome, fern, now)[0].due).toBe('2026-06-22');

		expect(undoCare(aliceHome, alice, fern, event.id)).toEqual({ ok: true, event });

		expect(history(aliceHome, fern)).toEqual([]);
		expect(listSchedules(aliceHome, fern, now)[0].due).toBe(before);
	});

	it("won't remove care someone else in the home logged", () => {
		const carer = insertUser('carol@example.com');
		const event = log(aliceHome, carer, fern, { type: 'water' });

		expect(undoCare(aliceHome, alice, fern, event.id)).toEqual({ ok: false, reason: 'not-yours' });
		expect(history(aliceHome, fern)).toEqual([event]);
	});

	it('says when the care has already gone', () => {
		const event = log(aliceHome, alice, fern, { type: 'water' });
		undoCare(aliceHome, alice, fern, event.id);

		expect(undoCare(aliceHome, alice, fern, event.id)).toEqual({ ok: false, reason: 'not-found' });
	});

	it("can't remove another home's care, even with its plant's id", () => {
		const event = log(aliceHome, alice, fern, { type: 'water' });

		expect(undoCare(bobHome, alice, fern, event.id)).toEqual({ ok: false, reason: 'not-found' });
		expect(undoCare(bobHome, bob, cactus, event.id)).toEqual({ ok: false, reason: 'not-found' });

		expect(history(aliceHome, fern)).toEqual([event]);
	});
});

describe('logDueTasks', () => {
	let ivy: string;
	beforeEach(() => {
		ivy = addPlant(aliceHome, 'Ivy');
		waterWeekly(aliceHome, fern);
		waterWeekly(aliceHome, ivy);
	});

	it('logs the task on each plant it is due on, by name, and the due dates move on', () => {
		const result = logDue(aliceHome, alice, {
			task: 'water',
			outcome: 'done',
			plantIds: [ivy, fern]
		});

		expect(result.notDue).toEqual([]);
		expect(result.logged.map((task) => [task.plantId, task.plantName])).toEqual([
			[fern, 'Fern'],
			[ivy, 'Ivy']
		]);
		expect(history(aliceHome, fern)).toMatchObject([
			{ id: result.logged[0].eventId, type: 'water', doneAt: now, userId: alice }
		]);
		expect(due(aliceHome, fern)).toMatchObject({ due: '2026-06-22', daysAway: 7 });
		expect(due(aliceHome, ivy)).toMatchObject({ due: '2026-06-22', daysAway: 7 });
	});

	it('records "not needed" as a check, which puts the task off by the recheck delay', () => {
		logDue(aliceHome, alice, { task: 'water', outcome: 'not-needed', plantIds: [fern] });

		expect(history(aliceHome, fern)).toMatchObject([{ type: 'checked', checkedTask: 'water' }]);
		expect(due(aliceHome, fern)).toMatchObject({ dueReason: 'checked', daysAway: 2 });
		expect(history(aliceHome, ivy)).toEqual([]);
	});

	it("leaves alone a plant whose task isn't due any more, so it isn't done twice", () => {
		const carer = insertUser('carol@example.com');
		log(aliceHome, carer, fern, { type: 'water' });

		const result = logDue(aliceHome, alice, {
			task: 'water',
			outcome: 'done',
			plantIds: [fern, ivy]
		});

		expect(result.logged.map((task) => task.plantName)).toEqual(['Ivy']);
		expect(result.notDue).toEqual([{ plantId: fern, plantName: 'Fern' }]);
		expect(history(aliceHome, fern)).toHaveLength(1);
	});

	it('logs a task due today because of a snooze, and ends the snooze', () => {
		snoozeTask(aliceHome, fern, 'water', { days: '1' }, now);
		const tomorrow = new Date('2026-06-16T09:00:00Z');
		expect(listSchedules(aliceHome, fern, tomorrow)[0]).toMatchObject({ daysAway: 0 });

		const result = logDueTasks(
			aliceHome,
			alice,
			{ task: 'water', outcome: 'done', plantIds: [fern] },
			tomorrow
		);

		expect(result).toMatchObject({ ok: true, notDue: [] });
		expect(listSchedules(aliceHome, fern, tomorrow)[0]).toMatchObject({
			snoozedUntil: null,
			due: '2026-06-23'
		});
	});

	it('ignores plants without that task or no longer active, and repeated plants', () => {
		const basil = addPlant(aliceHome, 'Basil');
		memorialisePlant(aliceHome, ivy, { status: 'given-away', statusOn: '2026-06-15' }, now);

		const result = logDue(aliceHome, alice, {
			task: 'water',
			outcome: 'done',
			plantIds: [fern, fern, basil, ivy]
		});

		expect(result.logged.map((task) => task.plantName)).toEqual(['Fern']);
		expect(history(aliceHome, fern)).toHaveLength(1);
		expect(history(aliceHome, basil)).toEqual([]);
		expect(history(aliceHome, ivy)).toEqual([]);
		expect(
			logDueTasks(aliceHome, alice, { task: 'feed', outcome: 'done', plantIds: [fern] }, now)
		).toEqual({ ok: false, reason: 'not-found' });
	});

	it('explains what is wrong with the input', () => {
		const input = { task: 'water', outcome: 'done', plantIds: [fern] };
		expect(messages(() => logDueTasks(aliceHome, alice, { ...input, task: 'move' }))).toEqual([
			'Choose a task.'
		]);
		expect(messages(() => logDueTasks(aliceHome, alice, { ...input, outcome: '' }))).toEqual([
			'Choose done or not needed.'
		]);
		expect(messages(() => logDueTasks(aliceHome, alice, { ...input, plantIds: [] }))).toEqual([
			'Choose a plant.'
		]);
		expect(
			messages(() =>
				logDueTasks(aliceHome, alice, { ...input, plantIds: Array<string>(501).fill(fern) })
			)
		).toEqual(['Choose 500 plants or fewer.']);
	});

	it("won't log care on another home's plants, even mixed with its own", () => {
		waterWeekly(bobHome, cactus);

		expect(
			logDueTasks(bobHome, bob, { task: 'water', outcome: 'done', plantIds: [fern, ivy] }, now)
		).toEqual({ ok: false, reason: 'not-found' });
		const mixed = logDue(bobHome, bob, {
			task: 'water',
			outcome: 'done',
			plantIds: [fern, cactus]
		});

		expect(mixed.logged.map((task) => task.plantName)).toEqual(['Cactus']);
		expect(history(aliceHome, fern)).toEqual([]);
		expect(history(aliceHome, ivy)).toEqual([]);
		expect(history(bobHome, fern)).toEqual([]);
	});
});

describe('listCareToday', () => {
	it("lists the day's care in the home's time zone, latest first, by anyone", () => {
		const carer = insertUser('carol@example.com');
		const ivy = addPlant(aliceHome, 'Ivy');
		// 00:30 BST on the 15th is still the 14th in UTC.
		const early = log(aliceHome, carer, ivy, { type: 'mist', doneAt: '2026-06-15T00:30' });
		const watered = log(aliceHome, alice, fern, { type: 'water' });
		// Logged today, but done yesterday.
		log(aliceHome, alice, fern, { type: 'feed', doneAt: '2026-06-14T23:59' });

		expect(listCareToday(aliceHome, now)).toEqual([
			{ ...watered, plantName: 'Fern' },
			{ ...early, plantName: 'Ivy' }
		]);
		// By midnight in Paris, the 15th has ended there, but not yet in London.
		expect(listCareToday(aliceHome, new Date('2026-06-15T22:30:00Z'))).toHaveLength(2);
		expect(listCareToday(aliceHome, new Date('2026-06-16T00:00:00Z'))).toEqual([]);
	});

	it('leaves out plants that are no longer active', () => {
		log(aliceHome, alice, fern, { type: 'water' });
		memorialisePlant(aliceHome, fern, { status: 'died', statusOn: '2026-06-15' }, now);

		expect(listCareToday(aliceHome, now)).toEqual([]);
	});

	it("lists only the home's own care, never another's", () => {
		const watered = log(aliceHome, alice, fern, { type: 'water' });
		const fed = log(bobHome, bob, cactus, { type: 'feed' });

		expect(listCareToday(aliceHome, now)).toEqual([{ ...watered, plantName: 'Fern' }]);
		expect(listCareToday(bobHome, now)).toEqual([{ ...fed, plantName: 'Cactus' }]);
	});
});

describe('undoCareEvents', () => {
	it('removes several events the person logged, and the due dates go back', () => {
		const ivy = addPlant(aliceHome, 'Ivy');
		waterWeekly(aliceHome, fern);
		waterWeekly(aliceHome, ivy);
		const { logged } = logDue(aliceHome, alice, {
			task: 'water',
			outcome: 'done',
			plantIds: [fern, ivy]
		});

		const result = undoCareEvents(
			aliceHome,
			alice,
			logged.map((task) => task.eventId)
		);

		expect(result).toMatchObject({
			ok: true,
			events: [
				{ plantName: 'Fern', type: 'water' },
				{ plantName: 'Ivy', type: 'water' }
			]
		});
		expect(history(aliceHome, fern)).toEqual([]);
		expect(due(aliceHome, fern)).toMatchObject({ due: '2026-06-08', daysAway: -7 });
		expect(due(aliceHome, ivy)).toMatchObject({ due: '2026-06-08', daysAway: -7 });
	});

	it('removes none if any was logged by someone else in the home', () => {
		const carer = insertUser('carol@example.com');
		const mine = log(aliceHome, alice, fern, { type: 'water' });
		const theirs = log(aliceHome, carer, fern, { type: 'mist' });

		expect(undoCareEvents(aliceHome, alice, [mine.id, theirs.id])).toEqual({
			ok: false,
			reason: 'not-yours'
		});
		expect(history(aliceHome, fern)).toHaveLength(2);
	});

	it('skips events already removed, and says when all of them have gone', () => {
		const watered = log(aliceHome, alice, fern, { type: 'water' });
		const misted = log(aliceHome, alice, fern, { type: 'mist' });
		undoCare(aliceHome, alice, fern, watered.id);

		expect(undoCareEvents(aliceHome, alice, [watered.id, misted.id])).toMatchObject({
			ok: true,
			events: [{ id: misted.id }]
		});
		expect(undoCareEvents(aliceHome, alice, [watered.id, misted.id])).toEqual({
			ok: false,
			reason: 'not-found'
		});
		expect(undoCareEvents(aliceHome, alice, [])).toEqual({ ok: false, reason: 'not-found' });
	});

	it("can't remove another home's care", () => {
		const watered = log(aliceHome, alice, fern, { type: 'water' });

		expect(undoCareEvents(bobHome, alice, [watered.id])).toEqual({
			ok: false,
			reason: 'not-found'
		});
		expect(undoCareEvents(bobHome, bob, [watered.id])).toEqual({ ok: false, reason: 'not-found' });

		expect(history(aliceHome, fern)).toEqual([watered]);
	});
});

describe('logCareWithPhoto', () => {
	let jpeg: Buffer;

	beforeEach(async () => {
		jpeg = await testJpeg();
	});

	/** Logs care with a photo that must be accepted. */
	async function logWithPhoto(input: CareInput & { takenAt?: string }) {
		const result = await logCareWithPhoto(aliceHome, alice, fern, input, jpeg, now);
		if (!result.ok) throw new Error(`Care refused: ${result.reason}`);
		return result;
	}

	/** Every file in the photo folder. */
	const filesOnDisk = () =>
		fs
			.readdirSync(folders.photosDir, { recursive: true, encoding: 'utf8' })
			.filter((name) => fs.statSync(path.join(folders.photosDir, name)).isFile());

	it('logs the care and adds the photo to the timeline together', async () => {
		const { event, photoId } = await logWithPhoto({ type: 'repot', note: 'Bigger pot' });

		expect(event).toMatchObject({ type: 'repot', note: 'Bigger pot', doneAt: now, userId: alice });
		expect(listCareEvents(aliceHome, fern).events).toEqual([{ ...event, photoId }]);
		expect(listPhotos(aliceHome, fern)).toMatchObject([{ id: photoId, takenAt: now }]);
		expect(getPhoto(aliceHome, fern, photoId)?.care).toEqual({
			type: 'repot',
			checkedTask: null,
			doneAt: now
		});
	});

	it('refuses a plant in the Memorial, keeping neither the care nor the photo', async () => {
		memorialisePlant(aliceHome, fern, { status: 'sold', statusOn: '2026-06-15' }, now);

		expect(await logCareWithPhoto(aliceHome, alice, fern, { type: 'repot' }, jpeg, now)).toEqual({
			ok: false,
			reason: 'in-the-memorial'
		});
		expect(listCareEvents(aliceHome, fern).events).toEqual([]);
		expect(listPhotos(aliceHome, fern)).toEqual([]);
		expect(filesOnDisk()).toEqual([]);
	});

	it('dates a photo with no date of its own when the care was done, and others by theirs', async () => {
		const undated = await logWithPhoto({ type: 'prune', doneAt: '2026-06-14T18:00' });
		const dated = await logWithPhoto({
			type: 'water',
			doneAt: '2026-06-14T18:00',
			takenAt: '2026-06-14T17:55:00'
		});

		// 18:00 in London in June is 17:00 UTC; the date the browser read from the photo wins.
		const takenAt = (photoId: string) => getPhoto(aliceHome, fern, photoId)?.takenAt;
		expect(takenAt(undated.photoId)).toEqual(new Date('2026-06-14T17:00:00Z'));
		expect(takenAt(dated.photoId)).toEqual(new Date('2026-06-14T16:55:00Z'));
	});

	it('stores neither when the time is still to come, or the photo is refused', async () => {
		const gif = await sharp(jpeg).gif().toBuffer();

		expect(
			await logCareWithPhoto(
				aliceHome,
				alice,
				fern,
				{ type: 'water', doneAt: '2026-06-15T12:00' },
				jpeg,
				now
			)
		).toEqual({ ok: false, reason: 'in-the-future' });
		expect(await logCareWithPhoto(aliceHome, alice, fern, { type: 'water' }, gif, now)).toEqual({
			ok: false,
			reason: 'unsupported'
		});

		expect(history(aliceHome, fern)).toEqual([]);
		expect(listPhotos(aliceHome, fern)).toEqual([]);
		expect(filesOnDisk()).toEqual([]);
	});

	it("won't log care with a photo on another home's plant, and stores nothing", async () => {
		expect(await logCareWithPhoto(aliceHome, alice, cactus, { type: 'water' }, jpeg, now)).toEqual({
			ok: false,
			reason: 'not-found'
		});

		expect(history(bobHome, cactus)).toEqual([]);
		expect(listPhotos(bobHome, cactus)).toEqual([]);
		expect(filesOnDisk()).toEqual([]);
	});

	it('keeps the photo when the care is undone', async () => {
		const { event, photoId } = await logWithPhoto({ type: 'repot' });

		expect(undoCare(aliceHome, alice, fern, event.id)).toMatchObject({ ok: true });

		expect(listPhotos(aliceHome, fern)).toMatchObject([{ id: photoId }]);
		expect(getPhoto(aliceHome, fern, photoId)?.care).toBeNull();
	});

	it('leaves a deleted photo out of the history, keeping the care', async () => {
		const { event, photoId } = await logWithPhoto({ type: 'repot' });

		deletePhoto(aliceHome, fern, photoId, { userId: alice, anyPhoto: true }, now);

		expect(listCareEvents(aliceHome, fern).events).toEqual([{ ...event, photoId: null }]);
	});
});
