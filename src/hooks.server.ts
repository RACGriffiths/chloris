import type { RequestEvent } from '@sveltejs/kit';
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
import { logLimitsReached, signInFailed } from '#lib/server/security/audit.js';
import { securityHeaders, withHeaders } from '#lib/server/security/headers.js';
import { clientKey, limits, looksProxied, tryAgainIn } from '#lib/server/security/rate-limit.js';
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
	headers = securityHeaders(config.origin);
	addressHeader = config.addressHeader;
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

	logLimitsReached();
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

/** Sent with every response; set at start-up from `ORIGIN`. */
let headers: Record<string, string> = {};
let addressHeader: string | undefined;
let warnedAboutProxy = false;

/** The passkey ceremony that signs someone in: a failure counts as a failed sign-in (D56, D58). */
const PASSKEY_SIGN_IN = '/api/auth/passkey/verify-authentication';

/**
 * Runs for every request, and adds the security headers to every response. The browser may reach
 * only BetterAuth's passkey endpoints, within rate limits; everything else about signing in goes
 * through the app's own pages (D27). For the rest, it looks up the session and puts the signed-in
 * user, if any, in `event.locals`.
 */
export const handle: Handle = async ({ event, resolve }) => {
	warnIfProxyUnknown(event.request.headers);
	return withHeaders(await respond({ event, resolve }), headers);
};

const respond: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	if (isAuthPath(pathname)) {
		if (!isBrowserAuthEndpoint(pathname)) return new Response('Not found', { status: 404 });
		return passkeyEndpoint(event);
	}

	const current = await getAuth().api.getSession({ headers: authHeaders(event) });
	event.locals.user = current?.user ?? null;
	event.locals.session = current?.session ?? null;
	return resolve(event);
};

/** BetterAuth's passkey endpoints, within the rate limits on passkeys and failed sign-ins. */
async function passkeyEndpoint(event: RequestEvent): Promise<Response> {
	const key = clientKey(event);
	const signingIn = event.url.pathname === PASSKEY_SIGN_IN;
	if (signingIn) {
		const failures = limits.failedSignIn.check(key);
		if (!failures.ok) return tooManyRequests(failures.retryAfterSeconds);
	}
	const requests = limits.passkey.consume(key);
	if (!requests.ok) return tooManyRequests(requests.retryAfterSeconds);

	const response = await getAuth().handler(authRequest(event));
	if (signingIn && !response.ok) signInFailed(event, 'passkey');
	return response;
}

/** A refusal BetterAuth's browser client shows as it would its own errors. */
function tooManyRequests(retryAfterSeconds: number): Response {
	return Response.json(
		{
			code: 'TOO_MANY_REQUESTS',
			message: `Too many attempts from here. ${tryAgainIn(retryAfterSeconds)}`
		},
		{ status: 429, headers: { 'retry-after': String(retryAfterSeconds) } }
	);
}

/**
 * Behind a proxy, `ADDRESS_HEADER` tells the app each visitor's real address. Without it every
 * visitor seems to come from the proxy, and they all share one set of rate limits: one person's
 * failed sign-ins would lock everyone out. Says so once, in the server's log.
 */
function warnIfProxyUnknown(requestHeaders: Headers): void {
	if (warnedAboutProxy || !looksProxied(requestHeaders, addressHeader)) return;
	warnedAboutProxy = true;
	console.warn(
		'Requests are arriving through a proxy (they carry X-Forwarded-For or similar), but ' +
			"ADDRESS_HEADER isn't set, so every visitor shares one set of rate limits. Behind one " +
			'Caddy, set ADDRESS_HEADER=X-Forwarded-For and XFF_DEPTH=1.'
	);
}
