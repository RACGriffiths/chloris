---
name: data-access-function
description: Add or change a function in src/lib/server/data/ that reads or writes a home's data (rooms, plants, care events, schedules, photos, measurements, members, invites), together with the can() check in every route that calls it and the test proving another home can't reach it. Use whenever a page, form action or API route needs domain data, a domain table is added, or a data-access function is written, changed or reviewed.
argument-hint: '[what the function should do]'
---

# Adding a data-access function

Chloris keeps each household's data away from every other household on the same server. Three rules in CLAUDE.md make that hold, and every data-access function must satisfy all three:

1. **Home scoping.** The function lives in `src/lib/server/data/`, takes a `homeId`, and every statement it runs is limited to that home.
2. **Authorisation on the server.** Every load function, form action and API route that calls it checks the permission for that home first, with `requireHome()` or `requirePermission()` (both use `can()`).
3. **Isolation test.** A test proves that, given another home's id, the function reads nothing and changes nothing.

Work through the steps in order. The real code to copy from is `src/lib/server/data/rooms.ts` and `plants.ts` (creating, listing, getting and changing rows, and checking a plant's room is in the same home), their tests in `rooms.spec.ts` and `plants.spec.ts`, and the routes under `src/routes/(app)/plants/` and `src/routes/(app)/rooms/`. `invites.ts` and the members page show a link that works once. `care-events.ts` and `schedules.ts` show functions that read the home's time zone and take `now`, and a value worked out from the log each time rather than stored (rule 4). `photos.ts` shows an async function that writes files before its row, checking the plant again inside the transaction, reads that leave out deleted rows, and changes only the author may make unless they have a second permission (`PhotoEditor`, D40).

Before starting, read the table's row in docs/spec.md (Data model) and the feature's section, so the fields and behaviour match the spec.

## 1. Choose the permission

Each function belongs to one permission from the spec's roles table (Roles in a home), defined in `statement` in `src/lib/server/permissions/roles.ts`:

| The function...                                       | Permission                       |
| ----------------------------------------------------- | -------------------------------- |
| reads anything in a home                              | `home:view`                      |
| logs care, snoozes a task or records a check          | `care:log`                       |
| adds a photo or a measurement                         | `photo:add`, `measurement:add`   |
| adds, edits or memorialises a plant                   | `plant:edit`                     |
| manages rooms, schedules or measurement types         | `home:configure`                 |
| changes the home's name, time zone or winter months   | `home:update`                    |
| invites or removes members, or changes their roles    | `member:manage`                  |
| exports or deletes the home                           | `home:export`, `home:delete`     |

If none fits, stop and ask. A new permission changes the spec's roles table and D15 (Agreed); it goes in `statement` and the roles in `roles.ts`, and in `SPEC` in `roles.spec.ts`. Never check a role name instead.

## 2. Add the table, if there is a new one

In `src/lib/server/db/schema.ts`:

- Give it a `home_id`, required, referencing `home.id` with `onDelete: 'cascade'`, and an index on it (see `invite`). Rows that also belong to a plant (care events, schedules, photos, measurements) still carry their own `home_id`, so every query is scoped the same way.
- Use `text('id').primaryKey()`, filled with `randomUUID()`, and the file's `createdAt()`, `updatedAt()` and `timestamp()` helpers for times.
- Don't store what can be derived. When a task is next due comes from the care log and its schedule (rule 4).

Then run `npm run db:generate` and commit the schema and the new migration together. The app applies migrations at start-up; there is no `db:migrate`. Never edit a committed migration (a hook blocks it). If drizzle-kit asks whether a table was created or renamed, it is waiting for an answer it can't get without a terminal: split the change so one migration drops and the next adds.

BetterAuth's tables (user, session, account, verification, passkey, home, membership, invitation) are different: BetterAuth checks their shape at runtime and throws on a required column it doesn't know, so declare new ones in `additionalFields` in `src/lib/server/auth/index.ts`.

## 3. Write the function

In `src/lib/server/data/<resource>.ts`. The examples here are a simplified `rooms.ts`; the real one also refuses a name the home already has.

```ts
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getConnection } from '../db';
import { room } from '../db/schema';

export interface Room {
	id: string;
	name: string;
}

/** What a person fills in to add or rename a room. */
export const roomInput = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Give the room a name.')
		.max(60, 'Keep the name to 60 characters or fewer.')
});

export type RoomInput = z.input<typeof roomInput>;

const columns = { id: room.id, name: room.name };

/**
 * Adds a room to `homeId`. Callers check `can(user, homeId, 'home:configure')` first. Throws a
 * `ZodError` if the input is invalid.
 */
export function createRoom(homeId: string, input: RoomInput): Room {
	const { name } = roomInput.parse(input);
	return getConnection()
		.db.insert(room)
		.values({ id: randomUUID(), homeId, name })
		.returning(columns)
		.get();
}

/** The rooms in `homeId`, oldest first. Callers check `can(user, homeId, 'home:view')` first. */
export function listRooms(homeId: string): Room[] {
	return getConnection()
		.db.select(columns)
		.from(room)
		.where(eq(room.homeId, homeId))
		.orderBy(asc(room.createdAt), asc(room.id))
		.all();
}

/** One room in `homeId`, or `null` if it has none with that id. */
export function getRoom(homeId: string, roomId: string): Room | null {
	const row = getConnection()
		.db.select(columns)
		.from(room)
		.where(and(eq(room.id, roomId), eq(room.homeId, homeId)))
		.get();
	return row ?? null;
}

/**
 * Renames a room in `homeId`, returning whether there was one to rename. Callers check
 * `can(user, homeId, 'home:configure')` first. Throws a `ZodError` if the input is invalid.
 */
export function renameRoom(homeId: string, roomId: string, input: RoomInput): boolean {
	const { name } = roomInput.parse(input);
	const { changes } = getConnection()
		.db.update(room)
		.set({ name })
		.where(and(eq(room.id, roomId), eq(room.homeId, homeId)))
		.run();
	return changes > 0;
}
```

What makes it safe:

- **`homeId` is in every statement's `where`.** Update and delete with `and(eq(t.id, id), eq(t.homeId, homeId))`, never by id alone. Ids reach the server in URLs and forms, so anyone can send another home's.
- **Ids that point at other rows are checked.** When the input names another record (a plant's room or parent plant, a care event's plant, a cover photo, a measurement type), look it up with `homeId`, in the same transaction as the write, and refuse if it isn't there. A foreign key proves only that the row exists somewhere, not that it is in this home:

  ```ts
  /** Adds a plant to a room in `homeId`; `null` if the home has no such room. */
  export function createPlant(homeId: string, input: PlantInput): Plant | null {
  	const { nickname, roomId } = plantInput.parse(input);
  	return getConnection().db.transaction((tx) => {
  		const inHome = tx
  			.select({ id: room.id })
  			.from(room)
  			.where(and(eq(room.id, roomId), eq(room.homeId, homeId)))
  			.get();
  		if (!inHome) return null;
  		return tx
  			.insert(plant)
  			.values({ id: randomUUID(), homeId, roomId, nickname })
  			.returning(plantColumns)
  			.get();
  	});
  }
  ```

- **Joins between domain tables match `home_id` too**, as a second guard: `innerJoin(room, and(eq(room.id, plant.roomId), eq(room.homeId, plant.homeId)))`. Joins to `user` or `home` don't need it.
- **"Not found" and "another home's" look the same.** Return `null` from reads and `false` from writes, so the route answers 404 either way. When a person can cause more than one kind of refusal, return a union like `JoinResult` in `invites.ts`. Throw only for invalid input (`ZodError`) and for bugs.
- **The doc comment names the permission** the caller checks. The function doesn't call `can()` itself: the route does, because it has the user.

The other conventions:

- Return chosen columns through an exported interface, not whole rows. Give lists a fixed order (`createdAt`, then `id`), so tests can compare them with `toEqual`.
- Input is an exported Zod schema named `<thing>Input`, parsed inside the function with `.parse()`. Write its messages for the person filling in the form ("Give the room a name."): routes show them as they are.
- Anything that depends on the clock takes `now = new Date()` as its last parameter, so tests can fix the time.
- Drizzle is synchronous here: `.get()`, `.all()` and `.run()` on `getConnection().db`, with no `await`.
- Statements that must happen together go in `db.transaction((tx) => ...)`. If the transaction reads something and then acts on it (a link that works once), pass `{ behavior: 'immediate' }` so it takes the write lock before reading, as `acceptInvite` does.
- Rows with a `deleted_at` (photos) are left out of every read, except a function whose job is to find them.
- A function that can't take a `homeId` (an invite used by its token; the homes a user belongs to) is rare. Its doc comment says what decides the home instead and why there is no `can()` check. Ask before adding one.

## 4. Call it from a route

Every load function and every form action that calls the function checks the permission itself. A form action is its own POST request, which anyone can send without loading the page, so a check in `load` doesn't protect it.

```ts
import { error, fail, redirect } from '@sveltejs/kit';
import { getRoom, roomInput, updateRoom } from '#lib/server/data/rooms.js';
import { fieldErrors, textFields } from '#lib/server/forms.js';
import { requireHome } from '#lib/server/permissions/guard.js';
import { can } from '#lib/server/permissions/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const { user, home } = requireHome(locals, 'home:view');
	const room = getRoom(home.id, params.roomId);
	if (!room) error(404, 'Not found');
	return { room, canEdit: can(user, home.id, 'home:configure') };
};

export const actions = {
	save: async ({ locals, params, request }) => {
		const { home } = requireHome(locals, 'home:configure');
		const values = textFields(await request.formData(), roomInput.keyof().options);
		const parsed = roomInput.safeParse(values);
		if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });
		const result = updateRoom(home.id, params.roomId, values);
		if (!result.ok && result.reason === 'not-found') error(404, 'Not found');
		if (!result.ok) {
			return fail(400, { values, errors: { name: 'There is already a room with that name.' } });
		}
		redirect(303, '/rooms');
	}
} satisfies Actions;
```

- `requireHome()` (in `#lib/server/permissions/guard.ts`) finds the signed-in user's home and calls `requirePermission()`, which stops the request: 404 for someone outside the home, so they learn nothing about it, and 403 for a member without the permission. Use `can()` only to decide what the page shows (`canEdit`). Hiding a button is not security.
- The home comes from the user's memberships, never from the form or the URL. Ids that do come from them (`params.roomId`) go to the data function along with `home.id`; `null`, `false` or a `not-found` result means 404.
- Read fields with `textFields()`, check them with the schema's `safeParse()`, and return `fail(400, ...)` with the values and `fieldErrors()` so the form can be shown again. Then pass the same raw values to the data function, which parses them itself: where the schema transforms values, `parsed.data` doesn't have the input's type.
- A page with named actions can't also have a `default` one: SvelteKit answers 500.
- `src/routes/` can't import `#lib/server/db` or `drizzle-orm`: ESLint refuses it (rule 1).

## 5. Write the isolation tests

In `src/lib/server/data/<resource>.spec.ts`, next to the code. Every function gets at least one test that sets up a second home and proves nothing crosses between them:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { insertUser, useTestDatabase } from '../testing';
import { createHome } from './homes';
import { createRoom, getRoom, listRooms, renameRoom } from './rooms';

useTestDatabase();

/** Two homes with an owner each. */
let aliceHome: string;
let bobHome: string;

beforeEach(() => {
	const alice = insertUser('alice@example.com', { canCreateHome: true });
	const bob = insertUser('bob@example.com', { canCreateHome: true });
	aliceHome = createHome(alice, { name: "Alice's flat", timeZone: 'Europe/London' }).id;
	bobHome = createHome(bob, { name: "Bob's house", timeZone: 'Europe/Paris' }).id;
});

describe('listRooms', () => {
	it("lists only the home's own rooms, never another's", () => {
		const kitchen = createRoom(aliceHome, { name: 'Kitchen' });
		const study = createRoom(bobHome, { name: 'Study' });

		expect(listRooms(aliceHome)).toEqual([kitchen]);
		expect(listRooms(bobHome)).toEqual([study]);
	});
});

describe('getRoom', () => {
	it("knows nothing of another home's room", () => {
		const kitchen = createRoom(aliceHome, { name: 'Kitchen' });

		expect(getRoom(aliceHome, kitchen.id)).toEqual(kitchen);
		expect(getRoom(bobHome, kitchen.id)).toBeNull();
	});
});

describe('renameRoom', () => {
	it("can't rename another home's room", () => {
		const kitchen = createRoom(aliceHome, { name: 'Kitchen' });

		expect(renameRoom(bobHome, kitchen.id, { name: 'Taken' })).toBe(false);

		expect(getRoom(aliceHome, kitchen.id)).toEqual(kitchen);
	});
});
```

What each kind of function needs:

| Function                   | Isolation test                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Lists                      | Rows in both homes; each home's list holds only its own.                                                         |
| Gets one by id             | The other home's id gives `null`.                                                                                |
| Creates                    | The new row is in its own home's list and not in the other's.                                                    |
| Updates or deletes         | Called with the other home's id, it returns `false` or `null`, and reading the row back shows it unchanged.      |
| Takes ids of other rows    | An id from the other home is refused, and nothing is written.                                                    |

For the last row, with `createPlant` above:

```ts
it("won't put a plant in another home's room", () => {
	const study = createRoom(bobHome, { name: 'Study' });

	expect(createPlant(aliceHome, { nickname: 'Fern', roomId: study.id })).toBeNull();

	expect(listPlants(aliceHome)).toEqual([]);
	expect(listPlants(bobHome)).toEqual([]);
});
```

Test the function's own behaviour too: the schema's messages, the order of lists, and anything that depends on `now`, passed in explicitly.

- `useTestDatabase()` gives each test a fresh, migrated database. `insertUser()` and `addMember()` in `src/lib/server/testing.ts` add users, other roles and expired memberships; add a fixture there when a test needs a state no data function creates yet.
- ESLint's `no-unsafe-assignment` rejects `expect.any(String)`. Use `toMatchObject` and leave that field out.
- When a new page has actions that some roles can't use, an end-to-end test that one of those members gets 403 is worth adding (see `tests/invites.e2e.ts`).

## 6. Check

```bash
npm run test:unit -- --run src/lib/server/data
```

```bash
npm run check
```

```bash
npm run lint
```

Before calling it done:

- [ ] The function takes `homeId`, and every `where` and domain-table join includes it.
- [ ] Ids of other rows in the input are checked against `homeId`.
- [ ] The doc comment names the permission the caller checks.
- [ ] Every load function and form action that calls it uses `requireHome()` or `requirePermission()` with that permission first.
- [ ] Each function has an isolation test with a second home, reading rows back after a refused write.
- [ ] A new table has `home_id` and an index on it, and its migration is generated and committed with the schema.
- [ ] docs/spec.md is updated if the data model or permissions changed, and docs/decisions.md if a decision did.
