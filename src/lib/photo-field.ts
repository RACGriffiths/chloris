/**
 * For forms that send a photo in a field called `photo`: "Add a photo", and "Log other care"
 * (D41). Browser-only, for a `use:enhance` callback.
 */

/** The photo chosen in the form, or `null` if none was. */
export function chosenPhoto(formData: FormData): File | null {
	const file = formData.get('photo');
	return file instanceof File && file.size > 0 ? file : null;
}

/**
 * Swaps the chosen photo for a copy at most 2560 pixels on its longest side, without the
 * original's metadata, and puts the date it was taken in `takenAt` (`#lib/photo-upload`;
 * docs/spec.md, Photos and backups). If the browser can't read the photo, the original is sent
 * and the server checks it. `use:enhance` waits for this before sending the form.
 */
export async function preparePhotoField(formData: FormData): Promise<void> {
	const file = chosenPhoto(formData);
	if (!file) return;
	try {
		// Loaded only now, so pages don't carry this code until someone sends a photo.
		const { preparePhoto } = await import('./photo-upload');
		const ready = await preparePhoto(file);
		if (ready) {
			formData.set('photo', ready.photo, 'photo.jpg');
			formData.set('takenAt', ready.takenAt);
		}
	} catch {
		// The original is sent instead, and the server checks it.
	}
}
