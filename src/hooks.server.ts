import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import * as env from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { signInLinkEmail } from '#lib/server/auth/emails.js';
import {
	authHeaders,
	authRequest,
	isAuthPath,
	isBrowserAuthEndpoint
} from '#lib/server/auth/http.js';
import { getAuth, initAuth } from '#lib/server/auth/index.js';
import { initConfig } from '#lib/server/config.js';
import { closeDatabase, getConnection, initDatabase } from '#lib/server/db/index.js';
import { startJobs, stopJobs } from '#lib/server/jobs/scheduler.js';
import { createSmtpMailer } from '#lib/server/notify/mailer.js';
import { initPhotoStorage } from '#lib/server/photos/storage.js';
import { MAX_PHOTO_BYTES } from '#lib/photos.js';

/** Room for a photo of the largest size accepted, plus the rest of the form it comes in. */
const UPLOAD_BODY_BYTES = MAX_PHOTO_BYTES + 1024 * 1024;

/**
 * Runs once when the server starts: validates the configuration, checks the photo folder, opens
 * the database and applies any migrations (after a backup), sets up sign-in, and starts the
 * background jobs: the daily digest, when email is on, and removing deleted photos after the grace
 * period. If any of it fails, the server refuses to start.
 */
export const init: ServerInit = async () => {
	if (building) return;

	const config = initConfig(env);
	initPhotoStorage(config.photosDir, { create: !config.photosDirSet });
	// The development server has no limit; the Node adapter's default is 512K (D37).
	if (!dev && config.bodySizeLimitBytes < UPLOAD_BODY_BYTES) {
		console.warn(
			`BODY_SIZE_LIMIT is ${config.bodySizeLimit ?? 'not set (512K)'}, so larger photos can't be ` +
				'uploaded. Set BODY_SIZE_LIMIT=25M, as the Docker image does.'
		);
	}
	const { applied, backupFile } = await initDatabase(config.dataDir);
	if (applied > 0) {
		console.info(
			`Applied ${applied} database migration(s).` +
				(backupFile ? ` The database before migrating is in ${backupFile}.` : '')
		);
	}

	const mailer = config.smtp ? createSmtpMailer(config.smtp) : null;
	initAuth({
		origin: config.origin,
		secret: config.authSecret,
		db: getConnection().db,
		getRequestEvent,
		sendSignInLink: (link) => {
			if (!mailer) throw new Error('Email is switched off, so sign-in links cannot be sent');
			// Not awaited: the sign-in page answers at once whether or not the address has an
			// account, so how long the mail server takes gives nothing away.
			mailer.send(signInLinkEmail(link)).catch((error: unknown) => {
				console.error('Could not email a sign-in link:', error);
			});
		}
	});

	startJobs({
		mailer,
		origin: config.origin,
		photoDeleteGraceDays: config.photoDeleteGraceDays
	});

	// Emitted by the Node adapter once it has stopped serving requests.
	process.once('sveltekit:shutdown', () => {
		stopJobs();
		closeDatabase();
	});
};

/**
 * Runs for every request. The browser may reach only BetterAuth's passkey endpoints; everything
 * else about signing in goes through the app's own pages (D27). For the rest, it looks up the
 * session and puts the signed-in user, if any, in `event.locals`.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	if (isAuthPath(pathname)) {
		if (!isBrowserAuthEndpoint(pathname)) return new Response('Not found', { status: 404 });
		return getAuth().handler(authRequest(event));
	}

	const current = await getAuth().api.getSession({ headers: authHeaders(event) });
	event.locals.user = current?.user ?? null;
	event.locals.session = current?.session ?? null;
	return resolve(event);
};
