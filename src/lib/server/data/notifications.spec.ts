import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { addMember, digestEntry, insertUser, removeMember, useTestDatabase } from '../testing';
import { createHome } from './homes';
import {
	claimDigest,
	getLastDigest,
	getNotificationSettings,
	listDigestRecipients,
	notificationSettingsInput,
	recordDigestSent,
	releaseDigest,
	saveNotificationSettings,
	type NotificationSettingsInput
} from './notifications';

useTestDatabase();

/** Two homes with an owner each. Alice also belongs to Bob's house, as a carer. */
let alice: string;
let bob: string;
let aliceHome: string;
let bobHome: string;

const now = new Date('2026-06-15T09:00:00Z');
const today = '2026-06-15';

beforeEach(() => {
	alice = insertUser('alice@example.com', { canCreateHome: true });
	bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
});

/** The form as the Notifications page sends it, with the defaults filled in. */
const form = (fields: Partial<NotificationSettingsInput> = {}): NotificationSettingsInput => ({
	channel: 'email',
	digestTime: '08:00',
	quietHours: 'on',
	quietStart: '22:00',
	quietEnd: '07:00',
	...fields
});

const messages = (fields: Partial<NotificationSettingsInput>) => {
	const result = notificationSettingsInput.safeParse(form(fields));
	return result.success
		? {}
		: Object.fromEntries(result.error.issues.map((i) => [i.path[0], i.message]));
};

describe('notificationSettingsInput', () => {
	it('accepts the defaults', () => {
		expect(messages({})).toEqual({});
	});

	it('asks for a channel and a time', () => {
		expect(messages({ channel: '', digestTime: '' })).toEqual({
			channel: 'Choose how the digest comes.',
			digestTime: 'Enter a time, such as 08:00.'
		});
		expect(messages({ channel: 'push' })).toEqual({ channel: 'Choose how the digest comes.' });
		expect(messages({ digestTime: '24:00' })).toEqual({
			digestTime: 'Enter a time, such as 08:00.'
		});
	});

	it('wants quiet hours that start and end at different times', () => {
		expect(messages({ quietStart: '', quietEnd: '7' })).toEqual({
			quietStart: 'Enter a time, such as 22:00.',
			quietEnd: 'Enter a time, such as 07:00.'
		});
		expect(messages({ quietStart: '22:00', quietEnd: '22:00' })).toEqual({
			quietEnd: 'Quiet hours need to end at a different time from when they start.'
		});
	});

	it('refuses a digest time inside quiet hours, unless the digest is off', () => {
		const inside =
			"That's in your quiet hours, 22:00 to 07:00. Choose a time outside them, or change them.";
		expect(messages({ digestTime: '06:30' })).toEqual({ digestTime: inside });
		expect(messages({ digestTime: '23:00' })).toEqual({ digestTime: inside });
		expect(messages({ digestTime: '07:00' })).toEqual({});
		expect(messages({ digestTime: '06:30', channel: 'off' })).toEqual({});
		expect(messages({ digestTime: '06:30', quietHours: '' })).toEqual({});
	});

	it('ignores the quiet hours fields while their box is unticked', () => {
		expect(messages({ quietHours: '', quietStart: '', quietEnd: 'nonsense' })).toEqual({});
	});
});

describe('saveNotificationSettings and getNotificationSettings', () => {
	it('has no settings until the person chooses some, then keeps them', () => {
		expect(getNotificationSettings(aliceHome, alice)).toBeNull();

		expect(saveNotificationSettings(aliceHome, alice, form({ digestTime: '7:45' }), now)).toBe(
			true
		);
		expect(getNotificationSettings(aliceHome, alice)).toEqual({
			channel: 'email',
			digestTime: '07:45',
			quietStart: '22:00',
			quietEnd: '07:00'
		});

		expect(
			saveNotificationSettings(aliceHome, alice, form({ channel: 'off', quietHours: '' }), now)
		).toBe(true);
		expect(getNotificationSettings(aliceHome, alice)).toEqual({
			channel: null,
			digestTime: '08:00',
			quietStart: null,
			quietEnd: null
		});
	});

	it('throws on invalid input and saves nothing', () => {
		expect(() => saveNotificationSettings(aliceHome, alice, form({ digestTime: 'soon' }))).toThrow(
			ZodError
		);
		expect(getNotificationSettings(aliceHome, alice)).toBeNull();
	});

	it("keeps a person's settings for each home apart", () => {
		addMember(bobHome, alice, 'carer');
		saveNotificationSettings(aliceHome, alice, form({ digestTime: '07:30' }), now);
		saveNotificationSettings(bobHome, alice, form({ channel: 'off' }), now);

		expect(getNotificationSettings(aliceHome, alice)?.digestTime).toBe('07:30');
		expect(getNotificationSettings(bobHome, alice)?.channel).toBeNull();
		expect(getNotificationSettings(aliceHome, bob)).toBeNull();
	});

	it("won't save settings in a home the person doesn't belong to", () => {
		expect(saveNotificationSettings(bobHome, alice, form(), now)).toBe(false);

		expect(getNotificationSettings(bobHome, alice)).toBeNull();
		expect(getNotificationSettings(aliceHome, alice)).toBeNull();
	});

	it('goes with the membership', () => {
		addMember(bobHome, alice, 'carer');
		saveNotificationSettings(bobHome, alice, form(), now);

		removeMember(bobHome, alice);

		expect(getNotificationSettings(bobHome, alice)).toBeNull();
	});
});

describe('listDigestRecipients', () => {
	it("lists the home's members, longest-standing first, with any settings they chose", () => {
		const carol = insertUser('carol@example.com');
		addMember(aliceHome, carol, 'viewer', { createdAt: new Date('2099-01-01') });
		saveNotificationSettings(aliceHome, carol, form({ channel: 'off' }), now);

		expect(listDigestRecipients(aliceHome, today, now)).toEqual([
			{
				userId: alice,
				name: 'alice',
				email: 'alice@example.com',
				emailVerified: true,
				settings: null
			},
			{
				userId: carol,
				name: 'carol',
				email: 'carol@example.com',
				emailVerified: true,
				settings: { channel: null, digestTime: '08:00', quietStart: '22:00', quietEnd: '07:00' }
			}
		]);
	});

	it('leaves out expired memberships', () => {
		const sitter = insertUser('sitter@example.com');
		addMember(aliceHome, sitter, 'sitter', { expiresAt: new Date('2026-06-15T08:59:00Z') });

		expect(listDigestRecipients(aliceHome, today, now).map((r) => r.userId)).toEqual([alice]);
	});

	it('leaves out those whose digest for the day is already logged', () => {
		claimDigest(aliceHome, alice, { date: today, channel: 'email', taskCount: 0 }, now);

		expect(listDigestRecipients(aliceHome, today, now)).toEqual([]);
		expect(listDigestRecipients(aliceHome, '2026-06-16', now)).toHaveLength(1);
	});

	it("lists only the home's own members, with their settings for that home", () => {
		addMember(bobHome, alice, 'carer');
		saveNotificationSettings(bobHome, alice, form({ channel: 'off' }), now);
		claimDigest(bobHome, bob, { date: today, channel: 'email', taskCount: 2 }, now);

		const inAliceHome = listDigestRecipients(aliceHome, today, now);
		expect(inAliceHome.map((r) => [r.userId, r.settings])).toEqual([[alice, null]]);

		const inBobHome = listDigestRecipients(bobHome, today, now);
		expect(inBobHome.map((r) => [r.userId, r.settings?.channel])).toEqual([[alice, null]]);
	});
});

describe('claimDigest', () => {
	const digest = { date: today, channel: 'email', taskCount: 3 } as const;

	it('logs a day once', () => {
		expect(claimDigest(aliceHome, alice, digest, now)).toBe(true);
		expect(claimDigest(aliceHome, alice, { ...digest, taskCount: 5 }, now)).toBe(false);

		expect(digestEntry(aliceHome, alice, today)).toEqual({
			channel: 'email',
			taskCount: 3,
			sentAt: null
		});
		expect(claimDigest(aliceHome, alice, { ...digest, date: '2026-06-16' }, now)).toBe(true);
	});

	it("can't log a digest in a home the person doesn't belong to", () => {
		expect(claimDigest(bobHome, alice, digest, now)).toBe(false);

		expect(digestEntry(bobHome, alice, today)).toBeUndefined();
	});

	it("keeps each home's log apart", () => {
		addMember(bobHome, alice, 'carer');
		expect(claimDigest(aliceHome, alice, digest, now)).toBe(true);

		expect(claimDigest(bobHome, alice, digest, now)).toBe(true);
		expect(digestEntry(bobHome, bob, today)).toBeUndefined();
	});
});

describe('recordDigestSent', () => {
	const sentAt = new Date('2026-06-15T09:00:02Z');

	it('records when a claimed digest was sent, once', () => {
		claimDigest(aliceHome, alice, { date: today, channel: 'email', taskCount: 3 }, now);

		expect(recordDigestSent(aliceHome, alice, today, sentAt)).toBe(true);
		expect(recordDigestSent(aliceHome, alice, today, new Date())).toBe(false);

		expect(digestEntry(aliceHome, alice, today)?.sentAt).toEqual(sentAt);
	});

	it("can't touch another home's log", () => {
		addMember(bobHome, alice, 'carer');
		claimDigest(aliceHome, alice, { date: today, channel: 'email', taskCount: 3 }, now);

		expect(recordDigestSent(bobHome, alice, today, sentAt)).toBe(false);

		expect(digestEntry(aliceHome, alice, today)?.sentAt).toBeNull();
	});
});

describe('releaseDigest', () => {
	it('removes a digest that was claimed but not sent, so it can be claimed again', () => {
		claimDigest(aliceHome, alice, { date: today, channel: 'email', taskCount: 3 }, now);

		expect(releaseDigest(aliceHome, alice, today)).toBe(true);
		expect(digestEntry(aliceHome, alice, today)).toBeUndefined();
		expect(
			claimDigest(aliceHome, alice, { date: today, channel: 'email', taskCount: 3 }, now)
		).toBe(true);
	});

	it('keeps a digest that was sent', () => {
		claimDigest(aliceHome, alice, { date: today, channel: 'email', taskCount: 3 }, now);
		recordDigestSent(aliceHome, alice, today, now);

		expect(releaseDigest(aliceHome, alice, today)).toBe(false);
		expect(digestEntry(aliceHome, alice, today)?.sentAt).toEqual(now);
	});

	it("can't remove another home's log", () => {
		addMember(bobHome, alice, 'carer');
		claimDigest(aliceHome, alice, { date: today, channel: 'email', taskCount: 3 }, now);

		expect(releaseDigest(bobHome, alice, today)).toBe(false);

		expect(digestEntry(aliceHome, alice, today)).toBeDefined();
	});
});

describe('getLastDigest', () => {
	it('is the latest digest sent, leaving out days when nothing was due', () => {
		expect(getLastDigest(aliceHome, alice)).toBeNull();

		claimDigest(aliceHome, alice, { date: '2026-06-13', channel: 'email', taskCount: 2 }, now);
		recordDigestSent(aliceHome, alice, '2026-06-13', new Date('2026-06-13T07:00:00Z'));
		claimDigest(aliceHome, alice, { date: '2026-06-14', channel: 'email', taskCount: 0 }, now);

		expect(getLastDigest(aliceHome, alice)).toEqual({
			date: '2026-06-13',
			channel: 'email',
			taskCount: 2,
			sentAt: new Date('2026-06-13T07:00:00Z')
		});
	});

	it("knows nothing of another home's digests", () => {
		addMember(bobHome, alice, 'carer');
		claimDigest(aliceHome, alice, { date: today, channel: 'email', taskCount: 2 }, now);
		recordDigestSent(aliceHome, alice, today, now);

		expect(getLastDigest(bobHome, alice)).toBeNull();
		expect(getLastDigest(bobHome, bob)).toBeNull();
	});
});
