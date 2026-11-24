import { listHomeIds } from '../data/homes';
import { purgeDeletedPhotos } from '../data/photos';

/**
 * Removes deleted photos once the grace period is over (docs/spec.md, Photos and backups; D54).
 * Until then their files stay on disk, so a backup of the photos taken a little after one of the
 * database still holds every photo that database refers to, and a mistaken deletion can be put
 * right on the server.
 */

/** What a run did, for the log and for tests. */
export interface PhotoCleanupRun {
	/** Deleted photos removed, files and rows. */
	removed: number;
	/** Deleted photos whose files couldn't be removed, to be tried again on the next run. */
	failed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Removes, in every home, the photos deleted more than `graceDays` days before `now`. */
export async function removeDeletedPhotos(
	graceDays: number,
	now = new Date()
): Promise<PhotoCleanupRun> {
	const deletedBefore = new Date(now.getTime() - graceDays * DAY_MS);
	const run: PhotoCleanupRun = { removed: 0, failed: 0 };
	for (const homeId of listHomeIds()) {
		const { removed, failed } = await purgeDeletedPhotos(homeId, deletedBefore);
		run.removed += removed;
		run.failed += failed.length;
		for (const { photoId, error } of failed) {
			console.error(`Could not remove the files of deleted photo ${photoId}:`, error);
		}
	}
	if (run.removed > 0) {
		console.info(
			`Removed ${run.removed} photo(s) deleted more than ${graceDays} day(s) ago, with their files.`
		);
	}
	return run;
}
