import { execFileSync } from 'node:child_process';
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { origin, serverEnv } from './server-env';

/** Runs the built command-line tool against the test server's database and returns the link. */
export function signInLink(email: string): string {
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
export const newEmail = (name: string) => `${name}-${Date.now()}-${++accounts}@example.com`;

/** A passkey authenticator built into the browser, which always says yes. */
export async function addVirtualAuthenticator(page: Page) {
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

export async function useLink(page: Page, link: string) {
	await page.goto(link);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

export async function createHome(page: Page, name: string) {
	await expect(page.getByRole('heading', { name: 'Set up your home' })).toBeVisible();
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Time zone').selectOption('Europe/London');
	await page.getByRole('button', { name: 'Create home' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

/** A page in a separate browser, with no cookies, on the same kind of phone as the test's. */
export async function newPhone(
	browser: Browser,
	testInfo: TestInfo,
	options: { javaScriptEnabled?: boolean } = {}
): Promise<Page> {
	const context = await browser.newContext({ ...testInfo.project.use, ...options });
	return context.newPage();
}

/** Signs in a new owner with the command-line tool's link and has them create a home. */
export async function newOwner(page: Page, homeName: string) {
	await useLink(page, signInLink(newEmail('owner')));
	await page.getByRole('link', { name: 'Not now' }).click();
	await createHome(page, homeName);
}

/** From the home page: makes an invite for `role` and returns its link. */
export async function createInvite(page: Page, role: 'Owner' | 'Carer' | 'Viewer') {
	await page.getByRole('link', { name: 'Invite someone' }).click();
	await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
	await page.getByRole('radio', { name: role }).check();
	await page.getByRole('button', { name: 'Create invite link' }).click();
	const link = await page.getByLabel('Invite link').inputValue();
	expect(link).toMatch(/^http:\/\/localhost:\d+\/invite\/[\w-]{43}$/);
	return link;
}

export async function joinWithNewAccount(page: Page, link: string, homeName: string, name: string) {
	await page.goto(link);
	await expect(page.getByRole('heading', { name: `Join ${homeName}` })).toBeVisible();
	await page.getByLabel('Your name').fill(name);
	await page.getByLabel('Email').fill(newEmail(name.toLowerCase()));
	await page.getByRole('button', { name: `Join ${homeName}` }).click();
	// As after a first sign-in, a passkey is offered.
	await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
	await page.getByRole('link', { name: 'Not now' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(homeName);
}

/** The id in the page's address, such as a plant's after it's added. */
export function idFromUrl(page: Page, pattern: RegExp): string {
	const id = pattern.exec(new URL(page.url()).pathname)?.[1];
	if (!id) throw new Error(`No id in ${page.url()}`);
	return id;
}

/** Sends a form to an action directly, as someone could without the page, and returns the status. */
export async function post(page: Page, path: string, form: Record<string, string>) {
	const response = await page.request.post(path, { form, headers: { origin } });
	return response.status();
}
