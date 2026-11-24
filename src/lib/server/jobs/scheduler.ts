import { Cron, scheduledJobs } from 'croner';
import type { Mailer } from '../notify/mailer';
import { sendDigests } from './digests';

/**
 * The app's background jobs, run in its own process by croner (docs/spec.md, Tech stack; D48).
 * Only the daily digest so far, and only when email is on. Removing deleted photos' files after
 * the grace period will join it (D51).
 */

/** Every 5 minutes, on the clock: 08:00, 08:05 and so on. */
export const DIGEST_SCHEDULE = '*/5 * * * *';

/**
 * Names the jobs, so croner keeps them in `scheduledJobs`. That list outlives this module when the
 * development server reloads it, so jobs started before a reload can still be found and stopped.
 */
const JOB_NAMES = ['daily-digests'];

export interface JobsOptions {
	/** `null` when email is off, which switches the digest off. */
	mailer: Mailer | null;
	/** `ORIGIN`, for links in emails. */
	origin: string;
}

/** Starts the background jobs, stopping any already running (the dev server can start twice). */
export function startJobs({ mailer, origin }: JobsOptions): void {
	stopJobs();
	if (mailer) {
		new Cron(
			DIGEST_SCHEDULE,
			{
				name: JOB_NAMES[0],
				// A run that's still waiting on a slow mail server isn't overlapped by the next.
				protect: true,
				// Lets the process exit on shutdown without waiting for the next run.
				unref: true,
				catch: (error) => {
					console.error('The daily digest job failed:', error);
				}
			},
			async () => {
				await sendDigests({ mailer, origin });
			}
		);
	}
}

/** Stops the background jobs. A run already under way finishes on its own. */
export function stopJobs(): void {
	for (const job of scheduledJobs.filter((job) => JOB_NAMES.includes(job.name ?? ''))) {
		job.stop();
	}
}
