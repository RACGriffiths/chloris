import { beforeEach, describe, expect, it } from 'vitest';
import { defaultNotificationSettings, type NotificationSettings } from '../../notifications';
import { logCare } from '../data/care-events';
import { createHome } from '../data/homes';
import {
	claimDigest,
	saveNotificationSettings,
	type NotificationSettingsInput
} from '../data/notifications';
import { createPlant } from '../data/plants';
import { createRoom } from '../data/rooms';
import { createSchedule } from '../data/schedules';
import type { Email, Mailer } from '../notify/mailer';
import { addMember, digestEntry, insertUser, setEmailVerified, useTestDatabase } from '../testing';
import { digestDue, sendDigests } from './digests';

useTestDatabase();

const origin = 'https://plants.example.com';

/** A mailer that keeps what it's given, or refuses while `failing` is set. */
class FakeMailer implements Mailer {
	sent: Email[] = [];
	failing = false;
	send(email: Email): Promise<void> {
		if (this.failing) return Promise.reject(new Error('Connection refused'));
		this.sent.push(email);
		return Promise.resolve();
	}
}

let mailer: FakeMailer;
let alice: string;
let aliceHome: string;
let fern: string;

/** A time on Monday 15 June 2026 in London, which is an hour ahead of UTC in summer. */
const london = (time: string, day = '15') => new Date(`2026-06-${day}T${time}:00+01:00`);

/** A home with a room, a plant in it, and a watering schedule overdue by 3 days on the 15th. */
function setUpHome(owner: string, name: string, timeZone: string, plantName: string) {
	const homeId = createHome(owner, { name, timeZone }).id;
	const room = createRoom(homeId, { name: 'Kitchen' });
	if (!room.ok) throw new Error('Room refused');
	const plant = createPlant(homeId, { nickname: plantName, roomId: room.room.id });
	if (!plant) throw new Error('Plant refused');
	const schedule = createSchedule(
		homeId,
		plant.id,
		{ task: 'water', intervalDays: '7', recheckDays: '2' },
		new Date('2026-06-05T12:00:00Z')
	);
	if (!schedule.ok) throw new Error('Schedule refused');
	return { homeId, plantId: plant.id };
}

const run = (now: Date) => sendDigests({ mailer, origin }, now);

const choose = (homeId: string, userId: string, fields: Partial<NotificationSettingsInput>) =>
	saveNotificationSettings(homeId, userId, {
		channel: 'email',
		digestTime: '08:00',
		quietHours: 'on',
		quietStart: '22:00',
		quietEnd: '07:00',
		...fields
	});

beforeEach(() => {
	mailer = new FakeMailer();
	alice = insertUser('alice@example.com', { canCreateHome: true });
	({ homeId: aliceHome, plantId: fern } = setUpHome(
		alice,
		"Alice's flat",
		'Europe/London',
		'Fern'
	));
});

describe('digestDue', () => {
	const settings = defaultNotificationSettings(true);

	it('is due from the chosen time, in the time zone given', () => {
		expect(digestDue(settings, london('07:59'), 'Europe/London')).toBe(false);
		expect(digestDue(settings, london('08:00'), 'Europe/London')).toBe(true);
		expect(digestDue(settings, london('15:30'), 'Europe/London')).toBe(true);
		// 08:00 in London is 03:00 in New York.
		expect(digestDue(settings, london('08:00'), 'America/New_York')).toBe(false);
		expect(digestDue(settings, london('13:00'), 'America/New_York')).toBe(true);
	});

	it('is never due in quiet hours, or when off', () => {
		expect(digestDue(settings, london('21:59'), 'Europe/London')).toBe(true);
		expect(digestDue(settings, london('22:00'), 'Europe/London')).toBe(false);
		const off: NotificationSettings = { ...settings, channel: null };
		expect(digestDue(off, london('08:00'), 'Europe/London')).toBe(false);
		const noQuiet: NotificationSettings = { ...settings, quietStart: null, quietEnd: null };
		expect(digestDue(noQuiet, london('23:30'), 'Europe/London')).toBe(true);
	});
});

describe('sendDigests', () => {
	it('emails what is due at the chosen time, and logs it', async () => {
		expect(await run(london('07:55'))).toEqual({ sent: 0, nothingDue: 0, failed: 0 });
		expect(mailer.sent).toEqual([]);

		expect(await run(london('08:00'))).toEqual({ sent: 1, nothingDue: 0, failed: 0 });
		expect(mailer.sent).toHaveLength(1);
		const [email] = mailer.sent;
		expect(email.to).toBe('alice@example.com');
		expect(email.subject).toBe("Alice's flat: 1 plant task for today");
		expect(email.text).toContain('Water, overdue by 3 days');
		expect(email.text).toContain(`${origin}/plants/${fern}`);
		expect(digestEntry(aliceHome, alice, '2026-06-15')).toMatchObject({
			channel: 'email',
			taskCount: 1
		});
		expect(digestEntry(aliceHome, alice, '2026-06-15')?.sentAt).toBeInstanceOf(Date);
	});

	it("doesn't send a day's digest twice, even after a restart", async () => {
		await run(london('08:00'));
		expect(await run(london('08:05'))).toEqual({ sent: 0, nothingDue: 0, failed: 0 });
		expect(await run(london('18:00'))).toEqual({ sent: 0, nothingDue: 0, failed: 0 });
		expect(mailer.sent).toHaveLength(1);

		// The next day brings the next digest.
		await run(london('08:00', '16'));
		expect(mailer.sent).toHaveLength(2);
	});

	it('sends nothing, and nothing more that day, when nothing is due', async () => {
		logCare(aliceHome, alice, fern, { type: 'water' }, london('07:30'));

		expect(await run(london('08:00'))).toEqual({ sent: 0, nothingDue: 1, failed: 0 });
		expect(digestEntry(aliceHome, alice, '2026-06-15')).toEqual({
			channel: 'email',
			taskCount: 0,
			sentAt: null
		});

		// Due again from now on, but the day's digest has been decided.
		createSchedule(
			aliceHome,
			fern,
			{ task: 'mist', intervalDays: '1', recheckDays: '1' },
			london('07:00', '14')
		);
		expect(await run(london('08:05'))).toEqual({ sent: 0, nothingDue: 0, failed: 0 });
		expect(mailer.sent).toEqual([]);
	});

	it('leaves out care someone has just logged', async () => {
		const ivy = createPlant(aliceHome, {
			nickname: 'Ivy',
			roomId: createRoomId(aliceHome, 'Hall')
		});
		if (!ivy) throw new Error('Plant refused');
		createSchedule(
			aliceHome,
			ivy.id,
			{ task: 'water', intervalDays: '7', recheckDays: '2' },
			new Date('2026-06-05T12:00:00Z')
		);
		logCare(aliceHome, alice, fern, { type: 'water' }, london('07:59'));

		await run(london('08:00'));

		expect(mailer.sent[0].text).toContain('Ivy');
		expect(mailer.sent[0].text).not.toContain('Fern');
	});

	it('goes later the same day if the server missed the time, but not in quiet hours', async () => {
		expect(await run(london('22:10'))).toEqual({ sent: 0, nothingDue: 0, failed: 0 });
		expect(await run(london('06:55', '16'))).toEqual({ sent: 0, nothingDue: 0, failed: 0 });
		expect(await run(london('11:20', '16'))).toEqual({ sent: 1, nothingDue: 0, failed: 0 });
		expect(digestEntry(aliceHome, alice, '2026-06-15')).toBeUndefined();
		expect(digestEntry(aliceHome, alice, '2026-06-16')?.taskCount).toBe(1);
	});

	it("follows each home's time zone", async () => {
		const bob = insertUser('bob@example.com', { canCreateHome: true });
		const bobs = setUpHome(bob, "Bob's house", 'America/New_York', 'Cactus');

		await run(london('08:00'));
		expect(mailer.sent.map((email) => email.to)).toEqual(['alice@example.com']);

		// 08:00 in New York, still the 15th there.
		await run(new Date('2026-06-15T12:00:00Z'));
		expect(mailer.sent.map((email) => email.to)).toEqual(['alice@example.com', 'bob@example.com']);
		expect(digestEntry(bobs.homeId, bob, '2026-06-15')?.taskCount).toBe(1);
	});

	it("lists only each person's own home", async () => {
		const bob = insertUser('bob@example.com', { canCreateHome: true });
		setUpHome(bob, "Bob's house", 'Europe/London', 'Cactus');

		await run(london('08:00'));

		const byRecipient = Object.fromEntries(mailer.sent.map((email) => [email.to, email.text]));
		expect(byRecipient['alice@example.com']).toContain('Fern');
		expect(byRecipient['alice@example.com']).not.toContain('Cactus');
		expect(byRecipient['bob@example.com']).toContain('Cactus');
		expect(byRecipient['bob@example.com']).not.toContain('Fern');
	});

	it("follows the person's chosen time and quiet hours", async () => {
		choose(aliceHome, alice, { digestTime: '18:30', quietStart: '23:00', quietEnd: '06:00' });

		await run(london('08:00'));
		expect(mailer.sent).toEqual([]);
		await run(london('18:30'));
		expect(mailer.sent).toHaveLength(1);
		expect(mailer.sent[0].text).toContain('You get this email at 18:30');
	});

	it('sends nothing to someone who turned it off', async () => {
		choose(aliceHome, alice, { channel: 'off' });

		expect(await run(london('09:00'))).toEqual({ sent: 0, nothingDue: 0, failed: 0 });
		expect(digestEntry(aliceHome, alice, '2026-06-15')).toBeUndefined();
	});

	it('is off for viewers until they choose it', async () => {
		const carol = insertUser('carol@example.com');
		addMember(aliceHome, carol, 'viewer');

		await run(london('08:00'));
		expect(mailer.sent.map((email) => email.to)).toEqual(['alice@example.com']);

		choose(aliceHome, carol, { digestTime: '09:00' });
		await run(london('09:00'));
		expect(mailer.sent.map((email) => email.to)).toEqual([
			'alice@example.com',
			'carol@example.com'
		]);
	});

	it('goes only to a confirmed address', async () => {
		setEmailVerified(alice, false);
		expect(await run(london('08:00'))).toEqual({ sent: 0, nothingDue: 0, failed: 0 });

		setEmailVerified(alice, true);
		expect(await run(london('08:05'))).toEqual({ sent: 1, nothingDue: 0, failed: 0 });
	});

	it('stops when a membership expires', async () => {
		const sitter = insertUser('sitter@example.com');
		addMember(aliceHome, sitter, 'sitter', { expiresAt: london('12:00') });

		await run(london('08:00'));
		expect(mailer.sent.map((email) => email.to)).toEqual([
			'alice@example.com',
			'sitter@example.com'
		]);

		await run(london('08:00', '16'));
		expect(mailer.sent.map((email) => email.to).slice(2)).toEqual(['alice@example.com']);
	});

	it('tries again on the next run when the mail server refuses', async () => {
		mailer.failing = true;
		expect(await run(london('08:00'))).toEqual({ sent: 0, nothingDue: 0, failed: 1 });
		expect(digestEntry(aliceHome, alice, '2026-06-15')).toBeUndefined();

		mailer.failing = false;
		expect(await run(london('08:05'))).toEqual({ sent: 1, nothingDue: 0, failed: 0 });
	});

	it('never resends one that was being sent when the server stopped', async () => {
		// As if the process stopped after logging the digest but before the mail server answered.
		claimDigest(
			aliceHome,
			alice,
			{ date: '2026-06-15', channel: 'email', taskCount: 1 },
			london('08:00')
		);

		expect(await run(london('08:05'))).toEqual({ sent: 0, nothingDue: 0, failed: 0 });
		expect(mailer.sent).toEqual([]);
	});
});

function createRoomId(homeId: string, name: string): string {
	const room = createRoom(homeId, { name });
	if (!room.ok) throw new Error('Room refused');
	return room.room.id;
}
