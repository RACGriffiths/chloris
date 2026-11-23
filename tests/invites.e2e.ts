import { expect, test, type Page } from '@playwright/test';
import { createHome, newEmail, newPhone, signInLink, useLink } from './helpers';

/** Signs in a new owner with the command-line tool's link and has them create a home. */
async function newOwner(page: Page, homeName: string) {
	await useLink(page, signInLink(newEmail('owner')));
	await page.getByRole('link', { name: 'Not now' }).click();
	await createHome(page, homeName);
}

/** From the home page: makes an invite for `role` and returns its link. */
async function createInvite(page: Page, role: 'Owner' | 'Carer' | 'Viewer') {
	await page.getByRole('link', { name: 'Invite someone' }).click();
	await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
	await page.getByRole('radio', { name: role }).check();
	await page.getByRole('button', { name: 'Create invite link' }).click();
	const link = await page.getByLabel('Invite link').inputValue();
	expect(link).toMatch(/^http:\/\/localhost:\d+\/invite\/[\w-]{43}$/);
	return link;
}

async function joinWithNewAccount(page: Page, link: string, homeName: string, name: string) {
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

test('an owner invites someone, who joins with a new account and sees the home', async ({
	page,
	browser
}, testInfo) => {
	await newOwner(page, 'Shared flat');
	const link = await createInvite(page, 'Viewer');
	await expect(page.getByText('Copy it now')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Invites not used yet' })).toBeVisible();

	const invitee = await newPhone(browser, testInfo);
	// Opening the link, as a chat app's preview would, doesn't use it up.
	expect((await invitee.request.get(link)).ok()).toBe(true);
	await joinWithNewAccount(invitee, link, 'Shared flat', 'Robin');

	// A viewer can't invite anyone, or open the members page.
	await expect(invitee.getByRole('link', { name: 'Invite someone' })).toHaveCount(0);
	expect((await invitee.goto('/members'))?.status()).toBe(403);
	// An invited account can never create a home (D26).
	await invitee.goto('/homes/new');
	await expect(invitee.getByRole('heading', { level: 1 })).toHaveText('Shared flat');

	// The owner sees the new member, and the invite is no longer waiting.
	await page.reload();
	await expect(page.getByText('Robin', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Invites not used yet' })).toHaveCount(0);

	// The link works only once.
	const late = await newPhone(browser, testInfo);
	await late.goto(link);
	await expect(late.getByRole('heading', { name: "This invite doesn't work" })).toBeVisible();
});

test('someone signed in joins with their own account', async ({ page, browser }, testInfo) => {
	await newOwner(page, 'Garden flat');
	const link = await createInvite(page, 'Carer');

	// An account from the command-line tool that has no home yet.
	const friend = await newPhone(browser, testInfo);
	await useLink(friend, signInLink(newEmail('friend')));
	await expect(friend.getByRole('heading', { name: /^Welcome/ })).toBeVisible();
	await friend.goto(link);
	await expect(friend.getByText("You're signed in as")).toBeVisible();
	await friend.getByRole('button', { name: 'Join Garden flat' }).click();
	await expect(friend.getByRole('heading', { level: 1 })).toHaveText('Garden flat');

	// The link is used up.
	await friend.goto(link);
	await expect(friend.getByRole('heading', { name: "This invite doesn't work" })).toBeVisible();
});

test('a cancelled invite stops working', async ({ page, browser }, testInfo) => {
	await newOwner(page, 'Cancelled flat');
	const link = await createInvite(page, 'Owner');
	await expect(page.getByRole('radio', { name: 'Owner' })).toBeChecked();

	await page.getByRole('button', { name: 'Cancel this owner invite' }).click();
	await expect(page.getByRole('heading', { name: 'Invites not used yet' })).toHaveCount(0);
	// The link just made stays on screen, in case it was the one to keep.
	await expect(page.getByLabel('Invite link')).toHaveValue(link);

	const invitee = await newPhone(browser, testInfo);
	await invitee.goto(link);
	await expect(invitee.getByRole('heading', { name: "This invite doesn't work" })).toBeVisible();
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('an owner makes an invite and the invitee joins', async ({ page, browser }, testInfo) => {
		await newOwner(page, 'Plain house');
		const link = await createInvite(page, 'Carer');

		const invitee = await newPhone(browser, testInfo, { javaScriptEnabled: false });
		await joinWithNewAccount(invitee, link, 'Plain house', 'Sam');
	});
});
