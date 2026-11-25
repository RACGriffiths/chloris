import type { BuildInfo } from './build-info.js';

/**
 * This build's version and where its source code is (D59), as fixed when it was built: `define`
 * in vite.config.ts replaces `__CHLORIS_BUILD__` with what `readBuildInfo()` found then.
 */
export const thisBuild: BuildInfo = __CHLORIS_BUILD__;

/** Where to get a build's source code: the commit it was built from, or else the repository. */
export function sourceUrl({ repository, commit }: BuildInfo): string {
	return commit ? `${repository}/tree/${commit}` : repository;
}

/** What the About page shows about this build. */
export function aboutThisBuild() {
	return {
		version: thisBuild.version,
		/** Short, as git and GitHub show it. */
		commit: thisBuild.commit?.slice(0, 7) ?? null,
		modified: thisBuild.modified,
		sourceUrl: sourceUrl(thisBuild)
	};
}
