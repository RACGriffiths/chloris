import { fail, redirect } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/require.js';
import {
	canonicalTimeZone,
	createHome,
	homeInput,
	listHomesForUser
} from '#lib/server/data/homes.js';
import { textField } from '#lib/server/forms.js';
import { canCreateHome } from '#lib/server/permissions/index.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Creating a home. Only accounts the command-line tool allowed may (D26), and while the UI shows
 * one home (D14), only if they don't have one yet.
 */
function requireHomeCreation(locals: App.Locals) {
	const user = requireUser(locals);
	if (!canCreateHome(user) || listHomesForUser(user.id).length > 0) redirect(303, '/');
	return user;
}

/** The server's own time zone: a good first guess for a server at home. */
const serverTimeZone = () => canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);

export const load: PageServerLoad = ({ locals }) => {
	requireHomeCreation(locals);
	const zones = Intl.supportedValuesOf('timeZone');
	const guess = serverTimeZone() ?? 'UTC';
	return { timeZones: zones.includes(guess) ? zones : [guess, ...zones], timeZone: guess };
};

export const actions = {
	default: async ({ locals, request }) => {
		const user = requireHomeCreation(locals);
		const form = await request.formData();
		const values = {
			name: textField(form, 'name'),
			timeZone: textField(form, 'timeZone')
		};

		const parsed = homeInput.safeParse(values);
		if (!parsed.success) {
			const errors = Object.fromEntries(
				parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])
			);
			return fail(400, { ...values, errors });
		}
		createHome(user.id, parsed.data);
		redirect(303, '/');
	}
} satisfies Actions;
