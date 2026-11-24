import { fail, redirect } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import { describeUserAgent } from '#lib/devices.js';
import { defaultNotificationSettings, digestSummary } from '#lib/notifications.js';
import { authHeaders } from '#lib/server/auth/http.js';
import { getAuth } from '#lib/server/auth/index.js';
import { requireUser } from '#lib/server/auth/require.js';
import { getConfig } from '#lib/server/config.js';
import { listHomesForUser } from '#lib/server/data/homes.js';
import { getNotificationSettings } from '#lib/server/data/notifications.js';
import { textField } from '#lib/server/forms.js';
import { can } from '#lib/server/permissions/index.js';
import { auditAccount, requestSource } from '#lib/server/security/audit.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/**
 * The signed-in person's passkeys and sessions, any of which they can remove, and signing out.
 * BetterAuth only ever lists or removes the signed-in user's own. For someone in a home, it also
 * sums up their daily digest, which the Notifications page changes.
 */

const formatDate = (date: Date) =>
	new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event.locals);
	const auth = getAuth();
	const headers = authHeaders(event);
	const [passkeys, sessions] = await Promise.all([
		auth.api.listPasskeys({ headers }),
		auth.api.listSessions({ headers })
	]);
	return {
		name: user.name,
		email: user.email,
		digest: digestFor(user),
		passkeys: passkeys
			.sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0))
			.map((passkey) => ({
				id: passkey.id,
				name: passkey.name || 'Passkey',
				added: passkey.createdAt ? formatDate(new Date(passkey.createdAt)) : null
			})),
		// Session tokens stay on the server: the page identifies sessions by id.
		sessions: sessions
			.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
			.map((session) => ({
				id: session.id,
				device: describeUserAgent(session.userAgent),
				lastActive: formatDate(new Date(session.updatedAt)),
				current: session.id === event.locals.session?.id
			}))
	};
};

/** The daily digest in a few words, for someone in a home; `null` for someone without one. */
function digestFor(user: { id: string; emailVerified: boolean }): string | null {
	const [home] = listHomesForUser(user.id);
	if (!home || !can(user, home.id, 'home:view')) return null;
	if (getConfig().smtp === null) return 'Off: email is switched off on this server';
	const settings =
		getNotificationSettings(home.id, user.id) ??
		defaultNotificationSettings(can(user, home.id, 'care:log'));
	const summary = digestSummary(settings);
	return settings.channel && !user.emailVerified
		? `${summary}, once you confirm your address`
		: summary;
}

async function signOut(event: RequestEvent): Promise<never> {
	await getAuth().api.signOut({ headers: authHeaders(event) });
	redirect(303, '/sign-in');
}

export const actions = {
	deletePasskey: async (event) => {
		const user = requireUser(event.locals);
		const id = textField(await event.request.formData(), 'id');
		const headers = authHeaders(event);
		const auth = getAuth();
		// BetterAuth lists only the signed-in person's own passkeys.
		const passkey = (await auth.api.listPasskeys({ headers })).find((key) => key.id === id);
		if (!passkey) return fail(400, { error: "That passkey couldn't be removed." });
		try {
			await auth.api.deletePasskey({ body: { id }, headers });
		} catch (error) {
			if (isAPIError(error)) return fail(400, { error: "That passkey couldn't be removed." });
			throw error;
		}
		auditAccount(
			{ ...requestSource(event), userId: user.id },
			{
				action: 'passkey-removed',
				targetId: id,
				detail: { name: passkey.name || 'Passkey' }
			}
		);
		return { removed: 'passkey' };
	},

	revokeSession: async (event) => {
		requireUser(event.locals);
		const id = textField(await event.request.formData(), 'id');
		if (id === event.locals.session?.id) return signOut(event);

		const headers = authHeaders(event);
		const auth = getAuth();
		const session = (await auth.api.listSessions({ headers })).find((s) => s.id === id);
		if (!session) return fail(400, { error: 'That session has already ended.' });
		await auth.api.revokeSession({ body: { token: session.token }, headers });
		return { removed: 'session' };
	},

	signOut: async (event) => {
		if (!event.locals.user) redirect(303, '/sign-in');
		return signOut(event);
	}
} satisfies Actions;
