import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { authHeaders } from '#lib/server/auth/http.js';
import { SIGN_IN_LINK_MINUTES, getAuth } from '#lib/server/auth/index.js';
import { getConfig } from '#lib/server/config.js';
import { accountExists } from '#lib/server/data/users.js';
import { textField } from '#lib/server/forms.js';
import { consumeSignInLink, tooManyLinks } from '#lib/server/security/rate-limit.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { emailEnabled: getConfig().smtp !== null, linkMinutes: SIGN_IN_LINK_MINUTES };
};

const emailField = z.object({ email: z.email().trim().toLowerCase() });

export const actions = {
	/** Emails a sign-in link, but only to an existing account: there is no sign-up (D26). */
	default: async (event) => {
		const form = await event.request.formData();
		const email = textField(form, 'email');
		if (getConfig().smtp === null) {
			return fail(400, { email, error: 'Sign-in links by email are switched off here.' });
		}
		const parsed = emailField.safeParse({ email });
		if (!parsed.success) return fail(400, { email, error: 'Enter your email address.' });

		// Counted before looking for the account, so the limits answer the same either way (D56).
		const limited = consumeSignInLink(event, parsed.data.email);
		if (!limited.ok) return fail(429, { email, error: tooManyLinks(limited) });

		// Answers the same either way, so the form doesn't reveal who has an account.
		if (accountExists(parsed.data.email)) {
			await getAuth().api.signInMagicLink({
				body: { email: parsed.data.email },
				headers: authHeaders(event)
			});
		}
		return { email: parsed.data.email, sent: true };
	}
} satisfies Actions;
