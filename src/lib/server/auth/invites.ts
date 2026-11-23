import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import { joinWithNewAccount } from '../data/invites';

/** The page an invite link opens. Opening it only shows the invite; joining waits for a POST. */
export function inviteUrl(origin: string, token: string): string {
	return new URL(`/invite/${encodeURIComponent(token)}`, origin).href;
}

/**
 * Joining a home from an invite link without an account (D28): creates the account and its
 * membership with `joinWithNewAccount()`, then signs the new account in. The link is the only
 * proof the person has, since email may be off. This is a BetterAuth endpoint so that the
 * session and its cookie are made exactly as BetterAuth makes them for any other sign-in.
 *
 * Server only: BetterAuth won't route it over HTTP (`SERVER_ONLY`), and `./http` lets the
 * browser reach only the passkey endpoints anyway (D27). The invite page's form action calls it
 * with `getAuth().api.joinWithInvite()`.
 */
export const invites = () =>
	({
		id: 'chloris-invites',
		endpoints: {
			joinWithInvite: createAuthEndpoint(
				'/chloris/join-with-invite',
				{
					method: 'POST',
					body: z.object({ token: z.string(), name: z.string(), email: z.string() }),
					metadata: { SERVER_ONLY: true }
				},
				async (ctx) => {
					const { token, name, email } = ctx.body;
					const result = joinWithNewAccount(token, { name, email });
					if (!result.ok) return ctx.json(result);

					const user = await ctx.context.internalAdapter.findUserById(result.userId);
					if (!user) throw new APIError('INTERNAL_SERVER_ERROR');
					const session = await ctx.context.internalAdapter.createSession(user.id);
					await setSessionCookie(ctx, { session, user });
					return ctx.json(result);
				}
			)
		}
	}) satisfies BetterAuthPlugin;
