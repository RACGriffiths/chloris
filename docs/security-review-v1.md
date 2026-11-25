# Security review before version 1.0.0

A review of the whole codebase as it stood on `main` at `d20ea89` (version 1, item 14), before the repository goes public and v1.0.0 is tagged. It checks the code against the spec's [Security and privacy](spec.md#security-and-privacy) section and the rules in `CLAUDE.md`. The spec names the two biggest risks: one home seeing another's data, and photos leaking someone's location.

**Result.** No way was found for one home to read or change another's data, and photos are served only after a permission check, with their metadata stripped. The one serious finding is an account takeover set up in advance through an invite link (finding 1), fixed on this branch. Four smaller issues are fixed too. The rest are recommendations, and three of them are questions for the owner.

**Follow-up.** A review of the fixes themselves once merged (`d20ea89..ce1456e`) found three more issues, all fixed: findings 10 to 12. All three questions are answered: D50 is Agreed, and questions 2 and 3 are done.

Line numbers point at `main` before this branch, unless a finding says otherwise.

## Findings, most severe first

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | Medium | A passkey added to an invite-made account under someone else's address survives once they prove it | Fixed |
| 2 | Medium (setup) | Behind a tunnel and then Caddy, every visitor shares one set of rate limits, so anyone can lock out every sign-in | Documented; install guide to follow |
| 3 | Low | Several large photos decoded at once can use up a small server's memory | Fixed; see finding 11 |
| 4 | Low | `node build/cli log` prints what people typed with control characters intact | Fixed |
| 5 | Low | Folders Chloris makes for its data can be read by other users on the host | Fixed |
| 6 | Low | The server's log grows without limit, and visitors who aren't signed in can add to it | Fixed: kept for 90 days |
| 7 | Low | After finding 1's fix, the real owner of the address is still a member of the home the squatter joined | Warning added; the rest is for version 2 |
| 8 | Info | The Docker image ships 75 development packages, including drizzle-kit and its old esbuild | Fixed |
| 9 | Info | Smaller observations | Notes |
| 10 | Low | A passkey sign-in at the moment a sign-in link proves the address keeps its session | Fixed (follow-up) |
| 11 | Low | One progressive JPEG or interlaced PNG can take far more memory than finding 3 measured | Fixed (follow-up) |
| 12 | Info | `node build/cli log` let three text-direction marks through | Fixed (follow-up) |

### 1. A passkey added under someone else's address survives once they prove it (Medium, fixed)

**Where.** `src/lib/server/data/invites.ts:225` (`joinWithNewAccount`) makes an account for whatever address the person with the invite link types, unproven (`emailVerified: false`, line 241), as D28 intends. `src/routes/(entry)/welcome/+page.svelte` then offers them a passkey. When a sign-in link later proves the address, BetterAuth's `revokeUnprovenAccountAccess` (`node_modules/better-auth/dist/db/revoke-unproven-account-access.mjs`) ends the account's sessions and deletes its linked accounts, but passkeys belong to the passkey plugin, and it leaves them alone. `src/routes/(entry)/sign-in/link/+page.server.ts:45` then sends the real owner to `/` rather than offering a passkey, because the account already has one.

**How it could be used.**

1. Mallory has an invite link to any home on the server: one sent to her, one forwarded, or one that leaked.
2. She opens it, types `alice@example.com` (someone she expects to use the server later, who has no account yet), joins, and adds a passkey.
3. Later Alice needs an account. Whoever runs the server runs `node build/cli sign-in-link alice@example.com --can-create-home`, which finds the existing account (`src/lib/server/auth/sign-in-link.ts:44`, line 61) and says only "an existing account". Or Alice is invited to another home, is told "There is already an account for this address. Sign in, then open this link again", and asks for a sign-in link by email.
4. Alice signs in with the link. Her address is now proven, and she creates her home or joins the other one.
5. Mallory signs in with her passkey, as Alice, as an owner or member of Alice's home.

**Fix.** `src/lib/server/auth/unproven.ts` (new) is a BetterAuth database hook. When a sign-in link proves an account's address for the first time, it removes the passkeys added before and records each in the audit log ("lost a passkey (…) added before their email address was confirmed"). BetterAuth sets `emailVerified` on that path only when the address wasn't proven before, so a verified account's passkeys are never touched. Alice is then offered a passkey of her own. The Notifications page, which sends such a link to confirm an address (D50), now says this happens.

**Tests.** `src/lib/server/auth/auth.spec.ts` ("an address proven by a sign-in link") covers the command-line tool's link and an emailed one, and checks that a verified account keeps its passkeys. `tests/invites.e2e.ts` ("a passkey added under someone else's address stops working once they prove it") runs the whole attack with a virtual authenticator. Both fail without the fix.

**Decision.** This changes D50, a Proposed decision: someone who joined by invite and confirms their address now has to add their passkey again. `docs/decisions.md`, `docs/spec.md` (Login) and `CLAUDE.md` are updated. See question 1 below.

### 2. Behind a tunnel and then Caddy, every visitor shares one set of rate limits (Medium, setup)

**Where.** Rate limits are keyed on `event.getClientAddress()` (`src/lib/server/security/rate-limit.ts:113`). The Node adapter takes the address from `ADDRESS_HEADER`, counting `XFF_DEPTH` entries from the right. The spec and `.env.example` recommend `X-Forwarded-For` and `1` behind one Caddy, which is right for Caddy alone. But Caddy doesn't trust an incoming `X-Forwarded-For` unless `trusted_proxies` says to: it replaces it with the address of whatever connected to it. Behind a Cloudflare Tunnel (cloudflared) and then Caddy, that is cloudflared, for every visitor. If the header goes missing, every such request falls into one `'unknown'` key (line 118).

**How it could be used.** Anyone on the internet makes 20 failed sign-ins in 15 minutes: invented sign-in links, invented invite links, or passkey attempts. `limits.failedSignIn` then refuses every sign-in from the shared key (`src/hooks.server.ts:122` for passkeys, and the sign-in link and invite pages), which is everyone, and they can repeat it every 15 minutes. People already signed in are unaffected. The start-up warning (D56) only covers `ADDRESS_HEADER` being unset, so this goes unnoticed.

**Fix.** This is a setup problem, not a code one, and the right values depend on the proxy chain. `.env.example` and the spec's Configuration table now say that Caddy must trust the tunnel. The install guides (the next roadmap item) should show a working configuration for Caddy alone, a tunnel then Caddy, and a tunnel alone, and how to check it: `node build/cli log` should show visitors' own addresses. Using `CF-Connecting-IP` instead is safe only if nothing but the tunnel can reach Caddy and the app.

### 3. Several large photos decoded at once can use up a small server's memory (Low, fixed)

**Where.** `src/lib/server/photos/process.ts:75` (`processPhoto`). The comment at line 13 says photos are processed one at a time, but nothing made them wait: each upload decoded at once, and sharp runs up to four at a time on libuv's thread pool.

**How it could be used.** Anyone with `photo:add` (owners, carers and sitters) uploads PNGs of 100 megapixels in 16-bit colour, within the 100-megapixel and 20 MB limits (D35). One such file compresses to 1.2 MB. Measured with sharp 0.35 on this pipeline, the process peaked at 263 MB of memory for one decode, taking 5.7 seconds, and at 840 MB for four at once. That is enough to have a 512 MB or 1 GB container or LXC killed for running out of memory. The upload limit (60 in 10 minutes per person, D56) doesn't stop several arriving together.

**Fix.** Uploads now take turns (`oneAtATime()` in `process.ts`), so only one photo is decoded at a time. Type sniffing and the byte limit still answer at once. An upload can now wait behind others: one person sending many large photos slows other people's uploads rather than stopping the server. Tested in `process.spec.ts` ("oneAtATime").

**Corrected since.** The PNG measured here was read a strip at a time. A file sharp must decode whole takes far more, even on its own: see finding 11.

### 4. `node build/cli log` prints what people typed with control characters intact (Low, fixed)

**Where.** `src/lib/server/cli.ts:300`. The server's log holds text people choose, above all a passkey's name, which is whatever the browser sends to `/api/auth/passkey/verify-registration`. `src/lib/server/auth/audit.ts:49` records it, and `log` printed it as it was.

**How it could be used.** A signed-in person names a passkey `Phone\x1b[2K\r…`. When whoever runs the server reads the log, the terminal acts on the escape sequence: it can wipe and rewrite the line, move up and overwrite earlier lines, change the window title, or, in some terminals, write to the clipboard. That could hide failed sign-ins or a limit being reached.

**Fix.** `printable()` in `cli.ts` shows control characters, and those that reverse the direction of text, as escapes (`\x1b`, `‮`) before printing. Tested in `cli.spec.ts`.

### 5. Folders Chloris makes for its data can be read by other users on the host (Low, fixed)

**Where.** `src/lib/server/db/index.ts:49` (the data folder), `src/lib/server/db/migrate.ts:65` (backups before migrating), `src/lib/server/photos/storage.ts:23` (the default photo folder) and `Dockerfile:22` (`/data`) were made with the default mode, usually `0755`, so the database file (`0644`) could be read by any user on the host. D52 already makes the backup command's folders private for this reason.

**How it could be used.** On an LXC or VM shared with other services or users, any local account can copy `chloris.db`: every home's plants, notes, members' names and email addresses, and the IP addresses in the audit and server logs. Session cookies are signed with `BETTER_AUTH_SECRET`, so the database alone doesn't give sessions away.

**Fix.** Folders Chloris makes itself are now `0700` (`PRIVATE_FOLDER` in `src/lib/server/db/paths.ts`), and the Docker image's `/data` too. A `PHOTOS_DIR` the host made is left as it is: the host may back it up as another user. Existing installs keep their current modes: `chmod 700` the data folder by hand. Tested in `db.spec.ts` and `storage.spec.ts`.

### 6. The server's log grows without limit, and visitors who aren't signed in can add to it (Low, question)

**Where.** `signInFailed()` (`src/lib/server/security/audit.ts:58`) writes a `server_event` row for each failed sign-in (`src/lib/server/data/server-log.ts:38`). D58 says the log is never changed once written, and nothing removes old rows.

**How it could be used.** Each visitor can add 20 rows per 15 minutes before the limit stops them. Someone with many addresses (a /48 of IPv6 holds 65,536 /64s, each counted separately) can add hundreds of thousands of rows of up to about 600 bytes an hour, slowly filling the database's disk. BetterAuth's passkey endpoints also store a challenge per request (60 a minute per visitor), in the `verification` table.

**Recommendation.** Keep the server's log for a fixed time (90 days, say), removed by the hourly job, and remove expired `verification` rows there too. That changes D58 (Proposed): see question 2.

**Done since.** An hourly job (`src/lib/server/jobs/expired.ts`) removes entries older than 90 days (`SERVER_LOG_DAYS`) and expired `verification` rows. BetterAuth does remove expired verification rows itself, but only when it next looks one up (at most once a minute), and asking for a passkey challenge looks none up, so they could still pile up while nobody signs in. D58 and the spec are updated. Tested in `src/lib/server/jobs/expired.spec.ts`.

### 7. The real owner of the address stays a member of the squatter's home (Low, version 2)

**Where.** Finding 1's fix removes the squatter's passkeys, but not the membership they joined with: in the legitimate case (D50), that membership is the person's own. `listHomesForUser` lists the oldest membership first (`src/lib/server/data/homes.ts:99`), and the UI shows only the first home (D14).

**What happens.** In finding 1's story, once Alice signs in she sees Mallory's home, not the one she was invited to, and she can't leave it, since leaving a home doesn't exist yet. Mallory, if an owner there, sees when Alice signs in (not where from: D58). No data of Alice's reaches Mallory.

**Recommendation.** Version 2's switching between homes should list every membership and let someone leave a home.

**Done since.** `node build/cli sign-in-link` now warns when it prints a link for an existing account whose address isn't confirmed and which is already in a home, which only an invite link makes ("Its address isn't confirmed: it was made from an invite link, and it's in 1 home."), so whoever runs the server can check with the person before handing it over. Tested in `cli.spec.ts`.

### 8. The Docker image ships development packages (Info, fixed)

**Where.** `Dockerfile:9` runs `npm prune --omit=dev`. npm keeps a development package that a production package names as an optional peer, marked `devOptional` in the lockfile. better-auth names many: drizzle-kit, SvelteKit, Vite and more. So the image held 75 packages the server never loads, among them drizzle-kit and the esbuild 0.18 behind `npm audit --omit=dev`'s moderate advisory (GHSA-67mh-4wv8-2f99, about esbuild's development server, which nothing runs).

**Fix.** The build stage now removes every `devOptional` package after pruning, and the commands they leave in `node_modules/.bin`. The built server imports only better-auth, @better-auth/passkey, better-sqlite3, croner, drizzle-orm, nodemailer, sharp and zod (checked with es-module-lexer over `build/`), and a `devOptional` package can't be a required dependency of a production one. The image shrank from 458 MB to 381 MB (`node_modules` from 217 MB to 137 MB). The new image was checked by hand: it starts and migrates, `/api/health` answers, a sign-in link from `node build/cli sign-in-link` signs in over HTTP, `node build/cli log` reads the log, and sharp encodes an image.

`npm audit --omit=dev` still reports the advisory, because npm reads the lockfile, not the image. It stays in development, where drizzle-kit only generates migrations.

### 9. Smaller observations (Info)

- **Passkey names have no length limit.** BetterAuth accepts any string, which goes in the `passkey` table and both logs. Only someone signed in can do it, within 60 requests a minute. Consider refusing a `verify-registration` body over a few kilobytes in `passkeyEndpoint()` (`src/hooks.server.ts`).
- **Asking for a sign-in link takes slightly longer when the address has an account** (`src/routes/(entry)/sign-in/+page.server.ts:34`: a token is made and stored). The difference is under a millisecond, and the limit of 3 requests per address every 15 minutes leaves too few samples to tell.
- **The rate limiter forgets the oldest keys after 10,000** (`rate-limit.ts:35`, line 76). Someone with very many addresses can push their own lockout out. That is no worse than using a fresh address each time, and the tokens are far too long to guess: about 182 bits for a sign-in link, 256 for an invite.
- **Invites outlive their maker's role.** An invite made by an owner who is later removed or demoted still works. When removing members and changing roles arrive (version 2), cancel the person's pending invites at the same time.
- **Signed-in pages aren't marked `no-store`.** After signing out on a shared device, the browser's back button can show pages from its cache. Photos are `private` (`photos/[photoId]/[size]/+server.ts:35`), so shared caches such as a CDN in front don't keep them. Consider `Cache-Control: private, no-store` on pages for signed-in people.
- **A link that leaks within its lifetime is enough.** Sign-in links and invite links are bearer tokens by design (D19, D28). They appear in the proxy's access log if it keeps one: whoever runs the proxy can read them anyway.

### 10. A passkey sign-in at the moment a sign-in link proves the address keeps its session (Low, fixed)

Findings 10 to 12 come from the follow-up review of the fixes. Line numbers point at `ce1456e`.

**Where.** BetterAuth's `revokeUnprovenAccountAccess` (`node_modules/better-auth/dist/db/revoke-unproven-account-access.mjs`) deletes the account's sessions, then sets `emailVerified`, which runs finding 1's hook, which deletes the passkeys (`src/lib/server/auth/unproven.ts:38`). Each step awaits the database, so other requests can run between them.

**How it could be used.** In finding 1's story, if Mallory finishes a passkey sign-in after the sessions are deleted but before the passkeys are, her new session survives: nothing deletes sessions again. Sessions last 30 days and are renewed daily. The gap is a few milliseconds, Mallory can't see when Alice opens her link, and the passkey limit (60 requests a minute per visitor, two per sign-in) makes hitting it by repeated tries very unlikely, but not impossible.

**Fix.** The hook deletes the account's sessions again once the passkeys are gone. BetterAuth runs the hook straight away, since that path isn't in a transaction, and makes the session for the person using the link only afterwards, so theirs is kept. Tested in `auth.spec.ts` ("ends a session the passkey started while BetterAuth was ending the others"), which signs in between the two steps and fails without the fix.

### 11. One progressive JPEG or interlaced PNG can take far more memory than finding 3 measured (Low, fixed)

**Where.** `src/lib/server/photos/process.ts`, `decode()`; the limit `MAX_PHOTO_PIXELS` in `src/lib/photos.ts`.

**What was missed.** sharp reads a baseline JPEG, a WebP or an ordinary PNG a strip at a time, shrinking as it goes. A progressive JPEG or an interlaced (Adam7) PNG can't be read that way: it is held whole while it decodes. Measured with sharp 0.35 on this pipeline, as the peak memory of the whole process (about 60 MB of it is Node and sharp themselves):

| 100 megapixels | Peak | 60 megapixels | Peak |
| --- | --- | --- | --- |
| Baseline JPEG, 4:4:4 | 156 MB | PNG, 16-bit, not interlaced | 197 MB |
| WebP, lossy or lossless | 145 MB | Progressive JPEG, 4:2:0 | 274 MB |
| PNG, 16-bit, not interlaced | 213 MB | Interlaced PNG, 8-bit | 279 MB |
| Progressive JPEG, 4:2:0 | 396 MB | Progressive JPEG, 4:4:4 | 450 MB |
| Interlaced PNG, 8-bit | 404 MB | Interlaced PNG, 16-bit | 475 MB |
| Progressive JPEG, 4:4:4 | 690 MB | | |
| Interlaced PNG, 16-bit | 946 MB | | |

So one upload, compressing to a few megabytes, could stop a 512 MB or 1 GB container or LXC on its own, with uploads taking turns or not. Lowering the limit to 60 megapixels (question 3) wasn't enough by itself.

**Fix.** The limit is now 60 megapixels, and a file sharp must decode whole is refused if, by its header, it would hold more than 200 MB (`MAX_HELD_BYTES`, `heldWhole()`): two bytes a channel for each pixel of a progressive JPEG, one or two for an interlaced PNG. That allows any such file of 8-bit colour up to 50 to 60 megapixels and one of 16-bit colour up to about 33. At those limits the peaks measured were 274 MB to 306 MB. Phone cameras save neither kind of file, and once JavaScript has loaded the browser sends an ordinary JPEG of 2560 pixels anyway, so the limits only touch an original sent before it loads. The page shows the existing "too many pixels" message. Tested in `process.spec.ts` ("refuses a file that must be decoded whole if it would hold too much memory"). D35 and the spec are updated.

### 12. `node build/cli log` let three text-direction marks through (Info, fixed)

**Where.** `UNPRINTABLE` in `src/lib/server/cli.ts:334`, from finding 4's fix, escaped the characters that override or isolate the direction of text, but not the marks U+200E, U+200F and U+061C, which can still move punctuation and numbers around them. They now show as escapes too. Tested in `cli.spec.ts`.

The rest of the fixes were found sound: `oneAtATime()` moves on after a task that failed; the hook acts only on the sign-in link's path and only when the address was unproven, which the test of a verified account guards; the private folders and the Dockerfile's removal of `devOptional` packages do what finding 5 and finding 8 say; and the warning from `sign-in-link` shows nothing anyone typed.

## Checked and found sound

### Who may do what

Every load function, form action and endpoint under `src/routes/` was read. Each signed-in page calls `requireHome()` with the permission the spec's roles table gives for what it does, in the load function and in every action. Actions that change someone's own records check authorship in the data layer as well (D32, D40).

| Route | Load | Actions |
| --- | --- | --- |
| `(app)/` (Today) | `requireUser` + `requirePermission('home:view')` | `log`, `undo`: `care:log`; undo only one's own care |
| `(app)/plants`, `plants/memorial` | `home:view` | — |
| `plants/new` | `plant:edit` | `create`: `plant:edit`; `room`: `home:configure` |
| `plants/[plantId]` | `home:view` | `log`: `care:log`, and `photo:add` when a photo comes with it; `undo`: `care:log`, own care only; `snooze`, `unsnooze`: `care:log`; `addPhoto`: `photo:add`; `restore`: `plant:edit` |
| `plants/[plantId]/edit`, `…/memorialise` | `plant:edit` | `plant:edit` |
| `plants/[plantId]/schedules/new`, `…/[scheduleId]` | `home:configure` | `home:configure` |
| `plants/[plantId]/photos/[photoId]` | `home:view` | `cover`: `plant:edit`; `save`, `delete`: `photo:add`, and own photos only unless `plant:edit` (D40) |
| `photos/[photoId]/[size]` (GET) | `home:view` | — |
| `rooms` | `home:view` | `create`: `home:configure` |
| `rooms/[roomId]/edit` | `home:configure` | `save`, `delete`: `home:configure` |
| `members`, `members/audit` | `member:manage` | `create`, `cancel`: `member:manage` |
| `account` | `requireUser`; BetterAuth lists only the person's own passkeys and sessions | `deletePasskey`, `revokeSession`: checked against that list first |
| `account/notifications` | `home:view` | `save`, `confirm`: `home:view`, the person's own settings and address only |
| `(entry)/homes/new` | `requireUser` + `canCreateHome()` + no home yet (D26) | the same |
| `(entry)/invite/[token]` | the token; opening counts towards failed sign-ins | `join`: `requireUser` + the token; `create`: signed out + the token |
| `(entry)/welcome` | `requireUser` | — |
| `(entry)/sign-in`, `sign-in/link`, `api/health` | public, within rate limits | — |

Someone outside the home gets a 404 and a member without the permission a 403 (`requirePermission`), so outsiders learn nothing. `can()` grants nothing to an expired membership or a role name that isn't exactly one of the four.

### Home scoping

Every function in `src/lib/server/data/` that reads or writes a home's data takes a `homeId` and filters on it, including both sides of every join (a plant's room, an event's plant, a photo's care event, the cover-photo subqueries) and every id that comes from a request: plant, room, schedule, photo and care event ids in the address or a form field, the `plantId` lists of "Water all" and the `eventId` lists of Undo. `setCoverPhoto` checks the photo belongs to that plant in that home and isn't deleted. Each such function has a test showing another home's member can't read or change its data (`*.spec.ts` next to each file). The exceptions are documented and deliberate: `listHomeIds()` for background jobs, `listPhotoFiles()` and `purgeDeletedPhotos()` for the backup, the check and the deletion job (each still home by home), and the server's log, which belongs to no home (D58).

### Signing in

- **The browser reaches only the four passkey endpoints** (`src/lib/server/auth/http.ts`): an allow-list on the exact path, so trailing slashes, other encodings and SvelteKit's `__data.json` suffix all get a 404 or reach no endpoint. `joinWithInvite` is also `SERVER_ONLY`. A visitor's own `x-chloris-client-address` header is dropped.
- **Sign-in links.** BetterAuth makes a 32-letter token (about 182 bits), stores only its SHA-256 (`storeToken: 'hashed'`), uses it up in one atomic step (`consumeVerificationValue`), and lets it work for 15 minutes. Opening the link only shows a button; the POST is checked for its origin by SvelteKit. `disableSignUp` means a link for an address without an account signs no one in, and the sign-in page sends none anyway.
- **Invite links.** 32 random bytes, stored as SHA-256 and looked up by the hash, so the lookup's timing reveals nothing about the token. Using one takes SQLite's write lock first (`behavior: 'immediate'`), so it works only once. Invites expire after 7 days, and only owners make, see and cancel them.
- **Sessions.** HTTP-only, SameSite=Lax cookies, `Secure` (with the `__Secure-` prefix) when `ORIGIN` is HTTPS; 30 days, renewed daily. Adding a passkey needs a session less than a day old. Revoking a session or passkey checks it is the person's own first.
- **The audit hook** (`src/lib/server/auth/audit.ts`) records only successful sign-ins (`ctx.context.newSession`) and passkeys that were added, and skips errors.
- **Confirming an address (D50).** Only a sign-in link proves an address. It ends the account's other sessions, now removes passkeys added before (finding 1), and the digest goes only to a proven address.

### Photos

- Uploads are limited to 20 MB, judged JPEG, PNG or WebP by their first bytes, and checked again against sharp's own reading of the header. HEIC, SVG, TIFF, GIF and anything else are refused before sharp decodes them.
- The header's size is checked against 100 megapixels before decoding, and the decode is held to the same limit (`limitInputPixels`), so a file can't claim to be smaller than it is. `failOn: 'error'` refuses damaged files.
- Re-encoding from raw pixels drops all metadata: EXIF (including GPS), XMP, IPTC and colour profiles. The date taken is read first, and only the date.
- Files are named `PHOTOS_DIR/<home id>/<random UUID>-<size>.jpg` from values in the database, checked against `^[\w-]+$` before use, so no path can leave the folder. They are created exclusively (`wx`) and flushed before the row is written.
- `photos/[photoId]/[size]` serves a file only for a photo in the person's own home that isn't deleted, as `image/jpeg` with `nosniff`, `private, max-age=31536000, immutable`. The placeholder for a missing file is an SVG with `default-src 'none'` and `no-store`.
- The deletion job removes files and rows home by home, only for photos deleted before the grace period began, and checks again before removing each row.

### Headers, CSP and forms

- The CSP (`vite.config.ts`, D55) allows scripts only from the app, with SvelteKit's per-page nonce; no `unsafe-inline` or `unsafe-eval` for scripts; `object-src`, `base-uri` and `frame-ancestors` are `'none'`; `form-action` is `'self'`. No page uses `{@html}`, `innerHTML` or `eval`. The digest email escapes everything people typed (`escapeHtml` in `src/lib/server/notify/digest.ts`).
- Every response gets `nosniff`, `Referrer-Policy: same-origin` (`strict-origin` on pages with a token), `Cross-Origin-Opener-Policy: same-origin`, a `Permissions-Policy` turning off location, microphone, payments and USB, and HSTS for two years when `ORIGIN` is HTTPS (`src/lib/server/security/headers.ts`).
- SvelteKit's origin check on form posts is left on, so other sites can't post to the app's forms.
- `ORIGIN` must be HTTPS (plain HTTP only for localhost) and exactly an origin; `BETTER_AUTH_SECRET` must be at least 32 characters (`src/lib/server/config.ts`).

### Command-line tool, backup and check

- `backup` makes each backup under a `.partial` name in a folder only its user can open (`0700`), checks the copied database, links only files with the same name and size from the newest finished backup, and `--keep` removes only folders named like a backup. Paths come from the person running it and from file names Chloris wrote.
- `check` changes nothing and looks only in folders named like a home's id.
- `sign-in-link` prints a link that signs in as the account, and says so; each one goes in the server's log.
- None of them migrate except `sign-in-link`, which sets up a new database.

### Dependencies

`npm audit --omit=dev` reports only the esbuild advisory through drizzle-kit (finding 8), which is no longer in the image. BetterAuth's limiter is off (D56) and its telemetry is off. npm runs no dependency's install script: `allowScripts` denies both that have one (better-sqlite3 and esbuild ship prebuilt binaries).

## Questions for the owner

1. **D50 (Proposed): removing passkeys when an address is proven.** Finding 1's fix means someone who joined by invite, added a passkey, and later confirms their address for the digest has to add a passkey again (they are offered one straight away). The alternative, keeping passkeys when the link is opened in a browser already signed in to that account, helps only when the email is opened in the same browser as the app, which an installed app on a phone often isn't. Is the simpler rule acceptable? **Answered:** yes. D50 is now Agreed.
2. **D58 (Proposed): a retention period for the server's log** (finding 6), such as 90 days, removed by the hourly job, along with expired BetterAuth `verification` rows. "Never changed once written" would still hold for every row kept. **Answered:** yes, 90 days. Done (finding 6).
3. **D35 (Proposed): 100 megapixels.** With uploads taking turns (finding 3), one decode peaks near 260 MB. Once JavaScript has loaded, the browser sends at most 2560 pixels on the longest side (under 7 megapixels), so the limit matters only for an original sent before JavaScript loads. Most phones save 12 to 50 megapixels unless set to a 200-megapixel mode, which the current limit refuses anyway. A limit of 60 megapixels would cut the worst case by about two-fifths. Worth changing? **Answered:** yes, 60 megapixels, with finding 11's limit on files decoded whole.

No Agreed decision needs to change. D28 (invites make an account with the address typed) and D26 (only accounts the command-line tool allows may create a home) stand, and finding 1's fix works within them.
