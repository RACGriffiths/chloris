import type { RequestEvent } from '@sveltejs/kit';
import { CLIENT_ADDRESS_HEADER } from './index';

/** Where BetterAuth's endpoints live. */
export const AUTH_BASE_PATH = '/api/auth';

/**
 * The only BetterAuth endpoints the browser may call: the passkey ceremonies, which have to run
 * in the browser. Everything else (sign-in links, sessions, homes) goes through the app's own
 * form actions, which call BetterAuth on the server after their own checks (D27).
 */
const BROWSER_ENDPOINTS = new Set([
	'/passkey/generate-register-options',
	'/passkey/verify-registration',
	'/passkey/generate-authenticate-options',
	'/passkey/verify-authentication'
]);

export function isAuthPath(pathname: string): boolean {
	return pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`);
}

export function isBrowserAuthEndpoint(pathname: string): boolean {
	return isAuthPath(pathname) && BROWSER_ENDPOINTS.has(pathname.slice(AUTH_BASE_PATH.length));
}

type AuthEvent = Pick<RequestEvent, 'request' | 'getClientAddress'>;

/**
 * The request's headers for a BetterAuth call, with the visitor's address as SvelteKit
 * determined it. Any copy of that header sent by the visitor is dropped.
 */
export function authHeaders(event: AuthEvent): Headers {
	const headers = new Headers(event.request.headers);
	headers.delete(CLIENT_ADDRESS_HEADER);
	try {
		headers.set(CLIENT_ADDRESS_HEADER, event.getClientAddress());
	} catch {
		// ADDRESS_HEADER is set but missing from this request: BetterAuth sees no address.
	}
	return headers;
}

/** The request to hand to BetterAuth's own handler, with `authHeaders()`. */
export function authRequest(event: AuthEvent): Request {
	return new Request(event.request, { headers: authHeaders(event) });
}
