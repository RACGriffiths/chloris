import { fail, redirect } from '@sveltejs/kit';
import { authHeaders } from '#lib/server/auth/http.js';
import { getAuth } from '#lib/server/auth/index.js';
import { requireUser } from '#lib/server/auth/require.js';
import { listHomesForUser } from '#lib/server/data/homes.js';
import { acceptInvite, findInvite, newAccountInput } from '#lib/server/data/invites.js';
import { getMembership, isActive } from '#lib/server/data/memberships.js';
import { textField } from '#lib/server/forms.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Where an invite link lands (D28). Opening it only shows the invite: joining waits for the POST,
 * so link previews in chat apps can't use it up. Someone signed in joins with their account;
 * anyone else gives a name and email address, and gets a new account, signed in.
 */

type FieldErrors = Partial<Record<'name' | 'email', string>>;

const formatDate = (date: Date) =>
	new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);

export const load: PageServerLoad = ({ params, locals, setHeaders }) => {
	// The token is in the address: keep it out of caches, and send only the origin as a Referer.
	setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'strict-origin' });

	const invite = findInvite(params.token);
	if (!invite) return { invite: null, signedIn: null };

	const user = locals.user;
	const member = user ? getMembership(invite.homeId, user.id) : null;
	return {
		invite: {
			homeName: invite.homeName,
			role: invite.role,
			invitedBy: invite.invitedBy,
			expires: formatDate(invite.expiresAt)
		},
		signedIn: user
			? {
					name: user.name,
					email: user.email,
					alreadyMember: member !== null && isActive(member)
				}
			: null
	};
};

export const actions = {
	/** Joins with the signed-in account. */
	join: ({ locals, params }) => {
		const user = requireUser(locals);
		const invite = findInvite(params.token);
		const result = acceptInvite(params.token, user.id);
		if (!result.ok || !invite) return fail(400, { refused: result.ok ? 'invalid' : result.reason });

		// The UI shows the first home only, until switching between homes arrives (D14).
		const [shown] = listHomesForUser(user.id);
		if (shown?.id === result.homeId) redirect(303, '/');
		return { joined: { homeName: invite.homeName, shownName: shown?.name ?? '' } };
	},

	/** Creates an account from the invite, signs it in, and offers a passkey. */
	create: async (event) => {
		if (event.locals.user) redirect(303, event.url.pathname);
		const form = await event.request.formData();
		const values = { name: textField(form, 'name'), email: textField(form, 'email') };

		const parsed = newAccountInput.safeParse(values);
		if (!parsed.success) {
			const errors: FieldErrors = Object.fromEntries(
				parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])
			);
			return fail(400, { ...values, errors });
		}

		const result = await getAuth().api.joinWithInvite({
			body: { token: event.params.token, ...parsed.data },
			headers: authHeaders(event)
		});
		if (!result.ok) {
			if (result.reason === 'email-taken') {
				const errors: FieldErrors = {
					email: 'There is already an account for this address. Sign in, then open this link again.'
				};
				return fail(400, { ...values, errors });
			}
			return fail(400, { refused: result.reason });
		}
		// As after a first sign-in, offer to add a passkey (spec: Login).
		redirect(303, '/welcome');
	}
} satisfies Actions;
