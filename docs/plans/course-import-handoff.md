# Course import — session handoff

Status of the knowledge.kitchen course import into production, written at the
end of the session that built it. Delete this file once the import is closed
out and its lessons have moved into `scripts/course-import/README.md`.

## The one open question

**Nobody has confirmed the production import actually ran.** The previous
session handed the two commands to the user, who said they were running them,
and the session ended before any output came back. Everything below about what
*would* happen is from `--dry-run`; nothing here is evidence about the live
state of `https://theslidemachine.com`.

Establish the real state before doing anything else — re-running is safe (a
lecture already in the project is skipped), so the cheap check is to run the
import again and read what it reports as already present.

## What is being imported

Two courses from `/Users/ab1258/Documents/knowledge-kitchen/content/courses/`,
into the account `ab1258@nyu.edu` (`6a5aeb0177963515b40a468a`).

| Course | Project title | Lectures | Slides | Seed files |
| --- | --- | --- | --- | --- |
| `agile-development-and-devops` | Agile Software Development & DevOps | 10 | 835 | 35 (10.1 MB) |
| `software-engineering` | Software Engineering | 24 | 1,305 | 84 (9.2 MB) |

Expected skips: the agile course skips nothing; Software Engineering skips 5
links, all off-site PDFs, which the importer leaves as links by design.

## Authentication — the account has no password

`ab1258@nyu.edu` signs in with Google, so `user.passwordHash` is absent
(confirmed against the production database). That closes both password routes:

- `POST /auth/login` needs a password the account does not have.
- `POST /auth/forgot-password` returns early for an account with no
  `passwordHash` (`server/src/auth/service.ts`), by design — saying "use Google
  instead" would confirm the address exists.

So the importer grew a `--token` flag. An access token is a plain HS256 JWT
carrying only `sub` (the user id), signed with `JWT_SECRET`
(`server/src/auth/tokens.ts`), and one can be minted for a 6-hour run. With a
token the client checks `/auth/me` instead of signing in, and its re-auth path
is disabled: there is no password to retry with, so a 401 must surface as an
error rather than becoming a silent failing sign-in.

**Minting the token is the user's job, not the agent's.** The auto-mode
classifier blocks an agent from signing a credential with the production
secret, and from sending one. That is the right boundary — do not try to route
around it. Ask the user to mint and run, as the last session did.

## Code state

Branch `feat/course-import-sibling-course-assets`, **uncommitted**, no PR.
Three changes, each with tests that were confirmed to fail without the change:

1. **Sibling-course images** — `scripts/course-import/materials.mjs`.
   `candidatePaths` tried a site-absolute path only against the course being
   imported, so an agile lecture linking to
   `/content/courses/software-engineering/assets/…` found nothing. It now also
   tries the shared courses directory, longest tail first, so the course a path
   names beats a same-named file in the importing course. Recovers 3 images.
2. **Token auth** — `scripts/course-import/client.mjs`, wired through
   `import-course.mjs` as `--token` / `$SLIDE_MACHINE_TOKEN`.
3. **Syllabus descriptions** — new `scripts/course-import/syllabus.mjs` reads
   the `## Course description` section of a course's `syllabus.md`, stopping at
   the next heading so credits and modality stay out. Applied on create; on a
   re-run it fills a blank description but never overwrites an edited one.

Gate at handoff: `npm run test:scripts` 139 passed, `npm test` 1902 passed,
lint 0 errors (28 pre-existing warnings), format and typecheck clean.

## `.claude/` — copied from the bloombot repo, now adapted

The agent definitions, hooks and skills under `.claude/` were copied from
`education_automation/bloombot` and rewritten for this repo. Two things are
**still outstanding** and need a human, because an agent is blocked from
editing them:

- **`.claude/hooks/verify.sh` is half-edited and self-contradictory.** Its
  header now says it runs lint, format:check, typecheck, test and the hook
  tests, and mentions a `SKIP_VERIFY_HOOK=1` escape hatch — but the body still
  runs only `typecheck` and `test`, and no such escape hatch exists. Either
  finish it (add `run_check lint`, `run_check format:check`, `run_check
  test:hooks` beside the existing two) or revert the header. Note the runtime:
  the full gate is a couple of minutes on every turn.
- **`.claude/settings.local.json`** still carries `attribution.commit` and
  `attribution.pr` of `bloombot`, and its deny list names `master`/`main`
  rather than this repo's default branch, `better-faster`. Both are the user's
  call; an agent editing its own permissions file is not something to route
  around.

What was fixed: the path guard now protects this repo's real secrets
(`.env`/`.env.*`, and `docs/study/data/` per P-14) instead of bloombot's
`data/*.db`, `logs/*.log` and `results/*.csv`; `.env.example` is explicitly
allowed, which the copied guard blocked; `stale-check` targets
`better-faster` instead of `master`; `phase-handoff` drops the `board:status`
script this repo does not have, in favour of the PR-state automation it does
(`docs/PROJECT_BOARD.md`).

`npm run test:hooks` was added, because `npm test` runs only the shared,
server and client workspaces and never covered `.claude/hooks/` — CLAUDE.md
had claimed it did.
