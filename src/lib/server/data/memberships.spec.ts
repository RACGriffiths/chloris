import { describe, expect, it } from 'vitest';
import { addMember, insertUser, useTestDatabase } from '../testing';
import { createHome } from './homes';
import { getMembership, isActive, listMembers } from './memberships';

useTestDatabase();

describe('getMembership', () => {
	it('finds a membership only in the home it belongs to', () => {
		const alice = insertUser('alice@example.com');
		const bob = insertUser('bob@example.com');
		const alices = createHome(alice, { name: "Alice's", timeZone: 'Europe/London' });
		const bobs = createHome(bob, { name: "Bob's", timeZone: 'Europe/Paris' });

		expect(getMembership(alices.id, alice)?.role).toBe('owner');
		expect(getMembership(bobs.id, alice)).toBeNull();
		expect(getMembership(alices.id, bob)).toBeNull();
	});

	it('returns an expired membership with its expiry, for the caller to judge', () => {
		const alice = insertUser('alice@example.com');
		const sitter = insertUser('sitter@example.com');
		const home = createHome(alice, { name: "Alice's", timeZone: 'Europe/London' });
		const ended = new Date('2026-01-01T00:00:00Z');
		addMember(home.id, sitter, 'sitter', { expiresAt: ended });

		expect(getMembership(home.id, sitter)).toEqual({
			homeId: home.id,
			userId: sitter,
			role: 'sitter',
			expiresAt: ended
		});
	});
});

describe('isActive', () => {
	const now = new Date('2026-06-01T12:00:00Z');

	it('is true without an expiry, or before it', () => {
		expect(isActive({ expiresAt: null }, now)).toBe(true);
		expect(isActive({ expiresAt: new Date('2026-06-01T12:00:01Z') }, now)).toBe(true);
	});

	it('is false from the moment of expiry', () => {
		expect(isActive({ expiresAt: now }, now)).toBe(false);
		expect(isActive({ expiresAt: new Date('2026-05-01T00:00:00Z') }, now)).toBe(false);
	});
});

describe('listMembers', () => {
	it("lists only the home's own members, never another's", () => {
		const alice = insertUser('alice@example.com');
		const bob = insertUser('bob@example.com');
		const carol = insertUser('carol@example.com');
		const alices = createHome(alice, { name: "Alice's", timeZone: 'Europe/London' });
		const bobs = createHome(bob, { name: "Bob's", timeZone: 'Europe/Paris' });
		addMember(alices.id, carol, 'viewer', { createdAt: new Date(Date.now() + 1000) });

		expect(listMembers(alices.id)).toEqual([
			{ userId: alice, name: 'alice', email: 'alice@example.com', role: 'owner' },
			{ userId: carol, name: 'carol', email: 'carol@example.com', role: 'viewer' }
		]);
		expect(listMembers(bobs.id)).toEqual([
			{ userId: bob, name: 'bob', email: 'bob@example.com', role: 'owner' }
		]);
	});

	it('leaves out memberships that have expired', () => {
		const alice = insertUser('alice@example.com');
		const sitter = insertUser('sitter@example.com');
		const home = createHome(alice, { name: "Alice's", timeZone: 'Europe/London' });
		const now = new Date();
		addMember(home.id, sitter, 'sitter', { expiresAt: new Date(now.getTime() + 1000) });

		expect(listMembers(home.id, now)).toHaveLength(2);
		expect(listMembers(home.id, new Date(now.getTime() + 2000))).toHaveLength(1);
	});
});
