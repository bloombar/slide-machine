# How to Contribute

## Required tools

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) ≥ 22 (includes npm; the repo uses npm workspaces)
- [MongoDB](https://www.mongodb.com/docs/manual/installation/) — run your own, or use the Docker one below (host port 27018)
- Chromium for Playwright e2e tests: `npx playwright install chromium`

## Optional tools

- [Docker](https://docs.docker.com/get-docker/) — one-command stack: `docker compose up` (app + MongoDB)
- [MinIO](https://min.io/) — S3-compatible storage, needed only for file-upload/export features: `docker compose --profile storage up`, or your own instance on port 9000
- [Claude Code](https://claude.com/claude-code) — AI coding assistant; project instructions live in `.claude/CLAUDE.md`
- [Visual Studio Code](https://code.visualstudio.com/) with the [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode), [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint), and [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) extensions

See instructions for [using the Claude Code Extension in VS Code](https://code.claude.com/docs/en/vs-code)

## Setup

```sh
npm ci
cp server/.env.example server/.env
cp client/.env.example client/.env.local
openssl rand -base64 48                   # run twice → JWT_SECRET and JWT_REFRESH_SECRET in server/.env
npm run dev                               # Express :3000 + Vite :5173
```

Commands, configuration, and deployment are documented in the [README](../README.md); the system design is in [SPEC.md](SPEC.md) and the schedule in [ROADMAP.md](ROADMAP.md).

## Configuration & API keys

Everything is set in `server/.env` — [server/.env.example](../server/.env.example) documents every variable — and the server validates it at boot, refusing to start with a clear message if something required is missing or malformed.

- **Required to boot:** `MONGODB_URI` (prefilled for a local mongod on `:27017`; use `mongodb://localhost:27018/slide-machine` for the Docker one) and `JWT_SECRET` + `JWT_REFRESH_SECRET` (≥ 32 chars each — generate with `openssl rand -base64 48`).
- **Google services** — `GEMINI_API_KEY` (slide/quiz/image generation), `GOOGLE_APPLICATION_CREDENTIALS` (service account for real-time Cloud STT, only when `TRANSCRIPTION_PROVIDER=google-cloud`), `GOOGLE_CLOUD_TRANSLATION_KEY` (deck translation): how to create each is in [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md). No Gemini key yet? Keep `GENERATION_PROVIDER=mock` (the `.env.example` default) for deterministic keyless slides.
- **Image enrichment** ([IMG-1](SPEC.md#img-1-real-time-image-enrichment)) — Wikimedia and Openverse are keyless and work out of the box; an optional `FLICKR_API_KEY` adds a third source: [IMAGE_ENRICHMENT.md](IMAGE_ENRICHMENT.md).
- **File uploads/exports** — `STORAGE_PROVIDER=local` (the default) writes to disk with no extra setup; `s3` needs MinIO, see [Object storage in the README](../README.md#object-storage).
- **Feature-specific, optional until you work on that feature** — Google/GitHub OAuth (sign-in, connected accounts), Stripe (billing), SMTP (email verification/reset), Quiz Generator (base URL + token). Each is documented inline in `.env.example`.
- **Tests** — integration and e2e runs use the separate `MONGODB_TEST_URI` database (e2e reads it from `server/.env` and starts its own app).

## Running the app

MongoDB must be reachable at `MONGODB_URI` for every mode (`/api/health` reports `degraded` otherwise).

| What                    | Command                                    | Where                                                     |
| ----------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Everything (dev)        | `npm run dev`                              | app at <http://localhost:5173>, API proxied to `:3000`    |
| Server only             | `npm run dev -w server`                    | API at <http://localhost:3000/api/health>                 |
| Client only             | `npm run dev -w client`                    | `:5173`; `/api` calls fail unless the server is up        |
| Production build, local | `npm run build && npm start`               | whole app (SPA + API) served by Express on `:3000`        |
| Docker stack            | `docker compose up`                        | app on `:3000`, MongoDB on host `:27018`                  |
| Docker stack + MinIO    | `docker compose --profile storage up`      | adds MinIO S3 on `:9000`, console on `:9001`              |
| Seed dev data           | `npm run seed -w server`                   | sample users/lectures ([SEEDING.md](SEEDING.md))          |

Dev mode hot-reloads both sides (`tsx watch` + Vite HMR). The server reads `server/.env` at boot and exits with a clear message if required config is missing.

## Before opening a PR

```sh
npm run lint && npm run format:check && npm run typecheck && npm test
npm run test:integration   # needs MongoDB running
npm run build && npm run e2e
```

Code style is enforced by Prettier/ESLint (ES modules, no semicolons) — run `npm run format` rather than formatting by hand.
