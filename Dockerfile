# syntax=docker/dockerfile:1

# Build stage: install everything, build the app, then drop the development dependencies.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

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
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "build"]
