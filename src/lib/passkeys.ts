import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import { describeUserAgent } from './devices';

/**
 * Passkeys in the browser: the WebAuthn ceremonies have to run there, talking to BetterAuth's
 * passkey endpoints (the only ones the browser may reach, D27). Load this module with
 * `await import()` from an event handler or `onMount`, so it never runs on the server.
 */

export type Outcome = { ok: true } | { ok: false; cancelled: boolean; message: string };

let client: ReturnType<typeof createClient> | undefined;

function createClient() {
	return createAuthClient({ baseURL: window.location.origin, plugins: [passkeyClient()] });
}

function getClient() {
	client ??= createClient();
	return client;
}

/** Error codes for a ceremony the person stopped, or that a newer one replaced. */
const CANCELLED = new Set([
	'AUTH_CANCELLED',
	'ERROR_CEREMONY_ABORTED',
	'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
	'REGISTRATION_CANCELLED'
]);

function outcome(error: { code?: string; message?: string } | null, fallback: string): Outcome {
	if (!error) return { ok: true };
	if (error.code === 'SESSION_NOT_FRESH') {
		return {
			ok: false,
			cancelled: false,
			message: 'To add a passkey, sign in again first. This keeps someone else from adding theirs.'
		};
	}
	return {
		ok: false,
		cancelled: CANCELLED.has(error.code ?? ''),
		message: error.message || fallback
	};
}

export function passkeysSupported(): boolean {
	return typeof window.PublicKeyCredential === 'function';
}

/** Whether the browser can offer passkeys in the email field's autofill suggestions. */
export async function autofillSupported(): Promise<boolean> {
	return (
		passkeysSupported() &&
		typeof PublicKeyCredential.isConditionalMediationAvailable === 'function' &&
		(await PublicKeyCredential.isConditionalMediationAvailable())
	);
}

/**
 * Signs in with a passkey. With `autoFill`, it waits quietly for the person to pick a passkey
 * from the email field's suggestions; a later call replaces it.
 */
export async function signInWithPasskey({ autoFill = false } = {}): Promise<Outcome> {
	const { error } = await getClient().signIn.passkey({ autoFill });
	return outcome(error, "That passkey didn't work. Try again, or get a sign-in link.");
}

/** Creates a passkey for the signed-in account, named after this device. */
export async function addPasskey(): Promise<Outcome> {
	const { error } = await getClient().passkey.addPasskey({
		name: describeUserAgent(navigator.userAgent)
	});
	return outcome(error, "The passkey wasn't added. Try again.");
}
