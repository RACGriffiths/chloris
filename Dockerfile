# syntax=docker/dockerfile:1

# Both stages start from the same Node image, pinned by digest so a build always uses the same one.
# Dependabot proposes a new digest when the image is updated (Debian or Node fixes), and the
# next release ships it.

# Build stage: install everything, build the app, then drop the development dependencies.
FROM node:26-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The commit being built, which the About page links to (D59). The repository isn't copied in,
# so pass it: --build-arg SOURCE_COMMIT=$(git rev-parse HEAD). Without it, the page links to the
# repository as a whole.
ARG SOURCE_COMMIT
RUN npm run build && npm prune --omit=dev
# `npm prune --omit=dev` keeps a development package that a production one names as an optional
# peer, which the lockfile marks "devOptional": better-auth's peers include drizzle-kit (with an
# old esbuild), SvelteKit and Vite. The built server loads none of them, so they go too. Their own
# platform binaries (esbuild's, Vite's rolldown, Tailwind's lightningcss) are marked only
# "optional", so then any optional package that nothing left depends on goes, and so on until none
# does. Then the empty scope folders, and the commands left behind in node_modules/.bin.
RUN node <<'EOF'
const fs = require('node:fs');
const { packages } = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const remove = (dir) => fs.rmSync(dir, { recursive: true, force: true });
for (const [dir, entry] of Object.entries(packages)) {
	if (entry.devOptional) remove(dir);
}
const nameOf = (dir) => dir.slice(dir.lastIndexOf('node_modules/') + 'node_modules/'.length);
for (let removed = true; removed; ) {
	removed = false;
	const left = Object.entries(packages).filter(([dir]) => fs.existsSync(dir));
	const needed = new Set(
		left.flatMap(([, entry]) => [
			...Object.keys(entry.dependencies ?? {}),
			...Object.keys(entry.optionalDependencies ?? {}),
			...Object.keys(entry.peerDependencies ?? {})
		])
	);
	for (const [dir, entry] of left) {
		if (entry.optional && !needed.has(nameOf(dir))) {
			remove(dir);
			removed = true;
		}
	}
}
for (const name of fs.readdirSync('node_modules')) {
	const dir = `node_modules/${name}`;
	if (name.startsWith('@') && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}
for (const name of fs.readdirSync('node_modules/.bin')) {
	if (!fs.existsSync(`node_modules/.bin/${name}`)) fs.rmSync(`node_modules/.bin/${name}`);
}
EOF

# Run stage: the built server, production dependencies and migrations, running as a normal user.
# Its /app folder is also each release's archive for installing without Docker (D61), which is why
# it holds the licence and the example configuration.
FROM node:26-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5
ENV NODE_ENV=production \
    DATA_DIR=/data \
    BODY_SIZE_LIMIT=25M
WORKDIR /app
COPY --from=build /app/package.json /app/LICENSE /app/.env.example ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# The app applies these at start-up, looking for them relative to the working directory.
COPY --from=build /app/src/lib/server/db/migrations ./src/lib/server/db/migrations
# Only the app's user may open its data: the database holds every home's data.
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "build"]
