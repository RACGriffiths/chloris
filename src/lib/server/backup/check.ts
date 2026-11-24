import fs from 'node:fs';
import { listHomeIds } from '../data/homes';
import { listPhotoFiles, type PhotoFiles } from '../data/photos';
import { checkDatabase } from '../db';
import { SIZES, listStoredFiles, photoFileName, type StoredFile } from '../photos/storage';

/**
 * The integrity check (docs/spec.md, Photos and backups; D53): SQLite's own checks of the
 * database, then the photos the database has compared with the files in the photo folder. It
 * reads only, so it can run while the server does. The backup uses the comparison too, to say
 * whether it holds every photo the database it copied refers to (D52).
 */

/** Every photo the database has, deleted or not, by home. */
export type PhotoRecords = Map<string, PhotoFiles[]>;

/** Reads every home's photos from the app's database. */
export function readPhotoRecords(): PhotoRecords {
	return new Map(listHomeIds().map((homeId) => [homeId, listPhotoFiles(homeId)]));
}

/** A photo that isn't deleted, some of whose files aren't where they should be. */
export interface MissingPhoto {
	homeId: string;
	plantId: string;
	photoId: string;
	/** The files that aren't there, as paths in the photo folder: `<home id>/<file name>`. */
	files: string[];
}

/** How the photos the database has compare with the files in a photo folder. */
export interface PhotoComparison {
	/** How many photos the database has, and how many of those are deleted. */
	photos: number;
	deleted: number;
	/** How many files there are in homes' folders. */
	files: number;
	/** Photos that aren't deleted with files missing. Pages show a placeholder in their place. */
	missing: MissingPhoto[];
	/**
	 * Deleted photos with files missing: removed by a run of the clean-up job that stopped before
	 * removing their rows, or restored from an older backup. Nothing shows them, so it's harmless.
	 */
	deletedWithoutFiles: number;
	/** Files in homes' folders that no photo refers to, as paths in the photo folder. */
	unreferenced: string[];
}

const relativePath = (homeId: string, name: string) => `${homeId}/${name}`;

/** The files the database's photos should have, as paths in the photo folder. */
function expectedFiles(records: PhotoRecords): Set<string> {
	const expected = new Set<string>();
	for (const [homeId, photos] of records) {
		for (const photo of photos) {
			for (const size of SIZES)
				expected.add(relativePath(homeId, photoFileName(photo.fileKey, size)));
		}
	}
	return expected;
}

/** Compares the photos the database has with the files in a photo folder. */
export function comparePhotoFiles(records: PhotoRecords, files: StoredFile[]): PhotoComparison {
	const present = new Set(files.map((file) => relativePath(file.homeId, file.name)));
	const comparison: PhotoComparison = {
		photos: 0,
		deleted: 0,
		files: files.length,
		missing: [],
		deletedWithoutFiles: 0,
		unreferenced: []
	};
	for (const [homeId, photos] of records) {
		for (const photo of photos) {
			comparison.photos++;
			if (photo.deletedAt) comparison.deleted++;
			const missing = SIZES.map((size) =>
				relativePath(homeId, photoFileName(photo.fileKey, size))
			).filter((file) => !present.has(file));
			if (missing.length === 0) continue;
			if (photo.deletedAt) comparison.deletedWithoutFiles++;
			else
				comparison.missing.push({
					homeId,
					plantId: photo.plantId,
					photoId: photo.id,
					files: missing
				});
		}
	}
	const expected = expectedFiles(records);
	comparison.unreferenced = [...present].filter((file) => !expected.has(file));
	return comparison;
}

/** What the integrity check found. */
export interface IntegrityReport {
	/** What SQLite's checks found wrong with the database; empty if nothing. */
	database: string[];
	/** Whether the photo folder exists. If not, every photo's files are missing. */
	photoFolderFound: boolean;
	photos: PhotoComparison;
	/** Whether anything needs putting right: damage to the database, or photos missing files. */
	ok: boolean;
}

/**
 * Checks the app's database and the photo folder `photosDir` against each other. Changes nothing.
 * The database must be open (`openExistingDatabase`).
 */
export async function checkIntegrity(photosDir: string): Promise<IntegrityReport> {
	const database = checkDatabase();

	// Read before the folder, so a photo added during the check has its files already (they're
	// written before its row) and isn't counted as missing.
	const before = readPhotoRecords();
	const photoFolderFound = fs.existsSync(photosDir);
	const files = photoFolderFound ? await listStoredFiles(photosDir) : [];
	const photos = comparePhotoFiles(before, files);
	// Read again after, so the files of a photo being added during the check, written before
	// its row, aren't counted as belonging to no photo once the row is there.
	const after = expectedFiles(readPhotoRecords());
	photos.unreferenced = photos.unreferenced.filter((file) => !after.has(file));

	return {
		database,
		photoFolderFound,
		photos,
		ok: database.length === 0 && photoFolderFound && photos.missing.length === 0
	};
}
