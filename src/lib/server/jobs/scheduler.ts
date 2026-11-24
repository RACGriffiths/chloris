import { Cron, scheduledJobs } from 'croner';
import type { Mailer } from '../notify/mailer';
import { sendDigests } from './digests';
import { removeDeletedPhotos } from './photos';

/**
 * The app's background jobs, run in its own process by croner (docs/spec.md, Tech stack): the
 * daily digest, when email is on (D48), and removing deleted photos after the grace period (D54).
 */

/** Every 5 minutes, on the clock: 08:00, 08:05 and so on. */
export const DIGEST_SCHEDULE = '*/5 * * * *';

/** Once an hour, at 17 minutes past, clear of the digest's runs on the hour. */
export const PHOTO_CLEANUP_SCHEDULE = '17 * * * *';

/**
 * Names the jobs, so croner keeps them in `scheduledJobs`. That list outlives this module when the
 * development server reloads it, so jobs started before a reload can still be found and stopped.
 */
const JOB_NAMES = { digests: 'daily-digests', photos: 'photo-cleanup' };

export interface JobsOptions {
	/** `null` when email is off, which switches the digest off. */
	mailer: Mailer | null;
	/** `ORIGIN`, for links in emails. */
	origin: string;
	/** `PHOTO_DELETE_GRACE_DAYS`: how long a deleted photo's files are kept. */
	photoDeleteGraceDays: number;
}

/** Starts the background jobs, stopping any already running (the dev server can start twice). */
export function startJobs({ mailer, origin, photoDeleteGraceDays }: JobsOptions): void {
	stopJobs();
	const options = {
		// A run that's still going (waiting on a slow mail server, say) isn't overlapped by the next.
		protect: true,
		// Lets the process exit on shutdown without waiting for the next run.
		unref: true
	};
	if (mailer) {
		new Cron(
			DIGEST_SCHEDULE,
			{
				...options,
				name: JOB_NAMES.digests,
				catch: (error) => {
					console.error('The daily digest job failed:', error);
				}
			},
			async () => {
				await sendDigests({ mailer, origin });
			}
		);
	}
	new Cron(
		PHOTO_CLEANUP_SCHEDULE,
		{
			...options,
			name: JOB_NAMES.photos,
			catch: (error) => {
				console.error('The job removing deleted photos failed:', error);
			}
		},
		async () => {
			await removeDeletedPhotos(photoDeleteGraceDays);
		}
	);
}

/** Stops the background jobs. A run already under way finishes on its own. */
export function stopJobs(): void {
	const names: string[] = Object.values(JOB_NAMES);
	for (const job of scheduledJobs.filter((job) => names.includes(job.name ?? ''))) {
		job.stop();
	}
}
