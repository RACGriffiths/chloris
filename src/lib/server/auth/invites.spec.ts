import { describe, expect, it } from 'vitest';
import { getConnection } from '../db';
import { listAuditEvents } from '../data/audit';
import { listServerEvents } from '../data/server-log';
import { createHome } from '../data/homes';
import { createInvite } from '../data/invites';
import { getMembership } from '../data/memberships';
import { mayCreateHome } from '../data/users';
import { TEST_ORIGIN, TEST_SECRET, insertUser, useTestDatabase } from '../testing';
import { createAuth } from './index';
import { inviteUrl } from './invites';

useTestDatabase();

function testAuth() {
	return createAuth({
		origin: TEST_ORIGIN,
		secret: TEST_SECRET,
		db: getConnection().db,
		sendSignInLink: () => {}
	});
}

function aliceInvite(role: 'owner' | 'carer' | 'viewer' = 'carer') {
	const alice = insertUser('alice@example.com', { canCreateHome: true });
	const home = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' });
	return { home, token: createInvite(home.id, alice, { role }).token };
}

describe('inviteUrl', () => {
	it('points at the invite page on the public origin', () => {
		expect(inviteUrl('https://plants.example.com', 'abc_DEF-123')).toBe(
			'https://plants.example.com/invite/abc_DEF-123'
		);
	});
});

describe('joinWithInvite', () => {
	it('creates the account and its membership, and signs it in', async () => {
		const { home, token } = aliceInvite();
		const auth = testAuth();

		const { headers, response } = await auth.api.joinWithInvite({
			body: { token, name: 'Carol', email: 'carol@example.com' },
			headers: new Headers(),
			returnHeaders: true
		});

		expect(response).toMatchObject({ ok: true, homeId: home.id });
		const userId = response.ok ? response.userId : '';
		expect(getMembership(home.id, userId)?.role).toBe('carer');
		expect(mayCreateHome(userId)).toBe(false);

		const setCookie = headers.get('set-cookie') ?? '';
		expect(setCookie).toMatch(/^chloris\.session_token=[^;]+;.*HttpOnly/i);
		const session = await auth.api.getSession({
			headers: new Headers({ cookie: setCookie.split(';')[0] })
		});
		expect(session?.user).toMatchObject({ id: userId, email: 'carol@example.com' });
	});

	it('records the sign-in in the home it joins', async () => {
		const { home, token } = aliceInvite();

		await testAuth().api.joinWithInvite({
			body: { token, name: 'Carol', email: 'carol@example.com' },
			headers: new Headers({ 'user-agent': 'Mozilla/5.0 (iPhone)' })
		});

		expect(listAuditEvents(home.id)).toMatchObject([
			{ action: 'sign-in', detail: { method: 'invite' }, userName: 'Carol' }
		]);
		expect(listServerEvents(10)).toMatchObject([
			{ action: 'sign-in', userEmail: 'carol@example.com', userAgent: 'Mozilla/5.0 (iPhone)' }
		]);
	});

	it('signs no one in when the invite is refused', async () => {
		const { token } = aliceInvite();
		const auth = testAuth();
		await auth.api.joinWithInvite({
			body: { token, name: 'Carol', email: 'carol@example.com' },
			headers: new Headers()
		});

		const { headers, response } = await auth.api.joinWithInvite({
			body: { token, name: 'Dave', email: 'dave@example.com' },
			headers: new Headers(),
			returnHeaders: true
		});

		expect(response).toEqual({ ok: false, reason: 'invalid' });
		expect(headers.get('set-cookie')).toBeNull();
	});

	it("can't be reached over HTTP, even if the browser allowlist let it through", async () => {
		const { token } = aliceInvite();

		const response = await testAuth().handler(
			new Request(`${TEST_ORIGIN}/api/auth/chloris/join-with-invite`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: TEST_ORIGIN },
				body: JSON.stringify({ token, name: 'Mallory', email: 'mallory@example.com' })
			})
		);

		expect(response.status).toBe(404);
	});
});
