import { passkey } from '@better-auth/passkey';
import type { RequestEvent } from '@sveltejs/kit';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import type { Db } from '../db';
import * as schema from '../db/schema';
import { ac, roles } from '../permissions/roles';
import { auditHook } from './audit';
import { invites } from './invites';

/**
 * Sign-in with BetterAuth: passkeys, with one-time sign-in links as the fallback, and no
 * passwords (D07). Nobody can sign up: accounts are made by the command-line tool or from an
 * invite link (D26). See docs/spec.md, Authentication and access control.
 *
 * This module has no SvelteKit runtime imports, so the command-line tool can use it too.
 */

/** How long a sign-in link works for. */
export const SIGN_IN_LINK_MINUTES = 15;

const DAY = 60 * 60 * 24;

/**
 * Carries the visitor's IP address to BetterAuth, which records it on sessions and uses it for
 * rate limits. Set only by the server from SvelteKit's `getClientAddress()`, which honours
 * `ADDRESS_HEADER` and `XFF_DEPTH`; never trusted from the incoming request (see `./http`).
 */
export const CLIENT_ADDRESS_HEADER = 'x-chloris-client-address';

export interface SignInLink {
	email: string;
	url: string;
}

export interface AuthOptions {
	/** The public origin, `ORIGIN`. Passkeys are tied to its host name. */
	origin: string;
	secret: string;
	db: Db;
	/** Delivers a sign-in link: by email on the server, printed by the command-line tool. */
	sendSignInLink: (link: SignInLink) => Promise<void> | void;
	/** SvelteKit's `getRequestEvent`, so auth calls made during a request can set cookies. */
	getRequestEvent?: () => RequestEvent;
}

/**
 * The page a sign-in link opens. It asks the visitor to confirm, so mail scanners that open
 * links can't use up the one-time token.
 */
export function signInLinkUrl(origin: string, token: string): string {
	const url = new URL('/sign-in/link', origin);
	url.searchParams.set('token', token);
	return url.href;
}

export function createAuth({ origin, secret, db, sendSignInLink, getRequestEvent }: AuthOptions) {
	return betterAuth({
		appName: 'Chloris',
		baseURL: origin,
		secret,
		database: drizzleAdapter(db, { provider: 'sqlite', schema }),
		telemetry: { enabled: false },
		user: {
			additionalFields: {
				canCreateHome: { type: 'boolean', required: false, defaultValue: false, input: false }
			}
		},
		session: { expiresIn: 30 * DAY, updateAge: DAY },
		// Chloris limits sign-ins itself (`#lib/server/security/rate-limit`, D56), including the
		// form actions that call BetterAuth on the server, where BetterAuth's own limits don't
		// apply. Those would otherwise depend on NODE_ENV, so differ between installs.
		rateLimit: { enabled: false },
		// Records sign-ins and new passkeys in the audit log (D57).
		hooks: { after: auditHook(CLIENT_ADDRESS_HEADER) },
		advanced: {
			cookiePrefix: 'chloris',
			ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] }
		},
		plugins: [
			magicLink({
				expiresIn: SIGN_IN_LINK_MINUTES * 60,
				disableSignUp: true,
				// A copy of the database alone can't be used to sign in.
				storeToken: 'hashed',
				sendMagicLink: async ({ email, token }) => {
					await sendSignInLink({ email, url: signInLinkUrl(origin, token) });
				}
			}),
			passkey({ rpID: new URL(origin).hostname, rpName: 'Chloris', origin }),
			organization({
				ac,
				roles,
				creatorRole: 'owner',
				// Homes are created through the data-access layer, after `canCreateHome()`.
				allowUserToCreateOrganization: false,
				schema: {
					organization: {
						modelName: 'home',
						additionalFields: { timeZone: { type: 'string', required: true } }
					},
					member: { modelName: 'membership', fields: { organizationId: 'homeId' } },
					// Unused: invite links are Chloris's own (D28), but the plugin needs the table.
					invitation: { fields: { organizationId: 'homeId' } },
					session: { fields: { activeOrganizationId: 'activeHomeId' } }
				}
			}),
			invites(),
			// Must stay last: copies the cookies set by any auth call onto SvelteKit's response.
			sveltekitCookies(getRequestEvent ?? noRequestEvent)
		]
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth['$Infer']['Session']['session'];
export type SessionUser = Auth['$Infer']['Session']['user'];

/** Outside a request (the command-line tool), there are no cookies to set. */
const noRequestEvent = () => undefined as unknown as RequestEvent;

let current: Auth | undefined;

/** Sets up the app's auth once at start-up, after the database is open. */
export function initAuth(options: AuthOptions): Auth {
	current = createAuth(options);
	return current;
}

export function getAuth(): Auth {
	if (!current) throw new Error('Auth has not been set up; call initAuth() at start-up');
	return current;
}
