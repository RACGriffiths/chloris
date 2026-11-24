import sharp, { type Sharp } from 'sharp';
import { exifDate, type ExifDate } from '../../exif';
import { MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS, PHOTO_SIZES, type PhotoSize } from '../../photos';

/**
 * Turns an uploaded image into the files Chloris stores (docs/spec.md, Photos and backups; D35):
 * checks it's a type on the allow-list, reads when it was taken, turns it the right way up, and
 * re-encodes it as a JPEG in each size. Nothing from the original's metadata survives: no GPS
 * position, camera details or colour profile.
 */

// Photos are processed one at a time and rarely, so there is nothing worth keeping in memory.
sharp.cache(false);

/**
 * Runs the tasks given to it one at a time, each after the one before has finished, whether that
 * one worked or not.
 */
export function oneAtATime(): <T>(task: () => Promise<T>) => Promise<T> {
	let previous: Promise<unknown> = Promise.resolve();
	return (task) => {
		const run = previous.then(task);
		previous = run.catch(() => undefined);
		return run;
	};
}

/**
 * Decoding a photo can take a few hundred megabytes for a few seconds: a 100-megapixel PNG of
 * 16-bit colour, which compresses to about a megabyte, peaks near 260 MB. Several at once, from
 * one person or a few, could use up the memory of a small server, so uploads take turns.
 */
const inTurn = oneAtATime();

/** JPEG quality for every size. mozjpeg makes files about a fifth smaller at the same quality. */
const JPEG = { quality: 80, mozjpeg: true } as const;

/** Why an upload was refused. Each has its own message on the page. */
export type PhotoProblem = 'too-big' | 'heic' | 'unsupported' | 'too-many-pixels' | 'unreadable';

export interface ProcessedPhoto {
	/** When it was taken, from its own EXIF data, if it had any. */
	taken: ExifDate | null;
	/** The size of the full-size file, the right way up. */
	width: number;
	height: number;
	/** A JPEG for each size. */
	files: Record<PhotoSize, Buffer>;
}

export type ProcessResult =
	{ ok: true; photo: ProcessedPhoto } | { ok: false; problem: PhotoProblem };

const refuse = (problem: PhotoProblem) => ({ ok: false, problem }) as const;

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
	return prefix.every((byte, i) => bytes[at + i] === byte);
}

/** HEIF brands used by HEIC photos (from iPhones and some Android phones). AVIF has its own. */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];

/**
 * What kind of image `bytes` holds, from its first bytes rather than its name or what the browser
 * said. Only JPEG, PNG and WebP are accepted, so nothing else reaches sharp's decoders: it also
 * reads SVG, TIFF, GIF and more, which a phone's photo never needs.
 */
export function sniffFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | 'heic' | null {
	if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
	if (startsWith(bytes, 0, [0x89, ...ascii('PNG\r\n\x1a\n')])) return 'png';
	if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'))) return 'webp';
	if (startsWith(bytes, 4, ascii('ftyp'))) {
		const brand = String.fromCharCode(...bytes.subarray(8, 12));
		if (HEIC_BRANDS.includes(brand)) return 'heic';
	}
	return null;
}

/** Each size from the full-size pixels, decoded once. */
function encodeSizes(pixels: () => Sharp): Promise<Buffer[]> {
	const fit = (size: number) =>
		pixels().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg(JPEG);
	return Promise.all([
		pixels().resize(PHOTO_SIZES.thumb, PHOTO_SIZES.thumb, { fit: 'cover' }).jpeg(JPEG).toBuffer(),
		fit(PHOTO_SIZES.medium).toBuffer(),
		pixels().jpeg(JPEG).toBuffer()
	]);
}

/**
 * Checks an uploaded image and makes the stored sizes from it. `maxPixels` is for tests.
 */
export async function processPhoto(
	input: Uint8Array,
	{ maxPixels = MAX_PHOTO_PIXELS }: { maxPixels?: number } = {}
): Promise<ProcessResult> {
	if (input.byteLength > MAX_PHOTO_BYTES) return refuse('too-big');
	const format = sniffFormat(input);
	if (format === 'heic') return refuse('heic');
	if (!format) return refuse('unsupported');

	return inTurn(() => decode(input, format, maxPixels));
}

/** Checks the size the header gives, then decodes the image and makes each stored size. */
async function decode(
	input: Uint8Array,
	format: 'jpeg' | 'png' | 'webp',
	maxPixels: number
): Promise<ProcessResult> {
	try {
		// Only the file's header is read here, so it needs no limit on pixels yet.
		const metadata = await sharp(input, { limitInputPixels: false }).metadata();
		if (metadata.format !== format) return refuse('unsupported');
		if (metadata.width * metadata.height > maxPixels) return refuse('too-many-pixels');

		const taken = metadata.exif ? exifDate(metadata.exif) : null;

		// `failOn: 'error'` refuses damaged files but lets through the harmless warnings some
		// cameras' files cause. `limitInputPixels` holds sharp to the header's word on size.
		// The photo is turned the right way up first, since the orientation tag goes with the
		// metadata. sRGB with no transparency suits a JPEG; a photo with a colour profile is
		// converted to it.
		const full = await sharp(input, { failOn: 'error', limitInputPixels: maxPixels })
			.autoOrient()
			.resize(PHOTO_SIZES.full, PHOTO_SIZES.full, { fit: 'inside', withoutEnlargement: true })
			.flatten({ background: '#ffffff' })
			.toColourspace('srgb')
			.raw()
			.toBuffer({ resolveWithObject: true });
		const { width, height, channels } = full.info;
		const [thumb, medium, largest] = await encodeSizes(() =>
			sharp(full.data, { raw: { width, height, channels } })
		);

		return { ok: true, photo: { taken, width, height, files: { thumb, medium, full: largest } } };
	} catch (error) {
		// sharp's errors for a damaged file, or one that is bigger than it first claimed.
		console.warn('Could not process an uploaded photo:', error);
		return refuse('unreadable');
	}
}
