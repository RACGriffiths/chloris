import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import {
	addPlant,
	addRoom,
	createInvite,
	joinWithNewAccount,
	newOwner,
	newPhone,
	post
} from './helpers';

/**
 * Adding and viewing photos on a plant's page (D35 to D38). Homes made by `newOwner()` are in
 * Europe/London.
 */

/**
 * A photo as a phone would take it: 3000 by 2000 pixels, stored on its side with orientation 6
 * (so it's shown 2000 wide and 3000 high), taken on 3 May 2025, with the camera's make and a GPS
 * position that must never reach the server's files.
 */
function phonePhoto(): Promise<Buffer> {
	return sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#3a7d44' } })
		.jpeg({ quality: 90 })
		.withExif({
			IFD0: { Make: 'TestCam' },
			IFD2: { DateTimeOriginal: '2025:05:03 14:22:10' },
			IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' }
		})
		.withMetadata({ orientation: 6 })
		.toBuffer();
}

const photosSection = (page: Page) => page.getByRole('region', { name: 'Photos', exact: true });
const photoList = (page: Page) => photosSection(page).getByRole('list');

/** A home with a plant called Fern, on whose page the owner ends up. */
async function ownerWithFern(page: Page, homeName: string) {
	await newOwner(page, homeName);
	await page.goto('/rooms');
	await addRoom(page, 'Kitchen');
	await addPlant(page, 'Fern', 'Kitchen');
}

/** From a plant's page: opens Add a photo, chooses a file and sends it. */
async function addPhoto(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
	const form = page.locator('details').filter({ hasText: 'Add a photo' });
	if ((await form.getAttribute('open')) === null) await page.getByText('Add a photo').click();
	await page.getByLabel('Photo', { exact: true }).setInputFiles(file);
	await page.getByRole('button', { name: 'Add photo' }).click();
}

/** The id of the photo whose thumbnail is listed at `index`. */
async function photoId(page: Page, index = 0): Promise<string> {
	// Server-rendered links are relative to the page, such as `../photos/<id>/thumb`.
	const src = await photoList(page).getByRole('img').nth(index).getAttribute('src');
	const path = new URL(src ?? '', page.url()).pathname;
	const id = /^\/photos\/([\w-]+)\/thumb$/.exec(path)?.[1];
	if (!id) throw new Error(`No photo id in ${src}`);
	return id;
}

/**
 * Has the page keep a copy of the photo it sends, since Playwright can't read a request body
 * holding a file. `use:enhance` sends forms with `fetch`, which this wraps.
 */
async function watchUploads(page: Page) {
	await page.addInitScript(() => {
		const send = window.fetch.bind(window);
		window.fetch = async (input, init) => {
			const body = init?.body;
			const photo = body instanceof FormData ? body.get('photo') : null;
			if (body instanceof FormData && photo instanceof Blob) {
				const dataUrl = await new Promise<string>((resolve) => {
					const reader = new FileReader();
					reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
					reader.readAsDataURL(photo);
				});
				Object.assign(window, { sentPhoto: { dataUrl, takenAt: body.get('takenAt') } });
			}
			return send(input, init);
		};
	});
}

/** The photo the page sent, as `watchUploads` kept it. */
async function sentPhoto(page: Page): Promise<{ bytes: Buffer; takenAt: string | null }> {
	const sent = await page.evaluate(
		() =>
			(window as unknown as { sentPhoto?: { dataUrl: string; takenAt: string | null } }).sentPhoto
	);
	if (!sent) throw new Error('No photo was sent');
	return { bytes: Buffer.from(sent.dataUrl.split(',')[1], 'base64'), takenAt: sent.takenAt };
}

/** Fetches one size of a photo as the signed-in browser would, and reads it. */
async function fetchPhoto(page: Page, id: string, size: string) {
	const response = await page.request.get(`/photos/${id}/${size}`);
	expect(response.status()).toBe(200);
	const body = await response.body();
	return { headers: response.headers(), body, metadata: await sharp(body).metadata() };
}

test('the browser resizes a photo and strips its metadata before sending it', async ({ page }) => {
	await watchUploads(page);
	await ownerWithFern(page, 'Photo flat');
	await expect(photosSection(page)).toContainText('No photos yet.');
	const original = await phonePhoto();

	await addPhoto(page, { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: original });
	await expect(page.getByRole('status')).toHaveText('Photo added.');

	// What left the phone: a JPEG turned the right way up and at most 2560 pixels, without the
	// camera's details or position, and the date it was taken sent separately.
	const sent = await sentPhoto(page);
	const sentMetadata = await sharp(sent.bytes).metadata();
	expect(sentMetadata.format).toBe('jpeg');
	expect([sentMetadata.width, sentMetadata.height]).toEqual([1707, 2560]);
	expect(sentMetadata.exif).toBeUndefined();
	expect(sent.bytes.includes('TestCam')).toBe(false);
	expect(sent.takenAt).toBe('2025-05-03T14:22:10');

	// Listed with the date it was taken, not today's.
	await expect(photoList(page).getByRole('listitem')).toHaveCount(1);
	await expect(photoList(page)).toContainText('3 May 2025');
	const thumbnail = photoList(page).getByRole('img');
	await expect(thumbnail).toHaveAttribute('alt', 'Fern, 3 may 2025');
	await expect
		.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
		.toBe(400);

	// Stored the right way up, at most 2560 pixels, with no metadata, and served privately.
	const id = await photoId(page);
	const full = await fetchPhoto(page, id, 'full');
	expect(full.headers['content-type']).toBe('image/jpeg');
	expect(full.headers['cache-control']).toBe('private, max-age=31536000, immutable');
	expect([full.metadata.width, full.metadata.height]).toEqual([1707, 2560]);
	expect(full.metadata.exif).toBeUndefined();
	const medium = await fetchPhoto(page, id, 'medium');
	expect([medium.metadata.width, medium.metadata.height]).toEqual([854, 1280]);

	// The form empties itself, ready for the next.
	await expect(page.getByLabel('Photo', { exact: true })).toHaveValue('');
});

test('a HEIC photo the browser cannot read is refused with a request for a JPEG', async ({
	page
}) => {
	await ownerWithFern(page, 'HEIC flat');
	// The start of an iPhone's HEIC file; Chrome can't decode it, so the original is sent.
	const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
	const heic = Buffer.from([0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')]);

	await addPhoto(page, { name: 'IMG_0002.HEIC', mimeType: 'image/heic', buffer: heic });

	await expect(photosSection(page)).toContainText(
		"That photo is in HEIC format, which Chloris can't read. Choose a JPEG instead."
	);
	await expect(page.getByLabel('Photo', { exact: true })).toHaveAttribute('aria-invalid', 'true');
	await expect(photosSection(page)).toContainText('No photos yet.');
});

test('only members see photos, and viewers cannot add them', async ({
	page,
	browser
}, testInfo) => {
	await ownerWithFern(page, 'Shared photo flat');
	const plant = new URL(page.url()).pathname;
	await addPhoto(page, { name: 'fern.jpg', mimeType: 'image/jpeg', buffer: await phonePhoto() });
	await expect(page.getByRole('status')).toHaveText('Photo added.');
	const id = await photoId(page);

	// A viewer sees the photo but has no form, and the server refuses the action.
	await page.goto('/');
	const link = await createInvite(page, 'Viewer');
	const viewer = await newPhone(browser, testInfo);
	await joinWithNewAccount(viewer, link, 'Shared photo flat', 'Vic');
	await viewer.goto(plant);
	await expect(photoList(viewer).getByRole('img')).toHaveCount(1);
	await expect(viewer.getByText('Add a photo')).toHaveCount(0);
	expect((await fetchPhoto(viewer, id, 'thumb')).metadata.width).toBe(400);
	expect(await post(viewer, `${plant}?/addPhoto`, { caption: 'Mine' })).toBe(403);

	// The owner of another home learns nothing of it, in any size.
	const outsider = await newPhone(browser, testInfo);
	await newOwner(outsider, 'Other photo flat');
	for (const size of ['thumb', 'medium', 'full']) {
		expect((await outsider.request.get(`/photos/${id}/${size}`)).status()).toBe(404);
	}

	// Someone signed out is sent to sign in.
	const stranger = await newPhone(browser, testInfo);
	const response = await stranger.request.get(`/photos/${id}/full`, { maxRedirects: 0 });
	expect(response.status()).toBe(303);
	expect(response.headers()['location']).toBe('/sign-in');

	// Only the three sizes exist.
	expect((await page.request.get(`/photos/${id}/original`)).status()).toBe(404);
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the original is sent, and the server reads its date and strips it', async ({ page }) => {
		await ownerWithFern(page, 'Plain photo flat');

		await addPhoto(page, {
			name: 'IMG_0003.jpg',
			mimeType: 'image/jpeg',
			buffer: await phonePhoto()
		});
		await expect(page.getByRole('status')).toHaveText('Photo added.');

		await expect(photoList(page)).toContainText('3 May 2025');
		const full = await fetchPhoto(page, await photoId(page), 'full');
		expect([full.metadata.width, full.metadata.height]).toEqual([1707, 2560]);
		expect(full.metadata.exif).toBeUndefined();
		expect(full.body.includes('TestCam')).toBe(false);
	});

	test('a file that is not a photo is refused, keeping the caption', async ({ page }) => {
		await ownerWithFern(page, 'Plain refusal flat');
		await page.getByText('Add a photo').click();
		await page.getByLabel('Caption').fill('Not really a photo');

		await page
			.getByLabel('Photo', { exact: true })
			.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
		await page.getByRole('button', { name: 'Add photo' }).click();

		await expect(photosSection(page)).toContainText('Choose a photo in JPEG, PNG or WebP format.');
		await expect(page.getByLabel('Caption')).toHaveValue('Not really a photo');
	});
});
