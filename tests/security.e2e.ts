import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import {
	addPlant,
	addRoom,
	addVirtualAuthenticator,
	createHome,
	createInvite,
	joinWithNewAccount,
	newEmail,
	newOwner,
	newPhone,
	serverLog,
	signInLink,
	useLink
} from './helpers';
import { origin } from './server-env';

/**
 * The security baseline (D55 to D57): the Content Security Policy and other headers, rate limits
 * on failed sign-ins, and the audit log.
 */

/** Collects the browser's reports of anything the Content Security Policy blocked. */
function watchPolicy(page: Page): string[] {
	const blocked: string[] = [];
	page.on('console', (message) => {
		if (/Content Security Policy/i.test(message.text())) blocked.push(message.text());
	});
	return blocked;
}

test('pages and other responses carry the security headers', async ({ page }) => {
	const response = await page.goto('/sign-in');
	const headers = response?.headers() ?? {};

	// A new nonce each time, so only the app's own scripts run.
	expect(headers['content-security-policy']).toMatch(/script-src 'self' 'nonce-[\w+/=]+'/);
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
	expect(headers['content-security-policy']).toContain("object-src 'none'");
	expect(headers).toMatchObject({
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'same-origin',
		'cross-origin-opener-policy': 'same-origin'
	});
	// The test server's origin is plain http://localhost, where HSTS means nothing.
	expect(headers).not.toHaveProperty('strict-transport-security');

	const health = await page.request.get('/api/health');
	expect(health.headers()['x-content-type-options']).toBe('nosniff');
});

test('the policy blocks nothing the app does: passkeys, forms and photo uploads', async ({
	page
}) => {
	const blocked = watchPolicy(page);
	await addVirtualAuthenticator(page);

	await useLink(page, signInLink(newEmail('owner')));
	await page.getByRole('button', { name: 'Add a passkey' }).click();
	await createHome(page, 'Strict flat');
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	await addPlant(page, 'Fern', 'Kitchen');

	// Resized in the browser before it's sent, which previews it from a `blob:` address.
	await page.getByText('Add a photo').click();
	const buffer = await sharp({
		create: { width: 1200, height: 900, channels: 3, background: '#3a7d44' }
	})
		.jpeg()
		.toBuffer();
	await page
		.getByLabel('Photo', { exact: true })
		.setInputFiles({ name: 'fern.jpg', mimeType: 'image/jpeg', buffer });
	await page.getByRole('button', { name: 'Add photo' }).click();
	await expect(page.getByText('Photo added.')).toBeVisible();

	for (const path of ['/', '/plants', '/account', '/members', '/members/audit']) {
		await page.goto(path);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	}
	expect(blocked).toEqual([]);
});

test('after too many sign-ins that fail, a visitor is refused for a while, and only they are', async ({
	browser
}, testInfo) => {
	// Each test address is a visitor of its own (ADDRESS_HEADER in tests/server-env.ts).
	const visitor = (address: string) =>
		newPhone(browser, testInfo, { extraHTTPHeaders: { 'x-forwarded-for': address } });
	const phone = await visitor('198.51.100.20');
	const useBadLink = (page: Page) =>
		page.request.post('/sign-in/link', {
			form: { token: 'not-a-real-token' },
			headers: { origin }
		});

	for (let attempt = 0; attempt < 20; attempt++) {
		expect((await useBadLink(phone)).status()).toBe(400);
	}
	expect((await useBadLink(phone)).status()).toBe(429);

	// The page says so, even for a link that works.
	await phone.goto(signInLink(newEmail('blocked')));
	await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(phone.getByRole('alert')).toHaveText(
		/^Too many sign-ins from here didn't work\. Try again in \d+ minutes\.$/
	);

	// Passkeys and invite links are refused from there too.
	const passkey = await phone.request.post('/api/auth/passkey/verify-authentication', {
		data: {},
		headers: { origin }
	});
	expect(passkey.status()).toBe(429);
	expect(await passkey.json()).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
	expect((await phone.request.get('/invite/not-a-real-token')).status()).toBe(429);

	// Someone at another address isn't affected.
	const neighbour = await visitor('198.51.100.21');
	expect((await useBadLink(neighbour)).status()).toBe(400);

	// The server's log has the failures, and the limit being used up, once.
	const log = serverLog();
	expect(log).toMatch(/A sign-in link that doesn't work was used \(198\.51\.100\.20, /);
	expect(log.match(/Limit used up on failed sign-ins from 198\.51\.100\.20;/g)).toHaveLength(1);
});

test('owners see sign-ins, invites and deletions in the audit log, and no one else can', async ({
	page,
	browser
}, testInfo) => {
	const ownerEmail = await newOwner(page, 'Logged flat');
	const owner = ownerEmail.split('@')[0];
	await page.goto('/rooms');
	await addRoom(page, 'Attic');
	await page.getByRole('link', { name: 'Edit Attic' }).click();
	await page.getByRole('button', { name: 'Delete Attic' }).click();
	await expect(page.getByRole('heading', { name: 'Rooms' })).toBeVisible();

	await page.goto('/');
	const link = await createInvite(page, 'Carer');
	const carer = await newPhone(browser, testInfo);
	await joinWithNewAccount(carer, link, 'Logged flat', 'Robin');

	await page.goto('/members');
	await page.getByRole('link', { name: 'See the audit log' }).click();
	await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
	// The owner's first sign-in came before the home, so it has no log to go in.
	await expect(page.getByRole('list', { name: 'Audit log' }).getByRole('listitem')).toHaveText([
		/^Robin joined as a carer, from an invite link\s*Today, \d\d:\d\d · Chrome on Android$/,
		// Where someone signs in from goes only in the server's log (D58).
		/^Robin signed in for the first time, from an invite link\s*Today, \d\d:\d\d$/,
		new RegExp(`^${owner} made an invite link for a carer`),
		new RegExp(`^${owner} deleted the room Attic`),
		new RegExp(`^${owner} created the home Logged flat`)
	]);

	// It's for owners only.
	expect((await carer.goto('/members/audit'))?.status()).toBe(403);
});
