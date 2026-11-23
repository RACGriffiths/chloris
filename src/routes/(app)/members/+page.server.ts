import { fail, redirect } from '@sveltejs/kit';
import { inviteUrl } from '#lib/server/auth/invites.js';
import { requireUser } from '#lib/server/auth/require.js';
import { getConfig } from '#lib/server/config.js';
import { listHomesForUser } from '#lib/server/data/homes.js';
import {
	INVITE_DAYS,
	INVITE_ROLES,
	cancelInvite,
	createInvite,
	inviteInput,
	listPendingInvites
} from '#lib/server/data/invites.js';
import { listMembers } from '#lib/server/data/memberships.js';
import { textField } from '#lib/server/forms.js';
import { requirePermission } from '#lib/server/permissions/guard.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The people in a home, and invite links for adding more (D28). Only those who may manage
 * members see it: owners.
 */
function managedHome(locals: App.Locals) {
	const user = requireUser(locals);
	// The UI shows one home for now (D14).
	const [home] = listHomesForUser(user.id);
	if (!home) redirect(303, '/');
	requirePermission(user, home.id, 'member:manage');
	return { user, home };
}

const dateFormat = (timeZone: string) =>
	new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone });

export const load: PageServerLoad = ({ locals }) => {
	const { user, home } = managedHome(locals);
	const format = dateFormat(home.timeZone);
	return {
		home: { name: home.name },
		roles: INVITE_ROLES,
		inviteDays: INVITE_DAYS,
		members: listMembers(home.id).map((member) => ({
			id: member.userId,
			name: member.name,
			email: member.email,
			role: member.role,
			you: member.userId === user.id
		})),
		invites: listPendingInvites(home.id).map((invite) => ({
			id: invite.id,
			role: invite.role,
			createdBy: invite.createdByName,
			expires: format.format(invite.expiresAt)
		}))
	};
};

export const actions = {
	/** Makes an invite and returns its link. Only a hash is stored, so this is its only showing. */
	create: async ({ locals, request }) => {
		const { user, home } = managedHome(locals);
		const role = textField(await request.formData(), 'role');
		const parsed = inviteInput.safeParse({ role });
		if (!parsed.success) return fail(400, { error: 'Choose a role for the person you invite.' });

		const { invite, token } = createInvite(home.id, user.id, parsed.data);
		return {
			created: {
				url: inviteUrl(getConfig().origin, token),
				role: invite.role,
				expires: dateFormat(home.timeZone).format(invite.expiresAt)
			}
		};
	},

	cancel: async ({ locals, request }) => {
		const { home } = managedHome(locals);
		const id = textField(await request.formData(), 'id');
		if (!cancelInvite(home.id, id)) {
			return fail(400, { error: 'That invite has already been used or cancelled.' });
		}
		return { cancelled: true };
	}
} satisfies Actions;
