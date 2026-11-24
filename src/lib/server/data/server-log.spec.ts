import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getConnection } from '../db';
import { user } from '../db/schema';
import { insertUser, useTestDatabase } from '../testing';
import { listServerEvents, recordServerEvent } from './server-log';

useTestDatabase();

const at = (minute: number) => new Date(Date.UTC(2026, 10, 24, 9, minute));
const failed = { action: 'sign-in-failed', detail: { method: 'link' } } as const;

describe('recordServerEvent and listServerEvents', () => {
	it('records what happened and where from, with the person if there is one', () => {
		const alice = insertUser('alice@example.com');
		recordServerEvent(
			{ userId: alice, ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0 (iPhone)' },
			{ action: 'sign-in', detail: { method: 'passkey' } },
			at(0)
		);
		recordServerEvent({ ipAddress: '198.51.100.20' }, failed, at(1));

		expect(listServerEvents(10)).toMatchObject([
			{ action: 'sign-in-failed', userEmail: null, ipAddress: '198.51.100.20', createdAt: at(1) },
			{
				action: 'sign-in',
				detail: { method: 'passkey' },
				userEmail: 'alice@example.com',
				ipAddress: '203.0.113.7',
				userAgent: 'Mozilla/5.0 (iPhone)',
				createdAt: at(0)
			}
		]);
	});

	it('lists the latest first, entries from the same moment too, up to the limit', () => {
		for (const method of ['passkey', 'link', 'invite'] as const) {
			recordServerEvent({}, { action: 'sign-in-failed', detail: { method } }, at(0));
		}
		recordServerEvent({}, failed, at(5));

		expect(listServerEvents(3).map((event) => [event.createdAt, event.detail])).toEqual([
			[at(5), { method: 'link' }],
			[at(0), { method: 'invite' }],
			[at(0), { method: 'link' }]
		]);
	});

	it('keeps the entry once the account is deleted, without its address', () => {
		const carol = insertUser('carol@example.com');
		recordServerEvent({ userId: carol }, { action: 'sign-in', detail: { method: 'link' } });

		getConnection().db.delete(user).where(eq(user.id, carol)).run();

		expect(listServerEvents(10)).toMatchObject([{ action: 'sign-in', userEmail: null }]);
	});
});
