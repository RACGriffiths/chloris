# Chloris

A self-hosted plant care tracker for households: a care log, watering schedules and reminders, and a photo timeline for each plant.

Named after Chloris, the Greek nymph of flowers.

> **Status: version 1 is nearly ready.** Everything under [What it does](#what-it-does) works, but there is no release yet: no published Docker image and no install guide. Those come with the first release candidate. The [roadmap](docs/roadmap.md) shows what's left.

## What it does

- **Today view.** What needs doing, grouped by room. Logging a watering takes one tap, and a task due on several plants can be done for all of them at once.
- **Care log and schedules.** Water, feed, mist, prune, repot and treat pests. Each task's next due date is worked out from when it was last done. Care can be backdated or undone, and a task can be snoozed.
- **Photo timeline.** Photos of each plant in date order, with a cover photo. Photos are resized and stripped of their location and other metadata on upload, and only the home's members can see them.
- **Memorial.** Plants that died, were given away or were sold leave the daily views but stay viewable.
- **Shared homes.** Several people per home, invited by link, each with a role: owner, carer or viewer. Owners can see an audit log of who changed what.
- **Passwordless sign-in.** Passkeys, with one-time sign-in links as the fallback. There is no open sign-up.
- **Daily email digest.** One email a day per person, at a time they choose, with quiet hours. Email is optional.
- **Your data stays yours.** A SQLite file and a folder of photos, with a backup command and an integrity check.

**Coming in version 2:** web push and an installable app, measurements charted over time, side-by-side photo comparison, a time-limited plant sitter role, switching between homes, and full export. See the [roadmap](docs/roadmap.md) for the rest.

## Stack

SvelteKit (TypeScript, Node adapter), Tailwind CSS with shadcn-svelte, SQLite with Drizzle ORM, BetterAuth, sharp for images and Nodemailer for email. It runs as a single Node process or Docker container and needs no paid or provider-specific services. See [docs/spec.md](docs/spec.md#tech-stack) for the reasons behind each choice.

## Self-hosting

Until the first release, run Chloris from a clone of this repository. Install guides for an LXC and for Docker will come with the release candidate.

- One Node process or Docker container, configured by environment variables. [.env.example](.env.example) lists them, and [compose.example.yaml](compose.example.yaml) is a starting point for Docker Compose.
- Put an HTTPS reverse proxy in front of it (Caddy, a Cloudflare Tunnel or similar). Passkeys need a real domain with a valid certificate. Behind a proxy, set `ADDRESS_HEADER` and `XFF_DEPTH` as `.env.example` describes, so that sign-in rate limits count each visitor separately.
- The database and photos live in folders you choose, so photos can sit on a separate drive.
- Email (SMTP) is optional. Without it there's no daily digest, and the command-line tool prints one-time sign-in links: `node build/cli sign-in-link you@example.com`.
- Backups: `node build/cli backup /mnt/backups/chloris --keep 14`, from cron or a systemd timer, copies the database and then the photos into a new folder, linking photos already in the previous backup rather than copying them again. `node build/cli check` checks the database and that every photo's files are there.

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

[CLAUDE.md](CLAUDE.md) explains how the code is organised and the rules it follows, and lists the other commands: checks, tests, migrations. Chloris is developed with the help of [Claude Code](https://claude.com/claude-code), which reads the same file.

## Contributing

Bug reports and ideas are welcome as [issues](https://github.com/RACGriffiths/chloris/issues). Chloris is maintained by one person in their spare time, so please open an issue to talk a change through before starting a pull request. [docs/decisions.md](docs/decisions.md) records what's already settled, and why.

To report a security problem, please don't open an issue: [SECURITY.md](SECURITY.md) explains how to report it privately.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/spec.md](docs/spec.md) | What is being built: architecture, data model, features, security |
| [docs/decisions.md](docs/decisions.md) | Why: each design decision and its status |
| [docs/roadmap.md](docs/roadmap.md) | In what order: phased checklists |
| [CLAUDE.md](CLAUDE.md) | How the code is organised, the rules it follows, and the commands |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability privately |
| [docs/security-review-v1.md](docs/security-review-v1.md) | The security review before version 1.0.0: what it found and fixed |

## Licence

Copyright © 2026 RACGriffiths. Chloris is free software, licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).

You can use, change and host it, including for other people. If you distribute it, or run a modified version that other people use over a network, you must make your source code available to them under the same licence. Chloris's About page links to the source of the version running, so if you run a modified version, set `repository` in [package.json](package.json) to where you publish yours.
