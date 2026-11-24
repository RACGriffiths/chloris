import { describeAuditEntry } from '#lib/audit.js';
import { formatMoment } from '#lib/dates.js';
import { describeUserAgent } from '#lib/devices.js';
import { AUDIT_PAGE_SIZE, listAuditEvents } from '#lib/server/data/audit.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import type { PageServerLoad } from './$types';

/**
 * The home's audit log (D57): sign-ins, passkeys, invites and deletions, newest first. Only those
 * who may manage members see it, since much of it is about who has access: owners.
 */
export const load: PageServerLoad = ({ locals }) => {
	const { home } = requireHome(locals, 'member:manage');
	const now = new Date();
	const events = listAuditEvents(home.id);
	return {
		home: { name: home.name },
		pageSize: AUDIT_PAGE_SIZE,
		events: events.map((event) => ({
			id: event.id,
			who: event.userName ?? 'Someone whose account was deleted',
			what: describeAuditEntry(event),
			when: formatMoment(event.createdAt, home.timeZone, now),
			at: event.createdAt.toISOString(),
			// Formatted here, so the page reads the same before and after it hydrates.
			from: [event.userAgent && describeUserAgent(event.userAgent), event.ipAddress]
				.filter(Boolean)
				.join(' · ')
		}))
	};
};
