import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConnection } from '../db';
import { accountExists, mayCreateHome } from '../data/users';
import { TEST_ORIGIN, TEST_SECRET, insertUser, useTestDatabase } from '../testing';
import { signInLinkEmail } from './emails';
import { SIGN_IN_LINK_MINUTES, createAuth, type SignInLink } from './index';
import { createCommandLineSignInLink } from './sign-in-link';

useTestDatabase();

afterEach(() => {
	vi.useRealTimers();
});

/** The app's auth, with sign-in links collected instead of emailed. */
function testAuth() {
	const sent: SignInLink[] = [];
	const auth = createAuth({
		origin: TEST_ORIGIN,
		secret: TEST_SECRET,
		db: getConnection().db,
		sendSignInLink: (link) => {
			sent.push(link);
		}
	});
	return { auth, sent };
}

function commandLineLink(email: string, options: { allowHomeCreation?: boolean } = {}) {
	return createCommandLineSignInLink(
		{ origin: TEST_ORIGIN, secret: TEST_SECRET, db: getConnection().db },
		{ email, ...options }
	);
}

const tokenOf = (url: string) => new URL(url).searchParams.get('token') ?? '';

/** Uses a sign-in link the way the confirmation page does. */
async function useLink(url: string) {
	const { auth } = testAuth();
	return auth.api.magicLinkVerify({ query: { token: tokenOf(url) }, headers: new Headers() });
}

describe('command-line sign-in link', () => {
	it('creates the account, which may create a home', async () => {
		const link = await commandLineLink('  Owner@Example.com ');

		expect(link).toMatchObject({ email: 'owner@example.com', created: true, canCreateHome: true });
		expect(link.url).toMatch(/^http:\/\/localhost:5173\/sign-in\/link\?token=\w{32}$/);
		expect(accountExists('owner@example.com')).toBe(true);
	});

	it('signs in once, then no more', async () => {
		const link = await commandLineLink('owner@example.com');

		const result = await useLink(link.url);
		expect(result.user).toMatchObject({ email: 'owner@example.com', emailVerified: true });
		expect(result.session.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);

		await expect(useLink(link.url)).rejects.toThrow();
	});

	it(`stops working after ${SIGN_IN_LINK_MINUTES} minutes`, async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const link = await commandLineLink('owner@example.com');

		vi.setSystemTime(Date.now() + (SIGN_IN_LINK_MINUTES * 60 + 1) * 1000);

		await expect(useLink(link.url)).rejects.toThrow();
	});

	it("doesn't let an existing account create a home unless asked to", async () => {
		const invited = insertUser('invited@example.com');

		const link = await commandLineLink('invited@example.com');

		expect(link).toMatchObject({ created: false, canCreateHome: false });
		expect(mayCreateHome(invited)).toBe(false);
		expect((await useLink(link.url)).user.email).toBe('invited@example.com');
	});

	it('lets an existing account create a home when asked to', async () => {
		const invited = insertUser('invited@example.com');

		const link = await commandLineLink('invited@example.com', { allowHomeCreation: true });

		expect(link).toMatchObject({ created: false, canCreateHome: true });
		expect(mayCreateHome(invited)).toBe(true);
	});

	it('rejects something that is not an email address', async () => {
		await expect(commandLineLink('not an address')).rejects.toThrow('not a valid email address');
	});
});

describe('emailed sign-in link', () => {
	it('signs in an existing account', async () => {
		insertUser('alice@example.com');
		const { auth, sent } = testAuth();

		await auth.api.signInMagicLink({
			body: { email: 'alice@example.com' },
			headers: new Headers()
		});

		expect(sent).toHaveLength(1);
		expect(sent[0].email).toBe('alice@example.com');
		expect((await useLink(sent[0].url)).user.email).toBe('alice@example.com');
	});

	it('never creates an account: there is no open sign-up', async () => {
		const { auth, sent } = testAuth();

		await auth.api.signInMagicLink({
			body: { email: 'stranger@example.com' },
			headers: new Headers()
		});

		await expect(useLink(sent[0].url)).rejects.toThrow();
		expect(accountExists('stranger@example.com')).toBe(false);
	});

	it('is a plain-text email with the link and how long it lasts', () => {
		const email = signInLinkEmail({ email: 'alice@example.com', url: 'https://x.test/a?token=t' });

		expect(email.to).toBe('alice@example.com');
		expect(email.text).toContain('\nhttps://x.test/a?token=t\n');
		expect(email.text).toContain(`within ${SIGN_IN_LINK_MINUTES} minutes`);
	});
});

describe('sessions', () => {
	it('use an HTTP-only, SameSite=Lax cookie, and can be revoked', async () => {
		const link = await commandLineLink('owner@example.com');
		const { auth } = testAuth();
		const { headers: response, response: result } = await auth.api.magicLinkVerify({
			query: { token: tokenOf(link.url) },
			headers: new Headers(),
			returnHeaders: true
		});
		const setCookie = response.get('set-cookie') ?? '';
		expect(setCookie).toMatch(/^chloris\.session_token=[^;]+;.*HttpOnly/i);
		expect(setCookie).toMatch(/SameSite=Lax/i);
		const session = result.session;
		const headers = new Headers({ cookie: setCookie.split(';')[0] });

		expect((await auth.api.getSession({ headers }))?.user.email).toBe('owner@example.com');
		await auth.api.revokeSession({ body: { token: session.token }, headers });
		expect(await auth.api.getSession({ headers })).toBeNull();
	});

	it('use a Secure cookie when the origin is https://', async () => {
		const origin = 'https://plants.example.com';
		const db = getConnection().db;
		const link = await createCommandLineSignInLink(
			{ origin, secret: TEST_SECRET, db },
			{ email: 'owner@example.com' }
		);
		const auth = createAuth({ origin, secret: TEST_SECRET, db, sendSignInLink: () => {} });

		const { headers } = await auth.api.magicLinkVerify({
			query: { token: tokenOf(link.url) },
			headers: new Headers(),
			returnHeaders: true
		});

		expect(headers.get('set-cookie')).toMatch(/^__Secure-chloris\.session_token=[^;]+;.*Secure/i);
	});
});
