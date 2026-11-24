import { error, fail, redirect } from '@sveltejs/kit';
import { getPlant, plantInput, updatePlant } from '#lib/server/data/plants.js';
import { listRooms } from '#lib/server/data/rooms.js';
import { fieldErrors, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Changing a plant's details, including moving it to another room, whatever its status: a room
 * can be deleted only once even its plants in the Memorial are moved (D30, D44). An active plant's
 * page ends with the way to the Memorial (D43).
 */
export const load: PageServerLoad = ({ locals, params }) => {
	const { home } = requireHome(locals, 'plant:edit');
	const plant = getPlant(home.id, params.plantId);
	if (!plant) error(404, 'Not found');
	return {
		plant: {
			id: plant.id,
			nickname: plant.nickname,
			inMemorial: plant.status !== 'active',
			values: {
				nickname: plant.nickname,
				roomId: plant.roomId,
				species: plant.species ?? '',
				acquiredOn: plant.acquiredOn ?? '',
				source: plant.source ?? '',
				pot: plant.pot ?? '',
				soil: plant.soil ?? '',
				tags: plant.tags.join(', '),
				notes: plant.notes ?? ''
			}
		},
		rooms: listRooms(home.id).map(({ id, name }) => ({ id, name }))
	};
};

export const actions = {
	default: async ({ locals, params, request }) => {
		const { home } = requireHome(locals, 'plant:edit');
		const values = textFields(await request.formData(), plantInput.keyof().options);
		const parsed = plantInput.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });

		const result = updatePlant(home.id, params.plantId, values);
		if (!result.ok && result.reason === 'not-found') error(404, 'Not found');
		if (!result.ok) {
			const errors = { roomId: 'That room has been deleted. Choose another.' };
			return fail(400, { values: { ...values, roomId: '' }, errors });
		}
		redirect(303, `/plants/${params.plantId}`);
	}
} satisfies Actions;
