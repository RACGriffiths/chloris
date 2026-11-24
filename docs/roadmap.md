# Roadmap

Tick items as they land. Items can move between phases. If a move changes a decision, record it in [decisions.md](decisions.md).

Version 1 already uses the multi-home data model, so version 2 adds screens rather than database migrations.

## Phase 0: Foundations

- [x] Scaffold SvelteKit with TypeScript (strict) and the Node adapter, using npm
- [x] Tailwind CSS and shadcn-svelte
- [x] ESLint, Prettier and svelte-check
- [x] Vitest and Playwright
- [x] Drizzle with SQLite (better-sqlite3) in WAL mode; migrations run at start-up after a backup
- [x] Claude Code hook that blocks edits to migrations already committed
- [x] Load and validate configuration (Zod) for the variables in the [spec](spec.md#configuration)
- [x] Dockerfile and an example Compose file
- [x] GitHub Actions CI: type-check, lint, test, build the image
- [x] Dependabot for dependency updates, with minor and patch updates grouped weekly

## Version 1: useful every day, in one home

- [x] BetterAuth: magic-link sign-in (no open sign-up, D26), passkeys and sessions; a CLI one-time sign-in link for when email is off
- [x] Multi-home data model (homes and memberships), with one home in the UI
- [x] Fixed roles and the `can()` permission helper, with tests that try to cross between homes
- [x] Invite links: copyable, single use, expiring, carrying a role
- [x] Claude Code skill for adding a data-access function (home scoping, `can()` check, isolation test), written once the first few exist
- [x] Rooms and plants: create, edit, list, plant page
- [x] Care log (events, backdating, undo) and schedules (intervals, snooze, recheck delay)
- [x] Today view, including bulk actions
- [x] Photo pipeline: browser resize, metadata stripping, sharp variants, write-once storage, permission-checked serving
- [x] Photo timeline on the plant page, and cover photos
- [x] Memorial and lifecycle statuses
- [x] Daily email digest: scheduler, digest log, quiet hours
- [x] Backup command and integrity check, and removing deleted photos' files after the grace period (D51)
- [ ] Security baseline: CSP, rate limits, audit log
- [ ] Install guides for an LXC and for Docker
- [ ] Release workflow: on a version tag, build the Docker image for x86 and ARM and publish it to GitHub's container registry
- [ ] About page with the version and a source-code link (AGPL)

## Version 2: sharing and push

- [ ] Web push and the installable app (PWA)
- [ ] Measurements and charts
- [ ] Sending invites by email, and switching between homes
- [ ] Sitter role with expiry
- [ ] Winter intervals
- [ ] QR labels for pots
- [ ] Export and import
- [ ] Activity feed
- [ ] Photo compare view, and the previous photo as a camera overlay
- [ ] Per-user data export and account deletion

## Later

- [ ] Propagation family tree
- [ ] Suggested intervals from care history
- [ ] Private calendar feed (iCal)
- [ ] Sensor API, e.g. for Home Assistant
- [ ] Photo time-lapse
- [ ] Assigning a plant or room to one person
- [ ] Offline logging
- [ ] Optional S3-compatible photo storage
