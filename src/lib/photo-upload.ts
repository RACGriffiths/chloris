import { exifDate, exifDateText, jpegExif } from './exif';
import { PHOTO_SIZES } from './photos';

/**
 * Gets a photo ready to upload, in the browser (docs/spec.md, Photos and backups): reads when it
 * was taken, then draws it at most `PHOTO_SIZES.full` pixels on its longest side and saves that
 * as a JPEG. The copy carries none of the original's metadata, so its GPS position never leaves
 * the phone, and it's a fraction of the size to send over mobile data. The server checks and
 * re-encodes it all the same. Browser-only: load it with `await import()`.
 */

/** JPEG quality for the copy sent. High, since the server encodes it once more. */
const QUALITY = 0.9;

/** EXIF sits near the start of a JPEG, so there's no need to read the whole file for it. */
const EXIF_SEARCH_BYTES = 128 * 1024;

export interface PreparedPhoto {
	photo: Blob;
	/** When it was taken, as the form's `takenAt` field carries it, or `''` if it doesn't say. */
	takenAt: string;
}

/**
 * The photo to send in place of `file`, or `null` if the browser can't read it (a HEIC photo in
 * a browser other than Safari, say). Then the original is sent and the server decides.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto | null> {
	const url = URL.createObjectURL(file);
	try {
		const head = new Uint8Array(await file.slice(0, EXIF_SEARCH_BYTES).arrayBuffer());
		const exif = jpegExif(head);
		const taken = exif ? exifDate(exif) : null;

		const image = new Image();
		image.src = url;
		// Fails if the browser can't decode the image.
		await image.decode();
		// Browsers turn an image the right way up by its EXIF orientation, both when showing it
		// and when drawing it on a canvas, so the copy needs no orientation tag of its own.
		const { naturalWidth: width, naturalHeight: height } = image;
		if (!width || !height) return null;

		const scale = Math.min(1, PHOTO_SIZES.full / Math.max(width, height));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		const context = canvas.getContext('2d');
		if (!context) return null;
		// A JPEG has no transparency: put a transparent PNG on white, as the server would.
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.imageSmoothingQuality = 'high';
		context.drawImage(image, 0, 0, canvas.width, canvas.height);

		const photo = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, 'image/jpeg', QUALITY);
		});
		return photo ? { photo, takenAt: taken ? exifDateText(taken) : '' } : null;
	} catch {
		return null;
	} finally {
		URL.revokeObjectURL(url);
	}
}
