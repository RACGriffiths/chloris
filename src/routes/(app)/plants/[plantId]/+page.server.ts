import { error } from '@sveltejs/kit';
import { formatCalendarDate } from '#lib/dates.js';
import { getPlant } from '#lib/server/data/plants.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { can } from '#lib/server/permissions/index.js';
import type { PageServerLoad } from './$types';

/** A plant's page. Its care history, photos and measurements come with later items (D29). */
export const load: PageServerLoad = ({ locals, params }) => {
	const { user, home } = requireHome(locals, 'home:view');
	const plant = getPlant(home.id, params.plantId);
	if (!plant) error(404, 'Not found');
	return {
		plant: { ...plant, acquired: plant.acquiredOn ? formatCalendarDate(plant.acquiredOn) : null },
		canEdit: can(user, home.id, 'plant:edit')
	};
};
