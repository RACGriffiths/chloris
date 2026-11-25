# syntax=docker/dockerfile:1

# Build stage: install everything, build the app, then drop the development dependencies.
FROM node:26-slim AS build
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
# old esbuild), SvelteKit and Vite. The built server loads none of them, so they go too, with any
# commands they leave behind in node_modules/.bin.
RUN node <<'EOF'
const fs = require('node:fs');
const { packages } = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
for (const [dir, entry] of Object.entries(packages)) {
	if (entry.devOptional) fs.rmSync(dir, { recursive: true, force: true });
}
for (const name of fs.readdirSync('node_modules/.bin')) {
	if (!fs.existsSync(`node_modules/.bin/${name}`)) fs.rmSync(`node_modules/.bin/${name}`);
}
EOF

# Run stage: the built server, production dependencies and migrations, running as a normal user.
FROM node:26-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    BODY_SIZE_LIMIT=25M
WORKDIR /app
COPY --from=build /app/package.json ./
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
