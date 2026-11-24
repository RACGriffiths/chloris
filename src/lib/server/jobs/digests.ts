import { calendarDate, localDateTime } from '../../dates';
import {
	defaultNotificationSettings,
	inQuietHours,
	type NotificationSettings
} from '../../notifications';
import { getHome, listHomeIds } from '../data/homes';
import {
	claimDigest,
	listDigestRecipients,
	recordDigestSent,
	releaseDigest
} from '../data/notifications';
import { listTasks } from '../data/schedules';
import { digestEmail } from '../notify/digest';
import type { Mailer } from '../notify/mailer';
import { can } from '../permissions';

/**
 * Sends the daily digests (docs/spec.md, Reminders and notifications; D48 to D50). The scheduler
 * runs this every few minutes. Each person's digest for a home goes on the first run at or after
 * their chosen time that day, in the home's time zone, outside their quiet hours. It lists what
 * is due when it's put together, and goes only if something is. The digest log is written first,
 * so a restart never sends one twice.
 */

export interface DigestJob {
	/** Sends email; there are no digests without it. */
	mailer: Mailer;
	/** `ORIGIN`, which the email's links start with. */
	origin: string;
}

/** What a run did, for the log and for tests. */
export interface DigestRun {
	/** Digests the mail server accepted. */
	sent: number;
	/** People whose digest was due but had nothing to list, so got none that day. */
	nothingDue: number;
	/** Digests the mail server refused, to be tried again on the next run. */
	failed: number;
}

/**
 * Whether a digest with these settings goes at `now` in `timeZone`: on, past its time that day,
 * and outside quiet hours. A digest that was missed (the server was down) still goes later that
 * day, unless quiet hours have begun.
 */
export function digestDue(settings: NotificationSettings, now: Date, timeZone: string): boolean {
	if (settings.channel === null) return false;
	const time = localDateTime(now, timeZone).slice(11);
	return time >= settings.digestTime && !inQuietHours(time, settings.quietStart, settings.quietEnd);
}

/** Sends the digests that are due at `now` in every home. */
export async function sendDigests(job: DigestJob, now = new Date()): Promise<DigestRun> {
	const run: DigestRun = { sent: 0, nothingDue: 0, failed: 0 };
	for (const homeId of listHomeIds()) {
		try {
			await sendHomeDigests(job, homeId, now, run);
		} catch (error) {
			// One home's problem shouldn't stop the others' digests.
			console.error(`Could not send the daily digests for home ${homeId}:`, error);
		}
	}
	return run;
}

async function sendHomeDigests(
	{ mailer, origin }: DigestJob,
	homeId: string,
	now: Date,
	run: DigestRun
): Promise<void> {
	const home = getHome(homeId);
	if (!home) return;
	const today = calendarDate(now, home.timeZone);

	for (const person of listDigestRecipients(homeId, today, now)) {
		const actor = { id: person.userId };
		const settings =
			person.settings ?? defaultNotificationSettings(can(actor, homeId, 'care:log', now));
		// Only email exists in version 1, and only to an address that has been proven (D50).
		if (settings.channel !== 'email' || !person.emailVerified) continue;
		if (!digestDue(settings, now, home.timeZone)) continue;
		// Checked again just before sending, as for any request (CLAUDE.md rule 2).
		if (!can(actor, homeId, 'home:view', now)) continue;

		// Worked out now, so a task someone has just logged isn't listed.
		const tasks = listTasks(homeId, now).filter((task) => task.daysAway <= 0);
		const digest = { date: today, channel: 'email', taskCount: tasks.length } as const;
		if (!claimDigest(homeId, person.userId, digest, now)) continue;
		if (tasks.length === 0) {
			run.nothingDue++;
			continue;
		}

		try {
			await mailer.send(
				digestEmail({
					to: person.email,
					name: person.name,
					homeName: home.name,
					today,
					digestTime: settings.digestTime,
					tasks,
					origin
				})
			);
		} catch (error) {
			releaseDigest(homeId, person.userId, today);
			run.failed++;
			console.error(`Could not email the daily digest to user ${person.userId}:`, error);
			continue;
		}
		recordDigestSent(homeId, person.userId, today);
		run.sent++;
	}
}
