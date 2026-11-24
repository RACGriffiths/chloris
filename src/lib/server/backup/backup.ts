import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { backupDatabase } from '../db';
import { databaseFile, fileTimestamp } from '../db/paths';
import { listStoredFiles, type StoredFile } from '../photos/storage';
import { comparePhotoFiles, readPhotoRecords, type MissingPhoto } from './check';

/**
 * The backup command (docs/spec.md, Photos and backups; D52). Each run makes a folder of its own
 * in the destination, named for the time: `chloris-2026-11-24T03-00-00Z/`, holding `chloris.db`
 * and `photos/`, laid out as `DATA_DIR` is with the default photo folder. So a backup can be
 * checked, or the app started on it, by pointing `DATA_DIR` at it.
 *
 * The database is copied first, then the photo folder. Photo files are written once and never
 * changed (D35), so every photo that copy of the database refers to is still on disk when the
 * photos are copied a moment later, deleted ones included (they're kept through the grace
 * period). For the same reason a photo's file with the same name and size as one in the previous
 * backup has the same contents, so it is linked to that one rather than copied again: each backup
 * is complete on its own, but only new photos take up more space.
 */

/** The name of a finished backup's folder. Only folders named like this are ever removed. */
export const BACKUP_NAME = /^chloris-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ$/;

/** Added to the name of a backup's folder while it's being made. */
const UNFINISHED = '.partial';

/** The photo folder inside a backup, where `PHOTOS_DIR` defaults to inside `DATA_DIR`. */
const PHOTOS = 'photos';

/** A reason the backup couldn't be made, to show as it is. */
export class BackupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BackupError';
	}
}

export interface BackupOptions {
	/** The photo folder to copy: `PHOTOS_DIR`. */
	photosDir: string;
	/** The folder to make the backup in. It must already exist. */
	destination: string;
	/** If given, the oldest backups in `destination` are removed afterwards, leaving this many. */
	keep?: number;
	now?: Date;
}

export interface BackupResult {
	/** The new backup's folder. */
	folder: string;
	/** The size of the copy of the database, in bytes. */
	databaseBytes: number;
	/** Photo files copied, and their size in bytes. */
	copied: number;
	copiedBytes: number;
	/** Photo files linked to the same file in the previous backup rather than copied. */
	linked: number;
	/** The folder of the previous backup, if files were linked to it. */
	linkedFrom: string | null;
	/**
	 * Photos the database refers to whose files weren't in the photo folder, so aren't in the
	 * backup either. They were missing already (`node build/cli check` says the same).
	 */
	missing: MissingPhoto[];
	/** The folders of older backups removed to keep `keep`. */
	removed: string[];
	/** Folders of backups that didn't finish, left by runs that stopped or still running. */
	unfinished: string[];
}

/**
 * Backs up the app's database and the photo folder into a new folder in `destination`, then
 * removes the oldest backups there beyond `keep`. The database must be open
 * (`openExistingDatabase`). Throws a `BackupError` for a problem the person running it can put
 * right; a backup that fails part way is removed.
 */
export async function makeBackup({
	photosDir,
	destination,
	keep,
	now = new Date()
}: BackupOptions): Promise<BackupResult> {
	const backups = await existingFolder(destination, 'backup folder');
	const photos = await existingFolder(photosDir, 'photo folder');
	if (backups === photos || backups.startsWith(photos + path.sep)) {
		throw new BackupError(
			`The backup folder ${destination} is inside the photo folder ${photosDir}. ` +
				'Choose a folder outside it, ideally on another drive.'
		);
	}

	const previous = (await listBackups(backups)).at(-1) ?? null;
	const folder = path.join(backups, `chloris-${fileTimestamp(now)}`);
	if (fs.existsSync(folder)) {
		throw new BackupError(`There is already a backup in ${folder}. Try again in a second.`);
	}
	const unfinished = folder + UNFINISHED;
	try {
		// Readable only by whoever made it: the database holds everyone's sign-in sessions.
		await fsp.mkdir(unfinished, { mode: 0o700 });
	} catch (error) {
		if (errorCode(error) !== 'EEXIST') throw error;
		throw new BackupError(`A backup is already being made in ${unfinished}.`);
	}

	let result: Omit<BackupResult, 'removed' | 'unfinished'>;
	try {
		const databaseCopy = databaseFile(unfinished);
		await backupDatabase(databaseCopy);
		// Read straight after copying the database: a photo added since then has its files on
		// disk already, since they're written before its row, so will be copied with the rest.
		const records = readPhotoRecords();
		const copy = await copyPhotos(
			photos,
			path.join(unfinished, PHOTOS),
			previous && path.join(backups, previous, PHOTOS)
		);
		result = {
			folder,
			databaseBytes: (await fsp.stat(databaseCopy)).size,
			copied: copy.copied,
			copiedBytes: copy.copiedBytes,
			linked: copy.linked,
			linkedFrom: copy.linked > 0 && previous ? path.join(backups, previous) : null,
			missing: comparePhotoFiles(records, copy.files).missing
		};
		await fsp.rename(unfinished, folder);
	} catch (error) {
		await fsp.rm(unfinished, { recursive: true, force: true });
		throw error;
	}

	const removed = keep === undefined ? [] : await removeOldBackups(backups, keep);
	const leftOver = (await fsp.readdir(backups))
		.filter(
			(name) => name.endsWith(UNFINISHED) && BACKUP_NAME.test(name.slice(0, -UNFINISHED.length))
		)
		.map((name) => path.join(backups, name));
	return { ...result, removed, unfinished: leftOver };
}

/** The real path of a folder that must already exist, or a `BackupError` saying it doesn't. */
async function existingFolder(dir: string, what: string): Promise<string> {
	let real: string;
	try {
		real = await fsp.realpath(dir);
	} catch {
		// Not made here: a backup drive that isn't mounted would fill the local disk instead (D37).
		throw new BackupError(
			`The ${what} ${dir} doesn't exist. Mount the drive or create the folder, then try again.`
		);
	}
	if (!(await fsp.stat(real)).isDirectory())
		throw new BackupError(`The ${what} ${dir} isn't a folder.`);
	return real;
}

/** The names of the finished backups in `dir`, oldest first. Links are left out. */
async function listBackups(dir: string): Promise<string[]> {
	return (await fsp.readdir(dir, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() && BACKUP_NAME.test(entry.name))
		.map((entry) => entry.name)
		.sort();
}

/** Removes the oldest finished backups in `dir`, leaving the latest `keep`. */
async function removeOldBackups(dir: string, keep: number): Promise<string[]> {
	const old = (await listBackups(dir)).slice(0, -keep);
	for (const name of old) await fsp.rm(path.join(dir, name), { recursive: true });
	return old.map((name) => path.join(dir, name));
}

/** Errors from `link()` meaning the drive can't link files at all, so it's not tried again. */
const CANNOT_LINK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

/**
 * Copies the files in the photo folder `source` that Chloris would have written to `target`,
 * linking a photo's file to the same one in `previous`, the previous backup's photo folder, where
 * that has it. Returns the files it copied or linked.
 */
async function copyPhotos(source: string, target: string, previous: string | null) {
	const files = await listStoredFiles(source);
	const done: StoredFile[] = [];
	let copied = 0;
	let copiedBytes = 0;
	let linked = 0;
	let canLink = previous !== null;

	await fsp.mkdir(target);
	for (const file of files) {
		const from = path.join(source, file.homeId, file.name);
		const to = path.join(target, file.homeId, file.name);
		await fsp.mkdir(path.dirname(to), { recursive: true });

		// Only a photo's own files are write-once; anything else in the folder is copied afresh.
		if (canLink && previous && file.photo) {
			const earlier = path.join(previous, file.homeId, file.name);
			if ((await fileSize(earlier)) === file.bytes) {
				try {
					await fsp.link(earlier, to);
					linked++;
					done.push(file);
					continue;
				} catch (error) {
					const code = errorCode(error);
					if (code && CANNOT_LINK.has(code)) canLink = false;
					// Otherwise (too many links to it, or that backup has just been removed by
					// another run), copy this one.
				}
			}
		}

		try {
			await copyFile(from, to);
		} catch (error) {
			// Removed since the folder was listed. Only a photo deleted longer ago than the grace
			// period, or an upload that failed, loses its files, so the backup doesn't need it.
			if (errorCode(error) === 'ENOENT') continue;
			throw error;
		}
		copied++;
		copiedBytes += file.bytes;
		done.push(file);
	}
	return { files: done, copied, copiedBytes, linked };
}

/** Copies a file to a new one, flushed to disk. */
async function copyFile(from: string, to: string): Promise<void> {
	await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL);
	const handle = await fsp.open(to, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** A file's size in bytes, or `null` if it isn't there. */
async function fileSize(file: string): Promise<number | null> {
	try {
		return (await fsp.stat(file)).size;
	} catch {
		return null;
	}
}

function errorCode(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException | undefined)?.code;
}
