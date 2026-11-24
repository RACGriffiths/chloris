# Chloris

A self-hosted plant care tracker for households. **Status:** Phase 0 (foundations) is done, and version 1 in [docs/roadmap.md](docs/roadmap.md) is under way: sign-in, homes, roles, invite links, and rooms and plants are in.

## Read first

- [docs/spec.md](docs/spec.md) is the source of truth for what is being built: architecture, configuration, data model, roles, features, security.
- [docs/decisions.md](docs/decisions.md) explains why. Don't reverse an **Agreed** decision without asking. **Proposed** ones can be challenged, but ask before changing them.
- [docs/roadmap.md](docs/roadmap.md) sets the order. Tick items off as they land.

## Stack

SvelteKit 3 (TypeScript strict, `@sveltejs/adapter-node`) · Tailwind CSS with shadcn-svelte (built on Bits UI) · SQLite (WAL) via better-sqlite3, with Drizzle ORM and drizzle-kit migrations · BetterAuth (passkey, magic link and organization plugins, Drizzle adapter) · Zod · sharp · croner · web-push · Nodemailer · @vite-pwa/sveltekit · Vitest · Playwright.

Use the current Node LTS (see `.nvmrc`) and npm. Dependabot handles dependency updates. Don't add a dependency without a clear reason; keep the list short.

npm blocks dependency install scripts unless `allowScripts` in `package.json` allows them. All are currently denied (better-sqlite3 and esbuild ship prebuilt binaries). Approve one with `npm install-scripts approve <package>` only after checking why it needs to run code at install time.

## Rules that must not be broken

1. **Home scoping.** Every domain table has a `home_id`. All reads and writes go through the data-access layer (`src/lib/server/data/`), whose functions take a `homeId`. Routes never query domain tables directly.
2. **Authorisation on the server.** Every load function, form action and API route that touches home data calls `can(user, homeId, permission)`. Never compare role names. Hiding a button in the UI is not security.
3. **Isolation tests.** Every new data-access function gets a test proving a member of another home can't read or change its data.
4. **Derived due dates.** When a task is next due is computed from the care log and its schedule. A cached value is fine only if it is always recomputed from the log.
5. **Photos.** Files are write-once, with new random names, and never overwritten. Deleting sets `deleted_at`; files go only after the grace period. Strip metadata and re-encode with sharp on upload. Serve photos only through a permission-checked route, never from `static/`.
6. **Configuration.** Environment variables only, validated with Zod at start-up (see the spec's Configuration table). No provider-specific services. SMTP and push must stay optional.
7. **Migrations.** Generate them with drizzle-kit. Never edit a migration that has already been applied. A Claude Code hook blocks edits to committed migrations, and CI fails if one changes.
8. **Phone first.** Pages render on the server. Forms are SvelteKit form actions with `use:enhance`, so they work before JavaScript loads.

## Layout

Folders marked *(v1)* don't exist yet.

```
src/
  env.ts          declares the environment variables for $app/env/private
  hooks.server.ts start-up (config, database, migrations, auth); per request: session, auth routes
  cli.ts          entry point of the command-line tool, built to build/cli
  lib/server/
    config.ts     config validation (Zod), free of SvelteKit imports
    db/           Drizzle schema, client, migrations (applied at start-up after a backup)
    data/         home-scoped queries, the only place that touches domain tables (add to it with
                  the data-access-function skill)
    auth/         BetterAuth setup, sign-in links, which auth endpoints the browser may reach
    permissions/  roles, can(), requirePermission()
    notify/       mailer (push in v2)
    cli.ts        the command-line tool's commands
    testing.ts    unit-test helpers: a fresh database per test, user and membership fixtures
    photos/       upload pipeline, storage, serving (v1)
    jobs/         scheduler, digests, photo clean-up (v1)
  lib/passkeys.ts     passkey sign-in and registration in the browser (load with await import())
  lib/rooms.ts, lib/plants.ts, lib/dates.ts
                      shared by server and pages: room and plant choices, their names on screen,
                      calendar dates
  lib/components/     the app's own components (plant form, room fields, plant tile)
  lib/components/ui/  shadcn-svelte components (add more with npx shadcn-svelte add <name>; it may
                      change package versions, so check package.json afterwards)
  routes/
    (entry)/      sign-in, sign-in links, invite links, adding a first passkey, creating a home
    (app)/        the signed-in app: the home page, plants, rooms, members and invites, the account
                  page
tests/            Playwright end-to-end tests (*.e2e.ts), with shared steps in helpers.ts
```

Folders in brackets are SvelteKit route groups: they share a layout but don't appear in URLs.

### Sign-in and permissions

- There is no open sign-up (D26). The first account comes from `node build/cli sign-in-link <email>`; later ones from invites. Only accounts the command-line tool made or allowed may create a home.
- Invite links (D28) are Chloris's own, in `#lib/server/data/invites.js`; only a hash of each token is stored. Someone without an account joins through `getAuth().api.joinWithInvite()` (`src/lib/server/auth/invites.ts`), a server-only BetterAuth endpoint that creates the account and membership in one transaction and signs it in. BetterAuth's `invitation` table is unused.
- The browser reaches only BetterAuth's passkey endpoints (D27, `src/lib/server/auth/http.ts`). Pages call the rest of BetterAuth on the server with `getAuth().api.*` and `authHeaders(event)`; homes and memberships change only through the data layer.
- `locals.user` is the signed-in user or `null`. In the signed-in app, start every load function and form action with `requireHome(locals, permission)` from `#lib/server/permissions/guard.js`: it returns the user and their home, and answers 404 to outsiders and 403 to members without the permission. Elsewhere, `requireUser(locals)` then `requirePermission(user, homeId, permission)` do the same in two steps.
- Read form fields with `textFields(form, schema.keyof().options)` from `#lib/server/forms.js`, check them with the data layer's Zod schema (`safeParse`, then `fieldErrors()` for the messages), and pass the same raw values to the data function, which parses them itself.

Unit tests sit next to the code as `*.spec.ts`. ESLint stops `src/routes/` from importing the database (rule 1).

### SvelteKit 3

Much SvelteKit material online describes version 2. In this project:

- `src/lib` is imported as `#lib/...` (a Node subpath import), not `$lib`. The path needs the file's extension as `.js`, even for `.ts` files: `#lib/server/config.js`, `#lib/server/db/index.js`.
- Environment variables are declared in `src/env.ts` and imported from `$app/env/private`; `$env/*` is deprecated. Chloris reads them only in `hooks.server.ts` and passes them to `parseConfig()`. Elsewhere, call `getConfig()`.
- There is no `svelte.config.js`; SvelteKit options go in `vite.config.ts`.
- Return `Response.json(...)` from endpoints; the `json()` helper is deprecated.
- `resolve()` from `$app/paths` takes a pathname *without* a leading slash (`resolve('account')`, `resolve('')` for the root), or a route ID *with* one, including route groups (`resolve('/(app)/account')`). Use pathnames.
- `invalidateAll` is now `refreshAll`, also as a `goto()` option.
- Hook types such as `ServerInit` and `Handle` come from `@sveltejs/kit/hooks`.

### Pitfalls found so far

- `use:enhance`'s default `update()` resets the form, clearing server-rendered choices such as a selected radio button. Call `update({ reset: false })` where a choice should stay. Straight after `await update()`, read the action's data from the callback's `result.data`, not the `form` prop.
- When one table is dropped and another added in the same change, `drizzle-kit generate` asks whether it was renamed, and hangs without a terminal. Split the change into two migrations.
- BetterAuth's Drizzle adapter throws on a required column it doesn't know in its own tables: declare new ones in `additionalFields` (`src/lib/server/auth/index.ts`). Its organisation plugin won't start without the `invitation` table, so that table stays.
- Pages with a token in the URL send `Referrer-Policy: strict-origin`, not `no-referrer`. With `no-referrer`, a form posted before JavaScript loads carries `Origin: null`, which SvelteKit refuses as cross-site.
- Adding a passkey needs a session less than a day old (BetterAuth's fresh-session rule).
- In end-to-end tests, wait for the next page after `useLink()` (such as the Welcome heading) before navigating, or the sign-in POST is aborted. Chrome's virtual authenticator accepts passkey autofill at once, so to test the sign-in button, stub `PublicKeyCredential.isConditionalMediationAvailable` to return false (see `tests/auth.e2e.ts`).
- ESLint's `no-unsafe-assignment` rejects `expect.any(String)`. Use `toMatchObject` and leave that field out.
- Work built in a worktree can add dependencies. After merging it, run `npm install` in the main checkout, or svelte-check reports missing modules such as `better-auth/api`.
- Svelte removes the `value` and `checked` attributes the server rendered once the page hydrates, so a form reset (what `use:enhance`'s `update()` does after a successful action) empties fields instead of returning them to their first values. Where a radio button should come back checked after a reset, use `defaultChecked`; the server still renders it as `checked` (see `room-fields.svelte`).
- SvelteKit refuses a `default` action on a page that also has named actions, with a 500 (`action_default_with_named`). Name them all, and post to `?/name`.
- Data functions take raw input and parse it themselves. Where a schema transforms values (enums, `''` to `null`), `parsed.data` has a different type from the input, so pass the raw values instead.
- `resolve()` takes a query string too: ``resolve(`plants?room=${id}`)``. The `svelte/no-navigation-without-resolve` rule accepts any expression typed as `resolve()`'s result, so a helper that builds links should return `resolve(...)`.
- ESLint's type-aware rules can't see types exported from a `.svelte` file's `<script module>` (they become `error` types), even though svelte-check can. Put shared types in a `.ts` file.
- In Playwright, `getByLabel` and `getByRole({ name })` match substrings: "Kitchen" also finds "Edit Kitchen", and "Name" finds "Room name". Use `exact: true`. After a click that navigates, wait for something on the next page before filling a field or reading the URL, or the step acts on the old page.

## Commands

First time: `npm install`, `cp .env.example .env` and set `BETTER_AUTH_SECRET`, and `npx playwright install chromium` for the end-to-end tests. To sign in locally, run `npm run build` and `npm run cli -- sign-in-link you@example.com`, then open the link with `npm run dev` running (the link uses `ORIGIN`).

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on http://localhost:5173, reading `.env` |
| `npm run build` | Production build into `build/`, with the command-line tool in `build/cli` |
| `npm start` | Runs the production build (`node build`), reading `.env` if present |
| `npm run cli -- sign-in-link <email>` | Prints a one-time sign-in link, creating the account if needed (after `npm run build`) |
| `npm run check` | Type-check with svelte-check |
| `npm run lint` | Prettier check, then ESLint |
| `npm run format` | Format everything with Prettier |
| `npm run test:unit` | Vitest in watch mode; add `-- --run` for a single run |
| `npm run test:e2e` | Builds, starts `node build` with a fresh database, runs Playwright on a phone-sized screen |
| `npm test` | Unit tests, then end-to-end tests |
| `npm run db:generate` | Creates a migration from changes to `src/lib/server/db/schema.ts` |
| `npm run db:check` | Checks the migrations for conflicts |
| `npm run db:studio` | Browses the database in `DATA_DIR` |

Migrations are applied by the app when it starts, after backing up the database to `$DATA_DIR/backups`. There is deliberately no `db:migrate` or `db:push`.

Docker: `docker build -t chloris .`, or copy `compose.example.yaml` to `compose.yaml` and follow its comments.

## Claude Code plugins

[.claude/settings.json](.claude/settings.json) enables these for anyone working on the project. Claude Code offers to install them when the folder is trusted.

- **svelte** (Svelte's official plugin): the Svelte docs over MCP, Svelte 5 skills, and the Svelte language server. The language server needs `npm install -g svelte-language-server`.
- **auth-skills** (Better Auth's official skills): setting up BetterAuth and following its best practices.
- **security-guidance** (Anthropic): warns about risky patterns as code is written, and has a model review each turn's diff and each commit. The reviews count towards your Claude usage.

It also registers a hook, [.claude/hooks/protect-migrations.mjs](.claude/hooks/protect-migrations.mjs), that blocks edits to migrations already committed.

The project's own skills are in `.claude/skills/`. Claude Code uses one when the work calls for it, or start it by name with a slash:

- **data-access-function** ([SKILL.md](.claude/skills/data-access-function/SKILL.md)): adding or changing a function in the data-access layer, with home scoping, the `can()` check in each route that calls it, and the isolation test. `rooms.ts` and `plants.ts` in `src/lib/server/data/` are the fullest real examples.

Also worth having, but installed per person rather than here, so they don't clash with copies enabled account-wide: a TypeScript language server plugin (`typescript-lsp@claude-plugins-official`, which needs `npm install -g typescript-language-server typescript`) and `frontend-design@claude-plugins-official`, which is the one to use when designing screens.

## Working style

- Small, focused commits with clear messages.
- If a change alters a design decision, update `docs/spec.md` and `docs/decisions.md` in the same commit.
- Tick roadmap items when they are done.
