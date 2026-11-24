# Security

Chloris is meant to be safe to put on the internet: households keep their plants, photos and care history in it, and several households can share one server. Thank you for helping keep it that way.

## Reporting a vulnerability

Please report it privately, through GitHub: on the repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/RACGriffiths/chloris/security/advisories/new)). Don't open a public issue or pull request for it.

It helps to include:

- what someone could do, and what they need first (an account, a role in a home, an invite link, access to the server);
- the steps to reproduce it, against a fresh install if possible;
- the version or commit you tested.

Chloris is maintained by one person in their spare time, so a reply may take a few days. Once the problem is confirmed, it is fixed in a new release, then the advisory is published, crediting you if you'd like.

## Supported versions

Fixes go into the latest release only. Upgrading is safe: the database is backed up before each migration.

## What counts

Anything that lets someone do more than their role allows, for example:

- seeing or changing another home's plants, photos, care log or members;
- doing something in a home their role doesn't allow (see the roles table in [docs/spec.md](docs/spec.md#roles-in-a-home));
- signing in as someone else, or getting round invite links, sign-in links, passkeys or the rate limits;
- a photo reaching someone outside its home, or keeping its location or other metadata;
- running script in someone else's browser.

Not in scope: anything that needs a shell on the server or its environment (the database file, `BETTER_AUTH_SECRET`), denial of service by sheer volume, and problems in a reverse proxy's own configuration. If the documentation leads people to an unsafe setup, though, please report that.

## How Chloris is built to be safe

[docs/spec.md](docs/spec.md#security-and-privacy) describes the design: home-scoped data access, permission checks on the server, passwordless sign-in, the Content Security Policy, rate limits and the audit log. [docs/security-review-v1.md](docs/security-review-v1.md) is the review done before version 1.0.0, with what it found and fixed.
