import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { zonedTime } from '../../dates';
import { parseExifDateText, type ExifDate } from '../../exif';
import { MAX_CAPTION_LENGTH, type PhotoSize } from '../../photos';
import { getConnection, type Db } from '../db';
import { home, photo, plant, user } from '../db/schema';
import { processPhoto, type PhotoProblem } from '../photos/process';
import { discardUnrecordedPhoto, readPhotoFile, writePhotoFiles } from '../photos/storage';
import { optionalText } from './fields';

/**
 * Photos of plants (docs/spec.md, Photos and backups; D35 to D38). Reading them needs
 * `home:view`; adding one needs `photo:add`. Callers check `can()` first.
 *
 * A photo is a row here and a file per size in the photo folder (`#lib/server/photos/storage`).
 * The files are written first and the row last, so a row always has its files; files left behind
 * by a crash have no row, and the integrity check will list them. Deleted photos, which keep their
 * files through the grace period, are left out of every read.
 */

export interface Photo {
	id: string;
	plantId: string;
	/** When it was taken (D36). */
	takenAt: Date;
	/** The size of the full-size file, in pixels. */
	width: number;
	height: number;
	caption: string | null;
	/** Who added it, or `null` once their account is deleted. */
	userId: string | null;
	userName: string | null;
}

/**
 * What the form sends with a photo. `takenAt` is the date the browser read from the photo before
 * resizing it (`exifDateText`): machine-written, so a value that doesn't fit is ignored rather
 * than refused.
 */
export const photoInput = z.object({
	caption: optionalText(
		MAX_CAPTION_LENGTH,
		`Keep the caption to ${MAX_CAPTION_LENGTH} characters or fewer.`
	),
	takenAt: z
		.string()
		.optional()
		.transform((text) => (text ? parseExifDateText(text) : null))
});

/** A photo's fields as a form sends them, before `photoInput` has checked them. */
export type PhotoInput = { caption?: string; takenAt?: string };

/** The outcome of adding a photo. A refused upload stores nothing. */
export type AddPhotoResult =
	{ ok: true; photo: Photo } | { ok: false; reason: 'not-found' | PhotoProblem };

/** The outcome of reading a photo's file: `missing` if its row is there but its file isn't. */
export type ReadPhotoResult =
	{ ok: true; bytes: Buffer } | { ok: false; reason: 'not-found' | 'missing' };

const notFound = { ok: false, reason: 'not-found' } as const;

/** A camera date earlier than this is a clock that was never set (D36). */
const EARLIEST_TAKEN_AT = Date.UTC(1990, 0, 1);

type Tx = Pick<Db, 'select'>;

const photoColumns = {
	id: photo.id,
	plantId: photo.plantId,
	takenAt: photo.takenAt,
	width: photo.width,
	height: photo.height,
	caption: photo.caption,
	userId: photo.userId,
	userName: user.name
};

/** Photos with who added them. The caller adds the `where`, which leaves out deleted ones. */
function selectPhotos(tx: Tx) {
	return tx.select(photoColumns).from(photo).leftJoin(user, eq(user.id, photo.userId));
}

/** The time zone of the home a plant is in, or `null` if `homeId` has no such plant. */
function plantTimeZone(tx: Tx, homeId: string, plantId: string): string | null {
	const found = tx
		.select({ timeZone: home.timeZone })
		.from(plant)
		.innerJoin(home, eq(home.id, plant.homeId))
		.where(and(eq(plant.id, plantId), eq(plant.homeId, homeId)))
		.get();
	return found?.timeZone ?? null;
}

/**
 * When a photo was taken (D36): its camera's date, read with the offset the camera recorded, or
 * else in the home's time zone. A date before 1990 is a clock that was never set, and one still to
 * come is a camera in another time zone; both, like no date at all, give `now`.
 */
export function takenAtFrom(taken: ExifDate | null, timeZone: string, now: Date): Date {
	if (!taken) return now;
	const instant = taken.offset
		? new Date(`${taken.local}${taken.offset}`)
		: zonedTime(taken.local, timeZone);
	const time = instant.getTime();
	if (Number.isNaN(time) || time < EARLIEST_TAKEN_AT || time > now.getTime()) return now;
	return instant;
}

/**
 * Adds a photo of a plant in `homeId`, added by `userId`: checks and re-encodes `file`, stores
 * its sizes, then records it. It was taken when its own EXIF data says, or else when the browser
 * said it read from it, or else now (D36). Refused, with nothing stored, if the home has no such
 * plant or the file isn't a photo the server accepts. Callers check
 * `can(user, homeId, 'photo:add')` first. Throws a `ZodError` if the input is invalid.
 */
export async function addPhoto(
	homeId: string,
	userId: string,
	plantId: string,
	input: PhotoInput,
	file: Uint8Array,
	now = new Date()
): Promise<AddPhotoResult> {
	const values = photoInput.parse(input);
	const db = getConnection().db;
	const timeZone = plantTimeZone(db, homeId, plantId);
	if (!timeZone) return notFound;

	const processed = await processPhoto(file);
	if (!processed.ok) return { ok: false, reason: processed.problem };
	const image = processed.photo;

	const id = randomUUID();
	const fileKey = randomUUID();
	await writePhotoFiles(homeId, fileKey, image.files);
	try {
		const added = db.transaction((tx) => {
			// Checked again: the plant could have gone while the photo was being processed.
			if (!plantTimeZone(tx, homeId, plantId)) return null;
			tx.insert(photo)
				.values({
					id,
					homeId,
					plantId,
					userId,
					fileKey,
					takenAt: takenAtFrom(image.taken ?? values.takenAt, timeZone, now),
					width: image.width,
					height: image.height,
					caption: values.caption,
					createdAt: now
				})
				.run();
			return selectPhotos(tx)
				.where(and(eq(photo.id, id), eq(photo.homeId, homeId)))
				.get();
		});
		if (!added) {
			await discardUnrecordedPhoto(homeId, fileKey);
			return notFound;
		}
		return { ok: true, photo: added };
	} catch (error) {
		await discardUnrecordedPhoto(homeId, fileKey);
		throw error;
	}
}

/**
 * The photos of a plant in `homeId`, the latest taken first. Empty if the home has no such
 * plant. Callers check `can(user, homeId, 'home:view')` first.
 */
export function listPhotos(homeId: string, plantId: string): Photo[] {
	return selectPhotos(getConnection().db)
		.where(and(eq(photo.plantId, plantId), eq(photo.homeId, homeId), isNull(photo.deletedAt)))
		.orderBy(desc(photo.takenAt), desc(photo.createdAt), desc(photo.id))
		.all();
}

/**
 * One size of a photo in `homeId`, to send to the browser. `not-found` if the home has no such
 * photo, or it was deleted; `missing` if its file isn't on disk, for which a placeholder is shown
 * (docs/spec.md, Photos and backups). Callers check `can(user, homeId, 'home:view')` first.
 */
export async function readPhoto(
	homeId: string,
	photoId: string,
	size: PhotoSize
): Promise<ReadPhotoResult> {
	const found = getConnection()
		.db.select({ fileKey: photo.fileKey })
		.from(photo)
		.where(and(eq(photo.id, photoId), eq(photo.homeId, homeId), isNull(photo.deletedAt)))
		.get();
	if (!found) return notFound;
	const bytes = await readPhotoFile(homeId, found.fileKey, size);
	return bytes ? { ok: true, bytes } : { ok: false, reason: 'missing' };
}
