import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getConnection } from '../db';
import { user } from '../db/schema';
import { insertUser, useTestDatabase } from '../testing';
import { AUDIT_PAGE_SIZE, listAuditEvents, recordAuditEvent } from './audit';
import { createHome } from './homes';

useTestDatabase();

/** Two homes with an owner each. */
let alice: string;
let bob: string;
let aliceHome: string;
let bobHome: string;

beforeEach(() => {
	alice = insertUser('alice@example.com', { canCreateHome: true });
	bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
});

const at = (minute: number) => new Date(Date.UTC(2026, 10, 24, 9, minute));

describe('recordAuditEvent and listAuditEvents', () => {
	it('records who did what, from where, and lists it with their name', () => {
		recordAuditEvent(
			aliceHome,
			{ userId: alice, ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0 (iPhone)' },
			{ action: 'room-deleted', targetId: 'room-1', detail: { name: 'Kitchen' } },
			at(0)
		);

		expect(listAuditEvents(aliceHome)).toMatchObject([
			{
				action: 'room-deleted',
				detail: { name: 'Kitchen' },
				userName: 'alice',
				ipAddress: '203.0.113.7',
				userAgent: 'Mozilla/5.0 (iPhone)',
				createdAt: at(0)
			}
		]);
	});

	it("lists only the home's own entries, never another's", () => {
		recordAuditEvent(aliceHome, { userId: alice }, invite('carer'), at(0));
		recordAuditEvent(bobHome, { userId: bob }, invite('viewer'), at(1));

		expect(listAuditEvents(aliceHome)).toMatchObject([{ detail: { role: 'carer' } }]);
		expect(listAuditEvents(bobHome)).toMatchObject([{ detail: { role: 'viewer' } }]);
	});

	it('lists the latest first, up to a page', () => {
		for (let minute = 0; minute < AUDIT_PAGE_SIZE + 2; minute++) {
			recordAuditEvent(aliceHome, { userId: alice }, invite('carer'), at(minute));
		}

		const events = listAuditEvents(aliceHome);
		expect(events).toHaveLength(AUDIT_PAGE_SIZE);
		expect(events[0].createdAt).toEqual(at(AUDIT_PAGE_SIZE + 1));
		expect(events.at(-1)?.createdAt).toEqual(at(2));
		expect(listAuditEvents(aliceHome, 1)).toHaveLength(1);
	});

	it('keeps the entry once the account is deleted, without a name', () => {
		const carol = insertUser('carol@example.com');
		recordAuditEvent(aliceHome, { userId: carol }, invite('carer'), at(0));

		getConnection().db.delete(user).where(eq(user.id, carol)).run();

		expect(listAuditEvents(aliceHome)).toMatchObject([{ userName: null }]);
	});

	it('stores no empty address or browser, and cuts a long user agent short', () => {
		recordAuditEvent(
			aliceHome,
			{ userId: alice, ipAddress: '', userAgent: 'x'.repeat(2000) },
			invite('carer')
		);

		const [event] = listAuditEvents(aliceHome);
		expect(event.ipAddress).toBeNull();
		expect(event.userAgent).toHaveLength(512);
	});
});

function invite(role: string) {
	return { action: 'invite-created', targetId: null, detail: { role } } as const;
}

describe('listAuditEvents', () => {
	it('keeps entries made in the same millisecond in the order they were written', () => {
		for (const role of ['owner', 'carer', 'viewer']) {
			recordAuditEvent(aliceHome, { userId: alice }, invite(role), at(0));
		}

		expect(listAuditEvents(aliceHome).map((event) => event.detail)).toEqual([
			{ role: 'viewer' },
			{ role: 'carer' },
			{ role: 'owner' }
		]);
	});
});
