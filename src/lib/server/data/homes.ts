import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { getConnection } from '../db';
import { home, membership } from '../db/schema';

export interface Home {
	id: string;
	name: string;
	timeZone: string;
}

export interface HomeInput {
	name: string;
	timeZone: string;
}

/**
 * Creates a home with `ownerId` as its owner. Whether that user may create a home is for the
 * caller to check first, with `canCreateHome()`.
 */
export function createHome(ownerId: string, input: HomeInput): Home {
	const { db } = getConnection();
	const id = randomUUID();
	return db.transaction((tx) => {
		const created = tx
			.insert(home)
			.values({ id, slug: id, name: input.name, timeZone: input.timeZone })
			.returning({ id: home.id, name: home.name, timeZone: home.timeZone })
			.get();
		tx.insert(membership)
			.values({ id: randomUUID(), homeId: id, userId: ownerId, role: 'owner' })
			.run();
		return created;
	});
}

/** One home. Callers check `can(user, homeId, 'home:view')` first. */
export function getHome(homeId: string): Home | null {
	const row = getConnection()
		.db.select({ id: home.id, name: home.name, timeZone: home.timeZone })
		.from(home)
		.where(eq(home.id, homeId))
		.get();
	return row ?? null;
}

/**
 * The homes a user belongs to, oldest membership first, leaving out memberships that have
 * expired. The UI shows only the first for now (D14).
 */
export function listHomesForUser(userId: string, now = new Date()): Home[] {
	return getConnection()
		.db.select({ id: home.id, name: home.name, timeZone: home.timeZone })
		.from(membership)
		.innerJoin(home, eq(home.id, membership.homeId))
		.where(
			and(
				eq(membership.userId, userId),
				or(isNull(membership.expiresAt), gt(membership.expiresAt, now))
			)
		)
		.orderBy(asc(membership.createdAt), asc(membership.id))
		.all();
}
