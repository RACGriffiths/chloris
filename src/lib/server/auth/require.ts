import { redirect } from '@sveltejs/kit';
import type { SessionUser } from './index';

/** For load functions and form actions: the signed-in user, or a redirect to the sign-in page. */
export function requireUser(locals: App.Locals): SessionUser {
	if (!locals.user) redirect(303, '/sign-in');
	return locals.user;
}
