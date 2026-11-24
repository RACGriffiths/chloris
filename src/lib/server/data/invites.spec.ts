import { and, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { getConnection } from '../db';
import { membership, user } from '../db/schema';
import { can } from '../permissions';
import { addMember, insertUser, useTestDatabase } from '../testing';
import { createHome, listHomesForUser } from './homes';
import {
	INVITE_DAYS,
	acceptInvite,
	cancelInvite,
	createInvite,
	findInvite,
	joinWithNewAccount,
	listPendingInvites
} from './invites';
import { getMembership } from './memberships';
import { accountExists, mayCreateHome } from './users';

useTestDatabase();

const DAY = 24 * 60 * 60 * 1000;

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

function accountFor(email: string) {
	return getConnection().db.select().from(user).where(eq(user.email, email)).get();
}

describe('createInvite', () => {
	it(`makes a pending invite that lasts ${INVITE_DAYS} days`, () => {
		const now = new Date('2026-11-23T10:00:00Z');

		const { invite, token } = createInvite(aliceHome, alice, { role: 'carer' }, now);

		expect(token).toMatch(/^[\w-]{43}$/);
		expect(invite).toMatchObject({
			role: 'carer',
			createdByName: 'alice',
			createdAt: now,
			expiresAt: new Date('2026-11-30T10:00:00Z')
		});
		expect(listPendingInvites(aliceHome, now)).toEqual([invite]);
	});

	it('gives each invite its own token, and stores only its hash', () => {
		const first = createInvite(aliceHome, alice, { role: 'carer' });
		const second = createInvite(aliceHome, alice, { role: 'carer' });

		expect(first.token).not.toBe(second.token);
		const stored = JSON.stringify(getConnection().sqlite.prepare('SELECT * FROM invite').all());
		expect(stored).not.toContain(first.token);
		expect(stored).not.toContain(second.token);
	});

	it('takes only the roles an invite may carry', () => {
		for (const role of ['owner', 'carer', 'viewer']) {
			expect(createInvite(aliceHome, alice, { role: role as 'owner' }).invite.role).toBe(role);
		}
		for (const role of ['sitter', 'admin', '']) {
			expect(() => createInvite(aliceHome, alice, { role: role as 'owner' })).toThrow(ZodError);
		}
	});

	it("puts the invite in its own home and not in another's", () => {
		const { invite } = createInvite(aliceHome, alice, { role: 'viewer' });

		expect(listPendingInvites(aliceHome)).toEqual([invite]);
		expect(listPendingInvites(bobHome)).toEqual([]);
	});
});

describe('listPendingInvites', () => {
	it("lists only the home's own invites, never another's", () => {
		const alices = createInvite(aliceHome, alice, { role: 'carer' }).invite;
		const bobs = createInvite(bobHome, bob, { role: 'viewer' }).invite;

		expect(listPendingInvites(aliceHome)).toEqual([alices]);
		expect(listPendingInvites(bobHome)).toEqual([bobs]);
	});

	it('leaves out invites that have been used or have expired', () => {
		const now = new Date();
		const used = createInvite(aliceHome, alice, { role: 'carer' }, now);
		const soon = createInvite(aliceHome, alice, { role: 'carer' }, new Date(now.getTime() - DAY));
		acceptInvite(used.token, insertUser('carol@example.com'), now);

		expect(listPendingInvites(aliceHome, now)).toEqual([soon.invite]);
		expect(listPendingInvites(aliceHome, new Date(now.getTime() + INVITE_DAYS * DAY))).toEqual([]);
	});
});

describe('cancelInvite', () => {
	it('stops the link working', () => {
		const { invite, token } = createInvite(aliceHome, alice, { role: 'carer' });

		expect(cancelInvite(aliceHome, invite.id)).toBe(true);

		expect(listPendingInvites(aliceHome)).toEqual([]);
		expect(findInvite(token)).toBeNull();
		expect(acceptInvite(token, insertUser('carol@example.com'))).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});

	it("can't cancel another home's invite", () => {
		const { invite, token } = createInvite(aliceHome, alice, { role: 'carer' });

		expect(cancelInvite(bobHome, invite.id)).toBe(false);

		expect(listPendingInvites(aliceHome)).toEqual([invite]);
		expect(findInvite(token)?.homeId).toBe(aliceHome);
	});

	it('leaves an invite that has been used alone', () => {
		const { invite, token } = createInvite(aliceHome, alice, { role: 'carer' });
		const carol = insertUser('carol@example.com');
		acceptInvite(token, carol);

		expect(cancelInvite(aliceHome, invite.id)).toBe(false);
		expect(getMembership(aliceHome, carol)?.role).toBe('carer');
	});
});

describe('findInvite', () => {
	it('describes the invite, for its own home only', () => {
		const now = new Date('2026-11-23T10:00:00Z');
		const { token } = createInvite(aliceHome, alice, { role: 'viewer' }, now);

		expect(findInvite(token, now)).toEqual({
			homeId: aliceHome,
			homeName: "Alice's flat",
			role: 'viewer',
			invitedBy: 'alice',
			expiresAt: new Date('2026-11-30T10:00:00Z')
		});
	});

	it('knows nothing of invented, used or expired tokens', () => {
		const now = new Date();
		const used = createInvite(aliceHome, alice, { role: 'carer' }, now).token;
		const old = createInvite(aliceHome, alice, { role: 'carer' }, now).token;
		acceptInvite(used, insertUser('carol@example.com'), now);

		expect(findInvite('not-a-real-token', now)).toBeNull();
		expect(findInvite('', now)).toBeNull();
		expect(findInvite(used, now)).toBeNull();
		expect(findInvite(old, new Date(now.getTime() + INVITE_DAYS * DAY))).toBeNull();
	});
});

describe('acceptInvite', () => {
	it("adds the account to the invite's home with its role, and to no other home", () => {
		const carol = insertUser('carol@example.com');
		const { invite, token } = createInvite(aliceHome, alice, { role: 'carer' });

		expect(acceptInvite(token, carol)).toEqual({
			ok: true,
			homeId: aliceHome,
			userId: carol,
			inviteId: invite.id,
			role: 'carer'
		});

		expect(getMembership(aliceHome, carol)).toMatchObject({ role: 'carer', expiresAt: null });
		expect(getMembership(bobHome, carol)).toBeNull();
		expect(can({ id: carol }, aliceHome, 'plant:edit')).toBe(true);
		expect(can({ id: carol }, bobHome, 'home:view')).toBe(false);
	});

	it('works only once', () => {
		const { token } = createInvite(aliceHome, alice, { role: 'carer' });
		const carol = insertUser('carol@example.com');
		const dave = insertUser('dave@example.com');

		expect(acceptInvite(token, carol).ok).toBe(true);
		expect(acceptInvite(token, dave)).toEqual({ ok: false, reason: 'invalid' });
		expect(getMembership(aliceHome, dave)).toBeNull();
	});

	it('stops working when the invite expires', () => {
		const now = new Date();
		const { token } = createInvite(aliceHome, alice, { role: 'carer' }, now);
		const carol = insertUser('carol@example.com');

		const later = new Date(now.getTime() + INVITE_DAYS * DAY);
		expect(acceptInvite(token, carol, later)).toEqual({ ok: false, reason: 'invalid' });
		expect(getMembership(aliceHome, carol)).toBeNull();
	});

	it('refuses a member of the home, and leaves the invite for someone else', () => {
		const { token } = createInvite(aliceHome, alice, { role: 'viewer' });

		expect(acceptInvite(token, alice)).toEqual({ ok: false, reason: 'already-member' });

		expect(getMembership(aliceHome, alice)?.role).toBe('owner');
		expect(acceptInvite(token, insertUser('carol@example.com')).ok).toBe(true);
	});

	it('replaces a membership that has expired', () => {
		const now = new Date();
		const carol = insertUser('carol@example.com');
		addMember(aliceHome, carol, 'sitter', { expiresAt: new Date(now.getTime() - DAY) });
		const { token } = createInvite(aliceHome, alice, { role: 'viewer' }, now);

		expect(acceptInvite(token, carol, now).ok).toBe(true);

		expect(getMembership(aliceHome, carol)).toMatchObject({ role: 'viewer', expiresAt: null });
	});

	it('lets a member of another home join, keeping their first home first', () => {
		// Made a minute ago: memberships made in the same millisecond would be ordered by their
		// random ids instead.
		getConnection()
			.db.update(membership)
			.set({ createdAt: new Date(Date.now() - 60_000) })
			.where(and(eq(membership.homeId, bobHome), eq(membership.userId, bob)))
			.run();
		const { token } = createInvite(aliceHome, alice, { role: 'carer' });

		expect(acceptInvite(token, bob).ok).toBe(true);

		expect(listHomesForUser(bob).map((home) => home.id)).toEqual([bobHome, aliceHome]);
		expect(getMembership(bobHome, bob)?.role).toBe('owner');
	});
});

describe('joinWithNewAccount', () => {
	it("creates the account and its membership of the invite's home only", () => {
		const { token } = createInvite(aliceHome, alice, { role: 'viewer' });

		const result = joinWithNewAccount(token, { name: '  Carol  ', email: ' Carol@Example.com ' });

		expect(result).toMatchObject({ ok: true, homeId: aliceHome });
		const userId = result.ok ? result.userId : '';
		expect(accountFor('carol@example.com')).toMatchObject({
			id: userId,
			name: 'Carol',
			emailVerified: false
		});
		expect(getMembership(aliceHome, userId)?.role).toBe('viewer');
		expect(getMembership(bobHome, userId)).toBeNull();
		expect(listHomesForUser(userId).map((home) => home.id)).toEqual([aliceHome]);
	});

	it('never lets the new account create a home (D26), even as an owner', () => {
		const { token } = createInvite(aliceHome, alice, { role: 'owner' });

		const result = joinWithNewAccount(token, { name: 'Carol', email: 'carol@example.com' });

		expect(result.ok && mayCreateHome(result.userId)).toBe(false);
		expect(result.ok && can({ id: result.userId }, aliceHome, 'member:manage')).toBe(true);
	});

	it('works only once', () => {
		const { token } = createInvite(aliceHome, alice, { role: 'carer' });

		expect(joinWithNewAccount(token, { name: 'Carol', email: 'carol@example.com' }).ok).toBe(true);
		expect(joinWithNewAccount(token, { name: 'Dave', email: 'dave@example.com' })).toEqual({
			ok: false,
			reason: 'invalid'
		});
		expect(accountExists('dave@example.com')).toBe(false);
	});

	it('refuses an address that already has an account, and leaves the invite unused', () => {
		const { token } = createInvite(aliceHome, alice, { role: 'carer' });

		expect(joinWithNewAccount(token, { name: 'Bob', email: 'BOB@example.com' })).toEqual({
			ok: false,
			reason: 'email-taken'
		});

		expect(getMembership(aliceHome, bob)).toBeNull();
		expect(findInvite(token)).not.toBeNull();
	});

	it('creates nothing for an invented or expired token', () => {
		const now = new Date();
		const { token } = createInvite(aliceHome, alice, { role: 'carer' }, now);
		const later = new Date(now.getTime() + INVITE_DAYS * DAY);

		expect(joinWithNewAccount('made-up', { name: 'C', email: 'c@example.com' }).ok).toBe(false);
		expect(joinWithNewAccount(token, { name: 'C', email: 'c@example.com' }, later).ok).toBe(false);
		expect(accountExists('c@example.com')).toBe(false);
	});

	it('checks its input', () => {
		const { token } = createInvite(aliceHome, alice, { role: 'carer' });

		expect(() => joinWithNewAccount(token, { name: ' ', email: 'carol@example.com' })).toThrow(
			'Enter your name.'
		);
		expect(() => joinWithNewAccount(token, { name: 'Carol', email: 'carol' })).toThrow(
			'Enter an email address'
		);
		expect(findInvite(token)).not.toBeNull();
	});
});
