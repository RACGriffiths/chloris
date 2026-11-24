import { expect, test } from '@playwright/test';
import {
	createInvite,
	joinWithNewAccount,
	newOwner,
	newPhone,
	post,
	readMail,
	useLink
} from './helpers';
import { emailOrigin, emailServerEnv } from './server-env';

/**
 * The Notifications page, where each person sets their daily digest (D47, D50). The usual test
 * server has email off; the tests that need it on use the second server (`emailOrigin`), whose
 * mail goes to the pretend mail server.
 */

test('with email off, there is no digest to set', async ({ page }) => {
	await page.goto('/account/notifications');
	await expect(page).toHaveURL('/sign-in');

	await newOwner(page, 'Quiet flat');
	await page.goto('/account');
	const digest = page.getByRole('link', { name: /Daily digest/ });
	await expect(digest).toContainText('Off: email is switched off on this server');
	await digest.click();

	await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
	await expect(page.getByText('Email is switched off on this server')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
	const form = {
		channel: 'email',
		digestTime: '08:00',
		quietHours: '',
		quietStart: '',
		quietEnd: ''
	};
	expect(await post(page, '/account/notifications?/save', form)).toBe(400);
});

test.describe('with email on', () => {
	test.use({ baseURL: emailOrigin });

	test('choosing the time and quiet hours', async ({ page }) => {
		await newOwner(page, 'Digest flat', emailServerEnv);
		await page.goto('/account');
		const digest = page.getByRole('link', { name: /Daily digest/ });
		await expect(digest).toContainText('By email at 08:00');
		await digest.click();
		await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();

		// Until chosen: by email at 08:00, with quiet hours from 22:00 to 07:00.
		const time = page.getByLabel('Time', { exact: true });
		const quiet = page.getByRole('checkbox', { name: 'Send nothing between these times' });
		const from = page.getByLabel('From', { exact: true });
		await expect(page.getByRole('radio', { name: /^By email/ })).toBeChecked();
		await expect(time).toHaveValue('08:00');
		await expect(quiet).toBeChecked();
		await expect(from).toHaveValue('22:00');
		await expect(page.getByLabel('Until', { exact: true })).toHaveValue('07:00');
		await expect(page.getByText("In the home's time zone, Europe/London.")).toBeVisible();

		// A time inside quiet hours is refused, and what was typed stays.
		await time.fill('06:30');
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText("That's in your quiet hours, 22:00 to 07:00.")).toBeVisible();
		await expect(time).toHaveValue('06:30');
		await expect(quiet).toBeChecked();

		// Without quiet hours it's fine. Their times are hidden while the box is unticked.
		await quiet.uncheck();
		await expect(from).toBeHidden();
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('status')).toHaveText('Saved.');

		await page.reload();
		await expect(time).toHaveValue('06:30');
		await expect(quiet).not.toBeChecked();
		await page.goto('/account');
		await expect(digest).toContainText('By email at 06:30');
	});

	test('turning the digest off, without JavaScript', async ({ browser }, testInfo) => {
		const page = await newPhone(browser, testInfo, {
			javaScriptEnabled: false,
			baseURL: emailOrigin
		});
		await newOwner(page, 'Plain digest flat', emailServerEnv);
		await page.goto('/account/notifications');

		await page.getByRole('radio', { name: 'Off', exact: true }).check();
		// The time is hidden while the digest is off, by CSS alone.
		await expect(page.getByLabel('Time', { exact: true })).toBeHidden();
		await page.getByRole('button', { name: 'Save' }).click();

		await expect(page.getByRole('status')).toHaveText('Saved.');
		await expect(page.getByRole('radio', { name: 'Off', exact: true })).toBeChecked();
		await page.goto('/account');
		const digest = page.getByRole('link', { name: /Daily digest/ });
		await expect(digest).toContainText('Off');
		await expect(digest).not.toContainText('By email');
	});

	test('someone who joined by invite confirms their address with a sign-in link', async ({
		page,
		browser
	}, testInfo) => {
		await newOwner(page, 'Shared digest flat', emailServerEnv);
		const link = await createInvite(page, 'Carer');
		const invitee = await newPhone(browser, testInfo, { baseURL: emailOrigin });
		const email = await joinWithNewAccount(invitee, link, 'Shared digest flat', 'Robin');

		await invitee.goto('/account');
		const digest = invitee.getByRole('link', { name: /Daily digest/ });
		await expect(digest).toContainText('By email at 08:00, once you confirm your address');
		await digest.click();
		await expect(invitee.getByText('Confirm your email address')).toBeVisible();
		await invitee.getByRole('button', { name: 'Email me a sign-in link' }).click();
		await expect(invitee.getByText('Check your email')).toBeVisible();

		let mail: string[] = [];
		await expect.poll(async () => (mail = await readMail(email)).length).toBe(1);
		expect(mail[0]).toContain('Subject: Your Chloris sign-in link');
		const signIn = /http:\/\/localhost:\d+\/sign-in\/link\?token=[^\s"]+/.exec(mail[0])?.[0] ?? '';
		expect(signIn).not.toBe('');

		await useLink(invitee, signIn);
		await expect(invitee.getByRole('heading', { name: 'Welcome, Robin' })).toBeVisible();
		await invitee.goto('/account/notifications');
		await expect(invitee.getByRole('heading', { name: 'Notifications' })).toBeVisible();
		await expect(invitee.getByText('Confirm your email address')).toHaveCount(0);
		await invitee.goto('/account');
		await expect(digest).toContainText('By email at 08:00');
		await expect(digest).not.toContainText('confirm');
	});
});
