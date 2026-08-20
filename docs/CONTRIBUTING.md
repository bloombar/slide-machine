# How to Contribute

## Architecture: three parts

The app is three cooperating parts, and **all three must be running for full functionality** — missing pieces degrade gracefully (the API reports `degraded` at `/api/health`) rather than crash:

- **Client** — the React/Vite single-page app (dev server on `:5173`; in a production build the server serves the built assets).
- **Server** — the Express/JWT API on `:3000` — auth, AI generation, and all business logic.
- **Storage** — **MongoDB** (all persistent data) plus an **S3-compatible object store** (uploaded seed files, slide images, exports, narration audio). Both have zero-setup local options — see [Storage](#storage-mongodb-and-object-storage-minios3).

`npm run dev` starts client + server; storage you run separately (below).

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

Commands and configuration are documented in the [README](../README.md); deployment (DO App Platform + Spaces + MongoDB Atlas) is in [DEPLOY.md](DEPLOY.md); the system design is in [SPEC.md](SPEC.md) and the schedule in [ROADMAP.md](ROADMAP.md).

## Configuration & API keys

Everything is set in `server/.env` — [server/.env.example](../server/.env.example) documents every variable — and the server validates it at boot, refusing to start with a clear message if something required is missing or malformed.

- **Required to boot:** `MONGODB_URI` (prefilled for a local mongod on `:27017`; use `mongodb://localhost:27018/slide-machine` for the Docker one) and `JWT_SECRET` + `JWT_REFRESH_SECRET` (≥ 32 chars each — generate with `openssl rand -base64 48`).
- **Google services** — `GEMINI_API_KEY` (slide/quiz/image generation), `GOOGLE_APPLICATION_CREDENTIALS` (service account for real-time Cloud STT, only when `TRANSCRIPTION_PROVIDER=google-cloud`), `GOOGLE_CLOUD_TRANSLATION_KEY` (deck translation): how to create each is in [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md). No Gemini key yet? Keep `GENERATION_PROVIDER=mock` (the `.env.example` default) for deterministic keyless slides.
- **Image enrichment** ([IMG-1](SPEC.md#img-1-real-time-image-enrichment)) — Wikimedia and Openverse are keyless and work out of the box; an optional `FLICKR_API_KEY` adds a third source: [IMAGE_ENRICHMENT.md](IMAGE_ENRICHMENT.md).
- **File uploads/exports** — `STORAGE_PROVIDER=local` (the default) writes to disk with no extra setup; `s3` needs MinIO, see [Object storage in the README](../README.md#object-storage).
- **Feature-specific, optional until you work on that feature** — Google/GitHub OAuth (sign-in, connected accounts — the Google connect flow's Drive/Forms scopes also back quiz publishing, [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md) §6), Stripe (billing), SMTP (email verification/reset). Each is documented inline in `.env.example`. The Quiz Generator is a git-dependency library (no runtime config), not a separate service.
- **Tests** — integration and e2e runs use the separate `MONGODB_TEST_URI` database (e2e reads it from `server/.env` and starts its own app).

## Storage: MongoDB and object storage (MinIO/S3)

Two stores back the server; both have zero-setup local options.

**MongoDB** — required for every mode (`MONGODB_URI`). Run your own, or start one with a single Docker command:

```sh
docker run -d --name slide-machine-mongo -p 27017:27017 mongo:7   # standalone on :27017
```

Or bring up the whole stack (app + MongoDB on host `:27018`) with `docker compose up`. Point `MONGODB_URI` at whichever you use — `mongodb://localhost:27017/slide-machine` for the standalone container, `:27018` for the compose one.

**Object storage** — needed only for file uploads/exports (seed files, slide images, narration, exports). `STORAGE_PROVIDER=local` (the default) writes to disk with no setup. For the real S3 path locally, use **[MinIO](https://min.io/)** — an S3-compatible server you run yourself; the app talks to it exactly as it would AWS S3 or DO Spaces, so nothing changes between dev and prod:

```sh
docker compose --profile storage up      # MinIO S3 on :9000, console on :9001
```

The `S3_*` variables in `.env.example` are prefilled for this local MinIO (`minioadmin`/`minioadmin`); in production they point at DO Spaces. Details: [Object storage in the README](../README.md#object-storage).

## Google services

Several features depend on Google Cloud APIs. Each is **optional** — without it that feature disables or falls back — **except Gemini**, which the core AI needs (the `mock` provider stands in until you add a key). Full setup for every one is in [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md).

| Service | Powers | Config | Setup |
| --- | --- | --- | --- |
| **Gemini API** | Slide/quiz/image generation, seed extraction | `GEMINI_API_KEY` | [§2](GOOGLE_API_KEYS.md#2-gemini-key-gemini_api_key) |
| **Cloud Speech-to-Text** | Real-time transcription (`google-cloud` engine; the `browser` default needs nothing) | `GOOGLE_APPLICATION_CREDENTIALS` | [§3](GOOGLE_API_KEYS.md#3-speech-to-text-choose-an-engine) |
| **Cloud Text-to-Speech** | Narration playback ("Speak this slide") | `GOOGLE_CLOUD_TTS_KEY` | [§4](GOOGLE_API_KEYS.md#text-to-speech-key-google_cloud_tts_key) |
| **Cloud Translation** | Post-lecture translated viewing | `GOOGLE_CLOUD_TRANSLATION_KEY` | [§4](GOOGLE_API_KEYS.md#4-translation-key-google_cloud_translation_key) |
| **Cloud Storage (GCS)** | Speaker-diarization batch job (Phase 3) | `GCS_AUDIO_BUCKET` | [§3](GOOGLE_API_KEYS.md#post-lecture-diarization-a-gcs-bucket-phase-3-gen-4) |
| **Google OAuth** | Sign-in + connected accounts | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | [GOOGLE_SIGN_IN.md](GOOGLE_SIGN_IN.md) |
| **Google Forms & Drive** | Quiz publishing via the connected account | (uses the OAuth connection above) | [§6](GOOGLE_API_KEYS.md#6-google-forms--drive-access-for-quiz-publishing-exp-4-connected-accounts) |

## Feature flags

Behavior is tuned by env vars in `server/.env`, each annotated inline in [.env.example](../server/.env.example). The notable **provider switches** (swap the engine behind a capability):

| Flag | Options (default) | Selects |
| --- | --- | --- |
| `GENERATION_PROVIDER` | `mock` \| `gemini` | Slide-generation engine (`.env.example` ships `mock` for keyless dev) |
| `TRANSCRIPTION_PROVIDER` | `browser` \| `google-cloud` \| `none` | Live speech engine |
| `TTS_PROVIDER` | `google-cloud` | Narration engine (off without a TTS key) |
| `TRANSLATION_PROVIDER` | `google-cloud` \| `none` \| `mock` | Slide-content translation for translated viewing (off without a Translation key) |
| `IMAGE_GEN_PROVIDER` / `QUIZ_PROVIDER` | `gemini` | AI image / quiz engines |
| `STORAGE_PROVIDER` | `local` \| `s3` | Object-storage backend |
| `DIARIZATION_PROVIDER` | `none` \| `google-cloud` \| `mock` | Post-lecture speaker diarization |
| `BILLING_PROVIDER` | `stripe` | Billing adapter |
| `QUIZ_PUBLISH_MODE` | `mock` \| `live` | Fake vs real Google Forms publishing |

…and the **behavior toggles** (default in parentheses):

| Flag | Default | Effect |
| --- | --- | --- |
| `GENERATION_VOICE_COMMANDS` | `false` | Let the model read plain speech as CAP-4 voice commands (experimental) |
| `GENERATION_LAYOUT_REFIT` | `true` | Allow a live slide to switch layout as content grows |
| `GENERATION_LIVE_REPHRASE` | `true` | Allow same-layout rephrasing of committed slide text (needs `LAYOUT_REFIT`) |
| `GENERATION_DECK_STRUCTURE` | `true` | Feed deck outline + positional signals for title/section decisions |
| `GENERATION_INTERIM_FLUSH` | `true` | Generate from long interim speech before the recognizer finalizes (GEN-12); threshold: `GENERATION_INTERIM_FLUSH_WORDS` (default `40`) |
| `GENERATION_LOG_PROMPTS` | `false` | Log assembled prompts + raw responses (dev only; includes seed text) |
| `IMAGE_ENRICHMENT_ENABLED` | `true` | Fetch stock images for slides (IMG-1) |
| `IMAGE_RERANK_ENABLED` / `_VISION` | `true` / `false` | AI re-rank of image candidates; vision re-rank is heavier |
| `AUDIO_RETENTION_ENABLED` | `false` | Retain lecture audio (only with `google-cloud` STT; for diarization/playback) |

Numeric tunables (`GENERATION_FREEDOM`, `GEMINI_MODEL`, `*_TIMEOUT_MS`, retention-day counts and the `AUDIO_RETENTION_MAX_*_MB` ceilings, `STT_CAPTURE_SAMPLE_RATE`, rerank sizes, `WHITEBOARD_SUPPRESS_DEBOUNCE_MS`, refine defaults) are documented next to each flag in `.env.example`.

For the retention ceilings, the capture rate, and the retention-day counts, **`0` means "no limit", not "off"** — it removes a bound (no downsampling, keep forever, unbounded buffers) and therefore costs more, not less. `WHITEBOARD_SUPPRESS_DEBOUNCE_MS` is the exception: there `0` is a literal zero-length window. The full list is in [server/.env.example](../server/.env.example).

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

The root `dev` script passes `--raw` to `concurrently`, which is load-bearing on Windows: without it, `tsx watch`'s child process deadlocks against concurrently's prefixing pipes, so the server never binds `:3000` and `wait-on` fails with a misleading `Timed out waiting for: http-get://localhost:3000/api/health`. The cost of `--raw` is losing the `[server]`/`[client]` prefixes — `tsx` and Vite still label their own output. Saving a server file restarts the API and briefly (~4s) makes it unreachable; the client's proxy errors during that window are expected.

## Seeding

Two unrelated things share the word "seed":

- **Dev database seeding** — `npm run seed -w server` ([server/src/db/seed.ts](../server/src/db/seed.ts)) populates a database with sample users, projects, and lectures so you have something to work against. Prerequisites, the seeded login credentials, quotas, and reset behavior are in [SEEDING.md](SEEDING.md).
- **Seed-material extraction** — [server/src/seeding/](../server/src/seeding/) is the ingestion pipeline for a **project's uploaded seed content** ([SEED-1](SPEC.md#seed-1-document-seeding)/[SEED-2](SPEC.md#seed-2-image-seeding)): `extract.ts` is the keyless baseline (PDF/DOCX text, embedded + uploaded images), and `ai-extract.ts` is the Gemini tier (vision captions/keywords, OCR for scanned PDFs) that layers on when `GEMINI_API_KEY` is set. Both run fire-and-forget after upload and never throw, so a failed extraction never blocks the request.

## Project board

Work is tracked on the [Task Board](https://github.com/users/bloombar/projects/1): every [SPEC](SPEC.md) requirement is an issue, filed by phase and status. Pick one from your phase's **Backlog**, branch as `feat/<REQ-ID>-<slug>`, and reference it from your PR with **`Closes #N`** so its card advances as the PR opens, is reviewed, and merges.

For example, say you grab the issue for [`AUTH-3`](SPEC.md#auth-3-email-verification) (email verification):

- **Branch name** — `<REQ-ID>` is the requirement id and `<slug>` is a few dashed words describing the work, so: `feat/AUTH-3-email-verification`.
- **`#N`** — `N` is that issue's **number**, shown as `#123` in the issue title on GitHub and in its URL (`.../issues/123`). Put `Closes #123` in your PR description; GitHub then links the PR to issue 123 and auto-closes it (moving its card to **Done**) when the PR merges. If your issue were number 123, the PR body would read `Closes #123`.

Card movement is automated, and that automation has requirements (one-time, maintainer setup — full checklist and the team SOP are in [PROJECT_BOARD.md](PROJECT_BOARD.md)):

- **`GH_PROJECTS_TOKEN` Actions secret** — a **classic** PAT with the `project` scope (+ `public_repo`); fine-grained PATs can't reach user-owned Projects. Set it under repo **Settings → Secrets and variables → Actions**.
- **GitHub Actions enabled** for the repo, so [.github/workflows/project-board.yml](../.github/workflows/project-board.yml) can run — it moves a linked issue's card to **In progress** (draft PR) and **Ready to review** (PR marked ready).
- **Built-in project workflows enabled** (Project → ⋯ → Workflows) for the moves the Action doesn't cover: added → **Backlog**, reopened → **In progress**, closed / PR merged → **Done**.
- **The `Closes #N` link** on every PR — without it the automation has no card to move.

Without these, work still merges fine; only the board's card movement stops updating.

### Syncing the board from the SPEC (maintainers)

The board's issues are **generated from the SPEC**, not created by hand:

```sh
npm run board:derive      # SPEC.md + ROADMAP.md → scripts/board/manifest.yaml (then curate any review: rows)
npm run board:sync        # push the manifest → issues, milestones, area labels, project cards (idempotent)
```

`board:sync` flags:

- `--dry-run` — preview every action, write nothing.
- `--limit N` — process only the first N manifest entries.
- `--reconcile` — force the manifest's Status column + open/closed onto the board (otherwise Status is board-owned once an issue exists, so live card moves aren't clobbered).
- `--prune` — **delete** issues whose requirement was removed from the manifest (also removes their card). Permanent, so it's opt-in.

Re-running is safe: each issue is keyed by a hidden marker, so a sync updates in place and never duplicates. Full workflow and the manifest format are in [PROJECT_BOARD.md](PROJECT_BOARD.md).

## Before opening a PR

```sh
npm run lint && npm run format:check && npm run typecheck && npm test
npm run test:integration   # needs MongoDB running
npm run build && npm run e2e
```

Code style is enforced by Prettier/ESLint (ES modules, no semicolons) — run `npm run format` rather than formatting by hand.
