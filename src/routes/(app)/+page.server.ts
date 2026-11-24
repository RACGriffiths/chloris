import { error, fail, redirect } from '@sveltejs/kit';
import { careEventName, dueText, taskNoun, TASKS, type Task } from '#lib/care.js';
import { calendarDate, formatLongDate, formatNearDate, localDateTime } from '#lib/dates.js';
import { requireUser } from '#lib/server/auth/require.js';
import {
	dueCareInput,
	listCareToday,
	logDueTasks,
	undoCareEvents,
	type CareEventOnPlant
} from '#lib/server/data/care-events.js';
import { listHomesForUser } from '#lib/server/data/homes.js';
import { compareNames } from '#lib/server/data/order.js';
import { listPlants } from '#lib/server/data/plants.js';
import { listTasks, type HomeTask } from '#lib/server/data/schedules.js';
import { fieldErrors, textFields, textList } from '#lib/server/forms.js';
import { requireHome, requirePermission } from '#lib/server/permissions/guard.js';
import { can, canCreateHome } from '#lib/server/permissions/index.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The home screen: the Today view (docs/spec.md, Today view; D34). It gathers the care due today
 * or overdue on the home's active plants, room by room, with buttons to log each task, or a task
 * on every plant in a room that needs it, and lists the care already done today.
 *
 * The UI shows one home for now (D14). Someone with no home either creates one, if the
 * command-line tool allowed it, or is told they have no access (D26).
 */

export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	const [home] = listHomesForUser(user.id);
	if (!home) {
		if (canCreateHome(user)) redirect(303, '/homes/new');
		return { name: user.name, home: null };
	}
	requirePermission(user, home.id, 'home:view');

	const now = new Date();
	const zone = home.timeZone;
	const today = calendarDate(now, zone);
	const tasks = listTasks(home.id, now);
	const next = tasks.find((task) => task.daysAway > 0);
	const plants = listPlants(home.id);
	const covers = new Map(plants.map((plant) => [plant.id, plant.coverPhotoId]));

	return {
		name: user.name,
		home: { name: home.name },
		date: formatLongDate(today),
		plantCount: plants.length,
		taskCount: tasks.length,
		rooms: byRoom(
			tasks.filter((task) => task.daysAway <= 0),
			today,
			covers
		),
		/** The next task to fall due, for when nothing is due today. */
		next: next && {
			plantId: next.plantId,
			plantName: next.plantName,
			noun: taskNoun(next.task),
			when: next.daysAway === 1 ? 'tomorrow' : `on ${formatNearDate(next.due, today)}`
		},
		done: listCareToday(home.id, now).map((event) => ({
			id: event.id,
			plantId: event.plantId,
			plantName: event.plantName,
			type: event.type,
			checkedTask: event.checkedTask,
			name: careEventName(event.type, event.checkedTask),
			time: localDateTime(event.doneAt, zone).slice(11),
			by: event.userId === user.id ? 'you' : (event.userName ?? 'someone who has left'),
			yours: event.userId === user.id
		})),
		canLog: can(user, home.id, 'care:log'),
		canEditPlants: can(user, home.id, 'plant:edit'),
		canManageMembers: can(user, home.id, 'member:manage')
	};
};

/**
 * The due tasks grouped by room and then by plant, both in name order, each plant's tasks in the
 * order of `TASKS`, with each plant's cover photo from `covers`. A task due on two or more plants
 * in a room can be logged on all of them at once.
 */
function byRoom(due: HomeTask[], today: string, covers: Map<string, string | null>) {
	type Plant = { id: string; name: string; tasks: HomeTask[] };
	type Room = { id: string; name: string; plants: Map<string, Plant> };
	const rooms = new Map<string, Room>();
	for (const task of due) {
		const room: Room = rooms.get(task.roomId) ?? {
			id: task.roomId,
			name: task.roomName,
			plants: new Map()
		};
		rooms.set(task.roomId, room);
		const plant: Plant = room.plants.get(task.plantId) ?? {
			id: task.plantId,
			name: task.plantName,
			tasks: []
		};
		room.plants.set(task.plantId, plant);
		plant.tasks.push(task);
	}

	const byName = <T extends { id: string; name: string }>(a: T, b: T) =>
		compareNames(a.name, b.name) || a.id.localeCompare(b.id);

	return [...rooms.values()].sort(byName).map((room) => {
		const plants = [...room.plants.values()].sort(byName);
		return {
			id: room.id,
			name: room.name,
			plants: plants.map((plant) => ({
				id: plant.id,
				name: plant.name,
				photoId: covers.get(plant.id) ?? null,
				tasks: plant.tasks
					.sort((a, b) => TASKS.indexOf(a.task) - TASKS.indexOf(b.task))
					.map((task) => ({
						task: task.task,
						due: dueText(task.daysAway, task.dueReason, formatNearDate(task.due, today)),
						overdue: task.daysAway < 0
					}))
			})),
			/** "Water all": each task due on more than one of the room's plants, with those plants. */
			together: TASKS.map((task) => ({
				task,
				plantIds: plants
					.filter((plant) => plant.tasks.some((due) => due.task === task))
					.map((plant) => plant.id)
			})).filter((group) => group.plantIds.length > 1)
		};
	});
}

/** Plant names for a message: "Fern", "Fern and Ivy", "Fern, Ivy and Basil", or "5 plants". */
function names(plants: { plantName: string }[]): string {
	if (plants.length > 3) return `${plants.length} plants`;
	return new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(
		plants.map((plant) => plant.plantName)
	);
}

const capitalise = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** What was logged: "Watering logged for Fern and Ivy.", "Checked Fern: watering not needed." */
function loggedMessage(task: Task, outcome: string, plants: { plantName: string }[]): string {
	const noun = taskNoun(task);
	return outcome === 'done'
		? `${capitalise(noun)} logged for ${names(plants)}.`
		: `Checked ${names(plants)}: ${noun} not needed.`;
}

/** What was removed: "Removed watering for Fern and Ivy.", "Removed watering check for Fern." */
function removedMessage(events: CareEventOnPlant[]): string {
	const groups = new Map<string, CareEventOnPlant[]>();
	for (const event of events) {
		const what =
			event.type === 'checked' && event.checkedTask
				? `${taskNoun(event.checkedTask)} check`
				: taskNoun(event.type);
		groups.set(what, [...(groups.get(what) ?? []), event]);
	}
	const parts = [...groups].map(([what, group]) => `${what} for ${names(group)}`);
	return `Removed ${parts.join('; ')}.`;
}

export const actions = {
	/**
	 * Logs a task as done, or as checked and not needed, on one plant or on several in a room.
	 * Plants where it's no longer due, because someone else got there first, are left alone.
	 */
	log: async ({ locals, request }) => {
		const { user, home } = requireHome(locals, 'care:log');
		const form = await request.formData();
		const values = {
			...textFields(form, ['task', 'outcome']),
			plantIds: textList(form, 'plantId')
		};
		const parsed = dueCareInput.safeParse(values);
		if (!parsed.success) {
			const [message] = Object.values(fieldErrors(parsed.error));
			return fail(400, { error: message ?? 'Choose a task.' });
		}

		const result = logDueTasks(home.id, user.id, values);
		if (!result.ok) error(404, 'Not found');
		const { task, outcome } = parsed.data;
		const notDue =
			result.notDue.length > 0
				? `Not logged, as ${taskNoun(task)} isn't due any more: ${names(result.notDue)}.`
				: null;
		if (result.logged.length === 0) return { message: notDue ?? '' };
		return {
			logged: {
				ids: result.logged.map((logged) => logged.eventId),
				message: loggedMessage(task, outcome, result.logged),
				notDue
			}
		};
	},

	/** Undoes care the user logged: straight after logging it, or from the list of today's care. */
	undo: async ({ locals, request }) => {
		const { user, home } = requireHome(locals, 'care:log');
		const result = undoCareEvents(home.id, user.id, textList(await request.formData(), 'eventId'));
		if (!result.ok && result.reason === 'not-yours') {
			error(403, 'Only the person who logged care can remove it.');
		}
		if (!result.ok) return fail(400, { error: 'That care has already been removed.' });
		return { message: removedMessage(result.events) };
	}
} satisfies Actions;
