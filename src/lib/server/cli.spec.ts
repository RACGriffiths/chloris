import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { USAGE, main, printable } from './cli';
import { createHome } from './data/homes';
import { createInvite, joinWithNewAccount } from './data/invites';
import { recordServerEvent } from './data/server-log';
import { closeDatabase, openExistingDatabase } from './db';
import { TEST_ORIGIN, TEST_SECRET, insertUser } from './testing';

let root: string;
let env: Record<string, string>;
let logged: string[];
let errors: string[];
const out = {
	log: (message: string) => logged.push(message),
	error: (message: string) => errors.push(message)
};

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'chloris-cli-'));
	env = { ORIGIN: TEST_ORIGIN, BETTER_AUTH_SECRET: TEST_SECRET, DATA_DIR: path.join(root, 'data') };
	logged = [];
	errors = [];
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe('sign-in-link', () => {
	it('prints a link for a new account, setting up the database if needed', async () => {
		expect(await main(['sign-in-link', 'owner@example.com'], env, out)).toBe(0);

		const output = logged.join('\n');
		expect(output).toMatch(/^Applied \d+ database migration\(s\)\./m);
		expect(output).toContain('owner@example.com (a new account, which may create a home)');
		expect(output).toMatch(/^ {2}http:\/\/localhost:5173\/sign-in\/link\?token=\w+$/m);
		expect(errors).toEqual([]);
	});

	it('says when the account already exists', async () => {
		await main(['sign-in-link', 'owner@example.com'], env, out);
		logged = [];

		expect(await main(['sign-in-link', 'Owner@example.com'], env, out)).toBe(0);
		expect(logged.join('\n')).toContain('(an existing account, which may create a home)');
		// Its address isn't proven yet, but it can't be in a home, so there's nothing to warn of.
		expect(logged.join('\n')).not.toContain("isn't confirmed");
	});

	it('warns when the account was made from an invite link and its address is unconfirmed', async () => {
		await main(['sign-in-link', 'owner@example.com'], env, out);
		// Someone with an invite link joined a home with this address, perhaps not their own.
		openExistingDatabase(env.DATA_DIR);
		const owner = insertUser('host@example.com', { canCreateHome: true });
		const home = createHome(owner, { name: 'Flat', timeZone: 'Europe/London' });
		const { token } = createInvite(home.id, owner, { role: 'viewer' });
		joinWithNewAccount(token, { name: 'Alice', email: 'alice@example.com' });
		closeDatabase();
		logged = [];

		expect(await main(['sign-in-link', 'alice@example.com'], env, out)).toBe(0);

		const output = logged.join('\n');
		expect(output).toContain('alice@example.com (an existing account)');
		expect(output).toMatch(/^ {2}http:\/\/localhost:5173\/sign-in\/link\?token=\w+$/m);
		expect(output).toContain(
			"Its address isn't confirmed: it was made from an invite link, and it's in 1 home."
		);
	});

	it('explains how to use it when the arguments are wrong', async () => {
		expect(await main([], env, out)).toBe(2);
		expect(await main(['sign-in-link'], env, out)).toBe(2);
		expect(await main(['make-coffee', 'a@example.com'], env, out)).toBe(2);
		expect(await main(['sign-in-link', 'a@example.com', '--colour'], env, out)).toBe(2);
		expect(errors.every((message) => message.endsWith(USAGE))).toBe(true);

		expect(await main(['--help'], env, out)).toBe(0);
		expect(logged).toEqual([USAGE]);
	});

	it('rejects an invalid address', async () => {
		expect(await main(['sign-in-link', 'owner'], env, out)).toBe(1);
		expect(errors).toEqual(['owner: is not a valid email address']);
	});

	it('reports a configuration problem without touching the database', async () => {
		expect(await main(['sign-in-link', 'a@example.com'], { DATA_DIR: env.DATA_DIR }, out)).toBe(1);
		expect(errors[0]).toContain('ORIGIN: is required');
		expect(fs.existsSync(env.DATA_DIR)).toBe(false);
	});
});

describe('backup', () => {
	let destination: string;

	beforeEach(async () => {
		// The server makes the database and the default photo folder when it first starts.
		await main(['sign-in-link', 'owner@example.com'], env, out);
		fs.mkdirSync(path.join(env.DATA_DIR, 'photos'));
		destination = path.join(root, 'backups');
		fs.mkdirSync(destination);
		logged = [];
	});

	it('backs up into a new folder and says what it did', async () => {
		expect(await main(['backup', destination, '--keep', '7'], env, out)).toBe(0);

		const [folder] = fs.readdirSync(destination);
		expect(folder).toMatch(/^chloris-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ$/);
		expect(logged.join('\n')).toContain(`Backed up to ${path.join(destination, folder)}`);
		expect(logged.join('\n')).toMatch(/Database: copied and checked \(\d+(\.\d)? KB\)\./);
		expect(logged.join('\n')).toContain('Photos: copied 0 files (0 bytes).');
		expect(errors).toEqual([]);
	});

	it("says when the backup folder doesn't exist", async () => {
		const missing = path.join(root, 'mnt', 'backups');

		expect(await main(['backup', missing], env, out)).toBe(1);
		expect(errors).toEqual([
			`The backup folder ${missing} doesn't exist. Mount the drive or create the folder, then try again.`
		]);
	});

	it("says when there's no database, rather than making an empty one", async () => {
		const elsewhere = { ...env, DATA_DIR: path.join(root, 'elsewhere') };

		expect(await main(['backup', destination], elsewhere, out)).toBe(1);
		expect(errors[0]).toContain(`there is no database at ${path.join(root, 'elsewhere')}`);
		expect(fs.existsSync(elsewhere.DATA_DIR)).toBe(false);
	});

	it('explains how to use it when the arguments are wrong', async () => {
		expect(await main(['backup'], env, out)).toBe(2);
		expect(await main(['backup', destination, 'more'], env, out)).toBe(2);
		expect(await main(['backup', destination, '--name', 'x'], env, out)).toBe(2);
		expect(await main(['backup', destination, '--keep', '0'], env, out)).toBe(2);
		expect(await main(['backup', destination, '--keep', 'all'], env, out)).toBe(2);
		expect(await main(['sign-in-link', 'a@example.com', '--keep', '2'], env, out)).toBe(2);
		expect(errors.every((message) => message.endsWith(USAGE))).toBe(true);
		expect(fs.readdirSync(destination)).toEqual([]);
	});
});

describe('check', () => {
	beforeEach(async () => {
		await main(['sign-in-link', 'owner@example.com'], env, out);
		logged = [];
	});

	it('says all is well when it is', async () => {
		fs.mkdirSync(path.join(env.DATA_DIR, 'photos'));

		expect(await main(['check'], env, out)).toBe(0);
		expect(logged.join('\n')).toBe(
			[
				'Database: no problems found.',
				`Photos: 0 photos in the database, and 0 files in ${path.join(env.DATA_DIR, 'photos')}.`,
				'',
				'All is well.'
			].join('\n')
		);
	});

	it("says when the photo folder isn't there", async () => {
		const photos = path.join(root, 'mnt', 'photos');

		expect(await main(['check'], { ...env, PHOTOS_DIR: photos }, out)).toBe(1);
		expect(errors.join('\n')).toContain(`The photo folder ${photos} doesn't exist.`);
		expect(errors.join('\n')).toMatch(/Found problems: see above\.$/);
	});

	it('takes no arguments', async () => {
		expect(await main(['check', 'now'], env, out)).toBe(2);
		expect(await main(['check', '--keep', '1'], env, out)).toBe(2);
	});
});

describe('log', () => {
	it('prints the server log, the latest first, including the links printed here', async () => {
		await main(['sign-in-link', 'owner@example.com'], env, out);
		await main(['sign-in-link', 'guest@example.com'], env, out);
		logged = [];

		expect(await main(['log'], env, out)).toBe(0);

		expect(logged.join('\n').split('\n')).toEqual([
			expect.stringMatching(
				/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\dZ {2}The command-line tool printed a sign-in link for guest@example\.com \(a new account, which may create a home\)$/
			) as unknown,
			expect.stringContaining('for owner@example.com') as unknown
		]);
	});

	it('prints as many as asked, and says there may be more', async () => {
		await main(['sign-in-link', 'owner@example.com'], env, out);
		await main(['sign-in-link', 'owner@example.com'], env, out);
		logged = [];

		expect(await main(['log', '--limit', '1'], env, out)).toBe(0);

		expect(logged.join('\n')).toMatch(/^.*existing account.*\n\nThe latest 1; use --limit/);
	});

	it("shows control characters in what people typed as escapes, so they can't rewrite the terminal", async () => {
		await main(['sign-in-link', 'owner@example.com'], env, out);
		// A passkey's name is whatever the browser sent. This one would wipe its own line and
		// write a harmless-looking one in its place.
		openExistingDatabase(env.DATA_DIR);
		recordServerEvent(
			{ ipAddress: '203.0.113.7' },
			{ action: 'passkey-added', detail: { name: 'Phone\x1b[2K\rNothing to see\u202e' } }
		);
		closeDatabase();
		logged = [];

		expect(await main(['log'], env, out)).toBe(0);

		const printed = logged.join('\n');
		expect(printed.replaceAll('\n', '')).not.toMatch(/[\p{Cc}\u202e]/u);
		expect(printed).toContain('added a passkey (Phone\\x1b[2K\\x0dNothing to see\\u202e)');
	});

	it('explains how to use it when the arguments are wrong', async () => {
		expect(await main(['log', 'now'], env, out)).toBe(2);
		expect(await main(['log', '--limit', '0'], env, out)).toBe(2);
		expect(await main(['log', '--keep', '3'], env, out)).toBe(2);
		expect(errors).toHaveLength(3);
	});
});

describe('printable', () => {
	it('leaves ordinary text alone, including accents and emoji', () => {
		expect(printable('Zoë’s Pixel 👩‍👩‍👧 · 203.0.113.7')).toBe('Zoë’s Pixel 👩‍👩‍👧 · 203.0.113.7');
	});

	it('escapes control characters and those that change the direction of text', () => {
		expect(printable('a\x1b]0;title\x07b\nc\u2066d')).toBe('a\\x1b]0;title\\x07b\\x0ac\\u2066d');
		expect(printable('\u202eab\u200fc\u061c')).toBe('\\u202eab\\u200fc\\u061c');
	});
});
