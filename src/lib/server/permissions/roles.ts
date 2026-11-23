import { createAccessControl } from 'better-auth/plugins/access';

/**
 * The fixed roles in a home and what each may do (docs/spec.md, Roles in a home; D15).
 *
 * Permissions are written `resource:action`, e.g. `plant:edit`. They are defined through
 * BetterAuth's access-control API, so BetterAuth's organisation plugin knows the same roles.
 * Code checks permissions with `can()`, never role names, so roles can change without
 * touching the checks.
 */
export const statement = {
	/** `view`: see plants, photos and history. `configure`: manage rooms, schedules and
	 * measurement types. `update`: change the home's name, time zone and winter months. */
	home: ['view', 'configure', 'update', 'export', 'delete'],
	/** Log care and snooze tasks. */
	care: ['log'],
	photo: ['add'],
	measurement: ['add'],
	/** Add, edit and memorialise plants. */
	plant: ['edit'],
	/** Invite and remove members, and change their roles. */
	member: ['manage']
} as const;

export const ac = createAccessControl(statement);

export const roles = {
	owner: ac.newRole({
		home: ['view', 'configure', 'update', 'export', 'delete'],
		care: ['log'],
		photo: ['add'],
		measurement: ['add'],
		plant: ['edit'],
		member: ['manage']
	}),
	carer: ac.newRole({
		home: ['view', 'configure'],
		care: ['log'],
		photo: ['add'],
		measurement: ['add'],
		plant: ['edit']
	}),
	viewer: ac.newRole({ home: ['view'] }),
	sitter: ac.newRole({
		home: ['view'],
		care: ['log'],
		photo: ['add'],
		measurement: ['add']
	})
};

export type Role = keyof typeof roles;

type Statement = typeof statement;
export type Permission = {
	[R in keyof Statement]: `${R}:${Statement[R][number]}`;
}[keyof Statement];

export const PERMISSIONS = Object.entries(statement).flatMap(([resource, actions]) =>
	actions.map((action) => `${resource}:${action}`)
) as Permission[];

export function isRole(value: string): value is Role {
	return Object.hasOwn(roles, value);
}

/**
 * Whether `role` grants `permission`. Anything that isn't exactly one of the fixed roles grants
 * nothing, including BetterAuth's comma-separated lists of roles, which Chloris never writes.
 */
export function roleGrants(role: string, permission: Permission): boolean {
	if (!isRole(role)) return false;
	const [resource, action] = permission.split(':') as [keyof Statement, string];
	return roles[role].authorize({ [resource]: [action] }).success;
}
