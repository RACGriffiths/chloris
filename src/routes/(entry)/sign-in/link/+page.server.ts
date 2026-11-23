import { fail, redirect } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import { authHeaders } from '#lib/server/auth/http.js';
import { getAuth } from '#lib/server/auth/index.js';
import { hasPasskey } from '#lib/server/data/users.js';
import { textField } from '#lib/server/forms.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Where a sign-in link lands. Opening it only shows a button: signing in waits for the POST, so
 * mail scanners that open links can't use up the one-time token.
 */
export const load: PageServerLoad = ({ url, setHeaders }) => {
	// The token is in the address: keep it out of caches, and send only the origin as a Referer.
	// (Not `no-referrer`: with that, a form posted without JavaScript carries `Origin: null`,
	// which SvelteKit refuses as a cross-site request.)
	setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'strict-origin' });
	return { token: url.searchParams.get('token') ?? '' };
};

export const actions = {
	default: async (event) => {
		const token = textField(await event.request.formData(), 'token');
		let userId: string;
		try {
			const result = await getAuth().api.magicLinkVerify({
				query: { token },
				headers: authHeaders(event)
			});
			userId = result.user.id;
		} catch (error) {
			// Unknown, used or expired: BetterAuth answers all three the same way.
			if (isAPIError(error)) return fail(400, { invalid: true });
			throw error;
		}
		// After a first sign-in, offer to add a passkey (spec: Login).
		redirect(303, hasPasskey(userId) ? '/' : '/welcome');
	}
} satisfies Actions;
