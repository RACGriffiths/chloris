import { expect, test, type Page } from '@playwright/test';
import { createInvite, idFromUrl, joinWithNewAccount, newOwner, newPhone, post } from './helpers';

/**
 * The care log and schedules on a plant's page (D31, D32). Homes made by `newOwner()` are in
 * Europe/London, so dates are worked out there.
 */

/** A calendar date in London, `days` from today. */
function londonDate(days = 0): string {
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
	const date = new Date(`${today}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** Adds a plant to a home with no rooms yet, naming its first room, and returns its id. */
async function addFirstPlant(page: Page, nickname: string): Promise<string> {
	await page.goto('/plants/new');
	await page.getByLabel('Room name').fill('Kitchen');
	await page.getByRole('button', { name: 'Add room' }).click();
	await expect(page.getByLabel('Room', { exact: true })).toHaveValue(/[\w-]{36}/);
	await page.getByLabel('Name', { exact: true }).fill(nickname);
	await page.getByRole('button', { name: 'Add plant' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(nickname);
	return idFromUrl(page, /^\/plants\/([\w-]+)$/);
}

/** From a plant's page: adds a schedule for one task and comes back. */
async function addSchedule(page: Page, task: string, days: number) {
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
async function logOtherCare(page: Page, care: { type?: string; doneAt?: string; note?: string }) {
	const form = page.locator('details').filter({ hasText: 'Log other care' });
	// An open <details> has an empty `open` attribute; a closed one has none.
	if ((await form.getAttribute('open')) === null) await page.getByText('Log other care').click();
	if (care.type) await page.getByLabel('What you did').selectOption({ label: care.type });
	await page.getByLabel('When').fill(care.doneAt ?? '');
	await page.getByLabel('Note').fill(care.note ?? '');
	await page.getByRole('button', { name: 'Log care' }).click();
}

const schedule = (page: Page, task: string) =>
	page.getByRole('list', { name: 'Schedules' }).getByRole('listitem').filter({ hasText: task });
const history = (page: Page) => page.getByRole('region', { name: 'Care history' });
const status = (page: Page) => page.getByRole('status');

test('an owner schedules watering, logs it now and earlier, and undoes it', async ({ page }) => {
	await newOwner(page, 'Watering flat');
	await addFirstPlant(page, 'Fern');
	await expect(page.getByText('No regular care yet.')).toBeVisible();
	await expect(history(page).getByText('Nothing logged yet.')).toBeVisible();

	await addSchedule(page, 'Watering', 7);
	const watering = schedule(page, 'Watering');
	await expect(watering).toContainText('Due in 7 days');
	await expect(watering).toContainText('Every 7 days');
	await expect(watering).toContainText('not done yet');

	// One tap logs it, and the due date moves on.
	await watering.getByRole('button', { name: 'Done watering' }).click();
	await expect(status(page)).toContainText(/^Logged: Watered, today at \d\d:\d\d\./);
	await expect(watering).toContainText('last done today');
	await expect(history(page).getByRole('listitem')).toHaveCount(1);
	await expect(history(page)).toContainText(/Today, \d\d:\d\d, by you/);

	// Undo takes it back off the log.
	await status(page).getByRole('button', { name: 'Undo' }).click();
	await expect(status(page)).toContainText('Removed: Watered, today at');
	await expect(history(page).getByText('Nothing logged yet.')).toBeVisible();
	await expect(watering).toContainText('not done yet');

	// Watered eight days ago, with a note: a day overdue.
	await logOtherCare(page, { doneAt: `${londonDate(-8)}T08:30`, note: 'Soaked it in the sink.' });
	await expect(status(page)).toContainText('Logged: Watered');
	await expect(watering).toContainText('Overdue by 1 day');
	await expect(history(page)).toContainText('Soaked it in the sink.');
	await expect(history(page)).toContainText(', 08:30, by you');

	// Care still to come can't be logged. The picker stops at the end of today, and the server
	// refuses anything later than now.
	await expect(page.getByLabel('When')).toHaveAttribute('max', `${londonDate()}T23:59`);
	const plant = new URL(page.url()).pathname;
	const tomorrow = { type: 'feed', doneAt: `${londonDate(1)}T09:00` };
	expect(await post(page, `${plant}?/log`, tomorrow)).toBe(400);
	await page.reload();
	await expect(history(page).getByRole('listitem')).toHaveCount(1);

	// Care from the history is removed in two taps.
	await history(page).locator('summary', { hasText: 'Remove' }).click();
	await history(page).getByRole('button', { name: 'Remove from history' }).click();
	await expect(status(page)).toContainText('Removed: Watered');
	await expect(history(page).getByText('Nothing logged yet.')).toBeVisible();
});

test('"not needed" and snoozes put a task off, and doing it ends the snooze', async ({ page }) => {
	await newOwner(page, 'Snoozy flat');
	await addFirstPlant(page, 'Calathea');
	await addSchedule(page, 'Watering', 7);
	await logOtherCare(page, { doneAt: `${londonDate(-8)}T08:30` });
	const watering = schedule(page, 'Watering');
	await expect(watering).toContainText('Overdue by 1 day');

	// Checked, and the soil is still damp: ask again in two days.
	await watering.getByRole('button', { name: 'Checked, watering not needed' }).click();
	await expect(watering).toContainText('Check again in 2 days');
	await expect(history(page)).toContainText('Checked, watering not needed');
	await expect(watering.getByRole('button', { name: 'Checked, watering not needed' })).toHaveCount(
		0
	);
	await status(page).getByRole('button', { name: 'Undo' }).click();
	await expect(watering).toContainText('Overdue by 1 day');

	// Snoozed for a day, then the snooze cancelled.
	await watering.locator('summary', { hasText: 'Snooze' }).click();
	await watering.getByRole('button', { name: 'For a day' }).click();
	await expect(status(page)).toContainText(/^Snoozed watering until .+\./);
	await expect(watering).toContainText('Snoozed until');
	await watering.getByRole('button', { name: 'Cancel snooze' }).click();
	await expect(status(page)).toHaveText('Watering is no longer snoozed.');
	await expect(watering).toContainText('Overdue by 1 day');

	// Snoozed until a chosen date. Watering it ends the snooze.
	await watering.locator('summary', { hasText: 'Snooze' }).click();
	await watering.getByLabel('Until a date').fill(londonDate(10));
	await watering.getByRole('button', { name: 'Snooze', exact: true }).click();
	await expect(watering).toContainText('Snoozed until');
	await watering.getByRole('button', { name: 'Done watering' }).click();
	await expect(watering).toContainText('Due in 7 days');
});

test('schedules are added, changed and removed, keeping the care logged', async ({ page }) => {
	await newOwner(page, 'Scheduled flat');
	await addFirstPlant(page, 'Basil');
	await addSchedule(page, 'Feeding', 28);
	await addSchedule(page, 'Watering', 3);
	// Listed in a fixed order, watering first.
	await expect(page.getByRole('list', { name: 'Schedules' }).getByRole('heading')).toHaveText([
		'Watering',
		'Feeding'
	]);
	await schedule(page, 'Watering').getByRole('button', { name: 'Done watering' }).click();
	await expect(history(page).getByRole('listitem')).toHaveCount(1);

	// A task already scheduled isn't offered again.
	await page.getByRole('link', { name: 'Add a schedule' }).click();
	await expect(page.getByRole('radio', { name: 'Watering' })).toHaveCount(0);
	await page.getByRole('link', { name: 'Cancel' }).click();

	await page.getByRole('link', { name: 'Change the watering schedule: every 3 days' }).click();
	await expect(page.getByRole('heading', { name: 'Watering schedule' })).toBeVisible();
	await expect(page.getByLabel('How often')).toHaveValue('3');
	await page.getByLabel('How often').fill('5');
	await page.getByLabel('Check again after').fill('1');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(schedule(page, 'Watering')).toContainText('Every 5 days');
	await expect(schedule(page, 'Watering')).toContainText('Due in 5 days');

	await page.getByRole('link', { name: 'Change the watering schedule: every 5 days' }).click();
	await page.getByRole('button', { name: 'Remove watering schedule' }).click();
	await expect(page.getByRole('heading', { name: 'Care', exact: true })).toBeVisible();
	await expect(schedule(page, 'Watering')).toHaveCount(0);
	await expect(schedule(page, 'Feeding')).toBeVisible();
	await expect(history(page)).toContainText('Watered');
});

test('a carer logs care but can only undo their own; a viewer changes nothing; outsiders get 404', async ({
	page,
	browser
}, testInfo) => {
	await newOwner(page, 'Shared flat');
	const fern = await addFirstPlant(page, 'Fern');
	await addSchedule(page, 'Watering', 7);
	await schedule(page, 'Watering').getByRole('button', { name: 'Done watering' }).click();
	await expect(history(page).getByRole('listitem')).toHaveCount(1);
	const ownersCare = await history(page).locator('input[name="eventId"]').inputValue();
	const editLink = page.getByRole('link', { name: /^Change the watering schedule/ });
	const watering = /\/schedules\/([\w-]+)$/.exec((await editLink.getAttribute('href')) ?? '')?.[1];
	if (!watering) throw new Error('No schedule id in the edit link');
	await page.goto('/');
	const carerLink = await createInvite(page, 'Carer');
	await page.goto('/');
	const viewerLink = await createInvite(page, 'Viewer');

	// A carer sees who did what, logs care, and can take back only their own.
	const carer = await newPhone(browser, testInfo);
	await joinWithNewAccount(carer, carerLink, 'Shared flat', 'Cara');
	await carer.goto(`/plants/${fern}`);
	await expect(history(carer).locator('summary', { hasText: 'Remove' })).toHaveCount(0);
	await logOtherCare(carer, { type: 'Misted' });
	await expect(history(carer).getByRole('listitem')).toHaveCount(2);
	await expect(history(carer).getByRole('listitem').first()).toContainText('by you');
	await expect(history(carer).locator('summary', { hasText: 'Remove' })).toHaveCount(1);
	expect(await post(carer, `/plants/${fern}?/undo`, { eventId: ownersCare })).toBe(403);

	// A viewer sees the schedule and history, with nothing to change them.
	const viewer = await newPhone(browser, testInfo);
	await joinWithNewAccount(viewer, viewerLink, 'Shared flat', 'Vic');
	await viewer.goto(`/plants/${fern}`);
	await expect(schedule(viewer, 'Watering')).toContainText('Due in 7 days');
	await expect(history(viewer).getByRole('listitem')).toHaveCount(2);
	await expect(viewer.getByRole('button', { name: 'Done watering' })).toHaveCount(0);
	await expect(viewer.getByText('Log other care')).toHaveCount(0);
	await expect(viewer.getByRole('link', { name: 'Add a schedule' })).toHaveCount(0);
	await expect(viewer.getByRole('link', { name: /^Change the watering schedule/ })).toHaveCount(0);

	// The viewer's requests are refused, even sent directly.
	const plant = `/plants/${fern}`;
	expect(await post(viewer, `${plant}?/log`, { type: 'water' })).toBe(403);
	expect(await post(viewer, `${plant}?/undo`, { eventId: ownersCare })).toBe(403);
	expect(await post(viewer, `${plant}?/snooze`, { task: 'water', days: '1' })).toBe(403);
	expect(await post(viewer, `${plant}?/unsnooze`, { task: 'water' })).toBe(403);
	expect((await viewer.goto(`${plant}/schedules/new`))?.status()).toBe(403);
	expect((await viewer.goto(`${plant}/schedules/${watering}`))?.status()).toBe(403);
	const change = { intervalDays: '1', recheckDays: '1' };
	expect(await post(viewer, `${plant}/schedules/new`, { task: 'feed', ...change })).toBe(403);
	expect(await post(viewer, `${plant}/schedules/${watering}?/save`, change)).toBe(403);
	expect(await post(viewer, `${plant}/schedules/${watering}?/delete`, {})).toBe(403);

	// Someone from another home learns nothing.
	const outsider = await newPhone(browser, testInfo);
	await newOwner(outsider, 'Other house');
	expect(await post(outsider, `${plant}?/log`, { type: 'water' })).toBe(404);
	expect(await post(outsider, `${plant}?/undo`, { eventId: ownersCare })).toBe(404);
	expect(await post(outsider, `${plant}?/snooze`, { task: 'water', days: '1' })).toBe(404);
	expect((await outsider.goto(`${plant}/schedules/${watering}`))?.status()).toBe(404);
	expect(await post(outsider, `${plant}/schedules/${watering}?/delete`, {})).toBe(404);

	// Nothing changed: the owner's watering and the carer's misting are both still there.
	await page.goto(plant);
	await expect(history(page).getByRole('listitem')).toHaveCount(2);
	await expect(schedule(page, 'Watering')).toContainText('Every 7 days');
	await expect(schedule(page, 'Watering')).not.toContainText('Snoozed');
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('care is logged with a note, snoozed and undone', async ({ page }) => {
		await newOwner(page, 'Plain care flat');
		await addFirstPlant(page, 'Cactus');
		await addSchedule(page, 'Watering', 14);

		await logOtherCare(page, { doneAt: `${londonDate(-20)}T18:00`, note: 'A good soak.' });
		const watering = schedule(page, 'Watering');
		await expect(watering).toContainText('Overdue by 6 days');
		await expect(history(page)).toContainText('A good soak.');

		await watering.locator('summary', { hasText: 'Snooze' }).click();
		await watering.getByRole('button', { name: 'For 3 days' }).click();
		await expect(watering).toContainText('Snoozed until');

		await watering.getByRole('button', { name: 'Done watering' }).click();
		await expect(watering).toContainText('Due in 14 days');
		await status(page).getByRole('button', { name: 'Undo' }).click();
		await expect(status(page)).toContainText('Removed: Watered, today at');
		// Undoing doesn't bring the snooze back (D31).
		await expect(watering).toContainText('Overdue by 6 days');
	});
});
