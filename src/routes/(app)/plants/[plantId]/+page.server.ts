import { error, fail } from '@sveltejs/kit';
import { careEventName, dueText, everyText, taskNoun, TASKS } from '#lib/care.js';
import {
	addDays,
	calendarDate,
	formatCalendarDate,
	formatMoment,
	formatNearDate,
	relativeDay
} from '#lib/dates.js';
import {
	MAX_NOTE_LENGTH,
	careInput,
	listCareEvents,
	logCare,
	undoCare
} from '#lib/server/data/care-events.js';
import { addPhoto, listPhotos, photoInput } from '#lib/server/data/photos.js';
import { getPlant } from '#lib/server/data/plants.js';
import {
	MAX_SNOOZE_DAYS,
	cancelSnooze,
	listSchedules,
	snoozeInput,
	snoozeTask
} from '#lib/server/data/schedules.js';
import { fieldErrors, textField, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { can } from '#lib/server/permissions/index.js';
import type { Home } from '#lib/server/data/homes.js';
import type { PhotoProblem } from '#lib/server/photos/process.js';
import { MAX_PHOTO_BYTES } from '#lib/photos.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * A plant's page: its details, its care schedules with what's due, its care history (D31, D32)
 * and its photos (D38). Measurements come with a later item. Logging, checking, snoozing and
 * undoing care, and adding photos, happen here; schedules are added and changed on their own
 * pages.
 */

/** How much care history the page shows before "Show all". */
const HISTORY_LIMIT = 20;
const ALL_HISTORY = 10_000;

const MAX_MEGABYTES = MAX_PHOTO_BYTES / 1024 / 1024;

/** Why a photo wasn't added, for the person who sent it. */
const PHOTO_PROBLEMS: Record<PhotoProblem | 'too-big-for-server' | 'none', string> = {
	none: 'Choose a photo.',
	'too-big': `That photo is too big. Choose one under ${MAX_MEGABYTES} MB.`,
	// The Node adapter's BODY_SIZE_LIMIT is lower than Chloris needs (D37).
	'too-big-for-server':
		'That photo is bigger than this server accepts. Whoever runs it can raise BODY_SIZE_LIMIT to 25M.',
	heic: "That photo is in HEIC format, which Chloris can't read. Choose a JPEG instead.",
	unsupported: 'Choose a photo in JPEG, PNG or WebP format.',
	'too-many-pixels': 'That photo has too many pixels to handle. Choose a smaller one.',
	unreadable: "That photo couldn't be read. It may be damaged; try another."
};

/** The plant in the URL, if it's in the user's home; otherwise the request ends with a 404. */
function plantIn(home: Home, plantId: string) {
	const plant = getPlant(home.id, plantId);
	if (!plant) error(404, 'Not found');
	return plant;
}

export const load: PageServerLoad = ({ locals, params, url }) => {
	const { user, home } = requireHome(locals, 'home:view');
	const plant = plantIn(home, params.plantId);
	const now = new Date();
	const zone = home.timeZone;
	const today = calendarDate(now, zone);

	const schedules = listSchedules(home.id, plant.id, now);
	const showAll = url.searchParams.get('history') === 'all';
	const history = listCareEvents(home.id, plant.id, showAll ? ALL_HISTORY : HISTORY_LIMIT);
	const photos = listPhotos(home.id, plant.id);

	return {
		plant: { ...plant, acquired: plant.acquiredOn ? formatCalendarDate(plant.acquiredOn) : null },
		schedules: schedules.map((schedule) => ({
			id: schedule.id,
			task: schedule.task,
			every: everyText(schedule.intervalDays),
			due: dueText(schedule.daysAway, schedule.dueReason, formatNearDate(schedule.due, today)),
			daysAway: schedule.daysAway,
			snoozed: schedule.dueReason === 'snoozed' && schedule.daysAway > 0,
			lastDone: schedule.lastDone
				? `last done ${relativeDay(calendarDate(schedule.lastDone, zone), today)}`
				: 'not done yet'
		})),
		/** Tasks without a schedule yet, which can be added. */
		unscheduled: TASKS.filter((task) => !schedules.some((schedule) => schedule.task === task)),
		history: history.events.map((event) => ({
			id: event.id,
			type: event.type,
			checkedTask: event.checkedTask,
			name: careEventName(event.type, event.checkedTask),
			when: formatMoment(event.doneAt, zone, now),
			by: event.userId === user.id ? 'you' : (event.userName ?? 'someone who has left'),
			note: event.note,
			yours: event.userId === user.id
		})),
		moreHistory: history.more,
		photos: photos.map((photo) => {
			const day = relativeDay(calendarDate(photo.takenAt, zone), today);
			return {
				id: photo.id,
				caption: photo.caption,
				taken: `${day.charAt(0).toUpperCase()}${day.slice(1)}`
			};
		}),
		/** Limits for the date fields: care can't be logged in the future, nor snoozed too far. */
		latest: `${today}T23:59`,
		noteLimit: MAX_NOTE_LENGTH,
		snoozeFrom: addDays(today, 1),
		snoozeTo: addDays(today, MAX_SNOOZE_DAYS),
		canEdit: can(user, home.id, 'plant:edit'),
		canLog: can(user, home.id, 'care:log'),
		canConfigure: can(user, home.id, 'home:configure'),
		canAddPhoto: can(user, home.id, 'photo:add')
	};
};

/** How care just logged or removed is described: "Watered, today at 09:14". */
function describe(event: { type: string; checkedTask: string | null; doneAt: Date }, home: Home) {
	return `${careEventName(event.type, event.checkedTask)}, ${formatMoment(event.doneAt, home.timeZone, new Date(), 'sentence')}`;
}

export const actions = {
	/** Logs care: a schedule's Done and "Not needed" buttons, and the Log care form. */
	log: async ({ locals, params, request }) => {
		const { user, home } = requireHome(locals, 'care:log');
		const plant = plantIn(home, params.plantId);
		const values = textFields(await request.formData(), careInput.keyof().options);
		const parsed = careInput.safeParse(values);
		if (!parsed.success) {
			return fail(400, { log: { values, errors: fieldErrors(parsed.error) } });
		}

		const result = logCare(home.id, user.id, plant.id, values);
		if (!result.ok && result.reason === 'not-found') error(404, 'Not found');
		if (!result.ok) {
			const errors = { doneAt: 'That time is still to come. Choose one that has passed.' };
			return fail(400, { log: { values, errors } });
		}
		return { logged: { id: result.event.id, message: `Logged: ${describe(result.event, home)}.` } };
	},

	/** Undoes care the user logged: just now, or from the history. */
	undo: async ({ locals, params, request }) => {
		const { user, home } = requireHome(locals, 'care:log');
		const plant = plantIn(home, params.plantId);
		const eventId = textField(await request.formData(), 'eventId');

		const result = undoCare(home.id, user.id, plant.id, eventId);
		if (!result.ok && result.reason === 'not-yours') {
			error(403, 'Only the person who logged care can remove it.');
		}
		if (!result.ok) return fail(400, { error: 'That care has already been removed.' });
		return { message: `Removed: ${describe(result.event, home)}.` };
	},

	snooze: async ({ locals, params, request }) => {
		const { home } = requireHome(locals, 'care:log');
		const plant = plantIn(home, params.plantId);
		const form = await request.formData();
		const task = textField(form, 'task');
		const values = textFields(form, snoozeInput.keyof().options);
		const parsed = snoozeInput.safeParse(values);
		if (!parsed.success) {
			// The panel shows one message, whichever field it's about.
			const [message] = Object.values(fieldErrors(parsed.error));
			return fail(400, { snooze: { task, error: message ?? 'Choose a date.' } });
		}

		const result = snoozeTask(home.id, plant.id, task, values);
		if (!result.ok && result.reason === 'not-found') error(404, 'Not found');
		if (!result.ok) {
			const message =
				result.reason === 'too-far' ? 'Choose a date within a year.' : 'Choose a date after today.';
			return fail(400, { snooze: { task, error: message } });
		}
		const today = calendarDate(new Date(), home.timeZone);
		return { message: `Snoozed ${taskNoun(task)} until ${formatNearDate(result.until, today)}.` };
	},

	/** Adds a photo: resized by the browser once JavaScript has loaded, the original before. */
	addPhoto: async ({ locals, params, request }) => {
		const { user, home } = requireHome(locals, 'photo:add');
		const plant = plantIn(home, params.plantId);
		let form: FormData;
		try {
			form = await request.formData();
		} catch (problem) {
			// The Node adapter stops reading a request bigger than BODY_SIZE_LIMIT with a 413.
			if ((problem as { status?: unknown }).status !== 413) throw problem;
			const errors = { photo: PHOTO_PROBLEMS['too-big-for-server'] };
			return fail(413, { photo: { values: { caption: '' }, errors } });
		}

		const values = textFields(form, photoInput.keyof().options);
		const parsed = photoInput.safeParse(values);
		if (!parsed.success) {
			return fail(400, { photo: { values, errors: fieldErrors(parsed.error) } });
		}
		const file = form.get('photo');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { photo: { values, errors: { photo: PHOTO_PROBLEMS.none } } });
		}

		const bytes = new Uint8Array(await file.arrayBuffer());
		const result = await addPhoto(home.id, user.id, plant.id, values, bytes);
		if (!result.ok) {
			if (result.reason === 'not-found') error(404, 'Not found');
			else
				return fail(400, { photo: { values, errors: { photo: PHOTO_PROBLEMS[result.reason] } } });
		}
		return { photoAdded: 'Photo added.' };
	},

	unsnooze: async ({ locals, params, request }) => {
		const { home } = requireHome(locals, 'care:log');
		const plant = plantIn(home, params.plantId);
		const task = textField(await request.formData(), 'task');
		if (!cancelSnooze(home.id, plant.id, task)) error(404, 'Not found');
		const noun = taskNoun(task);
		return { message: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} is no longer snoozed.` };
	}
} satisfies Actions;
