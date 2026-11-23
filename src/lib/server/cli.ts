import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { SIGN_IN_LINK_MINUTES } from './auth/index';
import { createCommandLineSignInLink } from './auth/sign-in-link';
import { ConfigError, parseConfig, type Env } from './config';
import { closeDatabase, getConnection, initDatabase } from './db';

/**
 * Chloris's command-line tool, built to `build/cli` by `npm run build`. It reads the same
 * environment variables as the server, so run it where the server runs.
 */

export const USAGE = `Usage: node build/cli sign-in-link <email> [--name <name>] [--can-create-home]

Prints a one-time link that signs in the account with that email address. Use it to set
up the first account, or when email is switched off and someone can't sign in.

If there is no account with that address, one is created, and it may create a home.
  --name <name>        Display name for a new account (default: the start of the address)
  --can-create-home    Also let an existing account create a home`;

export interface Output {
	log(message: string): void;
	error(message: string): void;
}

/** Runs one command and returns the exit code. */
export async function main(args: string[], env: Env, out: Output = console): Promise<number> {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			allowPositionals: true,
			options: {
				name: { type: 'string' },
				'can-create-home': { type: 'boolean', default: false },
				help: { type: 'boolean', short: 'h', default: false }
			}
		});
	} catch (error) {
		out.error(`${(error as Error).message}\n\n${USAGE}`);
		return 2;
	}
	const { values, positionals } = parsed;
	if (values.help) {
		out.log(USAGE);
		return 0;
	}
	const [command, email, ...extra] = positionals;
	if (command !== 'sign-in-link' || !email || extra.length > 0) {
		out.error(USAGE);
		return 2;
	}

	try {
		const config = parseConfig(env);
		const { applied } = await initDatabase(config.dataDir);
		if (applied > 0) out.log(`Applied ${applied} database migration(s).`);

		const link = await createCommandLineSignInLink(
			{ origin: config.origin, secret: config.authSecret, db: getConnection().db },
			{ email, name: values.name, allowHomeCreation: values['can-create-home'] }
		);

		const account = link.created
			? 'a new account, which may create a home'
			: link.canCreateHome
				? 'an existing account, which may create a home'
				: 'an existing account';
		out.log(
			[
				`Sign-in link for ${link.email} (${account}):`,
				'',
				`  ${link.url}`,
				'',
				`It works once, within ${SIGN_IN_LINK_MINUTES} minutes. Open it on the device that`,
				'should be signed in, and keep it private: anyone with it can sign in as this account.'
			].join('\n')
		);
		return 0;
	} catch (error) {
		if (error instanceof ConfigError) out.error(error.message);
		else if (error instanceof ZodError) out.error(`${email}: ${error.issues[0].message}`);
		else throw error;
		return 1;
	} finally {
		closeDatabase();
	}
}
