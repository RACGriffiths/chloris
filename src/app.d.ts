// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Session, SessionUser } from '#lib/server/auth/index.js';

declare global {
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
