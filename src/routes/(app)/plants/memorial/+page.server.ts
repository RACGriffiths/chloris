import { formatCalendarDate } from '#lib/dates.js';
import { listMemorial } from '#lib/server/data/plants.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { statusName } from '#lib/plants.js';
import type { PageServerLoad } from './$types';

/**
 * The Memorial: the home's plants that died, were given away or were sold, the most recent first,
 * each with its dates, cover photo and note (D45). Each opens the plant's own page, where it can be
 * restored (D43).
 */
export const load: PageServerLoad = ({ locals }) => {
	const { home } = requireHome(locals, 'home:view');
	return {
		home: { name: home.name },
		plants: listMemorial(home.id).map((plant) => ({
			id: plant.id,
			nickname: plant.nickname,
			species: plant.species,
			/** What happened and when: `Died 3 Nov 2026`. */
			ended: [statusName(plant.status), plant.statusOn && formatCalendarDate(plant.statusOn)]
				.filter(Boolean)
				.join(' '),
			got: plant.acquiredOn ? formatCalendarDate(plant.acquiredOn) : null,
			note: plant.statusNote,
			coverPhotoId: plant.coverPhotoId
		}))
	};
};
