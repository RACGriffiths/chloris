import { aboutThisBuild } from '#lib/server/about.js';
import type { PageServerLoad } from './$types';

/**
 * The version running here and a link to its source code, with the licence's notices (D59). Open
 * to anyone, signed in or not: the AGPL asks that everyone using a modified copy over a network
 * can get its source, and that includes the sign-in page.
 */
export const load: PageServerLoad = () => aboutThisBuild();
