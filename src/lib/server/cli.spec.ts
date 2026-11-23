import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { USAGE, main } from './cli';
import { TEST_ORIGIN, TEST_SECRET } from './testing';

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
		expect(output).toContain('Applied 1 database migration(s).');
		expect(output).toContain('owner@example.com (a new account, which may create a home)');
		expect(output).toMatch(/^ {2}http:\/\/localhost:5173\/sign-in\/link\?token=\w+$/m);
		expect(errors).toEqual([]);
	});

	it('says when the account already exists', async () => {
		await main(['sign-in-link', 'owner@example.com'], env, out);
		logged = [];

		expect(await main(['sign-in-link', 'Owner@example.com'], env, out)).toBe(0);
		expect(logged.join('\n')).toContain('(an existing account, which may create a home)');
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
