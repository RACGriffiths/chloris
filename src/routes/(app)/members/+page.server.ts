import { fail } from '@sveltejs/kit';
import { inviteUrl } from '#lib/server/auth/invites.js';
import { getConfig } from '#lib/server/config.js';
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
import { requireHome } from '#lib/server/permissions/guard.js';
import { audit } from '#lib/server/security/audit.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The people in a home, and invite links for adding more (D28). Only those who may manage
 * members see it: owners.
 */
const managedHome = (locals: App.Locals) => requireHome(locals, 'member:manage');

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
	create: async (event) => {
		const { user, home } = managedHome(event.locals);
		const role = textField(await event.request.formData(), 'role');
		const parsed = inviteInput.safeParse({ role });
		if (!parsed.success) return fail(400, { error: 'Choose a role for the person you invite.' });

		const { invite, token } = createInvite(home.id, user.id, parsed.data);
		audit(event, home.id, user.id, {
			action: 'invite-created',
			targetId: invite.id,
			detail: { role: invite.role }
		});
		return {
			created: {
				url: inviteUrl(getConfig().origin, token),
				role: invite.role,
				expires: dateFormat(home.timeZone).format(invite.expiresAt)
			}
		};
	},

	cancel: async (event) => {
		const { user, home } = managedHome(event.locals);
		const id = textField(await event.request.formData(), 'id');
		const pending = listPendingInvites(home.id).find((invite) => invite.id === id);
		if (!pending || !cancelInvite(home.id, id)) {
			return fail(400, { error: 'That invite has already been used or cancelled.' });
		}
		audit(event, home.id, user.id, {
			action: 'invite-cancelled',
			targetId: id,
			detail: { role: pending.role }
		});
		return { cancelled: true };
	}
} satisfies Actions;
