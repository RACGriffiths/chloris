import { and, eq } from 'drizzle-orm';
import { getConnection } from '../db';
import { membership } from '../db/schema';

export interface Membership {
	homeId: string;
	userId: string;
	role: string;
	/** When the membership stops granting access, or `null` if it doesn't expire. */
	expiresAt: Date | null;
}

/** A user's membership of one home, whether or not it has expired; `null` if there is none. */
export function getMembership(homeId: string, userId: string): Membership | null {
	const row = getConnection()
		.db.select({
			homeId: membership.homeId,
			userId: membership.userId,
			role: membership.role,
			expiresAt: membership.expiresAt
		})
		.from(membership)
		.where(and(eq(membership.homeId, homeId), eq(membership.userId, userId)))
		.get();
	return row ?? null;
}

/** Whether a membership still grants access at `now`. */
export function isActive(member: Pick<Membership, 'expiresAt'>, now = new Date()): boolean {
	return member.expiresAt === null || member.expiresAt > now;
}
