import { error, fail, redirect } from '@sveltejs/kit';
import { careEventName } from '#lib/care.js';
import { calendarDate, formatMoment, localDateTime } from '#lib/dates.js';
import { MAX_CAPTION_LENGTH } from '#lib/photos.js';
import type { SessionUser } from '#lib/server/auth/index.js';
import type { Home } from '#lib/server/data/homes.js';
import {
	deletePhoto,
	getPhoto,
	listPhotos,
	photoChangeInput,
	updatePhoto,
	type PhotoEditor
} from '#lib/server/data/photos.js';
import { getPlant, setCoverPhoto } from '#lib/server/data/plants.js';
import { fieldErrors, textField, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { can } from '#lib/server/permissions/index.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * One photo of a plant, in the app (D39): larger, with when it was taken, who added it, the care
 * it was added with, and links to the newer and older photos in the timeline. From here it can be
 * chosen as the plant's cover (D42), and its caption and date changed or the photo deleted (D40).
 */

/** The plant in the URL, if it's in the user's home; otherwise the request ends with a 404. */
function plantIn(home: Home, plantId: string) {
	const plant = getPlant(home.id, plantId);
	if (!plant) error(404, 'Not found');
	return plant;
}

/** Who is changing a photo: anyone's, if they may edit plants, or else only their own (D40). */
function editorFor(user: SessionUser, home: Home): PhotoEditor {
	return { userId: user.id, anyPhoto: can(user, home.id, 'plant:edit') };
}

const NOT_YOURS =
	'Only the person who added a photo, or someone who can edit plants, can change it.';

export const load: PageServerLoad = ({ locals, params }) => {
	const { user, home } = requireHome(locals, 'home:view');
	const plant = plantIn(home, params.plantId);
	const photo = getPhoto(home.id, plant.id, params.photoId);
	if (!photo) error(404, 'Not found');

	const now = new Date();
	const zone = home.timeZone;
	const photos = listPhotos(home.id, plant.id);
	const index = photos.findIndex((each) => each.id === photo.id);
	const editor = editorFor(user, home);

	return {
		plant: { id: plant.id, nickname: plant.nickname },
		photo: {
			id: photo.id,
			caption: photo.caption,
			width: photo.width,
			height: photo.height,
			taken: formatMoment(photo.takenAt, zone, now, 'sentence'),
			/** For the date field: when it was taken, in the home's time zone. */
			takenAt: localDateTime(photo.takenAt, zone),
			by: photo.userId === user.id ? 'you' : (photo.userName ?? 'someone who has left'),
			care: photo.care && {
				name: careEventName(photo.care.type, photo.care.checkedTask),
				when: formatMoment(photo.care.doneAt, zone, now, 'sentence')
			}
		},
		/** Its place in the timeline, the latest first. */
		position: index + 1,
		count: photos.length,
		newerId: photos[index - 1]?.id ?? null,
		olderId: photos[index + 1]?.id ?? null,
		/** Whether it's the cover chosen for the plant, rather than shown as its latest photo. */
		isCover: plant.coverChosen && plant.coverPhotoId === photo.id,
		/** The latest time the date field offers: the end of today in the home's time zone. */
		latest: `${calendarDate(now, zone)}T23:59`,
		captionLimit: MAX_CAPTION_LENGTH,
		canChooseCover: can(user, home.id, 'plant:edit'),
		canChange:
			can(user, home.id, 'photo:add') && (editor.anyPhoto || photo.userId === editor.userId)
	};
};

export const actions = {
	/** Chooses this photo as the plant's cover, or goes back to its latest photo. */
	cover: async ({ locals, params, request }) => {
		const { home } = requireHome(locals, 'plant:edit');
		const plant = plantIn(home, params.plantId);
		const latest = textField(await request.formData(), 'use') === 'latest';

		if (!setCoverPhoto(home.id, plant.id, latest ? null : params.photoId)) {
			error(404, 'Not found');
		}
		return {
			message: latest
				? `${plant.nickname} shows its latest photo again.`
				: `This is now ${plant.nickname}'s cover photo.`
		};
	},

	/** Changes the caption, and when the photo was taken. */
	save: async ({ locals, params, request }) => {
		const { user, home } = requireHome(locals, 'photo:add');
		const plant = plantIn(home, params.plantId);
		const values = textFields(await request.formData(), photoChangeInput.keyof().options);
		const parsed = photoChangeInput.safeParse(values);
		if (!parsed.success) {
			return fail(400, { edit: { values, errors: fieldErrors(parsed.error) } });
		}

		const result = updatePhoto(home.id, plant.id, params.photoId, editorFor(user, home), values);
		if (!result.ok) {
			if (result.reason === 'not-found') error(404, 'Not found');
			if (result.reason === 'not-yours') error(403, NOT_YOURS);
			const takenAt =
				result.reason === 'in-the-future'
					? 'That time is still to come. Choose one that has passed.'
					: 'Choose a date from 1990 on.';
			return fail(400, { edit: { values, errors: { takenAt } } });
		}
		return { message: 'Saved.' };
	},

	/** Deletes the photo, then goes back to the plant's timeline. */
	delete: ({ locals, params }) => {
		const { user, home } = requireHome(locals, 'photo:add');
		const plant = plantIn(home, params.plantId);

		const result = deletePhoto(home.id, plant.id, params.photoId, editorFor(user, home));
		if (!result.ok && result.reason === 'not-yours') error(403, NOT_YOURS);
		// Already deleted, perhaps by someone else: the timeline is the place to go either way.
		redirect(303, `/plants/${plant.id}#photos`);
	}
} satisfies Actions;
