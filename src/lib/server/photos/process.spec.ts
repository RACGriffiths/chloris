import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { MAX_PHOTO_BYTES } from '../../photos';
import { testJpeg } from '../testing';
import { oneAtATime, processPhoto, sniffFormat } from './process';

const ascii = (text: string) => new TextEncoder().encode(text);

/** The start of a HEIC file from an iPhone: a box size, `ftyp`, then its brand. */
const heic = new Uint8Array([
	0,
	0,
	0,
	0x18,
	...ascii('ftypheic'),
	0,
	0,
	0,
	0,
	...ascii('mif1heic')
]);

async function processed(input: Uint8Array) {
	const result = await processPhoto(input);
	if (!result.ok) throw new Error(`Refused: ${result.problem}`);
	return result.photo;
}

describe('processPhoto', () => {
	it('makes a square thumbnail, a medium and a full size, all JPEGs without metadata', async () => {
		const original = await testJpeg({
			width: 3000,
			height: 2000,
			exif: {
				IFD0: { Make: 'TestCam', Model: 'Secret 9000' },
				IFD2: { DateTimeOriginal: '2025:05:03 14:22:10', OffsetTimeOriginal: '+01:00' },
				IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' }
			}
		});

		const photo = await processed(original);

		expect(photo.taken).toEqual({ local: '2025-05-03T14:22:10', offset: '+01:00' });
		expect([photo.width, photo.height]).toEqual([2560, 1707]);
		const sizes = { thumb: [400, 400], medium: [1280, 854], full: [2560, 1707] };
		for (const [size, [width, height]] of Object.entries(sizes)) {
			const file = photo.files[size as keyof typeof sizes];
			const metadata = await sharp(file).metadata();
			expect(metadata, size).toMatchObject({ format: 'jpeg', width, height });
			expect(metadata.exif, size).toBeUndefined();
			expect(metadata.xmp, size).toBeUndefined();
			expect(metadata.icc, size).toBeUndefined();
			expect(file.includes('TestCam'), size).toBe(false);
		}
	});

	it('turns a photo the right way up before its orientation tag is dropped', async () => {
		// Stored on its side, 600 by 400; shown as a portrait photo, 400 by 600.
		const sideways = await testJpeg({ width: 600, height: 400, orientation: 6 });

		const photo = await processed(sideways);

		expect([photo.width, photo.height]).toEqual([400, 600]);
		const full = await sharp(photo.files.full).metadata();
		expect([full.width, full.height, full.orientation]).toEqual([400, 600, undefined]);
	});

	it('keeps a small photo at its own size, apart from the square thumbnail', async () => {
		const photo = await processed(await testJpeg({ width: 300, height: 200 }));

		expect([photo.width, photo.height]).toEqual([300, 200]);
		expect((await sharp(photo.files.medium).metadata()).width).toBe(300);
		expect((await sharp(photo.files.thumb).metadata()).width).toBe(400);
		expect(photo.taken).toBeNull();
	});

	it('accepts PNG and WebP, putting a transparent background on white', async () => {
		const transparent = sharp({
			create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
		});

		for (const input of [
			await transparent.clone().png().toBuffer(),
			await transparent.clone().webp().toBuffer()
		]) {
			const photo = await processed(input);
			const { data } = await sharp(photo.files.full).raw().toBuffer({ resolveWithObject: true });
			expect([...data.subarray(0, 3)].every((value) => value > 245)).toBe(true);
		}
	});

	it('converts a photo with a wide-gamut colour profile to sRGB and drops the profile', async () => {
		const p3 = await sharp({
			create: { width: 64, height: 64, channels: 3, background: '#ff0000' }
		})
			.withIccProfile('p3')
			.jpeg()
			.toBuffer();
		expect((await sharp(p3).metadata()).icc).toBeDefined();

		const photo = await processed(p3);

		expect((await sharp(photo.files.full).metadata()).icc).toBeUndefined();
	});

	it('refuses HEIC with its own reason, so the page can ask for a JPEG', async () => {
		expect(await processPhoto(heic)).toEqual({ ok: false, problem: 'heic' });
	});

	it('refuses types off the allow-list, whatever the file claims to be', async () => {
		const svg = ascii('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
		const base = sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } });

		for (const input of [
			svg,
			await base.clone().gif().toBuffer(),
			await base.clone().tiff().toBuffer(),
			await base.clone().avif().toBuffer(),
			ascii('plain text')
		]) {
			expect(await processPhoto(input)).toEqual({ ok: false, problem: 'unsupported' });
		}
	});

	it('refuses a file that is too big, before decoding it', async () => {
		const huge = new Uint8Array(MAX_PHOTO_BYTES + 1);
		huge.set([0xff, 0xd8, 0xff]);

		expect(await processPhoto(huge)).toEqual({ ok: false, problem: 'too-big' });
	});

	it('refuses an image with more pixels than the limit', async () => {
		const jpeg = await testJpeg({ width: 600, height: 400 });

		expect(await processPhoto(jpeg, { maxPixels: 200_000 })).toEqual({
			ok: false,
			problem: 'too-many-pixels'
		});
	});

	it('refuses a file that must be decoded whole if it would hold too much memory', async () => {
		const image = () =>
			sharp({ create: { width: 100, height: 100, channels: 3, background: '#3a7d44' } });
		const toBuffer = (made: ReturnType<typeof image>) => made.toBuffer();
		// 100 × 100 pixels of three channels: 60,000 bytes for a progressive JPEG or an interlaced
		// PNG of 16-bit colour, 30,000 for an interlaced PNG of 8-bit colour.
		const limits = { maxHeldBytes: 50_000 };
		const refused = { ok: false, problem: 'too-many-pixels' };

		const progressive = await toBuffer(image().jpeg({ progressive: true }));
		expect(await processPhoto(progressive, limits)).toEqual(refused);
		const interlaced16 = await toBuffer(image().toColourspace('rgb16').png({ progressive: true }));
		expect(await processPhoto(interlaced16, limits)).toEqual(refused);

		// sharp reads these a strip at a time, or they're small enough.
		for (const made of [
			image().jpeg(),
			image().toColourspace('rgb16').png(),
			image().png({ progressive: true })
		]) {
			expect(await processPhoto(await toBuffer(made), limits)).toMatchObject({ ok: true });
		}
	});

	it('refuses a damaged file, and logs why', async () => {
		const jpeg = await testJpeg({ width: 600, height: 400 });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(await processPhoto(jpeg.subarray(0, jpeg.length / 2))).toEqual({
			ok: false,
			problem: 'unreadable'
		});
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});
});

describe('sniffFormat', () => {
	it('knows the accepted types and HEIC from their first bytes', async () => {
		const base = sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } });

		expect(sniffFormat(await base.clone().jpeg().toBuffer())).toBe('jpeg');
		expect(sniffFormat(await base.clone().png().toBuffer())).toBe('png');
		expect(sniffFormat(await base.clone().webp().toBuffer())).toBe('webp');
		expect(sniffFormat(heic)).toBe('heic');
		expect(sniffFormat(new Uint8Array())).toBeNull();
	});
});

describe('oneAtATime', () => {
	/** A task that starts when it's run and finishes when told to. */
	function task(name: string, log: string[]) {
		let finish: (ok: boolean) => void = () => {};
		const run = () => {
			log.push(`start ${name}`);
			return new Promise<string>((resolve, reject) => {
				finish = (ok) => {
					log.push(`end ${name}`);
					if (ok) resolve(name);
					else reject(new Error(name));
				};
			});
		};
		return { run, finish: (ok = true) => finish(ok) };
	}

	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	it('starts each task only once the one before has finished, even if it failed', async () => {
		const log: string[] = [];
		const inTurn = oneAtATime();
		const [first, second, third] = ['first', 'second', 'third'].map((name) => task(name, log));

		const results = [inTurn(first.run), inTurn(second.run), inTurn(third.run)];
		await settle();
		expect(log).toEqual(['start first']);

		first.finish(false);
		await settle();
		second.finish();
		await settle();
		third.finish();

		await expect(results[0]).rejects.toThrow('first');
		await expect(results[1]).resolves.toBe('second');
		await expect(results[2]).resolves.toBe('third');
		expect(log).toEqual([
			'start first',
			'end first',
			'start second',
			'end second',
			'start third',
			'end third'
		]);
	});

	it('lets photos sent together all be processed', async () => {
		const photos = await Promise.all([testJpeg(), testJpeg({ width: 300, height: 200 })]);

		const results = await Promise.all(photos.map((photo) => processPhoto(photo)));

		expect(results.map((result) => result.ok)).toEqual([true, true]);
	});
});
