import { lt } from 'drizzle-orm';
import { getConnection } from '../db';
import { verification } from '../db/schema';

/**
 * Removes BetterAuth's verification values that have expired, returning how many: sign-in link
 * tokens and passkey challenges no longer of use.
 *
 * BetterAuth removes expired ones itself, but only when it next looks one up. Asking for a passkey
 * challenge stores one without looking any up, and anyone can ask, 60 times a minute from each
 * address (D56), so without this they could pile up while nobody signs in. Removing an expired
 * value changes nothing for anyone: BetterAuth refuses it either way.
 */
export function removeExpiredVerifications(now = new Date()): number {
	return getConnection().db.delete(verification).where(lt(verification.expiresAt, now)).run()
		.changes;
}
