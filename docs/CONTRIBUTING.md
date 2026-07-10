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

## Setup

```sh
npm ci
cp server/.env.example server/.env        # set MONGODB_URI at minimum
cp client/.env.example client/.env.local
npm run dev                               # Express :3000 + Vite :5173
```

Commands, configuration, and deployment are documented in the [README](../README.md); the system design is in [SPEC.md](SPEC.md) and the schedule in [ROADMAP.md](ROADMAP.md).

## Before opening a PR

```sh
npm run lint && npm run format:check && npm run typecheck && npm test
npm run test:integration   # needs MongoDB running
npm run build && npm run e2e
```

Code style is enforced by Prettier/ESLint (ES modules, no semicolons) — run `npm run format` rather than formatting by hand.
