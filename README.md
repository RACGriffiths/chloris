# Chloris

A self-hosted plant care tracker for households: a care log, watering schedules and reminders, photo timelines and growth measurements.

Named after Chloris, the Greek nymph of flowers.

> **Status: early development.** The foundations are in place, but the app doesn't do anything useful yet. The [design spec](docs/spec.md), [decision log](docs/decisions.md) and [roadmap](docs/roadmap.md) describe what is being built.

## What it will do

- **Today view.** What needs doing, grouped by room. Logging a watering takes one tap.
- **Care log and schedules.** Water, feed, repot, prune, mist, pest treatment. Each task's next due date is worked out from when it was last done.
- **Photo timeline.** Photos of each plant in date order, with side-by-side comparison.
- **Measurements.** Track height, leaf count or anything else, charted over time.
- **Memorial.** Plants that died, were given away or were sold leave the daily views but stay viewable.
- **Shared homes.** Several people per home, with roles: owner, carer, viewer and time-limited plant sitter.
- **Passwordless login.** Passkeys, with magic links as the fallback.
- **Reminders.** One daily digest per person, by web push or email.
- **Your data stays yours.** A SQLite file and a folder of photos, with full export.

## Stack

SvelteKit (TypeScript, Node adapter), Tailwind CSS with shadcn-svelte, SQLite with Drizzle ORM, BetterAuth, sharp for images, Web Push and SMTP via Nodemailer. It runs as a single Node process or Docker container and needs no paid or provider-specific services. See [docs/spec.md](docs/spec.md#tech-stack) for the reasons behind each choice.

## Self-hosting (planned)

- One Node process or Docker container, configured by environment variables.
- Put an HTTPS reverse proxy in front of it (Caddy, a Cloudflare Tunnel or similar). Passkeys and push notifications need a real domain with a valid certificate.
- The database and photos live in folders you choose, so photos can sit on a separate drive.
- Email (SMTP) is optional. Without it there's no daily digest, and the command-line tool prints one-time sign-in links: `node build/cli sign-in-link you@example.com`.

[.env.example](.env.example) lists the settings, and [compose.example.yaml](compose.example.yaml) is a starting point for Docker Compose. Install guides will follow with version 1.

## Development

You need the current Node LTS (see [.nvmrc](.nvmrc)).

```sh
npm install
cp .env.example .env   # then set BETTER_AUTH_SECRET
npm run dev            # http://localhost:5173
```

There is no sign-up page. To make the first account, build the app and print a one-time sign-in link, then open it:

```sh
npm run build
npm run cli -- sign-in-link you@example.com
```

[CLAUDE.md](CLAUDE.md#commands) lists the other commands: checks, tests, migrations.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/spec.md](docs/spec.md) | What is being built: architecture, data model, features, security |
| [docs/decisions.md](docs/decisions.md) | Why: each design decision and its status |
| [docs/roadmap.md](docs/roadmap.md) | In what order: phased checklists |

## Licence

Copyright © 2026 RACGriffiths. Chloris is free software, licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).

You can use, change and host it, including for other people. If you distribute it, or run a modified version that other people use over a network, you must make your source code available to them under the same licence.
