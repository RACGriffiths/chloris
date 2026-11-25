// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Session, SessionUser } from '#lib/server/auth/index.js';
import type { BuildInfo } from '#lib/server/build-info.js';

declare global {
	/** Replaced when the app is built (`define` in vite.config.ts). Read it as `thisBuild`, from `#lib/server/about.js`. */
	const __CHLORIS_BUILD__: BuildInfo;

	namespace App {
		// interface Error {}
		interface Locals {
			/** The signed-in user, or `null`. Set in `hooks.server.ts` for every request. */
			user: SessionUser | null;
			session: Session | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
