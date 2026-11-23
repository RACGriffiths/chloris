import { isHealthy } from '#lib/server/health.js';
import type { RequestHandler } from './$types';

/**
 * For the Docker health check and uptime monitors. Public, so it says nothing beyond up or down.
 */
export const GET: RequestHandler = () => {
	const healthy = isHealthy();
	return Response.json(
		{ status: healthy ? 'ok' : 'unavailable' },
		{ status: healthy ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
};
