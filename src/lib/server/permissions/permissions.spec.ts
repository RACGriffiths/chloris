import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHome } from '../data/homes';
import { addMember, insertUser, useTestDatabase } from '../testing';
import { requirePermission } from './guard';
import { PERMISSIONS, can, canCreateHome } from './index';

useTestDatabase();

const DAY = 24 * 60 * 60 * 1000;

/** Two homes with an owner each, and a third person who belongs to neither. */
let alice: { id: string };
let bob: { id: string };
let carol: { id: string };
let aliceHome: string;
let bobHome: string;

beforeEach(() => {
	alice = { id: insertUser('alice@example.com', { canCreateHome: true }) };
	bob = { id: insertUser('bob@example.com', { canCreateHome: true }) };
	carol = { id: insertUser('carol@example.com') };
	aliceHome = createHome(alice.id, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob.id, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
});

function statusOf(run: () => void): number | 'allowed' {
	try {
		run();
		return 'allowed';
	} catch (error) {
		if (isHttpError(error)) return error.status;
		throw error;
	}
}

describe('can', () => {
	it('lets an owner do everything in their own home', () => {
		for (const permission of PERMISSIONS) {
			expect(can(alice, aliceHome, permission), permission).toBe(true);
		}
	});

	it("never lets the owner of one home into another's", () => {
		for (const permission of PERMISSIONS) {
			expect(can(alice, bobHome, permission), permission).toBe(false);
			expect(can(bob, aliceHome, permission), permission).toBe(false);
		}
	});

	it('gives nothing to someone who belongs to no home', () => {
		for (const permission of PERMISSIONS) {
			expect(can(carol, aliceHome, permission), permission).toBe(false);
		}
	});

	it('gives nothing to someone signed out', () => {
		for (const permission of PERMISSIONS) {
			expect(can(null, aliceHome, permission), permission).toBe(false);
			expect(can(undefined, aliceHome, permission), permission).toBe(false);
		}
	});

	it('gives nothing in a home that does not exist', () => {
		expect(can(alice, 'no-such-home', 'home:view')).toBe(false);
	});

	it("limits a member to their role, and only in the home they're a member of", () => {
		addMember(aliceHome, carol.id, 'viewer');

		expect(can(carol, aliceHome, 'home:view')).toBe(true);
		expect(can(carol, aliceHome, 'care:log')).toBe(false);
		for (const permission of PERMISSIONS) {
			expect(can(carol, bobHome, permission), permission).toBe(false);
		}
	});

	it('keeps a member of both homes to the role they have in each', () => {
		addMember(aliceHome, carol.id, 'viewer');
		addMember(bobHome, carol.id, 'carer');

		expect(can(carol, aliceHome, 'plant:edit')).toBe(false);
		expect(can(carol, bobHome, 'plant:edit')).toBe(true);
	});

	it('ends access when a membership expires', () => {
		const now = new Date();
		addMember(aliceHome, carol.id, 'sitter', { expiresAt: new Date(now.getTime() + DAY) });

		expect(can(carol, aliceHome, 'care:log', now)).toBe(true);
		const later = new Date(now.getTime() + 2 * DAY);
		for (const permission of PERMISSIONS) {
			expect(can(carol, aliceHome, permission, later), permission).toBe(false);
		}
	});

	it('gives nothing for a role it does not know', () => {
		addMember(aliceHome, carol.id, 'admin');

		for (const permission of PERMISSIONS) {
			expect(can(carol, aliceHome, permission), permission).toBe(false);
		}
	});
});

describe('requirePermission', () => {
	it('allows what can() allows', () => {
		expect(statusOf(() => requirePermission(alice, aliceHome, 'home:delete'))).toBe('allowed');
	});

	it("answers 404 for another home, so it doesn't reveal that it exists", () => {
		expect(statusOf(() => requirePermission(bob, aliceHome, 'home:view'))).toBe(404);
		expect(statusOf(() => requirePermission(bob, aliceHome, 'plant:edit'))).toBe(404);
		expect(statusOf(() => requirePermission(null, aliceHome, 'home:view'))).toBe(404);
	});

	it('answers 403 to a member without the permission', () => {
		addMember(aliceHome, carol.id, 'viewer');

		expect(statusOf(() => requirePermission(carol, aliceHome, 'plant:edit'))).toBe(403);
	});
});

describe('canCreateHome', () => {
	it('allows only accounts the command-line tool allowed', () => {
		expect(canCreateHome(alice)).toBe(true);
		expect(canCreateHome(carol)).toBe(false);
		expect(canCreateHome(null)).toBe(false);
		expect(canCreateHome({ id: 'no-such-user' })).toBe(false);
	});
});
