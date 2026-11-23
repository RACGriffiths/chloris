import { execFileSync } from 'node:child_process';
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { serverEnv } from './server-env';

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
