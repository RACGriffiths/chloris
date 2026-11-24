/**
 * Reads when a photo was taken from its EXIF data: in the browser, before resizing leaves the
 * metadata behind, and on the server, for a photo sent before JavaScript loaded (D36). Only the
 * date tags are read. Anything malformed or missing gives `null`, never an error.
 */

/** When a camera says a photo was taken. */
export interface ExifDate {
	/** The time on the camera's clock: `YYYY-MM-DDTHH:MM:SS`. */
	local: string;
	/** How far that clock was ahead of UTC, such as `+01:00`, if the camera recorded it. */
	offset: string | null;
}

/** Points from the first directory of tags to the one holding the dates. */
const EXIF_IFD_POINTER = 0x8769;
/** When the photo was taken, and when it was digitised (the same for a digital camera). */
const DATE_ORIGINAL = 0x9003;
const DATE_DIGITIZED = 0x9004;
/** The offsets from UTC that go with each, added in EXIF 2.31 (2016). */
const OFFSET_ORIGINAL = 0x9011;
const OFFSET_DIGITIZED = 0x9012;

const TYPE_ASCII = 2;
const TYPE_LONG = 4;

/** More entries than any real directory has: a corrupt count stops the reading. */
const MAX_ENTRIES = 1000;

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
	return prefix.every((byte, i) => bytes[at + i] === byte);
}

interface Entry {
	type: number;
	count: number;
	/** Where the entry's 4-byte value field is, from the start of the TIFF data. */
	at: number;
}

/** The entries of the directory at `offset`, by tag. Throws `RangeError` past the end. */
function readDirectory(view: DataView, offset: number, little: boolean): Map<number, Entry> {
	const entries = new Map<number, Entry>();
	const count = view.getUint16(offset, little);
	if (count > MAX_ENTRIES) return entries;
	for (let i = 0; i < count; i++) {
		const at = offset + 2 + i * 12;
		entries.set(view.getUint16(at, little), {
			type: view.getUint16(at + 2, little),
			count: view.getUint32(at + 4, little),
			at: at + 8
		});
	}
	return entries;
}

/** An ASCII entry's text, up to its first NUL; `null` if it isn't ASCII. */
function readText(view: DataView, entry: Entry | undefined, little: boolean): string | null {
	if (!entry || entry.type !== TYPE_ASCII || entry.count > 64) return null;
	// Values of 4 bytes or fewer sit in the entry itself; longer ones elsewhere, at an offset.
	const start = entry.count <= 4 ? entry.at : view.getUint32(entry.at, little);
	let text = '';
	for (let i = 0; i < entry.count; i++) {
		const code = view.getUint8(start + i);
		if (code === 0) break;
		text += String.fromCharCode(code);
	}
	return text;
}

/** `2025:05:03 14:22:10` as `2025-05-03T14:22:10`, or `null` if it isn't a real date and time. */
function parseDate(text: string | null): string | null {
	const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(text ?? '');
	if (!match) return null;
	const [, year, month, day, hour, minute, second] = match.map(Number);
	const valid =
		year >= 1800 &&
		month >= 1 &&
		month <= 12 &&
		day >= 1 &&
		day <= 31 &&
		hour <= 23 &&
		minute <= 59 &&
		second <= 59;
	if (!valid) return null;
	return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
}

function parseOffset(text: string | null): string | null {
	const match = /^([+-])(\d{2}):(\d{2})$/.exec(text ?? '');
	if (!match || Number(match[2]) > 14 || Number(match[3]) > 59) return null;
	return match[0];
}

/**
 * When a photo was taken, from its EXIF data: the TIFF structure EXIF is stored in, with or
 * without the `Exif\0\0` header in front (sharp's `metadata().exif` has it). Prefers the date
 * the photo was taken, then the date it was digitised; the date it was last changed is ignored,
 * since editing a photo sets it.
 */
export function exifDate(exif: Uint8Array): ExifDate | null {
	const start = startsWith(exif, 0, EXIF_HEADER) ? EXIF_HEADER.length : 0;
	const view = new DataView(exif.buffer, exif.byteOffset + start, exif.byteLength - start);
	try {
		const order = view.getUint16(0);
		// "II" for Intel's byte order (little-endian), "MM" for Motorola's.
		const little = order === 0x4949 ? true : order === 0x4d4d ? false : null;
		if (little === null || view.getUint16(2, little) !== 42) return null;

		const first = readDirectory(view, view.getUint32(4, little), little);
		const pointer = first.get(EXIF_IFD_POINTER);
		if (!pointer || pointer.type !== TYPE_LONG) return null;
		const tags = readDirectory(view, view.getUint32(pointer.at, little), little);

		for (const [dateTag, offsetTag] of [
			[DATE_ORIGINAL, OFFSET_ORIGINAL],
			[DATE_DIGITIZED, OFFSET_DIGITIZED]
		]) {
			const local = parseDate(readText(view, tags.get(dateTag), little));
			if (local) return { local, offset: parseOffset(readText(view, tags.get(offsetTag), little)) };
		}
		return null;
	} catch (error) {
		// Reading past the end of the data: a truncated or corrupt file.
		if (error instanceof RangeError) return null;
		throw error;
	}
}

/**
 * The EXIF data in a JPEG file, from its APP1 segment, or `null` if it has none or isn't a JPEG.
 * EXIF sits near the start of the file, so the first 128 KiB is enough.
 */
export function jpegExif(bytes: Uint8Array): Uint8Array | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let at = 2;
	while (at + 4 <= bytes.length) {
		if (bytes[at] !== 0xff) return null;
		const marker = bytes[at + 1];
		if (marker === 0xff) {
			// Padding before a marker.
			at += 1;
			continue;
		}
		// The image data starts, or the file ends, before any EXIF.
		if (marker === 0xda || marker === 0xd9) return null;
		const length = (bytes[at + 2] << 8) | bytes[at + 3];
		if (length < 2) return null;
		const end = at + 2 + length;
		if (marker === 0xe1 && startsWith(bytes, at + 4, EXIF_HEADER)) {
			return end <= bytes.length ? bytes.subarray(at + 4, end) : null;
		}
		at = end;
	}
	return null;
}

/** How a browser sends the date it read: `2025-05-03T14:22:10+01:00`, or without the offset. */
export function exifDateText(date: ExifDate): string {
	return `${date.local}${date.offset ?? ''}`;
}

/** Reads back what `exifDateText` wrote; `null` if it doesn't fit. */
export function parseExifDateText(text: string): ExifDate | null {
	const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})?$/.exec(text);
	if (!match) return null;
	const local = parseDate(match[1].replace(/-/g, ':').replace('T', ' '));
	if (!local) return null;
	const offset = match[2] ? parseOffset(match[2]) : null;
	if (match[2] && !offset) return null;
	return { local, offset };
}
