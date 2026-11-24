import { expect, test, type Page } from '@playwright/test';
import {
	addPlant,
	addRoom,
	addSchedule,
	createInvite,
	joinWithNewAccount,
	logOtherCare,
	londonDate,
	newOwner,
	newPhone,
	post
} from './helpers';

/**
 * The Today view, the home page: what's due, room by room, and what's been done today (D34).
 * Homes made by `newOwner()` are in Europe/London, so dates are worked out there.
 */

/** Adds a plant to a room, watered every 7 days and last watered 8 days ago: a day overdue. */
async function addDuePlant(page: Page, nickname: string, room: string): Promise<string> {
	const id = await addPlant(page, nickname, room);
	await addSchedule(page, 'Watering', 7);
	await logOtherCare(page, { doneAt: `${londonDate(-8)}T08:30` });
	await expect(page.getByRole('status')).toContainText('Logged: Watered');
	return id;
}

const room = (page: Page, name: string) => page.getByRole('region', { name });
const plant = (page: Page, roomName: string, name: string) =>
	room(page, roomName).getByRole('listitem', { name, exact: true });
const doneToday = (page: Page) => page.getByRole('region', { name: 'Done today' });
const status = (page: Page) => page.getByRole('status');

test('the home page gathers what is due, and one tap logs it', async ({ page }) => {
	await newOwner(page, 'Today flat');
	await expect(page.getByText('Nothing to look after yet')).toBeVisible();
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	const fern = await addPlant(page, 'Fern', 'Kitchen');
	await page.goto('/');
	await expect(page.getByText('No regular care yet')).toBeVisible();

	// A new schedule isn't due straight away (D20), so the page says what's next.
	await page.goto(`/plants/${fern}`);
	await addSchedule(page, 'Watering', 7);
	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
	await expect(page.getByText('Nothing needs doing today')).toBeVisible();
	await expect(page.locator('main')).toContainText('Next up is watering for Fern, on ');

	// Watered eight days ago: a day overdue.
	await page.goto(`/plants/${fern}`);
	await logOtherCare(page, { doneAt: `${londonDate(-8)}T08:30` });
	await expect(status(page)).toContainText('Logged: Watered');
	await page.goto('/');
	await expect(plant(page, 'Kitchen', 'Fern')).toContainText('Overdue by 1 day');
	// "Water all" is for two plants or more.
	await expect(room(page, 'Kitchen').getByRole('button', { name: /^Water all/ })).toHaveCount(0);

	// One tap logs it, and it moves to what's been done today.
	await page.getByRole('button', { name: 'Done watering Fern' }).click();
	await expect(status(page)).toContainText('Watering logged for Fern.');
	await expect(room(page, 'Kitchen')).toHaveCount(0);
	await expect(page.getByText('Nothing needs doing today')).toBeVisible();
	await expect(doneToday(page).getByRole('listitem')).toHaveCount(1);
	await expect(doneToday(page)).toContainText(/Fern\s*Watered, \d\d:\d\d, by you/);

	// Undo puts it back.
	await status(page).getByRole('button', { name: 'Undo' }).click();
	await expect(status(page)).toHaveText('Removed watering for Fern.');
	await expect(plant(page, 'Kitchen', 'Fern')).toContainText('Overdue by 1 day');
	await expect(doneToday(page)).toHaveCount(0);

	// "Not needed" puts it off by the recheck delay.
	await page.getByRole('button', { name: 'Checked Fern, watering not needed' }).click();
	await expect(status(page)).toContainText('Checked Fern: watering not needed.');
	await expect(page.locator('main')).toContainText(
		`Next up is watering for Fern, on ${new Intl.DateTimeFormat('en-GB', {
			timeZone: 'UTC',
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		})
			.format(new Date(`${londonDate(2)}T00:00:00Z`))
			.replace(',', '')}.`
	);
	await expect(doneToday(page)).toContainText('Checked, watering not needed');

	// Care done today is removed in two taps.
	await doneToday(page).locator('summary', { hasText: 'Remove' }).click();
	await doneToday(page).getByRole('button', { name: 'Remove from today' }).click();
	await expect(status(page)).toHaveText('Removed watering check for Fern.');
	await expect(plant(page, 'Kitchen', 'Fern')).toContainText('Overdue by 1 day');
});

test('"Water all" waters the plants that still need it, and one Undo takes it back', async ({
	page,
	browser
}, testInfo) => {
	await newOwner(page, 'Busy flat');
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	await addRoom(page, 'Hall');
	await addDuePlant(page, 'Fern', 'Kitchen');
	await addDuePlant(page, 'Ivy', 'Kitchen');
	await addDuePlant(page, 'basil', 'Kitchen');
	await addDuePlant(page, 'Cactus', 'Hall');
	await page.goto('/');
	const link = await createInvite(page, 'Carer');
	const carer = await newPhone(browser, testInfo);
	await joinWithNewAccount(carer, link, 'Busy flat', 'Cara');

	// Rooms and plants in name order, each room with its own "Water all". A plant's link holds
	// its tile's initial too, so its name is matched within the link's text.
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Hall', 'Kitchen']);
	await expect(room(page, 'Kitchen').getByRole('link')).toHaveText([/basil/, /Fern/, /Ivy/]);
	await expect(room(page, 'Hall').getByRole('button', { name: /^Water all/ })).toHaveCount(0);

	// Meanwhile, Cara waters Ivy from her phone.
	await carer.getByRole('button', { name: 'Done watering Ivy' }).click();
	await expect(status(carer)).toContainText('Watering logged for Ivy.');

	// The owner's page still lists Ivy, but watering the room leaves it alone.
	await page.getByRole('button', { name: 'Water all 3 in Kitchen' }).click();
	await expect(status(page)).toContainText('Watering logged for basil and Fern.');
	await expect(status(page)).toContainText("Not logged, as watering isn't due any more: Ivy.");
	await expect(room(page, 'Kitchen')).toHaveCount(0);
	await expect(plant(page, 'Hall', 'Cactus')).toContainText('Overdue by 1 day');
	await expect(doneToday(page).getByRole('listitem')).toHaveCount(3);
	await expect(doneToday(page).getByRole('listitem').filter({ hasText: 'Ivy' })).toContainText(
		'by Cara'
	);
	// Only your own care can be removed.
	await expect(doneToday(page).locator('summary', { hasText: 'Remove' })).toHaveCount(2);
	const owners = await doneToday(page)
		.getByRole('listitem')
		.filter({ hasText: 'Fern' })
		.locator('input[name="eventId"]')
		.inputValue();
	expect(await post(carer, '/?/undo', { eventId: owners })).toBe(403);

	// One Undo takes back the room's watering.
	await status(page).getByRole('button', { name: 'Undo' }).click();
	await expect(status(page)).toHaveText('Removed watering for basil and Fern.');
	await expect(room(page, 'Kitchen').getByRole('link')).toHaveText([/basil/, /Fern/]);
	await expect(doneToday(page).getByRole('listitem')).toHaveCount(1);

	// Cara sees the same list.
	await carer.reload();
	await expect(room(carer, 'Kitchen').getByRole('link')).toHaveText([/basil/, /Fern/]);
	await expect(doneToday(carer)).toContainText(/Ivy\s*Watered, \d\d:\d\d, by you/);
});

test('a viewer sees what is due but logs nothing; outsiders reach nothing', async ({
	page,
	browser
}, testInfo) => {
	await newOwner(page, 'Watched flat');
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	const fern = await addDuePlant(page, 'Fern', 'Kitchen');
	await addDuePlant(page, 'Ivy', 'Kitchen');
	await page.goto('/');
	await page.getByRole('button', { name: 'Done watering Ivy' }).click();
	await expect(doneToday(page).getByRole('listitem')).toHaveCount(1);
	const watered = await doneToday(page).locator('input[name="eventId"]').inputValue();
	const link = await createInvite(page, 'Viewer');

	const viewer = await newPhone(browser, testInfo);
	await joinWithNewAccount(viewer, link, 'Watched flat', 'Vic');
	await expect(plant(viewer, 'Kitchen', 'Fern')).toContainText('Overdue by 1 day');
	await expect(doneToday(viewer)).toContainText(/Ivy\s*Watered, \d\d:\d\d, by owner-/);
	await expect(viewer.getByRole('button')).toHaveCount(0);
	await expect(viewer.locator('summary', { hasText: 'Remove' })).toHaveCount(0);
	await expect(viewer.getByRole('link', { name: 'Invite someone' })).toHaveCount(0);

	// Its requests are refused, even sent directly.
	const water = { task: 'water', outcome: 'done', plantId: fern };
	expect(await post(viewer, '/?/log', water)).toBe(403);
	expect(await post(viewer, '/?/undo', { eventId: watered })).toBe(403);

	// Someone from another home can't log care on the plant, nor find the care to remove.
	const outsider = await newPhone(browser, testInfo);
	await newOwner(outsider, 'Other house');
	expect(await post(outsider, '/?/log', water)).toBe(404);
	expect(await post(outsider, '/?/undo', { eventId: watered })).toBe(400);

	// Nothing changed.
	await page.goto('/');
	await expect(plant(page, 'Kitchen', 'Fern')).toContainText('Overdue by 1 day');
	await expect(doneToday(page).getByRole('listitem')).toHaveCount(1);
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('a room is watered, the watering undone, and one plant done', async ({ page }) => {
		await newOwner(page, 'Plain today flat');
		await page.goto('/rooms');
		await addRoom(page, 'Kitchen');
		await addDuePlant(page, 'Fern', 'Kitchen');
		await addDuePlant(page, 'Ivy', 'Kitchen');
		await page.goto('/');

		await page.getByRole('button', { name: 'Water all 2 in Kitchen' }).click();
		await expect(status(page)).toContainText('Watering logged for Fern and Ivy.');
		await expect(room(page, 'Kitchen')).toHaveCount(0);

		await status(page).getByRole('button', { name: 'Undo' }).click();
		await expect(status(page)).toHaveText('Removed watering for Fern and Ivy.');

		await page.getByRole('button', { name: 'Done watering Ivy' }).click();
		await expect(status(page)).toContainText('Watering logged for Ivy.');
		await expect(room(page, 'Kitchen').getByRole('link')).toHaveText([/Fern/]);
	});
});
