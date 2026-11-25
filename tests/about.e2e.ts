import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { newOwner } from './helpers';

/** The About page (D59): the version running here, a link to its source code, and the licence. */

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
// The test server is built from this checkout, so the page names its commit.
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

test('anyone can open the About page from the sign-in page, and get the source of this version', async ({
	page
}) => {
	await page.goto('/sign-in');
	await page.getByRole('link', { name: 'About Chloris' }).click();

	await expect(page.getByRole('heading', { name: 'About Chloris', level: 1 })).toBeVisible();
	await expect(page.getByText(version, { exact: true })).toBeVisible();
	await expect(page.getByText(commit.slice(0, 7), { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Source code of this version' })).toHaveAttribute(
		'href',
		`https://github.com/RACGriffiths/chloris/tree/${commit}`
	);

	// The licence's notices: copyright, no warranty, and where to read it.
	await expect(page.getByText('Copyright © 2026 RACGriffiths.')).toBeVisible();
	await expect(page.getByText(/no warranty/)).toBeVisible();
	await expect(page.getByRole('link', { name: 'Read the licence' })).toHaveAttribute(
		'href',
		'https://www.gnu.org/licenses/agpl-3.0.html'
	);
	// The footer doesn't link the page to itself.
	await expect(page.getByRole('link', { name: 'About Chloris' })).toHaveCount(0);
});

test('the Account page shows the version and links to the About page', async ({ page }) => {
	await newOwner(page, 'Versioned flat');
	await page.goto('/account');
	await page.getByRole('link', { name: `Version ${version}` }).click();

	await expect(page.getByRole('heading', { name: 'About Chloris', level: 1 })).toBeVisible();
});
