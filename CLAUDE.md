# Chloris

A self-hosted plant care tracker for households. **Status:** Phase 0 (foundations) is done, and version 1 in [docs/roadmap.md](docs/roadmap.md) is under way: sign-in, homes, roles, invite links, rooms and plants, the care log and schedules, the Today view, the photo pipeline, the photo timeline with cover photos, the Memorial (lifecycle statuses), the daily email digest with its scheduler, the backup command, integrity check and removal of deleted photos, and the security baseline (Content Security Policy, rate limits, audit log) are in.

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
  hooks.server.ts start-up (config, database, migrations, auth, background jobs); per request:
                  security headers, session, auth routes (passkeys only, within rate limits)
  cli.ts          entry point of the command-line tool, built to build/cli
  lib/server/
    config.ts     config validation (Zod), free of SvelteKit imports
    db/           Drizzle schema, client, migrations (applied at start-up after a backup); the
                  command-line tool opens it with openExistingDatabase(), which never migrates
    data/         home-scoped queries, the only place that touches domain tables (add to it with
                  the data-access-function skill)
    auth/         BetterAuth setup, sign-in links, which auth endpoints the browser may reach
    permissions/  roles, can(), requirePermission()
    notify/       mailer, and the daily digest email (push in v2)
    cli.ts        the command-line tool's commands: sign-in-link, backup, check, log
    backup/       the backup command and the integrity check (D52, D53)
    security/     security headers (the CSP itself is in vite.config.ts), rate limits, and
                  recording the audit log and the server's own log (D55 to D58)
    testing.ts    unit-test helpers: a fresh database per test, user and membership fixtures
    photos/       checking and resizing uploads with sharp, write-once storage, the missing-photo
                  placeholder (the data layer's photos.ts is what calls them)
    jobs/         croner scheduler: the daily digest job, run only when email is on, and the
                  hourly job removing deleted photos after the grace period (D54)
  lib/passkeys.ts     passkey sign-in and registration in the browser (load with await import())
  lib/rooms.ts, lib/plants.ts, lib/care.ts, lib/dates.ts, lib/photos.ts, lib/exif.ts,
  lib/notifications.ts, lib/audit.ts
                      shared by server and pages: room, plant and care choices (including what
                      happened to a plant in the Memorial), their names on screen, calendar
                      dates and times in the home's time zone, photo sizes and limits, reading
                      the date a photo was taken from its EXIF data, the digest's defaults and
                      quiet hours, the audit log's actions and how they read
  lib/photo-upload.ts resizing a photo in the browser before upload (load with await import())
  lib/photo-field.ts  for a form that sends a photo: swaps in the resized copy, loading
                      photo-upload.ts only once a photo is sent
  lib/components/     the app's own components (plant form, room fields, plant tile, care schedule,
                      log care form, schedule fields, due task)
  lib/components/ui/  shadcn-svelte components (add more with npx shadcn-svelte add <name>; it may
                      change package versions, so check package.json afterwards)
  routes/
    (entry)/      sign-in, sign-in links, invite links, adding a first passkey, creating a home
    (app)/        the signed-in app: the Today view (the home page), plants, each photo's page
                  (plants/[plantId]/photos/[photoId]), the Memorial (plants/memorial) and the form
                  that moves a plant there (plants/[plantId]/memorialise), rooms, members and
                  invites, the audit log (members/audit), the account page and its Notifications page (account/notifications),
                  and photos/[photoId]/[size], which serves photo files
tests/            Playwright end-to-end tests (*.e2e.ts), with shared steps in helpers.ts, and
                  mailbox.ts, a pretend mail server for the second test server, which has email on
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
- Times people see and type are in the home's time zone, not the server's: use `calendarDate()`, `zonedTime()` and `formatMoment()` from `#lib/dates.js`, and format on the server in `load`, so the page doesn't change when it hydrates. Due dates are calendar dates (D31).
- `SubmitFunction`, the type of a `use:enhance` callback, comes from `$app/forms` in SvelteKit 3, not `@sveltejs/kit`. shadcn-svelte's `buttonVariants` is exported from a `.svelte` file, so ESLint rejects it (see above): to style a `<summary>` as a button, write the classes out.
- A `<details>` element opens without JavaScript, so it holds the optional parts of the plant page (Snooze, Log other care, the confirmation for removing care). In Playwright, click its `summary`; an open one has `open=""`, which is falsy, so compare `getAttribute('open')` with `null`.
- A `min` or `max` on a date field stops the browser from sending a value outside it, so an end-to-end test of the server's own check has to post the form directly (`post()` in `tests/helpers.ts`).
- Playwright's `toHaveText` reads text hidden with `aria-hidden`, such as a plant tile's initial inside a plant's link, so match the name with a regular expression there. The home page's heading is "Today": wait for it with `expectHome(page, name)` from `tests/helpers.ts`.
- To log a task on several plants, a form repeats a hidden field (`plantId`) and the action reads it with `textList()` from `#lib/server/forms.js`. Two submit buttons in one form can each send their own `name` and `value` (Done or "Not needed"), with or without JavaScript.
- drizzle-kit leaves `ON DELETE` off a foreign key it adds to an existing table with `ALTER TABLE ... ADD`, though its snapshot records it. Add it to the generated migration by hand before committing (see `0004_photos.sql`).
- The Node adapter refuses a request over `BODY_SIZE_LIMIT` only when the body is read: `request.formData()` throws an error with `status` 413. Catch it in the action to show a message (the plant page's `addPhoto`). `npm run dev` has no limit.
- sharp's `metadata()` already enforces `limitInputPixels`, so read the header with `limitInputPixels: false` and check the size yourself, then decode with the limit.
- `resolve()` gives relative paths in server-rendered pages (`../photos/<id>/thumb`): in Playwright, read them with `new URL(src, page.url())`. Playwright can't read a request body holding a file; `watchUploads()` in `tests/photos.e2e.ts` keeps a copy in the page instead.
- A plant tile is `aria-hidden`, so Playwright's `getByRole('img')` can't see its photo: read it with `locator('img')` instead.
- Tailwind's `line-clamp-*` works by setting `display: -webkit-box`, so `block` on the same element undoes it and nothing is cut off. Leave `block` out; the clamp makes the element a block already.
- A result type whose failure has a union of reasons (`reason: 'not-found' | 'in-the-future'`) can't be narrowed one reason at a time, so a field on another failure (`acquiredOn`) can't be read after `error(404)` on `not-found`. Give each reason its own variant, as `MemorialiseResult` does.
- In Playwright, `getByLabel` and `getByRole({ name })` match substrings: "Kitchen" also finds "Edit Kitchen", and "Name" finds "Room name". Use `exact: true`. After a click that navigates, wait for something on the next page before filling a field or reading the URL, or the step acts on the old page.
- SvelteKit types a page's `form` as every action's result merged, each key optional, so `'values' in form` doesn't narrow it. Read `form?.values ?? data.values`, as the other pages do.
- Zod's `.superRefine()` keeps an object schema an object, so `.keyof()` still lists its fields for `textFields()`. `.transform()` on the whole object doesn't: check fields across each other with `superRefine` and turn the values into what's stored in the data function.
- When an unconfirmed account uses a sign-in link, BetterAuth confirms the address and ends all its other sessions (`revokeUnprovenAccountAccess`). The Notifications page warns of this before sending one (D50).
- The digest job and other background work act for no one signed in, so they can't use `requireHome()`. They call `can({ id: userId }, homeId, permission, now)` for each person they act for, and only `listHomeIds()` in `homes.ts` reads across homes. Work that acts for no person at all (removing deleted photos, the backup and the check) still goes home by home through data functions that take a `homeId`, whose doc comments say why there's no `can()`.
- A SQLite database in WAL mode copied without its `-wal` file can be missing everything since the last checkpoint. Playwright stops the test servers without closing the database, so `test-results/e2e-data/chloris.db` on its own may have no tables at all: copy the `-wal` file with it, or use `npm run cli -- backup`.
- Rows created at the same `now` are ordered by their random ids, so a test that checks the order of a list needs them created at different times.
- The end-to-end tests run two copies of the app: the usual one with email off, and one with email on (`emailOrigin` in `tests/server-env.ts`) whose mail `readMail()` reads back. In a test for the second, `test.use({ baseURL: emailOrigin })` doesn't reach a page from `newPhone()`: pass `baseURL` to it, and `emailServerEnv` to `newOwner()` and `signInLink()`.
- A form field hidden with CSS is still sent with the form, so `required` on it stops the browser submitting while it's hidden. The Notifications page hides fields with `group-has-[...]:hidden` and leaves the checking to the server.
- The Content Security Policy (`csp` in `vite.config.ts`, D55) lets no inline script run except SvelteKit's own: no `<script>` in `app.html` without `nonce="%sveltekit.nonce%"`, no `onclick="..."` attributes, no `eval`. Images, fonts, fetches and forms may only use the app's own origin, plus `data:` and `blob:` images; anything else has to be added there. `npm run dev` allows inline styles, so a style blocked only in production shows up in `tests/security.e2e.ts`, which fails on any violation the browser reports.
- Rate limits (D56) are counted in memory, per visitor. The end-to-end test servers set `ADDRESS_HEADER`, so a request without `X-Forwarded-For` comes from one shared visitor: every test's failed sign-ins add up there, and over 20 in 15 minutes would lock out the rest of the run. A test that sets out to hit a limit gives its page an address of its own with `newPhone(browser, testInfo, { extraHTTPHeaders: { 'x-forwarded-for': ... } })`.
- Record an audit entry (D57) in the form action, once the change has worked, with `audit(event, home.id, user.id, { action, targetId, detail })` from `#lib/server/security/audit.js`. Read what the details need, such as a room's name, before deleting it. Something done to an account rather than a home (a sign-in, a passkey) goes through `auditAccount()`, which puts it in the server's log with where it came from and in each of the person's homes without (D58). Sign-ins and new passkeys are recorded by BetterAuth's after-hook (`src/lib/server/auth/audit.ts`), which runs for `getAuth().api.*` calls as well as the browser's; `ctx.context.newSession` is set once one signed someone in. A sign-in that fails goes through `signInFailed()`, which counts it towards the limit and logs it.
- Running the server and running a home are separate (D58): a home's roles never reach the server's log, and the server admin coming in version 2 gets no access inside homes. The server's log (`#lib/server/data/server-log.js`) is the one table besides the account tables with no `home_id`; only the command-line tool reads it.
- Rows written in the same millisecond can't be told apart by time. Where their order matters, as in the audit log, order by `rowid` after the time: SQLite gives every row one, in the order rows were added.

## Commands

First time: `npm install`, `cp .env.example .env` and set `BETTER_AUTH_SECRET`, and `npx playwright install chromium` for the end-to-end tests. To sign in locally, run `npm run build` and `npm run cli -- sign-in-link you@example.com`, then open the link with `npm run dev` running (the link uses `ORIGIN`).

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on http://localhost:5173, reading `.env` |
| `npm run build` | Production build into `build/`, with the command-line tool in `build/cli` |
| `npm start` | Runs the production build (`node build`), reading `.env` if present |
| `npm run cli -- sign-in-link <email>` | Prints a one-time sign-in link, creating the account if needed (after `npm run build`) |
| `npm run cli -- backup <folder>` | Backs up the database, then the photos, into a new folder in `<folder>`, which must exist; `--keep <n>` removes the oldest |
| `npm run cli -- check` | Checks the database, and its photos against the photo folder; changes nothing |
| `npm run cli -- log` | Prints the server's own log: sign-ins with where they came from, failed sign-ins, rate limits used up (D58) |
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
