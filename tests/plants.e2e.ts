import { expect, test, type Page } from '@playwright/test';
import {
	addPlant,
	addRoom,
	createInvite,
	idFromUrl,
	joinWithNewAccount,
	newOwner,
	newPhone,
	post
} from './helpers';

const plantsLink = (page: Page) =>
	page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Plants' });

test('an owner adds a first plant, naming its room on the way, and sees its page', async ({
	page
}) => {
	await newOwner(page, 'Fern flat');
	await expect(page.getByText('Nothing to look after yet')).toBeVisible();
	await page.getByRole('link', { name: 'Add a plant' }).click();

	// With no rooms yet, the first room comes first.
	await expect(page.getByRole('heading', { name: 'Add a plant' })).toBeVisible();
	await page.getByLabel('Room name').fill('Kitchen');
	await page.getByRole('radio', { name: /^Bright light/ }).check();
	await page.getByRole('button', { name: 'Add room' }).click();

	// Then the plant, with that room already chosen.
	await expect(page.getByLabel('Room')).toHaveValue(/[\w-]{36}/);
	await expect(page.getByLabel('Room').locator('option:checked')).toHaveText('Kitchen');
	await page.getByLabel('Name', { exact: true }).fill('Fern');
	await page.getByLabel('Species').fill('Boston fern');
	await page.getByText('More details').click();
	await page.getByLabel('Date you got it').fill('2025-03-14');
	await page.getByLabel('Pot').fill('15 cm terracotta');
	await page.getByLabel('Tags').fill('Pet safe, humid');
	await page.getByLabel('Notes').fill('Likes the steam\nfrom the kettle.');
	await page.getByRole('button', { name: 'Add plant' }).click();

	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fern');
	await expect(page.getByText('Boston fern', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Kitchen' })).toBeVisible();
	await expect(page.getByText('14 Mar 2025')).toBeVisible();
	await expect(page.getByText('15 cm terracotta')).toBeVisible();
	await expect(page.getByRole('link', { name: 'pet safe' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'humid' })).toBeVisible();
	await expect(page.getByText('Likes the steam')).toBeVisible();
	for (const section of ['Care history', 'Photos', 'Measurements']) {
		await expect(page.getByRole('heading', { name: section })).toBeVisible();
	}

	// It's listed under its room, and the home page asks for its first schedule.
	await plantsLink(page).click();
	const kitchen = page.getByRole('region', { name: 'Kitchen' });
	await expect(kitchen.getByText('Bright light')).toBeVisible();
	await expect(kitchen.getByRole('link', { name: /Fern/ })).toBeVisible();
	await page.goto('/');
	await expect(page.getByText('No regular care yet')).toBeVisible();
});

test('a plant is edited and moved, and the list filters by room and by tag', async ({ page }) => {
	await newOwner(page, 'Moving flat');
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	await addRoom(page, 'Hall');
	await addPlant(page, 'Fern', 'Kitchen', 'pet safe');
	await addPlant(page, 'Basil', 'Kitchen', 'herb');

	await plantsLink(page).click();
	await expect(page.getByRole('region', { name: 'Kitchen' }).getByRole('listitem')).toHaveCount(2);
	await expect(page.getByText('No plants in Hall yet.')).toBeVisible();

	// Rename Fern and move it to the hall.
	await page.getByRole('link', { name: /Fern/ }).click();
	await page.getByRole('link', { name: 'Edit Fern' }).click();
	await expect(page.getByRole('heading', { name: 'Edit Fern' })).toBeVisible();
	await expect(page.getByLabel('Tags')).toHaveValue('pet safe');
	await page.getByLabel('Name', { exact: true }).fill('Fernando');
	await page.getByLabel('Room').selectOption({ label: 'Hall' });
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fernando');
	await expect(page.getByRole('link', { name: 'Hall' })).toBeVisible();

	// Its tag lists the plants that share it, across rooms.
	await page.getByRole('link', { name: 'pet safe' }).click();
	await expect(page.getByText('Plants tagged pet safe')).toBeVisible();
	await expect(page.getByRole('link', { name: /Fernando/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /Basil/ })).toHaveCount(0);
	await page.getByRole('link', { name: 'Show plants with any tag' }).click();

	// One room at a time.
	const rooms = page.getByRole('navigation', { name: 'Show one room' });
	await rooms.getByRole('link', { name: 'Kitchen' }).click();
	await expect(rooms.getByRole('link', { name: 'Kitchen' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.getByRole('link', { name: /Basil/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /Fernando/ })).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'Hall' })).toHaveCount(0);
});

test('rooms are added, renamed, and deleted only when empty', async ({ page }) => {
	await newOwner(page, 'Roomy house');
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	await addRoom(page, 'Balcony', { outdoor: true });
	await expect(page.getByRole('listitem').filter({ hasText: 'Balcony' })).toContainText('Outdoors');

	// Names are unique in a home, ignoring case.
	await page.getByLabel('Room name').fill('kitchen');
	await page.getByRole('button', { name: 'Add room' }).click();
	await expect(page.getByText("There's already a room called kitchen.")).toBeVisible();
	await expect(page.getByLabel('Room name')).toHaveValue('kitchen');

	await page.getByRole('link', { name: 'Edit Kitchen' }).click();
	await expect(page.getByRole('heading', { name: 'Edit Kitchen' })).toBeVisible();
	await page.getByLabel('Room name').fill('Galley');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('heading', { name: 'Rooms' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Galley', exact: true })).toBeVisible();

	// A room with a plant in it can't be deleted.
	await addPlant(page, 'Fig', 'Galley');
	await page.goto('/rooms');
	await page.getByRole('link', { name: 'Edit Galley' }).click();
	await expect(page.getByText('A room can be deleted only when it')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Fig' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
	const galley = idFromUrl(page, /^\/rooms\/([\w-]+)\/edit$/);
	// Not even by sending the form directly.
	expect(await post(page, `/rooms/${galley}/edit?/delete`, {})).toBe(400);

	await page.goto('/rooms');
	await page.getByRole('link', { name: 'Edit Balcony' }).click();
	await page.getByRole('button', { name: 'Delete Balcony' }).click();
	await expect(page.getByRole('heading', { name: 'Rooms' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Balcony', exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Galley', exact: true })).toBeVisible();
});

test('a viewer sees plants but gets 403 for every change; outsiders get 404', async ({
	page,
	browser
}, testInfo) => {
	await newOwner(page, 'Viewed flat');
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	const fern = await addPlant(page, 'Fern', 'Kitchen');
	await page.goto('/rooms');
	await page.getByRole('link', { name: 'Edit Kitchen' }).click();
	await page.waitForURL(/\/edit$/);
	const kitchen = idFromUrl(page, /^\/rooms\/([\w-]+)\/edit$/);
	await page.goto('/');
	const link = await createInvite(page, 'Viewer');

	const viewer = await newPhone(browser, testInfo);
	await joinWithNewAccount(viewer, link, 'Viewed flat', 'Vic');

	// A viewer sees the plants and rooms, with nothing to change them.
	await plantsLink(viewer).click();
	await expect(viewer.getByRole('link', { name: /Fern/ })).toBeVisible();
	await expect(viewer.getByRole('link', { name: 'Add plant' })).toHaveCount(0);
	await viewer.getByRole('link', { name: /Fern/ }).click();
	await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Fern');
	await expect(viewer.getByRole('link', { name: 'Edit Fern' })).toHaveCount(0);
	await viewer.goto('/rooms');
	await expect(viewer.getByRole('link', { name: 'Kitchen', exact: true })).toBeVisible();
	await expect(viewer.getByRole('link', { name: 'Edit Kitchen' })).toHaveCount(0);
	await expect(viewer.getByRole('heading', { name: 'Add a room' })).toHaveCount(0);

	// The edit pages are refused, and so are their actions when sent directly.
	expect((await viewer.goto('/plants/new'))?.status()).toBe(403);
	expect((await viewer.goto(`/plants/${fern}/edit`))?.status()).toBe(403);
	expect((await viewer.goto(`/rooms/${kitchen}/edit`))?.status()).toBe(403);
	const plant = { nickname: 'Taken', roomId: kitchen };
	expect(await post(viewer, `/plants/${fern}/edit`, plant)).toBe(403);
	expect(await post(viewer, '/plants/new?/create', plant)).toBe(403);
	expect(await post(viewer, '/plants/new?/room', { name: 'Shed', setting: 'outdoor' })).toBe(403);
	expect(await post(viewer, '/rooms?/create', { name: 'Shed', setting: 'outdoor' })).toBe(403);
	expect(await post(viewer, `/rooms/${kitchen}/edit?/save`, { name: 'Taken' })).toBe(403);
	expect(await post(viewer, `/rooms/${kitchen}/edit?/delete`, {})).toBe(403);

	// Someone from another home learns nothing: not even that the plant exists.
	const outsider = await newPhone(browser, testInfo);
	await newOwner(outsider, 'Other house');
	expect((await outsider.goto(`/plants/${fern}`))?.status()).toBe(404);
	expect(await post(outsider, `/plants/${fern}/edit`, plant)).toBe(404);
	expect(await post(outsider, `/rooms/${kitchen}/edit?/delete`, {})).toBe(404);

	// Nothing changed.
	await page.goto(`/plants/${fern}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fern');
	await page.goto('/rooms');
	await expect(page.getByRole('link', { name: 'Kitchen', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Shed', exact: true })).toHaveCount(0);
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('an owner adds a first room and plant, and edits it', async ({ page }) => {
		await newOwner(page, 'Plain flat');
		await page.goto('/plants/new');
		await page.getByLabel('Room name').fill('Study');
		await page.getByRole('button', { name: 'Add room' }).click();

		await page.getByLabel('Name', { exact: true }).fill('Cactus');
		// A problem in the hidden details opens them, with what was typed still there.
		await page.getByText('More details').click();
		await page.getByLabel('Date you got it').fill('2025-02-28');
		await page.getByLabel('Tags').fill(`desert, ${'x'.repeat(31)}`);
		await page.getByRole('button', { name: 'Add plant' }).click();
		await expect(page.getByText('Keep each tag to 30 characters or fewer.')).toBeVisible();
		await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Cactus');
		await expect(page.getByLabel('Date you got it')).toHaveValue('2025-02-28');
		await page.getByLabel('Tags').fill('desert');
		await page.getByRole('button', { name: 'Add plant' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cactus');
		await expect(page.getByText('28 Feb 2025')).toBeVisible();

		await page.getByRole('link', { name: 'Edit Cactus' }).click();
		await page.getByLabel('Species').fill('Golden barrel');
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByText('Golden barrel')).toBeVisible();
	});
});
