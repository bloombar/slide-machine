# Generation prompts

The text sent to the generation model alongside each spoken phrase is
assembled from **externalized templates** in [`config/prompts/`](../config/prompts/) —
editable without a code change, and shipped in the Docker image (the
runtime copies `config/`).

| File | Purpose |
| --- | --- |
| `generation.txt` | The master instruction template. `{{slot}}` placeholders are filled per request; an unknown placeholder fails loudly on first use. |
| `freedom-bands.txt` | The 1–5 AI-freedom policy texts, one `[n]` section per band. |
| `refine.txt` | Post-lecture "Refine all slides": improve one slide at a 1–5 strength. |
| `narrate.txt` | Rewrite a slide's spoken narration at a 1–5 eloquence (student slides framed as questions). |
| `reformat.txt` | Reframe a slide once speakers are known — student turns as questions/feedback. |

The three post-lecture templates (`refine`/`narrate`/`reformat`) are loaded by
[`refine-prompts.ts`](../server/src/providers/refine-prompts.ts); their slots
are computed in [`gemini-generation.ts`](../server/src/providers/gemini-generation.ts).

Slots filled by [`gemini-generation.ts`](../server/src/providers/gemini-generation.ts):
`outputShape` (the JSON contract — kept in code because zod enforces it),
`freedomPolicy` (from the bands + the resolved 1–5 setting),
`layouts` (the template's layout descriptors and character budgets),
`seededImages`, `projectSeed`, `deckSeed` (seed notes + extracted document
text), `rolling` (recent slides), `capacity` (current-slide load),
`voiceCommands` (the [CAP-4](SPEC.md#cap-4-voice-commands) command option set — empty unless
`GENERATION_VOICE_COMMANDS=true`), `updateRules` (delta/refit update
semantics plus the current slide's exact content — empty unless
`GENERATION_LAYOUT_REFIT=true`, the default), `lockLayout` (tells the model to
keep the current slide's layout while the user is hand-annotating it —
[EDIT-4](SPEC.md#edit-4-whiteboard-annotation); empty unless the phrase arrives
mid-draw), `pinLayout` (tells the model a heading — title/section — slide's
layout is fixed and new content belongs on a new slide; empty unless the
current slide is a heading), `phrase`.

`PROMPTS_DIR` overrides the directory (defaults to `config/prompts`).

**Slot order matters for cost and latency**: `generation.txt` keeps every
session-stable slot (shape, freedom policy, layouts, seeds…) ahead of the
per-phrase ones (`rolling`, `capacity`, `updateRules`, `lockLayout`,
`pinLayout`, `phrase`…), so the repeated prefix stays byte-identical across a
lecture and Gemini's implicit context cache discounts it. Keep new slots in
the section matching how often they change.

## Seeing exactly what the model saw

Set `GENERATION_LOG_PROMPTS=true` in `server/.env` and the server logs the
fully assembled prompt and the raw model response for every generation
call, delimited by `===== GENERATION PROMPT/RESPONSE =====` markers.
Prompts include seed material and lecture content — treat the flag as
dev-only.

Model choice, the no-`responseSchema` decision, and server-side
enforcement (zod validation, layout drift correction, word-budget
clamping) are recorded in [DECISIONS.md](DECISIONS.md).
