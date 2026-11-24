import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { AuditEntry } from '../../audit';
import { getConnection } from '../db';
import { auditEvent, user } from '../db/schema';

/**
 * The home's audit log (D57): who signed in, added or removed a passkey, made, cancelled or used
 * an invite, and deleted a room, a schedule or a photo. Rows are only ever added.
 */

/** Who did something, and from which address and browser when it came from a request. */
export interface AuditSource {
	userId: string;
	ipAddress?: string | null;
	userAgent?: string | null;
}

/** What was done, with the id of what it was done to, if it has one. */
export type AuditRecord = AuditEntry & { targetId?: string | null };

/** An entry in the log, as its page shows it. */
export type AuditEvent = AuditEntry & {
	id: string;
	/** The person's name, or `null` once their account is deleted. */
	userName: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	createdAt: Date;
};

/** How many entries the log's page shows: the latest. */
export const AUDIT_PAGE_SIZE = 100;

/** Longer user agents are cut short: they're shown only as a device's name. */
const MAX_USER_AGENT_LENGTH = 512;

/**
 * Adds an entry to `homeId`'s log. Callers have already checked the permission for what they
 * record, such as `can(user, homeId, 'home:configure')` before deleting a room; a sign-in is
 * recorded in each of the person's own homes (`#lib/server/security/audit`).
 */
export function recordAuditEvent(
	homeId: string,
	source: AuditSource,
	record: AuditRecord,
	now = new Date()
): void {
	getConnection()
		.db.insert(auditEvent)
		.values({
			id: randomUUID(),
			homeId,
			userId: source.userId,
			action: record.action,
			targetId: record.targetId ?? null,
			detail: record.detail,
			ipAddress: source.ipAddress || null,
			userAgent: source.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) || null,
			createdAt: now
		})
		.run();
}

/**
 * The latest entries in `homeId`'s log, newest first. Callers check
 * `can(user, homeId, 'member:manage')` first: only owners see the log.
 */
export function listAuditEvents(homeId: string, limit = AUDIT_PAGE_SIZE): AuditEvent[] {
	return (
		getConnection()
			.db.select({
				id: auditEvent.id,
				action: auditEvent.action,
				detail: auditEvent.detail,
				userName: user.name,
				ipAddress: auditEvent.ipAddress,
				userAgent: auditEvent.userAgent,
				createdAt: auditEvent.createdAt
			})
			.from(auditEvent)
			.leftJoin(user, eq(user.id, auditEvent.userId))
			.where(eq(auditEvent.homeId, homeId))
			// Entries made in the same millisecond, such as joining and the sign-in it makes, keep the
			// order they were written in.
			.orderBy(desc(auditEvent.createdAt), sql`${auditEvent}.rowid desc`)
			.limit(limit)
			.all() as AuditEvent[]
	);
}
