import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { mailboxUrl, origin, serverEnv } from './server-env';

/**
 * Runs the built command-line tool against a test server's database and returns the link: the
 * usual server's, or with `emailServerEnv` the one with email on.
 */
export function signInLink(email: string, env: Record<string, string> = serverEnv): string {
	const output = execFileSync(process.execPath, ['build/cli', 'sign-in-link', email], {
		env: { ...process.env, ...env },
		encoding: 'utf8'
	});
	const url = /^\s+(http\S+)$/m.exec(output)?.[1];
	if (!url) throw new Error(`No sign-in link in:\n${output}`);
	return url;
}

/**
 * A new address for each test, since the tests share one database. Random, because tests run in
 * several workers at once: a time and a counter can repeat in two of them, signing two tests in
 * to one account.
 */
export const newEmail = (name: string) => `${name}-${randomUUID()}@example.com`;

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

/** Waits for the home page, the Today view, of the home called `name`. */
export async function expectHome(page: Page, name: string) {
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Today');
	await expect(page.locator('main').getByText(name, { exact: true })).toBeVisible();
}

export async function createHome(page: Page, name: string) {
	await expect(page.getByRole('heading', { name: 'Set up your home' })).toBeVisible();
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Time zone').selectOption('Europe/London');
	await page.getByRole('button', { name: 'Create home' }).click();
	await expectHome(page, name);
}

/** A page in a separate browser, with no cookies, on the same kind of phone as the test's. */
export async function newPhone(
	browser: Browser,
	testInfo: TestInfo,
	options: { javaScriptEnabled?: boolean; baseURL?: string } = {}
): Promise<Page> {
	const context = await browser.newContext({ ...testInfo.project.use, ...options });
	return context.newPage();
}

/**
 * Signs in a new owner with the command-line tool's link and has them create a home, on the usual
 * server or, with `emailServerEnv`, the one with email on. Returns their email address.
 */
export async function newOwner(
	page: Page,
	homeName: string,
	env: Record<string, string> = serverEnv
): Promise<string> {
	const email = newEmail('owner');
	await useLink(page, signInLink(email, env));
	await page.getByRole('link', { name: 'Not now' }).click();
	await createHome(page, homeName);
	return email;
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

/** Joins a home with an invite link, as someone without an account. Returns their email address. */
export async function joinWithNewAccount(
	page: Page,
	link: string,
	homeName: string,
	name: string
): Promise<string> {
	const email = newEmail(name.toLowerCase());
	await page.goto(link);
	await expect(page.getByRole('heading', { name: `Join ${homeName}` })).toBeVisible();
	await page.getByLabel('Your name').fill(name);
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: `Join ${homeName}` }).click();
	// As after a first sign-in, a passkey is offered.
	await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
	await page.getByRole('link', { name: 'Not now' }).click();
	await expectHome(page, homeName);
	return email;
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

/** A calendar date in London, `days` from today. */
export function londonDate(days = 0): string {
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
	const date = new Date(`${today}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** From a plant's page: adds a schedule for one task and comes back. */
export async function addSchedule(page: Page, task: string, days: number) {
	await page.getByRole('link', { name: 'Add a schedule' }).click();
	await expect(page.getByRole('heading', { name: 'Add a schedule' })).toBeVisible();
	// The radio button itself is hidden behind its tile, so tap the tile, as a person would.
	await page.locator('label').filter({ hasText: task }).click();
	await expect(page.getByRole('radio', { name: task })).toBeChecked();
	await page.getByLabel('How often').fill(String(days));
	await page.getByRole('button', { name: 'Add schedule' }).click();
	await expect(page.getByRole('heading', { name: 'Care', exact: true })).toBeVisible();
}

/** From a plant's page: logs care with the Log other care form. */
export async function logOtherCare(
	page: Page,
	care: { type?: string; doneAt?: string; note?: string }
) {
	const form = page.locator('details').filter({ hasText: 'Log other care' });
	// An open <details> has an empty `open` attribute; a closed one has none.
	if ((await form.getAttribute('open')) === null) await page.getByText('Log other care').click();
	if (care.type) await page.getByLabel('What you did').selectOption({ label: care.type });
	await page.getByLabel('When').fill(care.doneAt ?? '');
	await page.getByLabel('Note').fill(care.note ?? '');
	await page.getByRole('button', { name: 'Log care' }).click();
}

/** On the Rooms page: adds a room and waits for it to be listed. */
export async function addRoom(page: Page, name: string, choices: { outdoor?: boolean } = {}) {
	await page.getByLabel('Room name').fill(name);
	if (choices.outdoor) await page.getByRole('radio', { name: 'Outdoors' }).check();
	await page.getByRole('button', { name: 'Add room' }).click();
	await expect(page.getByRole('status')).toHaveText(`Added ${name}.`);
}

/** Adds a plant to a room that exists, and returns its id from its page's address. */
export async function addPlant(page: Page, nickname: string, room: string, tags = '') {
	await page.goto('/plants/new');
	await page.getByLabel('Name', { exact: true }).fill(nickname);
	await page.getByLabel('Room').selectOption({ label: room });
	if (tags) {
		await page.getByText('More details').click();
		await page.getByLabel('Tags').fill(tags);
	}
	await page.getByRole('button', { name: 'Add plant' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(nickname);
	return idFromUrl(page, /^\/plants\/([\w-]+)$/);
}

/**
 * The email sent to `address` through the server with email on, read from the pretend mail
 * server (`tests/mailbox.ts`), oldest first: each whole, with quoted-printable undone so links
 * read as they were written.
 */
export async function readMail(address: string): Promise<string[]> {
	const response = await fetch(`${mailboxUrl}/messages?to=${encodeURIComponent(address)}`);
	const messages = (await response.json()) as { raw: string }[];
	return messages.map(({ raw }) =>
		raw
			.replace(/=\r\n/g, '')
			.replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
	);
}
