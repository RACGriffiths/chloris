import { error, redirect } from '@sveltejs/kit';
import { requireUser } from '../auth/require';
import type { SessionUser } from '../auth';
import { listHomesForUser, type Home } from '../data/homes';
import { can, type Actor, type Permission } from './index';

/**
 * For load functions and form actions: stops the request unless `user` may do `permission` in
 * `homeId`. Someone who can't see the home at all gets a 404, so they learn nothing about it;
 * a member without this permission gets a 403.
 */
export function requirePermission(user: Actor, homeId: string, permission: Permission): void {
	if (can(user, homeId, permission)) return;
	if (permission !== 'home:view' && can(user, homeId, 'home:view')) {
		error(403, "You don't have permission to do that.");
	}
	error(404, 'Not found');
}

/**
 * For the signed-in app's load functions and form actions: the user and their home, once they
 * may do `permission` there. Someone signed out is sent to sign in, and someone with no home to
 * the home page, which explains. The UI shows one home for now (D14).
 *
 * Every load function and every form action calls this itself: an action is its own POST
 * request, which anyone can send without loading the page.
 */
export function requireHome(
	locals: App.Locals,
	permission: Permission
): { user: SessionUser; home: Home } {
	const user = requireUser(locals);
	const [home] = listHomesForUser(user.id);
	if (!home) redirect(303, '/');
	requirePermission(user, home.id, permission);
	return { user, home };
}
