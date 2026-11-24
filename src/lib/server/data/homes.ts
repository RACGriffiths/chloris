import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { getConnection } from '../db';
import { home, membership } from '../db/schema';

export interface Home {
	id: string;
	name: string;
	timeZone: string;
}

/** The IANA name of a time zone, e.g. `Europe/London`, in its canonical form; `null` if unknown. */
export function canonicalTimeZone(value: string): string | null {
	try {
		return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
	} catch {
		return null;
	}
}

/** What a person fills in to create or rename a home. */
export const homeInput = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Give the home a name.')
		.max(60, 'Keep the name to 60 characters or fewer.'),
	timeZone: z.string().transform((value, ctx) => {
		const zone = canonicalTimeZone(value);
		if (zone) return zone;
		ctx.addIssue({ code: 'custom', message: 'Choose a time zone from the list.' });
		return z.NEVER;
	})
});

export type HomeInput = z.input<typeof homeInput>;

/**
 * Creates a home with `ownerId` as its owner. Whether that user may create a home is for the
 * caller to check first, with `canCreateHome()`. Throws a `ZodError` if the input is invalid.
 */
export function createHome(ownerId: string, input: HomeInput): Home {
	const { name, timeZone } = homeInput.parse(input);
	const { db } = getConnection();
	const id = randomUUID();
	return db.transaction((tx) => {
		const created = tx
			.insert(home)
			.values({ id, slug: id, name, timeZone })
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
 * Every home on the server, oldest first. Only for background jobs, such as the daily digest,
 * which work through each home in turn and are run by no one in particular, so there's no
 * `can()` to check: each job checks `can()` for the people it acts for. Pages never call this.
 */
export function listHomeIds(): string[] {
	return getConnection()
		.db.select({ id: home.id })
		.from(home)
		.orderBy(asc(home.createdAt), asc(home.id))
		.all()
		.map((row) => row.id);
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
