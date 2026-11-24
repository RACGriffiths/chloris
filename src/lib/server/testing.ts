import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach } from 'vitest';
import { closeDatabase, getConnection, initDatabase } from './db';
import { and, eq } from 'drizzle-orm';
import { digestLog, membership, photo, user } from './db/schema';
import { initPhotoStorage } from './photos/storage';

/**
 * Helpers for unit tests only. Fixtures write to the database directly, so tests can set up
 * states that no data-access function creates yet (other roles, expired memberships).
 */

/** Gives each test in the file a new database, migrated like the app's, and an empty photo folder. */
export function useTestDatabase(): { readonly dataDir: string; readonly photosDir: string } {
	const state = { dataDir: '', photosDir: '' };
	beforeEach(async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chloris-test-'));
		state.dataDir = path.join(root, 'data');
		state.photosDir = path.join(root, 'photos');
		await initDatabase(state.dataDir);
		initPhotoStorage(state.photosDir, { create: true });
	});
	afterEach(() => {
		closeDatabase();
		fs.rmSync(path.dirname(state.dataDir), { recursive: true, force: true });
	});
	return state;
}

export function insertUser(email: string, fields: { canCreateHome?: boolean } = {}): string {
	const id = randomUUID();
	getConnection()
		.db.insert(user)
		.values({ id, email, name: email.split('@')[0], emailVerified: true, ...fields })
		.run();
	return id;
}

export function addMember(
	homeId: string,
	userId: string,
	role: string,
	{ expiresAt, createdAt }: { expiresAt?: Date; createdAt?: Date } = {}
): void {
	getConnection()
		.db.insert(membership)
		.values({ id: randomUUID(), homeId, userId, role, expiresAt, createdAt })
		.run();
}

/** Removes a membership directly, as removing members will when it arrives. */
export function removeMember(homeId: string, userId: string): void {
	getConnection()
		.db.delete(membership)
		.where(and(eq(membership.homeId, homeId), eq(membership.userId, userId)))
		.run();
}

/** Marks a user's email address as proven, as using a sign-in link sent to it does (D50). */
export function setEmailVerified(userId: string, verified: boolean): void {
	getConnection().db.update(user).set({ emailVerified: verified }).where(eq(user.id, userId)).run();
}

/** A person's digest log entry for one day in a home, read back directly; `undefined` if none. */
export function digestEntry(homeId: string, userId: string, date: string) {
	return getConnection()
		.db.select({
			channel: digestLog.channel,
			taskCount: digestLog.taskCount,
			sentAt: digestLog.sentAt
		})
		.from(digestLog)
		.where(
			and(eq(digestLog.homeId, homeId), eq(digestLog.userId, userId), eq(digestLog.date, date))
		)
		.get();
}

/**
 * Marks a photo deleted directly, without what `deletePhoto` also does (clearing a cover), to
 * prove that reads leave out any photo marked deleted.
 */
export function markPhotoDeleted(photoId: string, at = new Date()): void {
	getConnection().db.update(photo).set({ deletedAt: at }).where(eq(photo.id, photoId)).run();
}

/** EXIF tags for `testJpeg`, grouped as sharp's `withExif` takes them. */
export interface TestExif {
	/** Camera details, e.g. `Make`. */
	IFD0?: Record<string, string>;
	/** Dates, e.g. `DateTimeOriginal: '2025:05:03 14:22:10'` and `OffsetTimeOriginal`. */
	IFD2?: Record<string, string>;
	/** GPS position, e.g. `GPSLatitude`. */
	IFD3?: Record<string, string>;
}

/**
 * A JPEG photo for tests: one colour, with the given EXIF tags and orientation. Orientation 6
 * means the camera was turned a quarter: the image is stored on its side, `width` by `height`,
 * and shown the other way round.
 */
export function testJpeg({
	width = 600,
	height = 400,
	exif,
	orientation
}: {
	width?: number;
	height?: number;
	exif?: TestExif;
	orientation?: number;
} = {}): Promise<Buffer> {
	let image = sharp({ create: { width, height, channels: 3, background: '#3a7d44' } }).jpeg();
	if (exif) image = image.withExif(exif);
	if (orientation) image = image.withMetadata({ orientation });
	return image.toBuffer();
}

export const TEST_ORIGIN = 'http://localhost:5173';
export const TEST_SECRET = 'unit-tests-only-not-a-real-secret-0123456789';
