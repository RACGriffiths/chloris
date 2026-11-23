import { describe, expect, it } from 'vitest';
import { addMember, insertUser, useTestDatabase } from '../testing';
import { createHome, getHome, listHomesForUser } from './homes';
import { getMembership } from './memberships';

useTestDatabase();

const DAY = 24 * 60 * 60 * 1000;

describe('createHome', () => {
	it('makes the creator its owner', () => {
		const alice = insertUser('alice@example.com');

		const home = createHome(alice, { name: 'Flat', timeZone: 'Europe/London' });

		expect(home).toMatchObject({ name: 'Flat', timeZone: 'Europe/London' });
		expect(getHome(home.id)).toEqual(home);
		expect(getMembership(home.id, alice)).toEqual({
			homeId: home.id,
			userId: alice,
			role: 'owner',
			expiresAt: null
		});
	});

	it('checks and tidies its input', () => {
		const alice = insertUser('alice@example.com');

		expect(createHome(alice, { name: '  Flat  ', timeZone: 'europe/london' })).toMatchObject({
			name: 'Flat',
			timeZone: 'Europe/London'
		});
		expect(() => createHome(alice, { name: ' ', timeZone: 'Europe/London' })).toThrow(
			'Give the home a name.'
		);
		expect(() => createHome(alice, { name: 'Flat', timeZone: 'Mars/Olympus_Mons' })).toThrow(
			'Choose a time zone from the list.'
		);
	});

	it('adds no one else to the new home, and the creator to no other home', () => {
		const alice = insertUser('alice@example.com');
		const bob = insertUser('bob@example.com');
		const bobs = createHome(bob, { name: "Bob's", timeZone: 'Europe/Paris' });

		const alices = createHome(alice, { name: "Alice's", timeZone: 'Europe/London' });

		expect(getMembership(alices.id, bob)).toBeNull();
		expect(getMembership(bobs.id, alice)).toBeNull();
		expect(listHomesForUser(bob)).toEqual([bobs]);
	});
});

describe('getHome', () => {
	it('returns the home asked for and no other', () => {
		const alice = insertUser('alice@example.com');
		const bob = insertUser('bob@example.com');
		const alices = createHome(alice, { name: "Alice's", timeZone: 'Europe/London' });
		const bobs = createHome(bob, { name: "Bob's", timeZone: 'Europe/Paris' });

		expect(getHome(alices.id)).toEqual(alices);
		expect(getHome(bobs.id)).toEqual(bobs);
		expect(getHome('no-such-home')).toBeNull();
	});
});

describe('listHomesForUser', () => {
	it("lists only the homes the user belongs to, never another's", () => {
		const alice = insertUser('alice@example.com');
		const bob = insertUser('bob@example.com');
		const carol = insertUser('carol@example.com');
		const alices = createHome(alice, { name: "Alice's", timeZone: 'Europe/London' });
		const bobs = createHome(bob, { name: "Bob's", timeZone: 'Europe/Paris' });

		expect(listHomesForUser(alice)).toEqual([alices]);
		expect(listHomesForUser(bob)).toEqual([bobs]);
		expect(listHomesForUser(carol)).toEqual([]);
	});

	it('lists the oldest membership first', () => {
		const alice = insertUser('alice@example.com');
		const bob = insertUser('bob@example.com');
		const alices = createHome(alice, { name: "Alice's", timeZone: 'Europe/London' });
		const bobs = createHome(bob, { name: "Bob's", timeZone: 'Europe/Paris' });

		addMember(bobs.id, alice, 'carer', { createdAt: new Date(Date.now() + DAY) });

		expect(listHomesForUser(alice)).toEqual([alices, bobs]);
	});

	it('leaves out memberships that have expired', () => {
		const alice = insertUser('alice@example.com');
		const sitter = insertUser('sitter@example.com');
		const home = createHome(alice, { name: "Alice's", timeZone: 'Europe/London' });
		const now = new Date();
		addMember(home.id, sitter, 'sitter', { expiresAt: new Date(now.getTime() + DAY) });

		expect(listHomesForUser(sitter, now)).toEqual([home]);
		expect(listHomesForUser(sitter, new Date(now.getTime() + 2 * DAY))).toEqual([]);
	});
});
