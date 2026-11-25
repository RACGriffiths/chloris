import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * What a build of Chloris knows about the code it was built from, for the About page (D59).
 * `readBuildInfo()` runs when the app is built, from `vite.config.ts`, which fixes the result into
 * the build as `__CHLORIS_BUILD__`; the running app reads it from `#lib/server/about.js`. So the
 * page describes the code that was built, even if the folder it was built in has changed since.
 * Only the build loads this module: the running app never reads git or package.json.
 */
export interface BuildInfo {
	/** `version` in package.json, e.g. `1.0.0`. */
	version: string;
	/** Where the source code is published: `repository` in package.json, e.g. `https://github.com/RACGriffiths/chloris`. */
	repository: string;
	/** The full id of the git commit it was built from, or `null` when that isn't known. */
	commit: string | null;
	/** Whether the files differed from that commit when it was built. */
	modified: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

const COMMIT_ID = /^[0-9a-f]{7,64}$/;

/**
 * Reads the version and repository from `root`'s package.json, and the commit from `SOURCE_COMMIT`
 * or, failing that, from git. `SOURCE_COMMIT` is for builds made without the repository, such as
 * the Docker image's. Throws if package.json lacks either field, so a build can't link nowhere.
 */
export function readBuildInfo(root: string, env: Env = process.env): BuildInfo {
	const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
		version?: unknown;
		repository?: unknown;
	};
	if (typeof manifest.version !== 'string' || manifest.version === '') {
		throw new Error('package.json needs a `version`, which the About page shows.');
	}
	const known = { version: manifest.version, repository: repositoryUrl(manifest.repository) };

	const given = env.SOURCE_COMMIT?.trim().toLowerCase();
	if (given) {
		if (!COMMIT_ID.test(given)) {
			throw new Error(
				`SOURCE_COMMIT must be a git commit id, such as the output of git rev-parse HEAD.`
			);
		}
		return { ...known, commit: given, modified: false };
	}
	return { ...known, ...readGit(root) };
}

/**
 * `repository` from package.json as a web address. npm accepts a string or `{ type, url }`, and
 * may write the address as `git+https://...git`.
 */
function repositoryUrl(field: unknown): string {
	const raw =
		typeof field === 'string'
			? field
			: typeof field === 'object' && field !== null && 'url' in field
				? field.url
				: undefined;
	const problem = new Error(
		'package.json needs `repository`, the https:// address where the source code is published: ' +
			'the About page links to it.'
	);
	if (typeof raw !== 'string') throw problem;
	let url: URL;
	try {
		url = new URL(raw.replace(/^git\+/, ''));
	} catch {
		throw problem;
	}
	if (url.protocol !== 'https:') throw problem;
	return `${url.origin}${url.pathname.replace(/\.git$/, '').replace(/\/+$/, '')}`;
}

/** The commit checked out in `root`, if `root` is the top of a git checkout with git installed. */
function readGit(root: string): Pick<BuildInfo, 'commit' | 'modified'> {
	const git = (...args: string[]) =>
		execFileSync('git', args, {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
	try {
		// A copy of the code unpacked inside some other repository mustn't take that one's commit.
		if (realpathSync(git('rev-parse', '--show-toplevel')) !== realpathSync(root)) {
			return { commit: null, modified: false };
		}
		return { commit: git('rev-parse', 'HEAD'), modified: git('status', '--porcelain') !== '' };
	} catch {
		// Not a git checkout, one with no commits yet, or no git (the Docker image's build stage).
		return { commit: null, modified: false };
	}
}
