import { eq } from 'drizzle-orm';
import { getConnection } from '../db';
import { passkey, user } from '../db/schema';

/**
 * Reads about accounts that BetterAuth doesn't offer directly. BetterAuth itself creates and
 * changes accounts, so nothing here writes to them. The one exception is an account made from an
 * invite link, which `./invites` creates in the same transaction as its membership.
 */

/** Whether an account exists for `email`. BetterAuth stores emails in lower case. */
export function accountExists(email: string): boolean {
	return Boolean(
		getConnection()
			.db.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email.trim().toLowerCase()))
			.get()
	);
}

/**
 * Whether the command-line tool has allowed this account to create a home (D26). Read from the
 * database rather than the session, so a change takes effect at once.
 */
export function mayCreateHome(userId: string): boolean {
	const row = getConnection()
		.db.select({ canCreateHome: user.canCreateHome })
		.from(user)
		.where(eq(user.id, userId))
		.get();
	return row?.canCreateHome ?? false;
}

export function hasPasskey(userId: string): boolean {
	return Boolean(
		getConnection()
			.db.select({ id: passkey.id })
			.from(passkey)
			.where(eq(passkey.userId, userId))
			.get()
	);
}
