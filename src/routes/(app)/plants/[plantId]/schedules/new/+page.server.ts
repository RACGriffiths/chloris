import { error, fail, redirect } from '@sveltejs/kit';
import { TASKS } from '#lib/care.js';
import { getPlant } from '#lib/server/data/plants.js';
import {
	DEFAULT_RECHECK_DAYS,
	MAX_INTERVAL_DAYS,
	MAX_RECHECK_DAYS,
	createSchedule,
	listSchedules,
	scheduleInput
} from '#lib/server/data/schedules.js';
import { fieldErrors, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import type { Actions, PageServerLoad } from './$types';

/** Adding a care schedule to a plant: one per task, such as watering every 7 days. */
export const load: PageServerLoad = ({ locals, params }) => {
	const { home } = requireHome(locals, 'home:configure');
	const plant = getPlant(home.id, params.plantId);
	if (!plant) error(404, 'Not found');
	const scheduled = new Set(listSchedules(home.id, plant.id).map((schedule) => schedule.task));
	const tasks = TASKS.filter((task) => !scheduled.has(task));
	return {
		plant: { id: plant.id, nickname: plant.nickname },
		tasks,
		values: {
			task: tasks[0] ?? '',
			intervalDays: '7',
			recheckDays: String(DEFAULT_RECHECK_DAYS)
		},
		maxInterval: MAX_INTERVAL_DAYS,
		maxRecheck: MAX_RECHECK_DAYS
	};
};

export const actions = {
	default: async ({ locals, params, request }) => {
		const { home } = requireHome(locals, 'home:configure');
		const values = textFields(await request.formData(), scheduleInput.keyof().options);
		const parsed = scheduleInput.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });

		const result = createSchedule(home.id, params.plantId, values);
		if (!result.ok && result.reason === 'not-found') error(404, 'Not found');
		if (!result.ok) {
			return fail(400, { values, errors: { task: 'That task already has a schedule.' } });
		}
		redirect(303, `/plants/${params.plantId}#care`);
	}
} satisfies Actions;
