import { error, fail, redirect } from '@sveltejs/kit';
import { calendarDate, formatCalendarDate } from '#lib/dates.js';
import {
	MAX_STATUS_NOTE_LENGTH,
	getPlant,
	memorialInput,
	memorialisePlant
} from '#lib/server/data/plants.js';
import { fieldErrors, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Moving a plant to the Memorial: what happened, on what day, and a note (D43). For a plant
 * already there, the same form corrects its entry. Restoring is on the plant's own page.
 */
export const load: PageServerLoad = ({ locals, params }) => {
	const { home } = requireHome(locals, 'plant:edit');
	const plant = getPlant(home.id, params.plantId);
	if (!plant) error(404, 'Not found');
	const today = calendarDate(new Date(), home.timeZone);
	const inMemorial = plant.status !== 'active';
	return {
		plant: { id: plant.id, nickname: plant.nickname, inMemorial },
		values: {
			status: inMemorial ? plant.status : '',
			statusOn: plant.statusOn ?? today,
			statusNote: plant.statusNote ?? ''
		},
		/** The days the date field offers: from the day the plant was got, if known, to today. */
		earliest: plant.acquiredOn,
		today,
		noteLimit: MAX_STATUS_NOTE_LENGTH
	};
};

export const actions = {
	default: async ({ locals, params, request }) => {
		const { home } = requireHome(locals, 'plant:edit');
		const values = textFields(await request.formData(), memorialInput.keyof().options);
		const parsed = memorialInput.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });

		const result = memorialisePlant(home.id, params.plantId, values);
		if (!result.ok) {
			if (result.reason === 'not-found') error(404, 'Not found');
			const message =
				result.reason === 'in-the-future'
					? 'That day is still to come. Choose today or a day before.'
					: `That's before the day you got it, ${formatCalendarDate(result.acquiredOn)}.`;
			return fail(400, { values, errors: { statusOn: message } });
		}
		redirect(303, `/plants/${params.plantId}`);
	}
} satisfies Actions;
