import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import type { SignInMethod } from '../../audit';
import { auditAccount } from '../security/audit';

/**
 * The endpoints that sign someone in, whether the browser calls them (passkeys) or a form action
 * does on the server (sign-in links, joining from an invite).
 */
const SIGN_IN_ENDPOINTS: Record<string, SignInMethod> = {
	'/passkey/verify-authentication': 'passkey',
	'/magic-link/verify': 'link',
	'/chloris/join-with-invite': 'invite'
};

const PASSKEY_ADDED = '/passkey/verify-registration';

/**
 * Runs after every BetterAuth endpoint, however it was called, and records sign-ins and new
 * passkeys in the audit log of each home the person belongs to (D57). Removing a passkey is
 * recorded by the account page, which knows the passkey's name before it goes.
 *
 * `addressHeader` is the header carrying the visitor's address (`CLIENT_ADDRESS_HEADER`).
 */
export const auditHook = (addressHeader: string) =>
	createAuthMiddleware((ctx) => {
		record(ctx, addressHeader);
		return Promise.resolve();
	});

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

function record(ctx: HookContext, addressHeader: string): void {
	const returned: unknown = ctx.context.returned;
	if (isAPIError(returned) || returned instanceof Response) return;

	const source = {
		ipAddress: ctx.headers?.get(addressHeader),
		userAgent: ctx.headers?.get('user-agent')
	};
	const method = SIGN_IN_ENDPOINTS[ctx.path];
	const signedIn = ctx.context.newSession;
	if (method && signedIn) {
		auditAccount(
			{ ...source, userId: signedIn.user.id },
			{ action: 'sign-in', detail: { method } }
		);
	}

	if (ctx.path === PASSKEY_ADDED && isPasskey(returned)) {
		auditAccount(
			{ ...source, userId: returned.userId },
			{
				action: 'passkey-added',
				targetId: returned.id,
				detail: { name: returned.name || 'Passkey' }
			}
		);
	}
}

function isPasskey(value: unknown): value is { id: string; userId: string; name?: string | null } {
	if (typeof value !== 'object' || value === null) return false;
	const { id, userId } = value as Record<string, unknown>;
	return typeof id === 'string' && typeof userId === 'string';
}
