# syntax=docker/dockerfile:1

# --- deps: install once with full devDependencies (needed to build the client + compile the server) ---
FROM node:20-slim AS deps
WORKDIR /app
# better-sqlite3 has a native addon that needs a compiler; ffmpeg is the timelapse CLI's own
# dependency, not a build tool, but installing it once here keeps the later stages simple.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

# --- build: compile the client (Vite) and server (tsc) with the full dependency set ---
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# --- runtime: a slimmer image with only production dependencies + the compiled output ---
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg is a runtime dependency of the timelapse CLI (admin/export tooling), not just a build tool.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# python3/make/g++ are needed here too: `npm ci --omit=dev` still has to compile better-sqlite3's
# native addon for this exact image, a separate compile from the build stage's.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev \
  && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist-client ./dist-client
COPY --from=build /app/dist-server ./dist-server

RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=8787
ENV SQLITE_PATH=/app/data/wall.db
EXPOSE 8787

# Migrations run automatically on boot (src/server/index.ts calls migrateToLatest() before
# listening), so there's no separate migrate step to run here.
CMD ["node", "dist-server/server/index.js"]
