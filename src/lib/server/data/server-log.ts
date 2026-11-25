import { randomUUID } from 'node:crypto';
import { desc, eq, lt, sql } from 'drizzle-orm';
import type { ServerEntry } from '../../audit';
import { getConnection } from '../db';
import { serverEvent, user } from '../db/schema';

/**
 * The server's own log (D58): sign-ins and passkey changes with where they came from, sign-ins
 * that failed, rate limits used up, and sign-in links the command-line tool printed.
 *
 * It belongs to no home, so these functions take no `homeId`, and there is no `can()` check: it
 * is written by the sign-in steps and the command-line tool, and read only by the command-line
 * tool, which whoever hosts Chloris runs on the server. Server admins (D58) will check a server
 * permission of their own before reading it.
 */

/** Who did something, if anyone, and from which address and browser. */
export interface ServerSource {
	userId?: string | null;
	ipAddress?: string | null;
	userAgent?: string | null;
}

export type ServerRecord = ServerEntry & { targetId?: string | null };

export type ServerEvent = ServerEntry & {
	id: string;
	/** The person's email address, or `null` if there's no person or their account is deleted. */
	userEmail: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	createdAt: Date;
};

/**
 * How long entries are kept (D58). The hourly job removes older ones (`#lib/server/jobs/expired`):
 * visitors who aren't signed in can add to the log, so it can't be left to grow.
 */
export const SERVER_LOG_DAYS = 90;

/** Longer user agents are cut short: they're shown only as a device's name. */
const MAX_USER_AGENT_LENGTH = 512;

export function recordServerEvent(
	source: ServerSource,
	record: ServerRecord,
	now = new Date()
): void {
	getConnection()
		.db.insert(serverEvent)
		.values({
			id: randomUUID(),
			action: record.action,
			userId: source.userId ?? null,
			targetId: record.targetId ?? null,
			detail: record.detail,
			ipAddress: source.ipAddress || null,
			userAgent: source.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) || null,
			createdAt: now
		})
		.run();
}

/** The latest `limit` entries, newest first; entries from the same moment newest first too. */
export function listServerEvents(limit: number): ServerEvent[] {
	return getConnection()
		.db.select({
			id: serverEvent.id,
			action: serverEvent.action,
			detail: serverEvent.detail,
			userEmail: user.email,
			ipAddress: serverEvent.ipAddress,
			userAgent: serverEvent.userAgent,
			createdAt: serverEvent.createdAt
		})
		.from(serverEvent)
		.leftJoin(user, eq(user.id, serverEvent.userId))
		.orderBy(desc(serverEvent.createdAt), sql`${serverEvent}.rowid desc`)
		.limit(limit)
		.all() as ServerEvent[];
}

/**
 * Removes the entries recorded before `before`, returning how many. Entries are never changed:
 * they're kept whole until they go.
 */
export function removeServerEventsBefore(before: Date): number {
	return getConnection().db.delete(serverEvent).where(lt(serverEvent.createdAt, before)).run()
		.changes;
}
