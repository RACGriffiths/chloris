import { removeExpiredVerifications } from '../auth/verifications';
import { SERVER_LOG_DAYS, removeServerEventsBefore } from '../data/server-log';

/**
 * Removes what belongs to no home and is past keeping (D58): entries in the server's log older
 * than `SERVER_LOG_DAYS`, and BetterAuth's expired verification values. Visitors who aren't
 * signed in can add to both, so neither may grow for ever.
 */

/** What a run removed, for the log and for tests. */
export interface ExpiredRun {
	serverEvents: number;
	verifications: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function removeExpired(now = new Date()): ExpiredRun {
	const run = {
		serverEvents: removeServerEventsBefore(new Date(now.getTime() - SERVER_LOG_DAYS * DAY_MS)),
		verifications: removeExpiredVerifications(now)
	};
	if (run.serverEvents > 0) {
		console.info(
			`Removed ${run.serverEvents} entries from the server's log older than ${SERVER_LOG_DAYS} days.`
		);
	}
	return run;
}
