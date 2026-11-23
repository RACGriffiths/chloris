import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { serverEnv } from './server-env';

/** Runs the built command-line tool against the test server's database and returns the link. */
function signInLink(email: string): string {
	const output = execFileSync(process.execPath, ['build/cli', 'sign-in-link', email], {
		env: { ...process.env, ...serverEnv },
		encoding: 'utf8'
	});
	const url = /^\s+(http\S+)$/m.exec(output)?.[1];
	if (!url) throw new Error(`No sign-in link in:\n${output}`);
	return url;
}

let accounts = 0;
/** A new address for each test, since the tests share one database. */
const newEmail = (name: string) => `${name}-${Date.now()}-${++accounts}@example.com`;

/** A passkey authenticator built into the browser, which always says yes. */
async function addVirtualAuthenticator(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	return cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
}

async function useLink(page: Page, link: string) {
	await page.goto(link);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function createHome(page: Page, name: string) {
	await expect(page.getByRole('heading', { name: 'Set up your home' })).toBeVisible();
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Time zone').selectOption('Europe/London');
	await page.getByRole('button', { name: 'Create home' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

test('the first owner signs in with a link, adds a passkey, then signs in with it', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	const email = newEmail('owner');

	await useLink(page, signInLink(email));
	await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible();
	await page.getByRole('button', { name: 'Add a passkey' }).click();
	await createHome(page, 'Test flat');

	await page.getByRole('link', { name: 'Account' }).click();
	await expect(page.getByText(email)).toBeVisible();
	await expect(page.getByText('Chrome on Android')).toHaveCount(2); // the passkey and the session

	// Signing out lands on the sign-in page, where the browser offers the passkey in the email
	// field's autofill. Chrome's test authenticator accepts at once, so it signs straight back in.
	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test flat');

	// In a browser without passkey autofill, the button signs in.
	await page.context().clearCookies();
	await page.addInitScript(() => {
		PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
	});
	await page.goto('/sign-in');
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test flat');
});

test('a sign-in link works only once', async ({ page, browser }) => {
	const link = signInLink(newEmail('once'));
	await useLink(page, link);
	await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible();

	const other = await browser.newPage();
	await useLink(other, link);
	await expect(other.getByRole('heading', { name: "This link doesn't work" })).toBeVisible();
	await other.close();
});

test('opening a sign-in link does not use it up', async ({ page }) => {
	const link = signInLink(newEmail('scanned'));
	// What a mail scanner does: fetch the page without pressing anything.
	expect((await page.request.get(link)).ok()).toBe(true);

	await useLink(page, link);
	await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible();
});

test('an invented token is refused', async ({ page }) => {
	await useLink(page, '/sign-in/link?token=not-a-real-token');
	await expect(page.getByRole('heading', { name: "This link doesn't work" })).toBeVisible();
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('a sign-in link signs in, and the home can be created', async ({ page }) => {
		await useLink(page, signInLink(newEmail('nojs')));
		await page.getByRole('link', { name: 'Not now' }).click();
		await createHome(page, 'Plain flat');
	});
});

test('signed-out visitors are sent to sign in', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL('/sign-in');
	await expect(page).toHaveTitle('Sign in · Chloris');

	await page.goto('/account');
	await expect(page).toHaveURL('/sign-in');
});

test('with email off, the sign-in page says so', async ({ page }) => {
	await page.goto('/sign-in');
	await expect(page.getByText('Sign-in links by email are switched off')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toHaveCount(0);
});

test('the browser can reach only the passkey endpoints of BetterAuth', async ({ request }) => {
	expect((await request.get('/api/auth/get-session')).status()).toBe(404);
	expect((await request.post('/api/auth/organization/create', { data: {} })).status()).toBe(404);
	expect(
		(
			await request.post('/api/auth/sign-in/magic-link', { data: { email: 'a@example.com' } })
		).status()
	).toBe(404);
	expect((await request.get('/api/auth/passkey/generate-authenticate-options')).status()).toBe(200);
});
