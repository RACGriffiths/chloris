import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ConfigError } from '../config';
import { PHOTO_SIZES, type PhotoSize } from '../../photos';

/**
 * Where photo files live: `PHOTOS_DIR/<home id>/<file key>-<size>.jpg` (D35). Files are written
 * once and never overwritten (CLAUDE.md rule 5), so a photo backup taken after a database backup
 * holds every photo that database refers to. Only the data-access layer (`#lib/server/data/photos`)
 * uses this module: it knows which files belong to which home.
 */

let photosDir: string | undefined;

/**
 * Checks the photo folder at start-up (D37). The default one, inside `DATA_DIR`, is made if it's
 * missing. One set with `PHOTOS_DIR` must already exist, so a drive that isn't mounted stops the
 * app instead of photos quietly filling the local disk. Either way, it must be writable. Throws a
 * `ConfigError` otherwise.
 */
export function initPhotoStorage(dir: string, { create }: { create: boolean }): void {
	if (create) fs.mkdirSync(dir, { recursive: true });
	let stats: fs.Stats;
	try {
		stats = fs.statSync(dir);
	} catch {
		throw new ConfigError([
			`PHOTOS_DIR: ${dir} doesn't exist. Mount the drive or create the folder, then start Chloris again.`
		]);
	}
	if (!stats.isDirectory()) throw new ConfigError([`PHOTOS_DIR: ${dir} isn't a folder.`]);
	try {
		fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
	} catch {
		throw new ConfigError([
			`PHOTOS_DIR: ${dir} isn't writable by this user (ID ${process.getuid?.() ?? 'unknown'}).`
		]);
	}
	photosDir = dir;
}

function root(): string {
	if (!photosDir)
		throw new Error('Photo storage is not set up; initPhotoStorage() runs at start-up');
	return photosDir;
}

/** Ids and keys come from the database, never from a request; this is a second guard. */
const SAFE_NAME = /^[\w-]+$/;

/** The path of one of a photo's files. */
export function photoPath(homeId: string, fileKey: string, size: PhotoSize): string {
	if (!SAFE_NAME.test(homeId) || !SAFE_NAME.test(fileKey)) {
		throw new Error('Unexpected characters in a photo file name');
	}
	return path.join(root(), homeId, `${fileKey}-${size}.jpg`);
}

const SIZES = Object.keys(PHOTO_SIZES) as PhotoSize[];

/**
 * Writes a new photo's files. Each is created exclusively, so an existing file is never
 * overwritten, and flushed to disk before the database row that refers to it is written. If any
 * fails, those already written are removed: nothing refers to them yet.
 */
export async function writePhotoFiles(
	homeId: string,
	fileKey: string,
	files: Record<PhotoSize, Uint8Array>
): Promise<void> {
	await fsp.mkdir(path.dirname(photoPath(homeId, fileKey, 'full')), { recursive: true });
	const written: PhotoSize[] = [];
	try {
		for (const size of SIZES) {
			// 'wx': create the file, failing if it already exists.
			const file = await fsp.open(photoPath(homeId, fileKey, size), 'wx');
			written.push(size);
			try {
				await file.writeFile(files[size]);
				await file.sync();
			} finally {
				await file.close();
			}
		}
	} catch (error) {
		await discardFiles(homeId, fileKey, written);
		throw error;
	}
}

async function discardFiles(homeId: string, fileKey: string, sizes: PhotoSize[]): Promise<void> {
	await Promise.all(sizes.map((size) => fsp.rm(photoPath(homeId, fileKey, size), { force: true })));
}

/**
 * Removes the files of a photo whose database row was never written. This is the only time
 * files are removed straight away: once a row refers to them, they stay until the grace period
 * after the photo is deleted has passed.
 */
export function discardUnrecordedPhoto(homeId: string, fileKey: string): Promise<void> {
	return discardFiles(homeId, fileKey, SIZES);
}

/** One of a photo's files, or `null` if it isn't on disk (D35: a placeholder is shown). */
export async function readPhotoFile(
	homeId: string,
	fileKey: string,
	size: PhotoSize
): Promise<Buffer | null> {
	try {
		return await fsp.readFile(photoPath(homeId, fileKey, size));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}
