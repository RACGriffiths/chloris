import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import {
	inQuietHours,
	parseTimeOfDay,
	type DigestChannel,
	type NotificationSettings
} from '../../notifications';
import { getConnection } from '../db';
import { digestLog, membership, notificationSettings, user } from '../db/schema';
import type { Tx } from './schedules';

/**
 * Each person's daily digest settings for a home, and the log of digests sent (docs/spec.md,
 * Reminders and notifications; D46 to D50).
 *
 * A person reads and changes only their own settings: callers check `can(user, homeId,
 * 'home:view')` and pass the signed-in user's id. The digest job (`#lib/server/jobs/digests`)
 * reads every member's and writes the log. It acts for the home rather than for someone signed
 * in, so it checks `can()` for each person just before sending instead.
 */

/** What the Notifications page offers: email or off. Push comes in version 2. */
export const CHANNEL_CHOICES = ['email', 'off'] as const;

/** A time of day typed into a form, as `HH:MM`. */
const timeOfDay = (message: string) =>
	z.string().transform((value, ctx) => {
		const time = parseTimeOfDay(value);
		if (time) return time;
		ctx.addIssue({ code: 'custom', message });
		return z.NEVER;
	});

/**
 * What a person fills in on the Notifications page. Quiet hours count only when their box is
 * ticked (`quietHours` is `on`). A digest time inside them is refused (D47).
 */
export const notificationSettingsInput = z
	.object({
		channel: z.enum(CHANNEL_CHOICES, 'Choose how the digest comes.'),
		digestTime: timeOfDay('Enter a time, such as 08:00.'),
		quietHours: z.enum(['', 'on']),
		quietStart: z.string(),
		quietEnd: z.string()
	})
	.superRefine((values, ctx) => {
		if (values.quietHours !== 'on') return;
		const start = parseTimeOfDay(values.quietStart);
		const end = parseTimeOfDay(values.quietEnd);
		if (!start) {
			ctx.addIssue({
				code: 'custom',
				path: ['quietStart'],
				message: 'Enter a time, such as 22:00.'
			});
		}
		if (!end) {
			ctx.addIssue({ code: 'custom', path: ['quietEnd'], message: 'Enter a time, such as 07:00.' });
		}
		if (!start || !end) return;
		if (start === end) {
			ctx.addIssue({
				code: 'custom',
				path: ['quietEnd'],
				message: 'Quiet hours need to end at a different time from when they start.'
			});
		} else if (values.channel !== 'off' && inQuietHours(values.digestTime, start, end)) {
			ctx.addIssue({
				code: 'custom',
				path: ['digestTime'],
				message: `That's in your quiet hours, ${start} to ${end}. Choose a time outside them, or change them.`
			});
		}
	});

/** The Notifications page's form as it's sent, before `notificationSettingsInput` checks it. */
export type NotificationSettingsInput = Record<
	keyof z.input<typeof notificationSettingsInput>,
	string
>;

/** Someone in a home who may get its digest, with their settings if they've chosen any. */
export interface DigestRecipient {
	userId: string;
	name: string;
	email: string;
	/** Whether the address has been proven, by using a sign-in link sent to it (D50). */
	emailVerified: boolean;
	/** `null` until they choose; then the defaults apply (D47). */
	settings: NotificationSettings | null;
}

/** A day's digest as the log records it. */
export interface DigestEntry {
	/** The day it was for, `YYYY-MM-DD` in the home's time zone. */
	date: string;
	channel: DigestChannel;
	taskCount: number;
	/** When the mail server accepted it; `null` while sending, or if nothing was due. */
	sentAt: Date | null;
}

const settingsColumns = {
	channel: notificationSettings.channel,
	digestTime: notificationSettings.digestTime,
	quietStart: notificationSettings.quietStart,
	quietEnd: notificationSettings.quietEnd
};

const logColumns = {
	date: digestLog.date,
	channel: digestLog.channel,
	taskCount: digestLog.taskCount,
	sentAt: digestLog.sentAt
};

const settingsOf = (homeId: string, userId: string) =>
	and(eq(notificationSettings.homeId, homeId), eq(notificationSettings.userId, userId));

const logOf = (homeId: string, userId: string, date: string) =>
	and(eq(digestLog.homeId, homeId), eq(digestLog.userId, userId), eq(digestLog.date, date));

/** Whether `userId` has a membership of `homeId`, expired or not. */
function isMember(tx: Tx, homeId: string, userId: string): boolean {
	return !!tx
		.select({ id: membership.id })
		.from(membership)
		.where(and(eq(membership.homeId, homeId), eq(membership.userId, userId)))
		.get();
}

/**
 * A person's digest settings for `homeId`, or `null` if they haven't chosen any, when the
 * defaults apply (`defaultNotificationSettings`). Callers check `can(user, homeId, 'home:view')`
 * first and pass the signed-in user's id.
 */
export function getNotificationSettings(
	homeId: string,
	userId: string
): NotificationSettings | null {
	const row = getConnection()
		.db.select(settingsColumns)
		.from(notificationSettings)
		.where(settingsOf(homeId, userId))
		.get();
	return row ?? null;
}

/**
 * Saves a person's digest settings for `homeId`, returning whether they're a member of it.
 * Without quiet hours ticked, any quiet hours are cleared. Callers check `can(user, homeId,
 * 'home:view')` first and pass the signed-in user's id. Throws a `ZodError` if the input is
 * invalid.
 */
export function saveNotificationSettings(
	homeId: string,
	userId: string,
	input: NotificationSettingsInput,
	now = new Date()
): boolean {
	const values = notificationSettingsInput.parse(input);
	const quiet = values.quietHours === 'on';
	const settings: NotificationSettings = {
		channel: values.channel === 'off' ? null : values.channel,
		digestTime: values.digestTime,
		quietStart: quiet ? parseTimeOfDay(values.quietStart) : null,
		quietEnd: quiet ? parseTimeOfDay(values.quietEnd) : null
	};
	return getConnection().db.transaction((tx) => {
		if (!isMember(tx, homeId, userId)) return false;
		tx.insert(notificationSettings)
			.values({ id: randomUUID(), homeId, userId, ...settings, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: [notificationSettings.homeId, notificationSettings.userId],
				set: { ...settings, updatedAt: now }
			})
			.run();
		return true;
	});
}

/**
 * The members of `homeId` whose membership grants access at `now`, with their settings, who have
 * no digest logged for `date` yet: those the digest job may still send that day's digest to,
 * longest-standing first. For the digest job, which checks `can(user, homeId, 'home:view')` for
 * each before sending.
 */
export function listDigestRecipients(
	homeId: string,
	date: string,
	now = new Date()
): DigestRecipient[] {
	const rows = getConnection()
		.db.select({
			userId: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			settingsId: notificationSettings.id,
			...settingsColumns
		})
		.from(membership)
		.innerJoin(user, eq(user.id, membership.userId))
		.leftJoin(
			notificationSettings,
			and(
				eq(notificationSettings.homeId, membership.homeId),
				eq(notificationSettings.userId, membership.userId)
			)
		)
		.leftJoin(
			digestLog,
			and(
				eq(digestLog.homeId, membership.homeId),
				eq(digestLog.userId, membership.userId),
				eq(digestLog.date, date)
			)
		)
		.where(
			and(
				eq(membership.homeId, homeId),
				or(isNull(membership.expiresAt), gt(membership.expiresAt, now)),
				isNull(digestLog.id)
			)
		)
		.orderBy(asc(membership.createdAt), asc(membership.id))
		.all();

	return rows.map(({ settingsId, channel, digestTime, quietStart, quietEnd, ...person }) => ({
		...person,
		settings:
			settingsId === null || digestTime === null
				? null
				: { channel, digestTime, quietStart, quietEnd }
	}));
}

/**
 * Records that a person's digest for `homeId` on `date` is being sent, with how many tasks it
 * lists, returning `false` if one is already logged for that day or they aren't a member. The
 * digest job calls this before sending, so a restart or a second process never sends it twice
 * (D48). With no tasks, nothing is sent and the day is done.
 */
export function claimDigest(
	homeId: string,
	userId: string,
	digest: { date: string; channel: DigestChannel; taskCount: number },
	now = new Date()
): boolean {
	return getConnection().db.transaction(
		(tx) => {
			if (!isMember(tx, homeId, userId)) return false;
			const { changes } = tx
				.insert(digestLog)
				.values({ id: randomUUID(), homeId, userId, ...digest, createdAt: now })
				.onConflictDoNothing()
				.run();
			return changes > 0;
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Records that the mail server accepted a person's digest for `homeId` on `date`, returning
 * whether one was waiting to be sent. For the digest job.
 */
export function recordDigestSent(
	homeId: string,
	userId: string,
	date: string,
	sentAt = new Date()
): boolean {
	const { changes } = getConnection()
		.db.update(digestLog)
		.set({ sentAt })
		.where(and(logOf(homeId, userId, date), isNull(digestLog.sentAt)))
		.run();
	return changes > 0;
}

/**
 * Removes the log of a person's digest for `homeId` on `date` that couldn't be sent, so the
 * digest job's next run tries again (D48). One already sent stays. Returns whether there was one
 * to remove.
 */
export function releaseDigest(homeId: string, userId: string, date: string): boolean {
	const { changes } = getConnection()
		.db.delete(digestLog)
		.where(and(logOf(homeId, userId, date), isNull(digestLog.sentAt)))
		.run();
	return changes > 0;
}

/**
 * The last digest sent to a person for `homeId`, or `null` if none has been. Callers check
 * `can(user, homeId, 'home:view')` first and pass the signed-in user's id.
 */
export function getLastDigest(homeId: string, userId: string): DigestEntry | null {
	const row = getConnection()
		.db.select(logColumns)
		.from(digestLog)
		.where(
			and(eq(digestLog.homeId, homeId), eq(digestLog.userId, userId), isNotNull(digestLog.sentAt))
		)
		.orderBy(desc(digestLog.sentAt))
		.limit(1)
		.get();
	return row ?? null;
}
