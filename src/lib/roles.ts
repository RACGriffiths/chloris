/**
 * How roles are named and described on screen. What each role may do is decided on the server,
 * in `#lib/server/permissions`; keep these descriptions in step with the spec's roles table.
 */
const ROLES: Record<string, { name: string; description: string }> = {
	owner: {
		name: 'Owner',
		description: 'Can do everything, including inviting and removing people and deleting the home.'
	},
	carer: {
		name: 'Carer',
		description: 'Looks after the plants: logs care, and adds and edits plants, rooms and photos.'
	},
	viewer: {
		name: 'Viewer',
		description: 'Can see the plants and their history, but not change anything.'
	},
	sitter: {
		name: 'Sitter',
		description: 'Looks after the plants for a while: logs care and adds photos.'
	}
};

export function roleName(role: string): string {
	return Object.hasOwn(ROLES, role) ? ROLES[role].name : role;
}

export function roleDescription(role: string): string {
	return Object.hasOwn(ROLES, role) ? ROLES[role].description : '';
}
