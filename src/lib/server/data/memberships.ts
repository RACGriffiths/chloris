import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { getConnection } from '../db';
import { membership, user } from '../db/schema';

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

/** A person in a home, as its owners see them. */
export interface Member {
	userId: string;
	name: string;
	email: string;
	role: string;
}

/**
 * The people whose membership of `homeId` still grants access, longest-standing first. Callers
 * check `can(user, homeId, 'member:manage')` first.
 */
export function listMembers(homeId: string, now = new Date()): Member[] {
	return getConnection()
		.db.select({ userId: user.id, name: user.name, email: user.email, role: membership.role })
		.from(membership)
		.innerJoin(user, eq(user.id, membership.userId))
		.where(
			and(
				eq(membership.homeId, homeId),
				or(isNull(membership.expiresAt), gt(membership.expiresAt, now))
			)
		)
		.orderBy(asc(membership.createdAt), asc(membership.id))
		.all();
}
