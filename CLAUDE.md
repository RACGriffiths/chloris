# Chloris

A self-hosted plant care tracker for households. **Status:** design done, no code yet. The next work is Phase 0 in [docs/roadmap.md](docs/roadmap.md).

## Read first

- [docs/spec.md](docs/spec.md) is the source of truth for what is being built: architecture, configuration, data model, roles, features, security.
- [docs/decisions.md](docs/decisions.md) explains why. Don't reverse an **Agreed** decision without asking. **Proposed** ones can be challenged, but ask before changing them.
- [docs/roadmap.md](docs/roadmap.md) sets the order. Tick items off as they land.

## Stack

SvelteKit (TypeScript strict, `@sveltejs/adapter-node`) · Tailwind CSS with shadcn-svelte or Bits UI · SQLite (WAL) with Drizzle ORM and drizzle-kit migrations · BetterAuth (passkey, magic link and organization plugins, Drizzle adapter) · Zod · sharp · croner · web-push · Nodemailer · @vite-pwa/sveltekit · Vitest · Playwright.

Use the current Node LTS. Don't add a dependency without a clear reason; keep the list short.

## Rules that must not be broken

1. **Home scoping.** Every domain table has a `home_id`. All reads and writes go through the data-access layer (`src/lib/server/data/`), whose functions take a `homeId`. Routes never query domain tables directly.
2. **Authorisation on the server.** Every load function, form action and API route that touches home data calls `can(user, homeId, permission)`. Never compare role names. Hiding a button in the UI is not security.
3. **Isolation tests.** Every new data-access function gets a test proving a member of another home can't read or change its data.
4. **Derived due dates.** When a task is next due is computed from the care log and its schedule. A cached value is fine only if it is always recomputed from the log.
5. **Photos.** Files are write-once, with new random names, and never overwritten. Deleting sets `deleted_at`; files go only after the grace period. Strip metadata and re-encode with sharp on upload. Serve photos only through a permission-checked route, never from `static/`.
6. **Configuration.** Environment variables only, validated with Zod at start-up (see the spec's Configuration table). No provider-specific services. SMTP and push must stay optional.
7. **Migrations.** Generate them with drizzle-kit. Never edit a migration that has already been applied.
8. **Phone first.** Pages render on the server. Forms are SvelteKit form actions with `use:enhance`, so they work before JavaScript loads.

## Planned layout

```
src/lib/server/
  config.ts       env loading and validation
  db/             Drizzle schema, client, migrations
  data/           home-scoped queries (the only place that touches domain tables)
  auth/           BetterAuth setup
  permissions/    roles, permissions, can()
  photos/         upload pipeline, storage, serving
  jobs/           scheduler, digests, photo clean-up
  notify/         push and mailer
src/lib/components/
src/routes/
tests/            Playwright end-to-end tests
```

## Commands

Not scaffolded yet. After Phase 0, list the commands here: dev, build, check, lint, format, unit tests, end-to-end tests, generating and applying migrations.

## Claude Code plugins

[.claude/settings.json](.claude/settings.json) enables these for anyone working on the project. Claude Code offers to install them when the folder is trusted.

- **svelte** (Svelte's official plugin): the Svelte docs over MCP, Svelte 5 skills, and the Svelte language server. The language server needs `npm install -g svelte-language-server`.
- **auth-skills** (Better Auth's official skills): setting up BetterAuth and following its best practices.
- **security-guidance** (Anthropic): warns about risky patterns as code is written, and has a model review each turn's diff and each commit. The reviews count towards your Claude usage.

Also worth having, but installed per person rather than here, so they don't clash with copies enabled account-wide: a TypeScript language server plugin (`typescript-lsp@claude-plugins-official`, which needs `npm install -g typescript-language-server typescript`) and `frontend-design@claude-plugins-official`, which is the one to use when designing screens.

## Working style

- Small, focused commits with clear messages.
- If a change alters a design decision, update `docs/spec.md` and `docs/decisions.md` in the same commit.
- Tick roadmap items when they are done.
