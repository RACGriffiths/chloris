import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aboutThisBuild, sourceUrl, thisBuild } from './about.js';
import { readBuildInfo } from './build-info.js';

const REPOSITORY = 'https://github.com/RACGriffiths/chloris';
const COMMIT = 'a'.repeat(40);

let folder: string;

beforeEach(() => {
	folder = mkdtempSync(path.join(tmpdir(), 'chloris-build-'));
});

afterEach(() => {
	rmSync(folder, { recursive: true, force: true });
});

function writeManifest(dir: string, fields: Record<string, unknown>) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, 'package.json'), JSON.stringify(fields));
}

/** Runs git in `dir`, ignoring the machine's own settings (signing, hooks, identity). */
function git(dir: string, ...args: string[]): string {
	return execFileSync('git', args, {
		cwd: dir,
		encoding: 'utf8',
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
	}).trim();
}

function commitAll(dir: string): string {
	git(dir, 'add', '-A');
	git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Test');
	return git(dir, 'rev-parse', 'HEAD');
}

describe('readBuildInfo', () => {
	it('reads the version and repository from package.json, in any form npm accepts', () => {
		for (const repository of [
			REPOSITORY,
			`${REPOSITORY}/`,
			`git+${REPOSITORY}.git`,
			{ type: 'git', url: `git+${REPOSITORY}.git` }
		]) {
			writeManifest(folder, { version: '1.2.3', repository });
			expect(readBuildInfo(folder, {})).toMatchObject({ version: '1.2.3', repository: REPOSITORY });
		}
	});

	it('refuses a package.json without a version or an https:// repository', () => {
		const tries: Record<string, unknown>[] = [
			{ repository: REPOSITORY },
			{ version: '', repository: REPOSITORY },
			{ version: '1.0.0' },
			{ version: '1.0.0', repository: 'RACGriffiths/chloris' },
			{ version: '1.0.0', repository: 'git@github.com:RACGriffiths/chloris.git' },
			{ version: '1.0.0', repository: { url: 'http://example.com/chloris' } }
		];
		for (const fields of tries) {
			writeManifest(folder, fields);
			expect(() => readBuildInfo(folder, {})).toThrow(/package\.json needs/);
		}
	});

	it('takes the commit from SOURCE_COMMIT when it is given, and checks it', () => {
		writeManifest(folder, { version: '1.0.0', repository: REPOSITORY });

		expect(readBuildInfo(folder, { SOURCE_COMMIT: ` ${COMMIT.toUpperCase()}\n` })).toEqual({
			version: '1.0.0',
			repository: REPOSITORY,
			commit: COMMIT,
			modified: false
		});
		expect(() => readBuildInfo(folder, { SOURCE_COMMIT: 'main' })).toThrow(/SOURCE_COMMIT/);
		// Empty counts as unset, as for the app's other variables.
		expect(readBuildInfo(folder, { SOURCE_COMMIT: '' })).toMatchObject({ commit: null });
	});

	it('reads the commit from git, and whether the files differ from it', () => {
		writeManifest(folder, { version: '1.0.0', repository: REPOSITORY });
		git(folder, 'init', '-q');
		const head = commitAll(folder);

		expect(readBuildInfo(folder, {})).toMatchObject({ commit: head, modified: false });

		writeManifest(folder, { version: '1.0.1', repository: REPOSITORY });
		expect(readBuildInfo(folder, {})).toMatchObject({ commit: head, modified: true });
	});

	it("knows no commit outside a git checkout, or inside another repository's", () => {
		writeManifest(folder, { version: '1.0.0', repository: REPOSITORY });
		expect(readBuildInfo(folder, {})).toMatchObject({ commit: null, modified: false });

		// As if a release archive were unpacked inside someone else's repository.
		git(folder, 'init', '-q');
		commitAll(folder);
		const unpacked = path.join(folder, 'chloris');
		writeManifest(unpacked, { version: '1.0.0', repository: REPOSITORY });
		expect(readBuildInfo(unpacked, {})).toMatchObject({ commit: null, modified: false });
	});
});

describe('sourceUrl', () => {
	it('links to the commit when it is known, and otherwise to the repository', () => {
		const build = { version: '1.0.0', repository: REPOSITORY, modified: false };
		expect(sourceUrl({ ...build, commit: COMMIT })).toBe(`${REPOSITORY}/tree/${COMMIT}`);
		expect(sourceUrl({ ...build, commit: null })).toBe(REPOSITORY);
	});
});

describe('thisBuild', () => {
	it("is this checkout's, fixed by vite.config.ts", () => {
		const manifest = readBuildInfo(process.cwd(), {});
		expect(thisBuild).toMatchObject({ version: manifest.version, repository: REPOSITORY });
		expect(aboutThisBuild()).toMatchObject({
			version: manifest.version,
			sourceUrl: sourceUrl(thisBuild)
		});
	});
});
