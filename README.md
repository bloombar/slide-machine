# Slide Machine V2

Slide Machine turns the relationship between lecturer and slides on its head: instead of speaking _to_ prepared slides, the instructor speaks freely and slides are generated _from_ their speech in real time. After a lecture, an exit-ticket quiz is auto-generated, distributed, and auto-graded.

V2 is a full-stack TypeScript application — a React SPA, an Express API, and MongoDB — shipped as a modular monolith on Digital Ocean App Platform. See the [Software Design Document](docs/SPEC.md) and the [Delivery Roadmap](docs/ROADMAP.md). The V1 single-page vanilla-JS app lives in git history (last V1 commit: `1683ad2`).

## Repository layout

| Path      | Package                 | Purpose                                                       |
| --------- | ----------------------- | ------------------------------------------------------------- |
| `shared/` | `@slide-machine/shared` | Shared types, API DTOs, and AI-provider interfaces (TECH-6/8) |
| `server/` | `@slide-machine/server` | Express API; serves the built SPA in production (TECH-2/10)   |
| `client/` | `@slide-machine/client` | React + Vite + TailwindCSS SPA (TECH-1)                       |
| `e2e/`    | `@slide-machine/e2e`    | Playwright end-to-end tests against the built app (TECH-7)    |
| `config/` | —                       | Plan tiers/caps, vendor prices, AI prompts (BILL-6, TECH-4)   |

## Getting started

Prerequisites: **Node ≥ 22** and **MongoDB** (either run your own, or `docker compose up` provides one on host port 27018). Features that store files also need **MinIO** (see [Object storage](#object-storage)).

```sh
npm ci
cp server/.env.example server/.env    # required: MONGODB_URI + JWT secrets (see docs/CONTRIBUTING.md)
cp client/.env.example client/.env.local
npm run dev                            # Express on :3000 + Vite on :5173 (proxied /api)
```

Or run the whole stack in Docker with one command: `docker compose up` (add `--profile storage` to include MinIO).

## Commands

| Command                    | What it does                                                 |
| -------------------------- | ------------------------------------------------------------ |
| `npm run dev`              | Server (`tsx watch`) + client (Vite) with `/api` proxy       |
| `npm run build`            | Build the SPA, then bundle the server to `server/dist`       |
| `npm start`                | Run the built app (production mode, serves the SPA on :3000) |
| `npm test`                 | Unit tests (shared + server + client, Vitest)                |
| `npm run test:integration` | API tests against a real MongoDB (`MONGODB_TEST_URI`)        |
| `npm run e2e`              | Playwright tests against the built app (run `build` first)   |
| `npm run lint`             | ESLint across the repo                                       |
| `npm run format`           | Prettier write / `format:check` to verify                    |
| `npm run typecheck`        | `tsc --noEmit` in every workspace                            |

## Configuration

All adjustable settings and credentials live in config files, never in code:

- **Server** — `server/.env` (see [server/.env.example](server/.env.example)); validated at boot, the server refuses to start on invalid config.
- **Client** — `client/.env.local` with `VITE_`-prefixed vars (no secrets — these ship to the browser).
- **Plan tiers** — [config/plans.json](config/plans.json): prices and usage caps, tunable without a code change. Per-unit vendor prices live alongside it in [config/service-prices.json](config/service-prices.json), and the AI prompts in [config/prompts/](config/prompts/).

### Object storage

Uploads and exports (seed assets, cached images, generated files — TECH-10) use S3-compatible object storage: **MinIO locally**, **DO Spaces in production**. Both are configured by the same `S3_*` variables in `server/.env`, whose defaults already point at a local MinIO:

```sh
docker compose --profile storage up   # MinIO on :9000, web console on :9001
```

The `minio-init` job creates the `slide-machine-dev` bucket automatically and allows anonymous reads, so `S3_PUBLIC_BASE_URL` works immediately. The console at <http://localhost:9001> (login `minioadmin` / `minioadmin`) lets you browse stored files. If you already run your own MinIO on port 9000, skip the profile — the `.env` defaults work with it as-is; just create a `slide-machine-dev` bucket.

Note `S3_FORCE_PATH_STYLE=true` is required for MinIO; production Spaces uses virtual-hosted addressing (`false`, the default) — see the production examples in [server/.env.example](server/.env.example).

## Deployment

A single Docker-built App Platform service runs the Express monolith (API + SPA), health-checked at `/api/health`, backed by MongoDB Atlas and DO Spaces. The service is defined by [.do/app.yaml](.do/app.yaml); `deploy_on_push` on the configured branch controls whether pushes auto-deploy. Full step-by-step setup — Atlas, Spaces, environment variables, and teardown — is in [docs/DEPLOY.md](docs/DEPLOY.md). CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs lint, typecheck, unit, integration, and e2e tests on every push.
