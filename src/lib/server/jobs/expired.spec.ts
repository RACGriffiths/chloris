import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConnection } from '../db';
import { verification } from '../db/schema';
import { listServerEvents, recordServerEvent } from '../data/server-log';
import { useTestDatabase } from '../testing';
import { removeExpired } from './expired';

useTestDatabase();

const now = new Date('2026-06-15T09:00:00Z');
const day = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * day);

const failed = (at: Date) =>
	recordServerEvent(
		{ ipAddress: '198.51.100.20' },
		{ action: 'sign-in-failed', detail: { method: 'link' } },
		at
	);

function storeVerification(identifier: string, expiresAt: Date) {
	getConnection()
		.db.insert(verification)
		.values({ id: randomUUID(), identifier, value: 'challenge', expiresAt })
		.run();
}

const identifiers = () =>
	getConnection()
		.db.select({ identifier: verification.identifier })
		.from(verification)
		.all()
		.map((row) => row.identifier);

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('removeExpired', () => {
	it("removes entries in the server's log older than 90 days, and keeps the rest whole", () => {
		failed(daysAgo(120));
		failed(daysAgo(90.01));
		failed(daysAgo(89.99));
		failed(daysAgo(1));

		expect(removeExpired(now)).toMatchObject({ serverEvents: 2 });
		expect(listServerEvents(10).map((event) => event.createdAt)).toEqual([
			daysAgo(1),
			daysAgo(89.99)
		]);
		expect(listServerEvents(10)[0]).toMatchObject({
			action: 'sign-in-failed',
			detail: { method: 'link' },
			ipAddress: '198.51.100.20'
		});
	});

	it('removes expired verification values, such as passkey challenges never used', () => {
		storeVerification('expired', new Date(now.getTime() - 1));
		storeVerification('current', new Date(now.getTime() + 5 * 60 * 1000));

		expect(removeExpired(now)).toEqual({ serverEvents: 0, verifications: 1 });
		expect(identifiers()).toEqual(['current']);
	});

	it('does nothing a second time', () => {
		failed(daysAgo(100));
		storeVerification('expired', daysAgo(1));
		removeExpired(now);

		expect(removeExpired(now)).toEqual({ serverEvents: 0, verifications: 0 });
	});
});
