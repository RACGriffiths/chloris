import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { CareType, Task } from '../../care';
import { localDateTime, zonedTime } from '../../dates';
import { parseExifDateText, type ExifDate } from '../../exif';
import { MAX_CAPTION_LENGTH, type PhotoSize } from '../../photos';
import { getConnection, type Db } from '../db';
import { careEvent, home, photo, plant, user } from '../db/schema';
import { processPhoto, type PhotoProblem } from '../photos/process';
import {
	discardUnrecordedPhoto,
	readPhotoFile,
	removeDeletedPhotoFiles,
	writePhotoFiles
} from '../photos/storage';
import { optionalText, stillToCome } from './fields';

/**
 * Photos of plants (docs/spec.md, Photo timeline, Photos and backups; D35 to D42). Reading them
 * needs `home:view`; adding one needs `photo:add`. Changing or deleting one needs `photo:add`,
 * and only the person who added it may, unless they may also edit plants (`plant:edit`, D40).
 * Callers check `can()` first.
 *
 * A photo is a row here and a file per size in the photo folder (`#lib/server/photos/storage`).
 * The files are written first and the row last, so a row always has its files; files left behind
 * by a crash have no row, and the integrity check lists them. Deleting a photo only marks its
 * row: its files stay through the grace period (CLAUDE.md rule 5), then a background job removes
 * them, and then the row (D54). Deleted photos are left out of every read except the two for
 * that housekeeping, `listPhotoFiles` and `purgeDeletedPhotos`.
 */

export interface Photo {
	id: string;
	plantId: string;
	/** When it was taken (D36), or when someone said it was. */
	takenAt: Date;
	/** The size of the full-size file, in pixels. */
	width: number;
	height: number;
	caption: string | null;
	/** Who added it, or `null` once their account is deleted. */
	userId: string | null;
	userName: string | null;
}

/** A photo as its own page shows it. */
export interface PhotoDetails extends Photo {
	/** The care it was added with (D41), while that care is still in the log. */
	care: { type: CareType; checkedTask: Task | null; doneAt: Date } | null;
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

/**
 * What a person changes about a photo they can see: its caption, and when it was taken, as a
 * `datetime-local` value in the home's time zone. Here a date is typed, so a bad one is refused.
 */
export const photoChangeInput = z.object({
	caption: photoInput.shape.caption,
	takenAt: z.iso.datetime({ local: true, error: 'Enter a date and time.' })
});

export type PhotoChangeInput = { caption?: string; takenAt: string };

/**
 * Who is changing or deleting a photo. Someone who may edit the home's plants can change any of
 * their photos; anyone else, only the photos they added (D40).
 */
export interface PhotoEditor {
	userId: string;
	/** Whether they may change photos other people added: `can(user, homeId, 'plant:edit')`. */
	anyPhoto: boolean;
}

/** The outcome of adding a photo. A refused upload stores nothing. */
export type AddPhotoResult =
	{ ok: true; photo: Photo } | { ok: false; reason: 'not-found' | PhotoProblem };

/** The outcome of changing a photo. A refused change leaves it as it was. */
export type UpdatePhotoResult =
	| { ok: true; photo: Photo }
	| { ok: false; reason: 'not-found' | 'not-yours' | 'in-the-future' | 'too-early' };

/** The outcome of deleting a photo: the photo deleted, or why it wasn't. */
export type DeletePhotoResult =
	{ ok: true; photo: Photo } | { ok: false; reason: 'not-found' | 'not-yours' };

/** The outcome of reading a photo's file: `missing` if its row is there but its file isn't. */
export type ReadPhotoResult =
	{ ok: true; bytes: Buffer } | { ok: false; reason: 'not-found' | 'missing' };

const notFound = { ok: false, reason: 'not-found' } as const;
const notYours = { ok: false, reason: 'not-yours' } as const;

/** A camera date earlier than this is a clock that was never set (D36). */
const EARLIEST_TAKEN_AT = Date.UTC(1990, 0, 1);

type Tx = Pick<Db, 'select'>;

/** What a record added with a photo can write with (`addPhotoWith`). */
export type PhotoTx = Pick<Db, 'select' | 'insert' | 'update'>;

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

/** A photo of a plant in `homeId` that hasn't been deleted, or `null`. */
function findPhoto(tx: Tx, homeId: string, plantId: string, photoId: string): Photo | null {
	const row = selectPhotos(tx)
		.where(
			and(
				eq(photo.id, photoId),
				eq(photo.plantId, plantId),
				eq(photo.homeId, homeId),
				isNull(photo.deletedAt)
			)
		)
		.get();
	return row ?? null;
}

/** Whether `editor` may change or delete `found` (D40). */
function mayChange(found: Photo, editor: PhotoEditor): boolean {
	return editor.anyPhoto || found.userId === editor.userId;
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
 * come is a camera in another time zone; both, like no date at all, give `undated`: the time it
 * was added, or the time of the care it was added with (D41).
 */
export function takenAtFrom(
	taken: ExifDate | null,
	timeZone: string,
	now: Date,
	undated = now
): Date {
	if (!taken) return undated;
	const instant = taken.offset
		? new Date(`${taken.local}${taken.offset}`)
		: zonedTime(taken.local, timeZone);
	const time = instant.getTime();
	if (Number.isNaN(time) || time < EARLIEST_TAKEN_AT || time > now.getTime()) return undated;
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
	const added = await addPhotoWith(homeId, userId, plantId, input, file, { now }, () => null);
	return added.ok ? { ok: true, photo: added.photo } : added;
}

/**
 * Adds a photo as `addPhoto` does, and in the same transaction calls `record` with it, to write
 * something that comes with the photo: the care it was taken with, say (`logCareWithPhoto`).
 * Either both are stored or neither is: if `record` throws, the photo's row is rolled back and its
 * files removed. A photo with no date of its own is dated `undated` (D41), which defaults to
 * `now`. Callers check `can(user, homeId, 'photo:add')` first, and whatever `record` needs.
 */
export async function addPhotoWith<T>(
	homeId: string,
	userId: string,
	plantId: string,
	input: PhotoInput,
	file: Uint8Array,
	{ now, undated = now }: { now: Date; undated?: Date },
	record: (tx: PhotoTx, photo: Photo) => T
): Promise<
	{ ok: true; photo: Photo; recorded: T } | { ok: false; reason: 'not-found' | PhotoProblem }
> {
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
					takenAt: takenAtFrom(image.taken ?? values.takenAt, timeZone, now, undated),
					width: image.width,
					height: image.height,
					caption: values.caption,
					createdAt: now
				})
				.run();
			const row = findPhoto(tx, homeId, plantId, id);
			if (!row) throw new Error('The photo just added has gone');
			return { photo: row, recorded: record(tx, row) };
		});
		if (!added) {
			await discardUnrecordedPhoto(homeId, fileKey);
			return notFound;
		}
		return { ok: true, ...added };
	} catch (error) {
		await discardUnrecordedPhoto(homeId, fileKey);
		throw error;
	}
}

/**
 * The photos of a plant in `homeId`: its timeline, the latest taken first. Empty if the home has
 * no such plant. Callers check `can(user, homeId, 'home:view')` first.
 */
export function listPhotos(homeId: string, plantId: string): Photo[] {
	return selectPhotos(getConnection().db)
		.where(and(eq(photo.plantId, plantId), eq(photo.homeId, homeId), isNull(photo.deletedAt)))
		.orderBy(desc(photo.takenAt), desc(photo.createdAt), desc(photo.id))
		.all();
}

/**
 * One photo of a plant in `homeId`, with the care it was added with, or `null` if the home has
 * no such photo of that plant, or it was deleted. Callers check `can(user, homeId, 'home:view')`
 * first.
 */
export function getPhoto(homeId: string, plantId: string, photoId: string): PhotoDetails | null {
	const row = getConnection()
		.db.select({
			...photoColumns,
			careType: careEvent.type,
			checkedTask: careEvent.checkedTask,
			doneAt: careEvent.doneAt
		})
		.from(photo)
		.leftJoin(user, eq(user.id, photo.userId))
		.leftJoin(careEvent, and(eq(careEvent.photoId, photo.id), eq(careEvent.homeId, photo.homeId)))
		.where(
			and(
				eq(photo.id, photoId),
				eq(photo.plantId, plantId),
				eq(photo.homeId, homeId),
				isNull(photo.deletedAt)
			)
		)
		.orderBy(asc(careEvent.doneAt), asc(careEvent.id))
		.get();
	if (!row) return null;
	const { careType, checkedTask, doneAt, ...found } = row;
	return {
		...found,
		care: careType && doneAt ? { type: careType, checkedTask, doneAt } : null
	};
}

/**
 * Changes the caption of a plant's photo in `homeId`, and when it was taken, which moves it in
 * the timeline. Refused if the home has no such photo, if `editor` may not change it (D40), or if
 * the time is still to come or before 1990. A time left as the form showed it keeps the seconds
 * the form leaves out. Callers check `can(user, homeId, 'photo:add')` first. Throws a `ZodError`
 * if the input is invalid.
 */
export function updatePhoto(
	homeId: string,
	plantId: string,
	photoId: string,
	editor: PhotoEditor,
	input: PhotoChangeInput,
	now = new Date()
): UpdatePhotoResult {
	const values = photoChangeInput.parse(input);
	return getConnection().db.transaction(
		(tx) => {
			const found = findPhoto(tx, homeId, plantId, photoId);
			const timeZone = plantTimeZone(tx, homeId, plantId);
			if (!found || !timeZone) return notFound;
			if (!mayChange(found, editor)) return notYours;

			const local = values.takenAt.slice(0, 16);
			const takenAt =
				local === localDateTime(found.takenAt, timeZone)
					? found.takenAt
					: zonedTime(local, timeZone);
			if (stillToCome(takenAt, now)) return { ok: false, reason: 'in-the-future' } as const;
			if (takenAt.getTime() < EARLIEST_TAKEN_AT) return { ok: false, reason: 'too-early' } as const;

			tx.update(photo)
				.set({ caption: values.caption, takenAt })
				.where(and(eq(photo.id, photoId), eq(photo.homeId, homeId)))
				.run();
			return { ok: true, photo: { ...found, caption: values.caption, takenAt } } as const;
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Deletes a plant's photo in `homeId`: it leaves the timeline and every page at once, but its
 * row and files stay until the grace period is over (docs/spec.md, Photos and backups). A plant
 * that had it as its cover goes back to showing its latest photo. Refused if the home has no such
 * photo, or `editor` may not delete it (D40). Callers check `can(user, homeId, 'photo:add')`
 * first.
 */
export function deletePhoto(
	homeId: string,
	plantId: string,
	photoId: string,
	editor: PhotoEditor,
	now = new Date()
): DeletePhotoResult {
	return getConnection().db.transaction(
		(tx) => {
			const found = findPhoto(tx, homeId, plantId, photoId);
			if (!found) return notFound;
			if (!mayChange(found, editor)) return notYours;

			tx.update(photo)
				.set({ deletedAt: now })
				.where(and(eq(photo.id, photoId), eq(photo.homeId, homeId)))
				.run();
			tx.update(plant)
				.set({ coverPhotoId: null })
				.where(
					and(eq(plant.id, plantId), eq(plant.homeId, homeId), eq(plant.coverPhotoId, photoId))
				)
				.run();
			return { ok: true, photo: found } as const;
		},
		{ behavior: 'immediate' }
	);
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

/** A photo's files as the backup and the integrity check see them, deleted or not. */
export interface PhotoFiles {
	id: string;
	plantId: string;
	/** Names its files: `#lib/server/photos/storage`'s `photoFileName()`. */
	fileKey: string;
	/** When it was deleted; its files are kept until the grace period after it is over. */
	deletedAt: Date | null;
}

/**
 * Every photo in `homeId`, deleted ones included, with the key that names its files, in the order
 * they were added: for the backup and the integrity check, which compare them with the files in
 * the photo folder (D52, D53). They are run from the command line by whoever runs the server,
 * and read every home in turn (`listHomeIds()`), so there's no one to check `can()` for. Pages
 * never call this.
 */
export function listPhotoFiles(homeId: string): PhotoFiles[] {
	return getConnection()
		.db.select({
			id: photo.id,
			plantId: photo.plantId,
			fileKey: photo.fileKey,
			deletedAt: photo.deletedAt
		})
		.from(photo)
		.where(eq(photo.homeId, homeId))
		.orderBy(asc(photo.createdAt), asc(photo.id))
		.all();
}

/** What `purgeDeletedPhotos` did. */
export interface PurgeResult {
	/** How many photos it removed, files and rows. */
	removed: number;
	/** Photos whose files couldn't be removed, and why. Their rows stay, to try again. */
	failed: { photoId: string; error: unknown }[];
}

/**
 * Removes the photos in `homeId` that were deleted before `deletedBefore`, the start of the grace
 * period: each one's files first, then its row (D54). Removing the files first means that if it
 * stops part way, a row marked deleted is left without its files, for the next run to finish,
 * rather than files that nothing refers to. Care logged with a photo keeps its place in the log
 * without it (D41). Run by a background job for no one signed in, so there's no `can()` to check:
 * whoever deleted the photo was checked then. Pages never call this.
 */
export async function purgeDeletedPhotos(
	homeId: string,
	deletedBefore: Date
): Promise<PurgeResult> {
	const { db } = getConnection();
	const expired = and(eq(photo.homeId, homeId), lt(photo.deletedAt, deletedBefore));
	const found = db
		.select({ id: photo.id, fileKey: photo.fileKey })
		.from(photo)
		.where(expired)
		.orderBy(asc(photo.deletedAt), asc(photo.id))
		.all();

	const result: PurgeResult = { removed: 0, failed: [] };
	for (const { id, fileKey } of found) {
		try {
			await removeDeletedPhotoFiles(homeId, fileKey);
		} catch (error) {
			result.failed.push({ photoId: id, error });
			continue;
		}
		// Checked again, in case it was put back while its files were being removed.
		const { changes } = db
			.delete(photo)
			.where(and(eq(photo.id, id), expired))
			.run();
		result.removed += changes;
	}
	return result;
}
