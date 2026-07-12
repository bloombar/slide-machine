# Generation prompts

The text sent to the generation model alongside each spoken phrase is
assembled from **externalized templates** in [`config/prompts/`](../config/prompts/) —
editable without a code change, and shipped in the Docker image (the
runtime copies `config/`).

| File | Purpose |
| --- | --- |
| `generation.txt` | The master instruction template. `{{slot}}` placeholders are filled per request; an unknown placeholder fails loudly on first use. |
| `freedom-bands.txt` | The 1–10 AI-freedom policy texts, one `[lo-hi]` section per band. |

Slots filled by [`gemini-generation.ts`](../server/src/providers/gemini-generation.ts):
`outputShape` (the JSON contract — kept in code because zod enforces it),
`freedomPolicy` (from the bands + the resolved 1–10 setting),
`layouts` (the template's layout descriptors and word budgets),
`seededImages`, `projectSeed`, `deckSeed` (seed notes + extracted document
text), `rolling` (recent slides), `capacity` (current-slide load), `phrase`.

`PROMPTS_DIR` overrides the directory (defaults to `config/prompts`).

## Seeing exactly what the model saw

Set `GENERATION_LOG_PROMPTS=true` in `server/.env` and the server logs the
fully assembled prompt and the raw model response for every generation
call, delimited by `===== GENERATION PROMPT/RESPONSE =====` markers.
Prompts include seed material and lecture content — treat the flag as
dev-only.

Model choice, the no-`responseSchema` decision, and server-side
enforcement (zod validation, layout drift correction, word-budget
clamping) are recorded in [DECISIONS.md](DECISIONS.md).
