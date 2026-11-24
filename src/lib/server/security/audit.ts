import type { RequestEvent } from '@sveltejs/kit';
import type { AccountEntry, SignInMethod } from '../../audit';
import { recordAuditEvent, type AuditRecord, type AuditSource } from '../data/audit';
import { listHomesForUser } from '../data/homes';
import { recordServerEvent } from '../data/server-log';
import { clientKey, limits, type LimitName } from './rate-limit';

/**
 * Recording what people do: in their home's audit log (D57), and in the server's own log what
 * belongs to no one home (D58). This module has no SvelteKit runtime imports, so BetterAuth's
 * hooks and the command-line tool can use it as well as the routes.
 */

type SourceEvent = Pick<RequestEvent, 'getClientAddress' | 'request'>;

/** Where a request came from: the visitor's address and browser. */
export function requestSource(event: SourceEvent): {
	ipAddress: string | null;
	userAgent: string | null;
} {
	let ipAddress: string | null = null;
	try {
		ipAddress = event.getClientAddress();
	} catch {
		// ADDRESS_HEADER is set, but this request doesn't have it.
	}
	return { ipAddress, userAgent: event.request.headers.get('user-agent') };
}

/**
 * Records what the signed-in person did in a request, in their home's log. Call it once the
 * change has been made, in the form action that checked the permission for it.
 */
export function audit(event: SourceEvent, homeId: string, userId: string, record: AuditRecord) {
	recordAuditEvent(homeId, { ...requestSource(event), userId }, record);
}

/**
 * Records something done to a person's account, such as signing in: in the server's log with
 * where it came from (D58), and in the log of each home they belong to at the time without it, so
 * one home's owners don't see where someone was while using another home.
 */
export function auditAccount(
	source: AuditSource,
	record: AccountEntry & { targetId?: string | null },
	now = new Date()
): void {
	recordServerEvent(source, record, now);
	for (const home of listHomesForUser(source.userId, now)) {
		recordAuditEvent(home.id, { userId: source.userId }, record, now);
	}
}

/**
 * A sign-in that failed: counts towards the visitor's limit on failed sign-ins (D56), and goes
 * in the server's log (D58).
 */
export function signInFailed(event: SourceEvent, method: SignInMethod): void {
	// Recorded first, so the log reads in order when this one uses up the limit.
	recordServerEvent(requestSource(event), { action: 'sign-in-failed', detail: { method } });
	limits.failedSignIn.count(clientKey(event));
}

/**
 * Has each rate limit record in the server's log when someone uses it up, once a window (D58).
 * The upload limit counts per person, so its key is their id.
 */
export function logLimitsReached(): void {
	for (const [name, limiter] of Object.entries(limits)) {
		limiter.onLimit = (key) => {
			const limit = name as LimitName;
			recordServerEvent(
				{ userId: limit === 'upload' ? key : null },
				{ action: 'limit-reached', detail: { limit, key } }
			);
		};
	}
}
