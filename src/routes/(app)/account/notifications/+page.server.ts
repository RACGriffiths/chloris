import { error, fail } from '@sveltejs/kit';
import { formatMoment } from '#lib/dates.js';
import {
	DEFAULT_QUIET_END,
	DEFAULT_QUIET_START,
	defaultNotificationSettings
} from '#lib/notifications.js';
import { authHeaders } from '#lib/server/auth/http.js';
import { SIGN_IN_LINK_MINUTES, getAuth } from '#lib/server/auth/index.js';
import { getConfig } from '#lib/server/config.js';
import {
	getLastDigest,
	getNotificationSettings,
	notificationSettingsInput,
	saveNotificationSettings
} from '#lib/server/data/notifications.js';
import { fieldErrors, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { can } from '#lib/server/permissions/index.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * A person's daily digest for their home: whether it comes by email, at what time, and quiet
 * hours (docs/spec.md, Reminders and notifications; D47). Each person sees and changes only their
 * own. With email off on the server there's nothing to set. Someone whose address isn't confirmed
 * can have a sign-in link sent to it, which confirms it (D50).
 */

const EMAIL_OFF = 'Email is switched off on this server, so there are no digests.';

export const load: PageServerLoad = ({ locals }) => {
	const { user, home } = requireHome(locals, 'home:view');
	const settings =
		getNotificationSettings(home.id, user.id) ??
		defaultNotificationSettings(can(user, home.id, 'care:log'));
	const last = getLastDigest(home.id, user.id);
	return {
		home: { name: home.name, timeZone: home.timeZone },
		email: user.email,
		emailEnabled: getConfig().smtp !== null,
		emailConfirmed: user.emailVerified,
		linkMinutes: SIGN_IN_LINK_MINUTES,
		values: {
			channel: settings.channel === 'email' ? 'email' : 'off',
			digestTime: settings.digestTime,
			quietHours: settings.quietStart ? 'on' : '',
			// Unticking quiet hours clears them; ticking again starts from the defaults.
			quietStart: settings.quietStart ?? DEFAULT_QUIET_START,
			quietEnd: settings.quietEnd ?? DEFAULT_QUIET_END
		},
		lastSent: last?.sentAt
			? `${formatMoment(last.sentAt, home.timeZone, new Date(), 'sentence')}, with ${
					last.taskCount === 1 ? '1 task' : `${last.taskCount} tasks`
				}`
			: null
	};
};

export const actions = {
	save: async ({ locals, request }) => {
		const { user, home } = requireHome(locals, 'home:view');
		if (getConfig().smtp === null) return fail(400, { error: EMAIL_OFF });

		const values = textFields(await request.formData(), notificationSettingsInput.keyof().options);
		const parsed = notificationSettingsInput.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });

		if (!saveNotificationSettings(home.id, user.id, values)) error(404, 'Not found');
		return { saved: true };
	},

	/** Emails the person a sign-in link, which confirms their address when it's used (D50). */
	confirm: async (event) => {
		const { user } = requireHome(event.locals, 'home:view');
		if (getConfig().smtp === null) return fail(400, { error: EMAIL_OFF });
		if (user.emailVerified) return { confirmed: true };

		await getAuth().api.signInMagicLink({
			body: { email: user.email },
			headers: authHeaders(event)
		});
		return { linkSent: true };
	}
} satisfies Actions;
