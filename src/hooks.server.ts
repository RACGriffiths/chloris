import type { ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import * as env from '$app/env/private';
import { initConfig } from '#lib/server/config.js';
import { closeDatabase, initDatabase } from '#lib/server/db/index.js';

/**
 * Runs once when the server starts: validates the configuration, then opens the database and
 * applies any migrations (after a backup). If either fails, the server refuses to start.
 */
export const init: ServerInit = async () => {
	if (building) return;

	const config = initConfig(env);
	const { applied, backupFile } = await initDatabase(config.dataDir);
	if (applied > 0) {
		console.info(
			`Applied ${applied} database migration(s).` +
				(backupFile ? ` The database before migrating is in ${backupFile}.` : '')
		);
	}

	// Emitted by the Node adapter once it has stopped serving requests.
	process.once('sveltekit:shutdown', closeDatabase);
};
