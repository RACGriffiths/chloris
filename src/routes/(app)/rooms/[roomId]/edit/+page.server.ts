import { error, fail, redirect } from '@sveltejs/kit';
import { listMemorial, listPlants } from '#lib/server/data/plants.js';
import { deleteRoom, getRoom, roomInput, updateRoom } from '#lib/server/data/rooms.js';
import { fieldErrors, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import type { Actions, PageServerLoad } from './$types';

/** Changing a room, or deleting it once it's empty, even of plants in the Memorial (D30, D44). */
export const load: PageServerLoad = ({ locals, params }) => {
	const { home } = requireHome(locals, 'home:configure');
	const room = getRoom(home.id, params.roomId);
	if (!room) error(404, 'Not found');
	return {
		room,
		plants: [
			...listPlants(home.id, { roomId: room.id }).map(({ id, nickname }) => ({
				id,
				nickname,
				inMemorial: false
			})),
			...listMemorial(home.id)
				.filter((plant) => plant.roomId === room.id)
				.map(({ id, nickname }) => ({ id, nickname, inMemorial: true }))
		]
	};
};

export const actions = {
	save: async ({ locals, params, request }) => {
		const { home } = requireHome(locals, 'home:configure');
		const values = textFields(await request.formData(), roomInput.keyof().options);
		const parsed = roomInput.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });

		const result = updateRoom(home.id, params.roomId, values);
		if (!result.ok && result.reason === 'not-found') error(404, 'Not found');
		if (!result.ok) {
			const errors = { name: `There's already a room called ${parsed.data.name}.` };
			return fail(400, { values, errors });
		}
		redirect(303, '/rooms');
	},

	delete: ({ locals, params }) => {
		const { home } = requireHome(locals, 'home:configure');
		const result = deleteRoom(home.id, params.roomId);
		if (!result.ok && result.reason === 'not-found') error(404, 'Not found');
		if (!result.ok) {
			return fail(400, { deleteError: 'Move the plants in this room to another room first.' });
		}
		redirect(303, '/rooms');
	}
} satisfies Actions;
