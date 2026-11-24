import { fail } from '@sveltejs/kit';
import { createRoom, listRooms, roomInput } from '#lib/server/data/rooms.js';
import { fieldErrors, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { can } from '#lib/server/permissions/index.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The home's rooms (D30). Everyone in the home can see them; those who may configure the home
 * (owners and carers) add them here and change them on each room's edit page.
 */
export const load: PageServerLoad = ({ locals }) => {
	const { user, home } = requireHome(locals, 'home:view');
	return {
		home: { name: home.name },
		rooms: listRooms(home.id),
		canConfigure: can(user, home.id, 'home:configure')
	};
};

export const actions = {
	create: async ({ locals, request }) => {
		const { home } = requireHome(locals, 'home:configure');
		const values = textFields(await request.formData(), roomInput.keyof().options);
		const parsed = roomInput.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });

		const result = createRoom(home.id, values);
		if (!result.ok) {
			const errors = { name: `There's already a room called ${parsed.data.name}.` };
			return fail(400, { values, errors });
		}
		return { added: result.room.name };
	}
} satisfies Actions;
