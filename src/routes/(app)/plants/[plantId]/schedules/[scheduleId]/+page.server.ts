import { error, fail, redirect } from '@sveltejs/kit';
import { getPlant } from '#lib/server/data/plants.js';
import {
	MAX_INTERVAL_DAYS,
	MAX_RECHECK_DAYS,
	deleteSchedule,
	getSchedule,
	scheduleChangeInput,
	updateSchedule
} from '#lib/server/data/schedules.js';
import { fieldErrors, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { audit } from '#lib/server/security/audit.js';
import type { Actions, PageServerLoad } from './$types';

/** Changing how often a plant's task comes round, or removing its schedule. */
export const load: PageServerLoad = ({ locals, params }) => {
	const { home } = requireHome(locals, 'home:configure');
	const plant = getPlant(home.id, params.plantId);
	const schedule = plant && getSchedule(home.id, plant.id, params.scheduleId);
	if (!plant || !schedule) error(404, 'Not found');
	return {
		plant: { id: plant.id, nickname: plant.nickname },
		task: schedule.task,
		values: {
			task: schedule.task,
			intervalDays: String(schedule.intervalDays),
			recheckDays: String(schedule.recheckDays)
		},
		maxInterval: MAX_INTERVAL_DAYS,
		maxRecheck: MAX_RECHECK_DAYS
	};
};

export const actions = {
	save: async ({ locals, params, request }) => {
		const { home } = requireHome(locals, 'home:configure');
		const values = textFields(await request.formData(), scheduleChangeInput.keyof().options);
		const parsed = scheduleChangeInput.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });

		if (!updateSchedule(home.id, params.plantId, params.scheduleId, values)) {
			error(404, 'Not found');
		}
		redirect(303, `/plants/${params.plantId}#care`);
	},

	delete: (event) => {
		const { params } = event;
		const { user, home } = requireHome(event.locals, 'home:configure');
		const plant = getPlant(home.id, params.plantId);
		const schedule = plant && getSchedule(home.id, plant.id, params.scheduleId);
		if (!plant || !schedule || !deleteSchedule(home.id, plant.id, schedule.id)) {
			error(404, 'Not found');
		}
		audit(event, home.id, user.id, {
			action: 'schedule-deleted',
			targetId: schedule.id,
			detail: { plant: plant.nickname, task: schedule.task }
		});
		redirect(303, `/plants/${plant.id}#care`);
	}
} satisfies Actions;
