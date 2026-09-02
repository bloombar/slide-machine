# Instructions to Claude

## Testing

Before finalizing major changes to code, do thorough 100% code coverage unit tests, integration tests. For changes that affect both front- and back-end, add e2e tests using Playwright with live front- and back-ends with live test db to ensure correct functionality. All passing passing tests should be reproducible during regression testing as we develop new code.

### Reading a green result

A passing check is not automatically evidence. Before treating one as proof, ask:

- **What would this value look like if the thing that sets it had never happened?** If the answer is "the same", it is not evidence. A count of zero failures, a field read off a type that does not have it, a measurement that never ran, and a bundle built before the change all report exactly what success reports.
- **Does this pass mean "nothing broke" or "the thing works"?** They are indistinguishable from outside. A green suite proves nothing about a feature the data under test never exercises.
- **Which tests did this green actually run?** The gate below is unit tests only; CI also runs `test:integration` and the e2e suite. A green from one says nothing about the others.
- **Was every artifact produced by the code under test?** Rebuild before measuring, and confirm the build contains something the change introduced — check for a marker, not a timestamp.

The first question you can and should ask about your own work: whether an artifact is what you think it is is checkable from the inside. **A prediction is not** — when you expect a particular answer, the expectation is what is doing the asking, so that check has to come from someone with no stake in the outcome. Where work is split across people or sessions, spend one question there rather than on general review.

Fix the defect, not the instrument. If a check reports something correct as a fault, the rule is measuring the wrong thing — loosening its threshold hides the real fault it was built to catch.

## Code conventions

Use Prettier and ESLint for code formatting, using default rules except semicolons, which should be avoided. Use ES Module import/export styles.

## Code comments

Leave standard docstring comments for all modules, functions, and for large block of complicated code. Avoid jargon and keep comments concise.

## Specification

An initial specification is written into docs/SPEC.md. This is the general plan for the project, although we may decide to change it along the way.

The project-board sync (`scripts/board`) parses docs/SPEC.md, so keep these formats when editing it:

- **Requirements are `#### <ID> <Title>` subheadings** — `<ID>` is `FAMILY-N` (uppercase family letters, hyphen, number; e.g. `GEN-6`, `AUTH-1`). The prose beneath the heading, up to the next heading, becomes the issue body — put the requirement's description there.
- **Sections are `### <N>. <Title>` headings** (e.g. `### 4. Accounts & Authentication`); they label a requirement's section.
- **Privacy items (`P-N`) are rows in the §16 table** whose first cell is `**P-N**`.
- **Future Work items are `-` bullets** under `### 18. Future Work`.
- **Never change an existing ID** — it keys the issue; renaming or renumbering orphans the old issue and creates a new one.
- docs/ROADMAP.md phase-scope lists seed each item's phase/status; they use the ID shorthand `FAMILY-1..6` (range) and `FAMILY-1/2/3` (list).

## Git & project-board workflow

Changes are tracked on the GitHub project board and follow a branch → PR flow so the board automation works (details: docs/CONTRIBUTING.md, docs/PROJECT_BOARD.md). Follow this **by default**:

- **Do not commit code changes directly to the default branch.** Create a feature branch named `feat/<REQ-ID>-<slug>` (e.g. `feat/AUTH-3-email-verification`; use a short descriptive slug when no requirement id applies). **Exception:** documentation (Markdown and anything under `docs/`), `.env.example` files, and project tooling under `scripts/` may be committed directly to the default branch without a PR.
- **Open a pull request** whose description includes `Closes #N` — `N` is the board issue's number — so the card links and advances to Done on merge. Commit and push only when asked, and run the pre-PR checks first (`npm run lint && npm run format:check && npm run typecheck && npm test`).
- **Do not hand-create board issues.** The board is generated from the SPEC via `npm run board:derive` then `npm run board:sync` (see docs/PROJECT_BOARD.md).

If asked to use a different workflow (e.g. commit straight to the default branch), **remind the user that it diverges from this flow and confirm before proceeding** — then honor the confirmed request.

## Protected paths

**IMPORTANT:** `.env*` hold live credentials, and `docs/study/data/` holds research study data (P-14). A `PreToolUse` hook
(`.claude/hooks/guard-paths.sh`, tested by `npm run test:hooks`) blocks writes to them. A block is a signal to stop and
report — never route around it.

## Agent workflow

Implementation runs as a supervisor/developer split: `.claude/agents/developer-agent.md` implements a scoped
slice against a brief, `.claude/agents/spec-reviewer.md` reviews the diff in fresh context, and the agent
doing the work is never the one grading it. The brief template and definition of done are in the
`phase-handoff` skill. The plan being built is summarised in `docs/SPEC.md` and `docs/ROADMAP.md`; decisions
made along the way are in `docs/DECISIONS.md`.
