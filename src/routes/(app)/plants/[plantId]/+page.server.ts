import { error, fail } from '@sveltejs/kit';
import { careEventName, dueText, everyText, taskNoun, TASKS } from '#lib/care.js';
import {
	addDays,
	calendarDate,
	formatCalendarDate,
	formatMoment,
	formatMonth,
	formatNearDate,
	relativeDay
} from '#lib/dates.js';
import {
	MAX_NOTE_LENGTH,
	careInput,
	listCareEvents,
	logCare,
	logCareWithPhoto,
	undoCare
} from '#lib/server/data/care-events.js';
import { addPhoto, listPhotos, photoInput, type Photo } from '#lib/server/data/photos.js';
import { getPlant } from '#lib/server/data/plants.js';
import {
	MAX_SNOOZE_DAYS,
	cancelSnooze,
	listSchedules,
	snoozeInput,
	snoozeTask
} from '#lib/server/data/schedules.js';
import { fieldErrors, textField, textFields } from '#lib/server/forms.js';
import { requireHome, requirePermission } from '#lib/server/permissions/guard.js';
import { can } from '#lib/server/permissions/index.js';
import type { Home } from '#lib/server/data/homes.js';
import type { PhotoProblem } from '#lib/server/photos/process.js';
import { MAX_PHOTO_BYTES } from '#lib/photos.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * A plant's page: its details, its care schedules with what's due, its care history (D31, D32)
 * and its photo timeline (D39). Measurements come with a later item. Logging, checking, snoozing
 * and undoing care, and adding photos, happen here; schedules are added and changed on their own
 * pages, and each photo has its own page.
 */

/** How much care history the page shows before "Show all". */
const HISTORY_LIMIT = 20;
const ALL_HISTORY = 10_000;

/** How many photos the timeline shows before "Show all": four rows of three. */
const PHOTO_LIMIT = 12;

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

/** Why care wasn't logged or snoozed on a plant in the Memorial (D44). */
const inTheMemorial = (nickname: string) =>
	`${nickname} is in the Memorial, so it needs no care. Restore it to look after it again.`;

/** The plant in the URL, if it's in the user's home; otherwise the request ends with a 404. */
function plantIn(home: Home, plantId: string) {
	const plant = getPlant(home.id, plantId);
	if (!plant) error(404, 'Not found');
	return plant;
}

/**
 * The form sent, or `null` if it was bigger than the server takes: the Node adapter stops reading
 * a request over BODY_SIZE_LIMIT with a 413 (D37).
 */
async function readForm(request: Request): Promise<FormData | null> {
	try {
		return await request.formData();
	} catch (problem) {
		if ((problem as { status?: unknown }).status !== 413) throw problem;
		return null;
	}
}

/** The photo a form sent, as bytes, or `null` if none was chosen. */
async function photoBytes(form: FormData): Promise<Uint8Array | null> {
	const file = form.get('photo');
	if (!(file instanceof File) || file.size === 0) return null;
	return new Uint8Array(await file.arrayBuffer());
}

/** A day near today, as a label: `Today`, `Yesterday`, `Mon 17 Nov`, `3 May 2025`. */
function dayLabel(date: string, today: string): string {
	const day = relativeDay(date, today);
	return `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
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
	const allPhotos = url.searchParams.get('photos') === 'all';

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
			photoId: event.photoId,
			yours: event.userId === user.id
		})),
		moreHistory: history.more,
		timeline: timeline(
			allPhotos ? photos : photos.slice(0, PHOTO_LIMIT),
			plant.coverChosen ? plant.coverPhotoId : null,
			zone,
			today
		),
		photoCount: photos.length,
		morePhotos: !allPhotos && photos.length > PHOTO_LIMIT,
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

/** A photo as the timeline shows it. */
interface TimelinePhoto {
	id: string;
	caption: string | null;
	/** The day it was taken: `Today`, `Mon 17 Nov`, `3 May 2025`. */
	taken: string;
	/** Whether it was chosen as the plant's cover (D42). */
	cover: boolean;
}

/**
 * A plant's photos by the month they were taken in, in the home's time zone, the latest first,
 * each with the day it was taken and whether it's the cover chosen for the plant (D39).
 */
function timeline(photos: Photo[], chosenCoverId: string | null, zone: string, today: string) {
	const months: { month: string; photos: TimelinePhoto[] }[] = [];
	for (const photo of photos) {
		const date = calendarDate(photo.takenAt, zone);
		const month = formatMonth(date);
		if (months.at(-1)?.month !== month) months.push({ month, photos: [] });
		months.at(-1)?.photos.push({
			id: photo.id,
			caption: photo.caption,
			taken: dayLabel(date, today),
			cover: photo.id === chosenCoverId
		});
	}
	return months;
}

/** How care just logged or removed is described: "Watered, today at 09:14". */
function describe(event: { type: string; checkedTask: string | null; doneAt: Date }, home: Home) {
	return `${careEventName(event.type, event.checkedTask)}, ${formatMoment(event.doneAt, home.timeZone, new Date(), 'sentence')}`;
}

export const actions = {
	/**
	 * Logs care: a schedule's Done and "Not needed" buttons, and the Log other care form, which
	 * can send a photo with it (D41).
	 */
	log: async ({ locals, params, request }) => {
		const { user, home } = requireHome(locals, 'care:log');
		const plant = plantIn(home, params.plantId);
		const form = await readForm(request);
		if (!form) {
			const errors = { photo: PHOTO_PROBLEMS['too-big-for-server'] };
			return fail(413, { log: { values: { type: '', doneAt: '', note: '' }, errors } });
		}
		const values = textFields(form, careInput.keyof().options);
		const parsed = careInput.safeParse(values);
		if (!parsed.success) {
			return fail(400, { log: { values, errors: fieldErrors(parsed.error) } });
		}

		const photo = await photoBytes(form);
		if (photo) requirePermission(user, home.id, 'photo:add');
		const result = photo
			? await logCareWithPhoto(
					home.id,
					user.id,
					plant.id,
					{ ...values, takenAt: textField(form, 'takenAt') },
					photo
				)
			: logCare(home.id, user.id, plant.id, values);
		if (!result.ok) {
			if (result.reason === 'not-found') error(404, 'Not found');
			if (result.reason === 'in-the-memorial') {
				return fail(400, { error: inTheMemorial(plant.nickname) });
			}
			const errors =
				result.reason === 'in-the-future'
					? { doneAt: 'That time is still to come. Choose one that has passed.' }
					: { photo: PHOTO_PROBLEMS[result.reason] };
			return fail(400, { log: { values, errors } });
		}
		const message = `Logged: ${describe(result.event, home)}${photo ? ', with a photo' : ''}.`;
		return { logged: { id: result.event.id, message } };
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
		if (!result.ok && result.reason === 'in-the-memorial') {
			return fail(400, { error: inTheMemorial(plant.nickname) });
		}
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
		const form = await readForm(request);
		if (!form) {
			const errors = { photo: PHOTO_PROBLEMS['too-big-for-server'] };
			return fail(413, { photo: { values: { caption: '' }, errors } });
		}

		const values = textFields(form, photoInput.keyof().options);
		const parsed = photoInput.safeParse(values);
		if (!parsed.success) {
			return fail(400, { photo: { values, errors: fieldErrors(parsed.error) } });
		}
		const bytes = await photoBytes(form);
		if (!bytes) {
			return fail(400, { photo: { values, errors: { photo: PHOTO_PROBLEMS.none } } });
		}

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
