import { listPlants } from '#lib/server/data/plants.js';
import { listRooms } from '#lib/server/data/rooms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { can } from '#lib/server/permissions/index.js';
import type { PageServerLoad } from './$types';

/**
 * The home's active plants, under their rooms (D30). `?room=` shows one room and `?tag=` only
 * plants with that tag. Both are links, so filtering works before JavaScript loads.
 */
export const load: PageServerLoad = ({ locals, url }) => {
	const { user, home } = requireHome(locals, 'home:view');
	const rooms = listRooms(home.id);
	// An unknown room, such as one deleted since the link was made, shows every room.
	const roomId = rooms.find((room) => room.id === url.searchParams.get('room'))?.id ?? null;
	const tag = url.searchParams.get('tag')?.trim().toLocaleLowerCase('en') || null;
	return {
		home: { name: home.name },
		rooms,
		plants: listPlants(home.id, { roomId, tag }),
		filter: { roomId, tag },
		canEditPlants: can(user, home.id, 'plant:edit')
	};
};
