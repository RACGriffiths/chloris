import { redirect } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/require.js';
import { hasPasskey } from '#lib/server/data/users.js';
import type { PageServerLoad } from './$types';

/** Offers a passkey after signing in with a link, to anyone who doesn't have one yet. */
export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	if (hasPasskey(user.id)) redirect(303, '/');
	return { name: user.name };
};
