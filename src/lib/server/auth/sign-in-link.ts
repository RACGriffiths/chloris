import { z } from 'zod';
import type { Db } from '../db';
import { createAuth } from './index';

export interface CommandLineLinkInput {
	email: string;
	/** Display name for a new account. Defaults to the start of the email address. */
	name?: string;
	/** Also let an existing account create a home. New accounts always may. */
	allowHomeCreation?: boolean;
}

export interface CommandLineLink {
	email: string;
	url: string;
	/** Whether the account was created just now. */
	created: boolean;
	/** Whether the account may create a home (D26). */
	canCreateHome: boolean;
}

/**
 * Makes a one-time sign-in link for the command-line tool, creating the account first if there
 * isn't one. This is how the first account comes to exist, and how someone gets back in when
 * email is off (spec: Authentication and access control). The link is returned, not sent.
 */
export async function createCommandLineSignInLink(
	{ origin, secret, db }: { origin: string; secret: string; db: Db },
	input: CommandLineLinkInput
): Promise<CommandLineLink> {
	const email = z.email('is not a valid email address').parse(input.email.trim().toLowerCase());

	let url: string | undefined;
	const auth = createAuth({
		origin,
		secret,
		db,
		sendSignInLink: (link) => {
			url = link.url;
		}
	});
	const { internalAdapter } = await auth.$context;

	const existing = await internalAdapter.findUserByEmail(email);
	// BetterAuth's internal adapter doesn't know about Chloris's extra user fields.
	let canCreateHome = Boolean(
		(existing?.user as { canCreateHome?: boolean } | undefined)?.canCreateHome
	);
	if (!existing) {
		await internalAdapter.createUser(
			{
				email,
				name: input.name?.trim() || email.split('@')[0],
				// Proven when the link is first used.
				emailVerified: false,
				canCreateHome: true
			},
			{ method: 'command-line' }
		);
		canCreateHome = true;
	} else if (input.allowHomeCreation && !canCreateHome) {
		await internalAdapter.updateUser(existing.user.id, { canCreateHome: true });
		canCreateHome = true;
	}

	await auth.api.signInMagicLink({ body: { email }, headers: new Headers() });
	if (!url) throw new Error('BetterAuth did not produce a sign-in link');
	return { email, url, created: !existing, canCreateHome };
}
