import { fail, redirect } from '@sveltejs/kit';
import { createPlant, plantInput } from '#lib/server/data/plants.js';
import { createRoom, listRooms, roomInput } from '#lib/server/data/rooms.js';
import { fieldErrors, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { can } from '#lib/server/permissions/index.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Adding a plant. Every plant is in a room, so a home with no rooms is asked for its first one
 * here, by people who may manage rooms (D30).
 */
export const load: PageServerLoad = ({ locals, url }) => {
	const { user, home } = requireHome(locals, 'plant:edit');
	const rooms = listRooms(home.id).map(({ id, name }) => ({ id, name }));
	const asked = url.searchParams.get('room');
	// The room the person came from, or the only one there is.
	const roomId =
		rooms.find((room) => room.id === asked)?.id ?? (rooms.length === 1 ? rooms[0].id : '');
	return { rooms, roomId, canAddRoom: can(user, home.id, 'home:configure') };
};

export const actions = {
	// SvelteKit doesn't allow a default action beside named ones, so this one has a name too.
	create: async ({ locals, request }) => {
		const { home } = requireHome(locals, 'plant:edit');
		const values = textFields(await request.formData(), plantInput.keyof().options);
		const parsed = plantInput.safeParse(values);
		if (!parsed.success) return fail(400, { plant: { values, errors: fieldErrors(parsed.error) } });

		const created = createPlant(home.id, values);
		if (!created) {
			const errors = { roomId: 'That room has been deleted. Choose another.' };
			return fail(400, { plant: { values: { ...values, roomId: '' }, errors } });
		}
		redirect(303, `/plants/${created.id}`);
	},

	/** Adds the home's first room, then comes back to add the plant to it. */
	room: async ({ locals, request }) => {
		const { home } = requireHome(locals, 'home:configure');
		const values = textFields(await request.formData(), roomInput.keyof().options);
		const parsed = roomInput.safeParse(values);
		if (!parsed.success) return fail(400, { room: { values, errors: fieldErrors(parsed.error) } });

		const result = createRoom(home.id, values);
		if (!result.ok) {
			const errors = { name: `There's already a room called ${parsed.data.name}.` };
			return fail(400, { room: { values, errors } });
		}
		redirect(303, `/plants/new?room=${result.room.id}`);
	}
} satisfies Actions;
