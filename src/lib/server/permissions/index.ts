import { getMembership, isActive } from '../data/memberships';
import { mayCreateHome } from '../data/users';
import { roleGrants, type Permission } from './roles';

export { PERMISSIONS, type Permission, type Role } from './roles';

/** Anything with a user id: the signed-in user from `locals.user`, or `null` when signed out. */
export type Actor = { id: string } | null | undefined;

/**
 * Whether `user` may do `permission` in the home `homeId`. Every load function, form action and
 * API route that touches a home's data calls this first (CLAUDE.md rule 2).
 *
 * It is `false` for anyone signed out, anyone who isn't a member of that home, and anyone whose
 * membership has expired.
 */
export function can(
	user: Actor,
	homeId: string,
	permission: Permission,
	now = new Date()
): boolean {
	if (!user) return false;
	const member = getMembership(homeId, user.id);
	if (!member || !isActive(member, now)) return false;
	return roleGrants(member.role, permission);
}

/** Whether `user` may create a new home: only accounts the command-line tool allowed (D26). */
export function canCreateHome(user: Actor): boolean {
	return user ? mayCreateHome(user.id) : false;
}
