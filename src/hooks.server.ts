import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
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
import { createSmtpMailer } from '#lib/server/notify/mailer.js';

/**
 * Runs once when the server starts: validates the configuration, opens the database and applies
 * any migrations (after a backup), then sets up sign-in. If any of it fails, the server refuses
 * to start.
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

	// Emitted by the Node adapter once it has stopped serving requests.
	process.once('sveltekit:shutdown', closeDatabase);
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
