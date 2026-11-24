import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { exifDate, exifDateText, jpegExif, parseExifDateText } from './exif';
import { testJpeg } from './server/testing';

/** The EXIF data sharp finds in a JPEG, as the server reads it. */
async function exifOf(jpeg: Buffer): Promise<Buffer> {
	const { exif } = await sharp(jpeg).metadata();
	if (!exif) throw new Error('No EXIF data');
	return exif;
}

/**
 * A big-endian ("MM") TIFF structure by hand, since sharp writes little-endian: a first
 * directory pointing at an EXIF directory with DateTimeOriginal and, optionally, its offset.
 */
function bigEndianExif(date: string, offset?: string): Uint8Array {
	const entries = offset ? 2 : 1;
	const exifDir = 26;
	const values = exifDir + 2 + entries * 12 + 4;
	const bytes = new Uint8Array(values + 40);
	const view = new DataView(bytes.buffer);
	bytes.set([0x4d, 0x4d], 0);
	view.setUint16(2, 42);
	view.setUint32(4, 8);
	// First directory: one entry, the pointer to the EXIF directory.
	view.setUint16(8, 1);
	view.setUint16(10, 0x8769);
	view.setUint16(12, 4);
	view.setUint32(14, 1);
	view.setUint32(18, exifDir);
	view.setUint32(22, 0);
	// EXIF directory.
	view.setUint16(exifDir, entries);
	const entry = (i: number, tag: number, text: string, at: number) => {
		const start = exifDir + 2 + i * 12;
		view.setUint16(start, tag);
		view.setUint16(start + 2, 2);
		view.setUint32(start + 4, text.length + 1);
		view.setUint32(start + 8, at);
		bytes.set(
			[...text].map((c) => c.charCodeAt(0)),
			at
		);
	};
	entry(0, 0x9003, date, values);
	if (offset) entry(1, 0x9011, offset, values + 20);
	return bytes;
}

describe('exifDate', () => {
	it('reads when a photo was taken, with the offset its camera recorded', async () => {
		const jpeg = await testJpeg({
			exif: { IFD2: { DateTimeOriginal: '2025:05:03 14:22:10', OffsetTimeOriginal: '+01:00' } }
		});

		expect(exifDate(await exifOf(jpeg))).toEqual({
			local: '2025-05-03T14:22:10',
			offset: '+01:00'
		});
	});

	it('reads a date with no offset, and the digitised date when the original is missing', async () => {
		const original = await testJpeg({
			exif: { IFD2: { DateTimeOriginal: '2024:12:31 23:59:59' } }
		});
		const digitized = await testJpeg({
			exif: { IFD2: { DateTimeDigitized: '2023:01:02 03:04:05' } }
		});

		expect(exifDate(await exifOf(original))).toEqual({
			local: '2024-12-31T23:59:59',
			offset: null
		});
		expect(exifDate(await exifOf(digitized))).toEqual({
			local: '2023-01-02T03:04:05',
			offset: null
		});
	});

	it('reads big-endian data, with or without the Exif header', () => {
		const tiff = bigEndianExif('2022:07:08 09:10:11', '-05:00');
		const withHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);

		expect(exifDate(tiff)).toEqual({ local: '2022-07-08T09:10:11', offset: '-05:00' });
		expect(exifDate(withHeader)).toEqual({ local: '2022-07-08T09:10:11', offset: '-05:00' });
	});

	it('ignores the date a photo was last changed, and blank or impossible dates', async () => {
		const edited = await testJpeg({ exif: { IFD0: { DateTime: '2025:05:03 14:22:10' } } });

		expect(exifDate(await exifOf(edited))).toBeNull();
		expect(exifDate(bigEndianExif('0000:00:00 00:00:00'))).toBeNull();
		expect(exifDate(bigEndianExif('2025:13:01 00:00:00'))).toBeNull();
		expect(exifDate(bigEndianExif('2025:05:03 14:22:10', '+25:00'))).toEqual({
			local: '2025-05-03T14:22:10',
			offset: null
		});
	});

	it('gives null for data that is cut short or not EXIF at all', () => {
		const tiff = bigEndianExif('2022:07:08 09:10:11');

		for (let length = 0; length < tiff.length - 30; length += 3) {
			expect(exifDate(tiff.subarray(0, length))).toBeNull();
		}
		expect(exifDate(new TextEncoder().encode('not exif data at all'))).toBeNull();
	});
});

describe('jpegExif', () => {
	it("finds a JPEG's EXIF data, as a browser reads the file", async () => {
		const jpeg = await testJpeg({ exif: { IFD2: { DateTimeOriginal: '2025:05:03 14:22:10' } } });

		const exif = jpegExif(jpeg);
		expect(exif && exifDate(exif)).toEqual({ local: '2025-05-03T14:22:10', offset: null });
	});

	it('gives null for a JPEG without EXIF, another kind of file, or one cut short', async () => {
		const plain = await testJpeg();
		const png = await sharp(plain).png().toBuffer();
		const withExif = await testJpeg({ exif: { IFD0: { Make: 'TestCam' } } });

		expect(jpegExif(plain)).toBeNull();
		expect(jpegExif(png)).toBeNull();
		expect(jpegExif(withExif.subarray(0, 30))).toBeNull();
	});
});

describe('exifDateText', () => {
	it('round-trips through the form field, and rejects anything else', () => {
		const date = { local: '2025-05-03T14:22:10', offset: '+01:00' };

		expect(parseExifDateText(exifDateText(date))).toEqual(date);
		expect(parseExifDateText('2025-05-03T14:22:10')).toEqual({ ...date, offset: null });
		for (const bad of ['', 'yesterday', '2025-05-03', '2025-05-03T14:22', '2025-02-03T25:00:00']) {
			expect(parseExifDateText(bad), bad).toBeNull();
		}
	});
});
