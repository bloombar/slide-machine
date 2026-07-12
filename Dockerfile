# Multi-stage build: compile client + server, then run the Express monolith
# serving the built SPA (SPEC TECH-10/11).

# --- Build stage ---
FROM node:24-alpine AS build
WORKDIR /app

# Copy manifests first so npm ci is cached until dependencies change
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY e2e/package.json e2e/
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime stage ---
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    CLIENT_DIST=/app/client/dist \
    PLANS_CONFIG_PATH=/app/config/plans.json

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY e2e/package.json e2e/
RUN npm ci --omit=dev

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/config server/config
COPY --from=build /app/client/dist client/dist
COPY config config

EXPOSE 3000
CMD ["node", "server/dist/index.js"]
