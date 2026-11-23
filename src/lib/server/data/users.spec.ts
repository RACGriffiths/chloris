import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getConnection } from '../db';
import { passkey } from '../db/schema';
import { insertUser, useTestDatabase } from '../testing';
import { accountExists, hasPasskey, mayCreateHome } from './users';

useTestDatabase();

function insertPasskey(userId: string) {
	getConnection()
		.db.insert(passkey)
		.values({
			id: randomUUID(),
			userId,
			publicKey: 'key',
			credentialID: randomUUID(),
			counter: 0,
			deviceType: 'multiDevice',
			backedUp: true
		})
		.run();
}

describe('accountExists', () => {
	it('matches the address whatever its case or surrounding spaces', () => {
		insertUser('alice@example.com');

		expect(accountExists('alice@example.com')).toBe(true);
		expect(accountExists('  Alice@Example.COM ')).toBe(true);
		expect(accountExists('bob@example.com')).toBe(false);
	});
});

describe('mayCreateHome', () => {
	it("reads each account's own flag", () => {
		const alice = insertUser('alice@example.com', { canCreateHome: true });
		const bob = insertUser('bob@example.com');

		expect(mayCreateHome(alice)).toBe(true);
		expect(mayCreateHome(bob)).toBe(false);
		expect(mayCreateHome('no-such-user')).toBe(false);
	});
});

describe('hasPasskey', () => {
	it("counts only the user's own passkeys", () => {
		const alice = insertUser('alice@example.com');
		const bob = insertUser('bob@example.com');
		insertPasskey(alice);

		expect(hasPasskey(alice)).toBe(true);
		expect(hasPasskey(bob)).toBe(false);
	});
});
