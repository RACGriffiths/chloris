import { describe, expect, it } from 'vitest';
import { PERMISSIONS, roleGrants, roles, type Permission, type Role } from './roles';

/** The table in docs/spec.md (Roles in a home). If this test changes, the spec changes too. */
const SPEC: Record<Permission, Role[]> = {
	'home:view': ['owner', 'carer', 'viewer', 'sitter'],
	'care:log': ['owner', 'carer', 'sitter'],
	'photo:add': ['owner', 'carer', 'sitter'],
	'measurement:add': ['owner', 'carer', 'sitter'],
	'plant:edit': ['owner', 'carer'],
	'home:configure': ['owner', 'carer'],
	'member:manage': ['owner'],
	'home:update': ['owner'],
	'home:export': ['owner'],
	'home:delete': ['owner']
};

describe('roles', () => {
	it('are the four fixed roles', () => {
		expect(Object.keys(roles).sort()).toEqual(['carer', 'owner', 'sitter', 'viewer']);
	});

	it('cover exactly the permissions in the spec', () => {
		expect([...PERMISSIONS].sort()).toEqual(Object.keys(SPEC).sort());
	});

	for (const [permission, allowed] of Object.entries(SPEC) as [Permission, Role[]][]) {
		it(`grant ${permission} to ${allowed.join(', ')} only`, () => {
			for (const role of Object.keys(roles) as Role[]) {
				expect(roleGrants(role, permission), role).toBe(allowed.includes(role));
			}
		});
	}

	it('grant nothing to anything other than exactly one fixed role', () => {
		for (const role of ['', 'admin', 'member', 'Owner', 'owner,carer', ' owner', '__proto__']) {
			for (const permission of PERMISSIONS) {
				expect(roleGrants(role, permission), `${role}: ${permission}`).toBe(false);
			}
		}
	});
});
