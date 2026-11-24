import { expect, test, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
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
 * Moving plants to the Memorial and back (D43), a plant's page while it's there (D44) and the
 * Memorial view (D45). Homes made by `newOwner()` are in Europe/London, so dates are worked out
 * there.
 */

const status = (page: Page) => page.getByRole('status');
const memorial = (page: Page) => page.getByRole('region', { name: 'In the Memorial' });
const history = (page: Page) => page.getByRole('region', { name: 'Care history' });
const entries = (page: Page) =>
	page.getByRole('list', { name: 'Plants in the Memorial' }).getByRole('listitem');
const todayPlant = (page: Page, name: string) =>
	page.getByRole('region', { name: 'Kitchen' }).getByRole('listitem', { name, exact: true });
const plantLink = (page: Page, name: string) =>
	page.locator('main').getByRole('link', { name: new RegExp(`^${name}`) });

/** A calendar date as the pages show it: `14 Mar 2025`. */
function shown(date: string): string {
	return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
		new Date(`${date}T00:00:00Z`)
	);
}

/** From a plant's page: adds a small photo and waits for it. */
async function addPhoto(page: Page) {
	const buffer = await sharp({
		create: { width: 800, height: 600, channels: 3, background: '#3a7d44' }
	})
		.jpeg()
		.toBuffer();
	await page.getByText('Add a photo').click();
	await page
		.getByLabel('Photo', { exact: true })
		.setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer });
	await page.getByRole('button', { name: 'Add photo' }).click();
	await expect(status(page)).toHaveText('Photo added.');
}

/** The id of the photo an image shows, from its `src`, which may be relative to the page. */
async function shownPhoto(page: Page, image: Locator): Promise<string> {
	const src = await image.getAttribute('src');
	const id = /^\/photos\/([\w-]+)\/thumb$/.exec(new URL(src ?? '', page.url()).pathname)?.[1];
	if (!id) throw new Error(`No photo id in ${src}`);
	return id;
}

/** Moves a plant to the Memorial from its own form, and waits for its page. */
async function memorialise(page: Page, plantId: string, what: string, note = '') {
	await page.goto(`/plants/${plantId}/memorialise`);
	await page.getByRole('radio', { name: what }).check();
	await page.getByLabel('Note').fill(note);
	await page.getByRole('button', { name: 'Move to the Memorial' }).click();
	await expect(memorial(page)).toContainText(`${what} on`);
}

test('a plant goes to the Memorial with its history and photos, and comes back', async ({
	page
}) => {
	await newOwner(page, 'Memorial flat');
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	await addPlant(page, 'Ivy', 'Kitchen');
	const fern = await addPlant(page, 'Fern', 'Kitchen');
	await addSchedule(page, 'Watering', 7);
	await logOtherCare(page, { doneAt: `${londonDate(-8)}T08:30`, note: 'A good soak.' });
	await expect(status(page)).toContainText('Logged: Watered');
	await addPhoto(page);
	const photo = await shownPhoto(
		page,
		page.getByRole('region', { name: 'Photos', exact: true }).getByRole('img')
	);
	await page.goto('/');
	await expect(todayPlant(page, 'Fern')).toContainText('Overdue by 1 day');

	// From the foot of its Edit page, with today filled in.
	await page.goto(`/plants/${fern}`);
	await page.getByRole('link', { name: 'Edit Fern' }).click();
	await page.getByRole('link', { name: 'Move to the Memorial' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Move to the Memorial');
	await expect(page.getByLabel('When')).toHaveValue(londonDate());
	await page.getByRole('radio', { name: 'Died' }).check();
	await page.getByLabel('When').fill(londonDate(-1));
	await page.getByLabel('Note').fill('Too much water over the winter.');
	await page.getByRole('button', { name: 'Move to the Memorial' }).click();

	// Its page says what happened and offers no care, but keeps its history and photos.
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fern');
	await expect(memorial(page)).toContainText(`Died on ${shown(londonDate(-1))}.`);
	await expect(memorial(page)).toContainText('Too much water over the winter.');
	await expect(page.getByRole('heading', { name: 'Care', exact: true })).toHaveCount(0);
	await expect(page.getByText('Log other care')).toHaveCount(0);
	await expect(history(page)).toContainText('A good soak.');
	await expect(
		page.getByRole('region', { name: 'Photos', exact: true }).getByRole('img')
	).toHaveCount(1);

	// It has left Today and the Plants list, which now leads to the Memorial.
	await page.goto('/');
	await expect(page.locator('main')).not.toContainText('Fern');
	await page.goto('/plants');
	await expect(plantLink(page, 'Ivy')).toBeVisible();
	await expect(plantLink(page, 'Fern')).toHaveCount(0);
	await page.getByRole('link', { name: /^Memorial/ }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Memorial');
	await expect(entries(page)).toHaveCount(1);
	await expect(entries(page)).toContainText(`Died ${shown(londonDate(-1))}`);
	await expect(entries(page)).toContainText('Too much water over the winter.');
	// Shown by its cover: its latest photo, as none was chosen (D42).
	expect(await shownPhoto(page, entries(page).locator('img'))).toBe(photo);

	// The entry can be corrected, and its page leads back to the Memorial.
	await entries(page).getByRole('link').click();
	await memorial(page).getByRole('link', { name: "Change Fern's Memorial entry" }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Memorial entry');
	await expect(page.getByRole('radio', { name: 'Died' })).toBeChecked();
	await expect(page.getByLabel('When')).toHaveValue(londonDate(-1));
	await page.getByRole('radio', { name: 'Given away' }).check();
	await page.getByLabel('Note').fill('To Sam next door.');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(memorial(page)).toContainText(`Given away on ${shown(londonDate(-1))}.`);
	await expect(memorial(page)).toContainText('To Sam next door.');
	await page.getByRole('link', { name: 'Memorial', exact: true }).click();
	await expect(entries(page)).toContainText('Given away');

	// Restoring takes two taps, and brings it back with its schedule.
	await entries(page).getByRole('link').click();
	await memorial(page).locator('summary', { hasText: 'Restore' }).click();
	await memorial(page).getByRole('button', { name: 'Restore Fern' }).click();
	await expect(status(page)).toHaveText('Fern is back in Plants and Today.');
	await expect(memorial(page)).toHaveCount(0);
	await expect(page.getByRole('list', { name: 'Schedules' })).toContainText('Overdue by 1 day');
	await page.goto('/');
	await expect(todayPlant(page, 'Fern')).toContainText('Overdue by 1 day');
	await page.goto('/plants');
	await expect(plantLink(page, 'Fern')).toBeVisible();
	await expect(page.getByRole('link', { name: /^Memorial/ })).toHaveCount(0);
});

test('a plant in the Memorial keeps its room from being deleted until it is moved', async ({
	page
}) => {
	await newOwner(page, 'Moving flat');
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	await addRoom(page, 'Hall');
	const fern = await addPlant(page, 'Fern', 'Hall');
	await memorialise(page, fern, 'Sold');

	await page.goto('/rooms');
	await page.getByRole('link', { name: 'Edit Hall' }).click();
	const deleting = page.getByRole('region', { name: 'Delete this room' });
	await expect(deleting).toContainText('Fern (in the Memorial)');
	await deleting.getByRole('link', { name: /^Fern/ }).click();
	await page.getByLabel('Room', { exact: true }).selectOption({ label: 'Kitchen' });
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(memorial(page)).toContainText('Sold on');

	await page.goto('/rooms');
	await page.getByRole('link', { name: 'Edit Hall' }).click();
	await page.getByRole('button', { name: 'Delete Hall' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rooms');
	await expect(page.getByRole('link', { name: 'Edit Hall' })).toHaveCount(0);
});

test('a viewer sees the Memorial but changes nothing; outsiders get 404', async ({
	page,
	browser
}, testInfo) => {
	await newOwner(page, 'Shared memorial flat');
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	const fern = await addPlant(page, 'Fern', 'Kitchen');
	const ivy = await addPlant(page, 'Ivy', 'Kitchen');
	await addSchedule(page, 'Watering', 7);
	await memorialise(page, ivy, 'Sold', 'To a friend at work.');
	await page.goto('/');
	const link = await createInvite(page, 'Viewer');

	// A viewer sees the Memorial and the plant's entry, with nothing to change them.
	const viewer = await newPhone(browser, testInfo);
	await joinWithNewAccount(viewer, link, 'Shared memorial flat', 'Vic');
	await viewer.goto('/plants');
	await viewer.getByRole('link', { name: /^Memorial/ }).click();
	await expect(entries(viewer)).toHaveCount(1);
	await expect(entries(viewer)).toContainText('To a friend at work.');
	await entries(viewer).getByRole('link').click();
	await expect(memorial(viewer)).toContainText('Sold on');
	await expect(memorial(viewer).getByRole('link')).toHaveCount(0);
	await expect(memorial(viewer).locator('summary')).toHaveCount(0);

	// Its requests are refused, even sent directly.
	const entry = { status: 'died', statusOn: londonDate(), statusNote: '' };
	expect((await viewer.goto(`/plants/${fern}/memorialise`))?.status()).toBe(403);
	expect(await post(viewer, `/plants/${fern}/memorialise`, entry)).toBe(403);
	expect(await post(viewer, `/plants/${ivy}?/restore`, {})).toBe(403);

	// Someone from another home learns nothing, and has an empty Memorial of their own.
	const outsider = await newPhone(browser, testInfo);
	await newOwner(outsider, 'Other memorial house');
	expect((await outsider.goto(`/plants/${fern}/memorialise`))?.status()).toBe(404);
	expect(await post(outsider, `/plants/${fern}/memorialise`, entry)).toBe(404);
	expect(await post(outsider, `/plants/${ivy}?/restore`, {})).toBe(404);
	await outsider.goto('/plants/memorial');
	await expect(outsider.getByText('No plants here')).toBeVisible();

	// The server refuses what the pages don't offer: a day still to come, and care for a plant in
	// the Memorial.
	const tomorrow = { ...entry, statusOn: londonDate(1) };
	expect(await post(page, `/plants/${fern}/memorialise`, tomorrow)).toBe(400);
	expect(await post(page, `/plants/${ivy}?/log`, { type: 'water' })).toBe(400);
	expect(await post(page, `/plants/${ivy}?/snooze`, { task: 'water', days: '1' })).toBe(400);

	// Nothing changed.
	await page.goto('/plants');
	await expect(plantLink(page, 'Fern')).toBeVisible();
	await page.goto(`/plants/${ivy}`);
	await expect(memorial(page)).toContainText('Sold on');
	await expect(history(page)).toContainText('Nothing logged yet.');
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('a plant is moved to the Memorial and restored', async ({ page }) => {
		await newOwner(page, 'Plain memorial flat');
		await page.goto('/rooms');
		await addRoom(page, 'Kitchen');
		const cactus = await addPlant(page, 'Cactus', 'Kitchen');
		await page.goto(`/plants/${cactus}/edit`);
		await page.getByText('More details').click();
		await page.getByLabel('Date you got it').fill(londonDate(-30));
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cactus');

		// Sent without a choice, the form comes back saying what's missing.
		await page.goto(`/plants/${cactus}/memorialise`);
		await page.getByRole('button', { name: 'Move to the Memorial' }).click();
		await expect(page.getByText('Choose what happened.')).toBeVisible();
		await page.getByRole('radio', { name: 'Died' }).check();
		await page.getByRole('button', { name: 'Move to the Memorial' }).click();
		await expect(memorial(page)).toContainText(`Died on ${shown(londonDate())}.`);

		await page.goto('/plants/memorial');
		await expect(entries(page)).toContainText(`Died ${shown(londonDate())}`);
		await expect(entries(page)).toContainText(`Had from ${shown(londonDate(-30))}`);

		await entries(page).getByRole('link').click();
		await memorial(page).locator('summary', { hasText: 'Restore' }).click();
		await memorial(page).getByRole('button', { name: 'Restore Cactus' }).click();
		await expect(status(page)).toHaveText('Cactus is back in Plants and Today.');
		await expect(memorial(page)).toHaveCount(0);
	});
});
