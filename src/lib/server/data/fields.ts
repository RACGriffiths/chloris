import { z } from 'zod';

/** Optional free text: surrounding spaces are trimmed, and an empty value means not given. */
export const optionalText = (max: number, message: string) =>
	z
		.string()
		.trim()
		.max(max, message)
		.optional()
		.transform((value) => value || null);

/** How far ahead of the server's clock a time may be, for a phone whose clock runs a little fast. */
const CLOCK_SLACK_MS = 5 * 60_000;

/**
 * Whether a time someone gave, such as when care was done, is still to come at `now`, allowing
 * for a phone whose clock runs a little fast.
 */
export function stillToCome(instant: Date, now: Date): boolean {
	return instant.getTime() > now.getTime() + CLOCK_SLACK_MS;
}
