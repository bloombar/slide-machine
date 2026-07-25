# Instructions to Claude

## Testing

Before finalizing major changes to code, do thorough 100% code coverage unit tests, integration tests. For changes that affect both front- and back-end, add e2e tests using Playwright with live front- and back-ends with live test db to ensure correct functionality. All passing passing tests should be reproducible during regression testing as we develop new code.

## Code conventions

Use Prettier and ESLint for code formatting, using default rules except semicolons, which should be avoided. Use ES Module import/export styles.

## Code comments

Leave standard docstring comments for all modules, functions, and for large block of complicated code. Avoid jargon and keep comments concise.

## Specification

An initial specification is written into docs/SPEC.md. This is the general plan for the project, although we may decide to change it along the way.

## Git & project-board workflow

Changes are tracked on the GitHub project board and follow a branch → PR flow so the board automation works (details: docs/CONTRIBUTING.md, docs/PROJECT_BOARD.md). Follow this **by default**:

- **Do not commit code changes directly to the default branch.** Create a feature branch named `feat/<REQ-ID>-<slug>` (e.g. `feat/AUTH-3-email-verification`; use a short descriptive slug when no requirement id applies). **Exception:** documentation (Markdown and anything under `docs/`) and `.env.example` files may be committed directly to the default branch without a PR.
- **Open a pull request** whose description includes `Closes #N` — `N` is the board issue's number — so the card links and advances to Done on merge. Commit and push only when asked, and run the pre-PR checks first (`npm run lint && npm run format:check && npm run typecheck && npm test`).
- **Do not hand-create board issues.** The board is generated from the SPEC via `npm run board:derive` then `npm run board:sync` (see docs/PROJECT_BOARD.md).

If asked to use a different workflow (e.g. commit straight to the default branch), **remind the user that it diverges from this flow and confirm before proceeding** — then honor the confirmed request.
