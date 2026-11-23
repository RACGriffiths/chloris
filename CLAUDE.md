# Chloris

A self-hosted plant care tracker for households. **Status:** Phase 0 (foundations) is done; version 1 in [docs/roadmap.md](docs/roadmap.md) is next.

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
  hooks.server.ts start-up: validate config, open the database, migrate
  lib/server/
    config.ts     config validation (Zod), free of SvelteKit imports
    db/           Drizzle schema, client, migrations (applied at start-up after a backup)
    data/         home-scoped queries, the only place that touches domain tables (v1)
    auth/         BetterAuth setup (v1)
    permissions/  roles, permissions, can() (v1)
    photos/       upload pipeline, storage, serving (v1)
    jobs/         scheduler, digests, photo clean-up (v1)
    notify/       push and mailer (v1)
  lib/components/ui/  shadcn-svelte components (add more with npx shadcn-svelte@latest add <name>)
  routes/
tests/            Playwright end-to-end tests (*.e2e.ts)
```

Unit tests sit next to the code as `*.spec.ts`. ESLint stops `src/routes/` from importing the database (rule 1).

### SvelteKit 3

Much SvelteKit material online describes version 2. In this project:

- `src/lib` is imported as `#lib/...` (a Node subpath import), not `$lib`. The path needs the file's extension as `.js`, even for `.ts` files: `#lib/server/config.js`, `#lib/server/db/index.js`.
- Environment variables are declared in `src/env.ts` and imported from `$app/env/private`; `$env/*` is deprecated. Chloris reads them only in `hooks.server.ts` and passes them to `parseConfig()`. Elsewhere, call `getConfig()`.
- There is no `svelte.config.js`; SvelteKit options go in `vite.config.ts`.
- Return `Response.json(...)` from endpoints; the `json()` helper is deprecated.
- Hook types such as `ServerInit` and `Handle` come from `@sveltejs/kit/hooks`.

## Commands

First time: `npm install`, `cp .env.example .env` and set `BETTER_AUTH_SECRET`, and `npx playwright install chromium` for the end-to-end tests.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on http://localhost:5173, reading `.env` |
| `npm run build` | Production build into `build/` |
| `npm start` | Runs the production build (`node build`), reading `.env` if present |
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

Also worth having, but installed per person rather than here, so they don't clash with copies enabled account-wide: a TypeScript language server plugin (`typescript-lsp@claude-plugins-official`, which needs `npm install -g typescript-language-server typescript`) and `frontend-design@claude-plugins-official`, which is the one to use when designing screens.

## Working style

- Small, focused commits with clear messages.
- If a change alters a design decision, update `docs/spec.md` and `docs/decisions.md` in the same commit.
- Tick roadmap items when they are done.
