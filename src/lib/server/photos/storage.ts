import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ConfigError } from '../config';
import { PRIVATE_FOLDER } from '../db/paths';
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
	if (create) fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_FOLDER });
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

/** The name of one of a photo's files, in its home's folder. */
export function photoFileName(fileKey: string, size: PhotoSize): string {
	return `${fileKey}-${size}.jpg`;
}

/** The path of one of a photo's files. */
export function photoPath(homeId: string, fileKey: string, size: PhotoSize): string {
	if (!SAFE_NAME.test(homeId) || !SAFE_NAME.test(fileKey)) {
		throw new Error('Unexpected characters in a photo file name');
	}
	return path.join(root(), homeId, photoFileName(fileKey, size));
}

export const SIZES = Object.keys(PHOTO_SIZES) as PhotoSize[];

const PHOTO_FILE_NAME = new RegExp(`^([\\w-]+)-(${SIZES.join('|')})\\.jpg$`);

/** A file in a home's folder of the photo folder. */
export interface StoredFile {
	/** The folder it's in, named for the home it belongs to. */
	homeId: string;
	name: string;
	/** Its size in bytes. */
	bytes: number;
	/** The photo it would be a file of, going by its name; `null` for any other name. */
	photo: { fileKey: string; size: PhotoSize } | null;
}

/**
 * The files in the photo folder `dir` that Chloris would have written: those in a folder named
 * like a home's id, which is where it writes them (D35). Anything else is left out, such as
 * `lost+found` at the top of a mounted drive, folders inside a home's folder, and links. Sorted by
 * home, then name. Throws if `dir` can't be read.
 */
export async function listStoredFiles(dir: string): Promise<StoredFile[]> {
	const files: StoredFile[] = [];
	const homes = (await fsp.readdir(dir, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() && SAFE_NAME.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	for (const homeId of homes) {
		const entries = await fsp.readdir(path.join(dir, homeId), { withFileTypes: true });
		for (const name of entries
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name)
			.sort()) {
			const { size: bytes } = await fsp.stat(path.join(dir, homeId, name));
			const match = PHOTO_FILE_NAME.exec(name);
			files.push({
				homeId,
				name,
				bytes,
				photo: match ? { fileKey: match[1], size: match[2] as PhotoSize } : null
			});
		}
	}
	return files;
}

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

/**
 * Removes the files of a photo deleted longer ago than the grace period (D54). A file that's
 * already gone is no error.
 */
export function removeDeletedPhotoFiles(homeId: string, fileKey: string): Promise<void> {
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
