# Project Board — SPEC → issues, phases, and workflow

How the [Task Board](https://github.com/users/bloombar/projects/1) is kept in
sync with the spec, and how the team drives cards through it. The board carries
**every SPEC requirement as an issue**, filed onto a **phase board** (tab) and a
**status column**.

## How it works

- **Source of truth:** [`scripts/board/manifest.yaml`](../scripts/board/manifest.yaml)
  — one entry per requirement (`id`, `title`, `section`, `family`, `phase`,
  `status`, `review`). It is generated from the docs, then hand-curated.
- **Phase = Milestone.** Each phase is a repo **Milestone** ("Phase 1 — MVP" …
  "Phase 4 — Future Work"); the project's built-in Milestone field is what each
  phase tab filters on, and milestones give a per-phase progress bar + due date.
- **Column = Status.** The project's **Status** single-select drives the board
  columns: Backlog → In progress → Ready to review → Done.
- **Labels.** Every managed issue gets a `spec` label plus an **`area:*` label
  per task type** (`area:auth`, `area:generation`, `area:infrastructure`,
  `area:privacy`, `area:admin`, `area:future`, …) so types are distinguishable
  in the repo issue list and as a board group/filter.
- **Idempotent sync.** Every issue carries a hidden marker `<!-- sm-req: ID -->`.
  Re-running the sync matches on it, so it updates in place and never duplicates.

Two small scripts:

| Command | What it does |
| --- | --- |
| `npm run board:derive` | Parse `docs/SPEC.md` + `docs/ROADMAP.md` → write/refresh `manifest.yaml`. Preserves your curated `phase`/`status`, flags new/uncertain rows `review: true`. |
| `npm run board:sync` | Push the manifest to GitHub: create/update issues, milestones, the `spec` label, add them to the project, seed Status. `--dry-run` to preview, `--reconcile` to force manifest Status back onto the board. |

## Ownership model (why re-runs don't clobber live work)

- **Manifest-owned** (re-enforced every sync): issue title, body, **milestone
  (phase)**, the `spec` label. Change a requirement's phase in the manifest and
  the next sync moves its card to the other board.
- **Board-owned** (seeded once at issue creation, then left alone): **Status
  column** and open/closed. After creation the team + the Actions automation own
  it. Use `board:sync --reconcile` only when you deliberately want to reset
  Status/state to the manifest.

## One-time setup

1. **Token scope** — `gh auth refresh -s project` (already done for the maintainer).
2. **Derive + review** — `npm run board:derive`, then open `manifest.yaml` and
   resolve every `review: true` row (phase/status best-guesses that need a human
   call — e.g. the split ids `AUTH-1`/`EXP-4`, the `ADMIN-*` family, `IMG-5`).
   Set `review: false` once confirmed.
3. **Sync** — `npm run board:sync -- --dry-run` to preview, then
   `npm run board:sync` to create the issues, milestones, and project items.
4. **Configure each phase tab** (Projects UI — views/tabs can't be scripted):
   for the **Phase 1–4** tabs set **Layout: Board**, **Group by: Status**, and
   **Filter: `milestone:"Phase N — …"`**.
5. **Enable built-in workflows** (Project → ⋯ → Workflows):
   - *Item added to project* → Status **Backlog**
   - *Item reopened* → Status **In progress**
   - *Item closed* → Status **Done**
   - *Pull request merged* → Status **Done**
   - *(optional)* *Auto-add to project* for `bloombar/slide-machine` issues.
6. **PR automation secret** — create a repo secret **`GH_PROJECTS_TOKEN`**: a
   **classic** PAT (Settings → Developer settings → Tokens (classic)) with the
   **`project`** scope, plus **`public_repo`** to read the linked issues/PRs
   (`repo` if the repo is ever made private). Fine-grained PATs **can't** access
   user-owned Projects v2 yet, so a classic token is required here. This powers
   [`.github/workflows/project-board.yml`](../.github/workflows/project-board.yml),
   which fills the two gaps the built-ins can't (In progress / Ready to review).

That yields the full column flow: **Backlog** (added) → **In progress** (draft PR
opened) → **Ready to review** (PR marked ready) → **Done** (merged/closed) →
**In progress** (reopened).

## Keeping it in sync

When the SPEC or ROADMAP change:

```sh
npm run board:derive      # refresh manifest (your curation is preserved)
git diff scripts/board/manifest.yaml   # review new/changed rows; fix any review:true
npm run board:sync        # push — updates in place, no duplicates
```

New requirements become new issues on the right board; reworded titles update;
requirements that changed phase move milestones. Ids that disappear from the SPEC
are reported as orphans and left for you to close by hand.

## Team workflow (per requirement)

1. **Pick** an issue from your phase board's **Backlog**; assign yourself.
2. **Branch** off the issue: `feat/<REQ-ID>-<slug>` (e.g.
   `feat/AUTH-3-email-verification`).
3. Open a **draft PR** early with **`Refs #<n>`** in the body → card auto-moves
   to **In progress**.
4. When ready, mark the PR **Ready for review** and change the body to
   **`Closes #<n>`** → card → **Ready to review**.
5. Reviewer (PI / RA1) approves and **merges** → card → **Done**, issue
   auto-closed.
6. Need rework after merge? **Reopen** the issue → card → **In progress**.

**Rules of the road**

- One issue per requirement id; **never edit the `<!-- sm-req -->` marker line**
  (it keys the issue to the manifest).
- The PR must reference its issue with **`Closes #N`** for the merge→Done and
  ready→review moves to land on the right card.
- Manual Status drags are always fine — the sync won't undo them.
