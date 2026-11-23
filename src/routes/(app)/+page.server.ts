import { redirect } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/require.js';
import { listHomesForUser } from '#lib/server/data/homes.js';
import { requirePermission } from '#lib/server/permissions/guard.js';
import { can, canCreateHome } from '#lib/server/permissions/index.js';
import type { PageServerLoad } from './$types';

/**
 * The home screen. For now it shows the user's one home (D14); the Today view comes later.
 * Someone with no home either creates one, if the command-line tool allowed it, or is told they
 * have no access (D26).
 */
export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	const [home] = listHomesForUser(user.id);
	if (!home) {
		if (canCreateHome(user)) redirect(303, '/homes/new');
		return { name: user.name, home: null, canManageMembers: false };
	}
	requirePermission(user, home.id, 'home:view');
	return {
		name: user.name,
		home: { name: home.name },
		canManageMembers: can(user, home.id, 'member:manage')
	};
};
