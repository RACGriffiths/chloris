import { error } from '@sveltejs/kit';
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
