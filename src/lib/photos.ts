/**
 * Photos: the sizes each is stored in and the limits on uploads, shared by the server and the
 * page that uploads them (docs/spec.md, Photos and backups; D35).
 */

/**
 * The sizes each photo is stored in, by the longest side in pixels. The thumbnail is cut to a
 * square; the others keep the photo's shape and are never made larger than it was.
 */
export const PHOTO_SIZES = { thumb: 400, medium: 1280, full: 2560 } as const;

export type PhotoSize = keyof typeof PHOTO_SIZES;

export function isPhotoSize(value: string): value is PhotoSize {
	return Object.hasOwn(PHOTO_SIZES, value);
}

/** The largest file the server takes: an original sent before JavaScript loads, say. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

/** The most pixels the server will decode, which also stops images made to exhaust memory. */
export const MAX_PHOTO_PIXELS = 100_000_000;

export const MAX_CAPTION_LENGTH = 200;

/**
 * What the file picker offers. With `image/*`, iPhones convert their HEIC photos to JPEG, and
 * phones offer the camera as well as the photo library. The server decides what it accepts, from
 * the file's contents.
 */
export const PHOTO_ACCEPT = 'image/*';
