import type { BetterAuthOptions } from 'better-auth';
import { auditAccount } from '../security/audit';

type UserHooks = NonNullable<NonNullable<BetterAuthOptions['databaseHooks']>['user']>;
type UserUpdated = NonNullable<NonNullable<UserHooks['update']>['after']>;

/** The endpoint a sign-in link calls: using one proves the person has the email address. */
const SIGN_IN_LINK = '/magic-link/verify';

/**
 * Removes the passkeys of an account whose email address a sign-in link has just proven for the
 * first time (D50).
 *
 * An account made from an invite link has an address nobody has proven: whoever had the link
 * typed it (D28). They could type someone else's address, add a passkey, and wait. When the real
 * owner of the address later signs in with a link (to join a home of their own, say, or with one
 * the command-line tool printed), BetterAuth ends every session the account had and removes its
 * other ways in (`revokeUnprovenAccountAccess`), but it doesn't know about passkeys, which belong
 * to a plugin. Without this, a passkey added before the address was proven would still sign in to
 * the account its real owner now uses, and to any home they go on to join or create.
 *
 * BetterAuth sets `emailVerified` on that path only when the address wasn't proven before, so this
 * runs as its database hook after a user is updated. Each passkey removed goes in the audit log.
 *
 * `addressHeader` is the header carrying the visitor's address (`CLIENT_ADDRESS_HEADER`).
 */
export const forgetUnprovenPasskeys =
	(addressHeader: string): UserUpdated =>
	async (user, ctx) => {
		if (ctx?.path !== SIGN_IN_LINK || !user.emailVerified) return;
		const { adapter } = ctx.context;
		const where = [{ field: 'userId', value: user.id }];
		const passkeys = await adapter.findMany<{ id: string; name?: string | null }>({
			model: 'passkey',
			where
		});
		if (passkeys.length === 0) return;
		await adapter.deleteMany({ model: 'passkey', where });

		const source = {
			userId: user.id,
			ipAddress: ctx.headers?.get(addressHeader),
			userAgent: ctx.headers?.get('user-agent')
		};
		for (const passkey of passkeys) {
			auditAccount(source, {
				action: 'passkey-removed',
				targetId: passkey.id,
				detail: { name: passkey.name || 'Passkey', unproven: true }
			});
		}
	};
