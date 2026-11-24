import { error } from '@sveltejs/kit';
import { isPhotoSize } from '#lib/photos.js';
import { readPhoto } from '#lib/server/data/photos.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { MISSING_PHOTO_SVG } from '#lib/server/photos/placeholder.js';
import type { RequestHandler } from './$types';

/**
 * Sends one size of a photo (thumb, medium or full) to someone who can see its home, never to
 * anyone else (CLAUDE.md rule 5). Photos are never served as static files.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const { home } = requireHome(locals, 'home:view');
	if (!isPhotoSize(params.size)) error(404, 'Not found');

	const result = await readPhoto(home.id, params.photoId, params.size);
	if (!result.ok && result.reason === 'not-found') error(404, 'Not found');
	if (!result.ok) {
		return new Response(MISSING_PHOTO_SVG, {
			headers: {
				'content-type': 'image/svg+xml',
				// Shown again once the file is back.
				'cache-control': 'no-store',
				'content-security-policy': "default-src 'none'",
				'x-content-type-options': 'nosniff'
			}
		});
	}

	return new Response(new Uint8Array(result.bytes), {
		headers: {
			'content-type': 'image/jpeg',
			// A photo's files never change (D35), so the browser can keep them. `private` keeps
			// them out of shared caches, such as a proxy or tunnel in front of the app.
			'cache-control': 'private, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff'
		}
	});
};
