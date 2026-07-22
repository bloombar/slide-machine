# Whiteboard

Live freehand annotation on slides — pen, highlighter, eraser — that replays in
sync with narration and never lets AI generation shift content out from under a
mark. This is the behavior map; the _why_ lives in
[DECISIONS.md](DECISIONS.md) ("Whiteboard drawings…" and "Whiteboard ↔ live
generation…"), the spec in [SPEC.md](SPEC.md) EDIT-4, and the code is linked
throughout.

Feature tags: **WB-1** drawing, **WB-2** anchoring/playback, **WB-3**
generation interaction.

## Tools & UI

- Floating, draggable palette ([WhiteboardToolbar](../client/src/components/whiteboard/WhiteboardToolbar.tsx)):
  pen (opaque), highlighter (semi-transparent), eraser. Position is remembered
  per lecture in `localStorage`. Tool state (active tool, per-tool color +
  thickness) is [useWhiteboard](../client/src/components/whiteboard/useWhiteboard.ts).
- **Press-and-hold** a pen/highlighter opens its color + thickness picker
  ([ColorThicknessPopover](../client/src/components/whiteboard/ColorThicknessPopover.tsx)).
  A small **corner triangle** on those buttons marks the affordance and, clicked
  directly, **toggles** the same picker.
- **New whiteboard slide** — the toolbar's square-pen button, or the voice
  command "slide machine, new whiteboard" (/ "new chalkboard"), appends a blank
  [whiteboard-layout](#whiteboard-layout) slide and arms the pen. Both routes
  are identical; the command follows the CAP-4 pattern (wake-word match +
  AI-recognized intent), executed in `runVoiceCommand`
  ([DeckViewerPage](../client/src/pages/DeckViewerPage.tsx)).
- Default pen/highlighter colors come from the deck's design template theme
  (`penColor`/`highlighterColor`), so marks suit the slides.
- The drawing surface is one [DrawingLayer](../client/src/components/whiteboard/DrawingLayer.tsx)
  canvas overlaying the slide (z-20; see [DECISIONS.md](DECISIONS.md) "Z-index
  tiers"). It captures pointer events only while a tool is active; otherwise it
  is transparent. Per-slide undo/redo.

## Stroke model & persistence

- Strokes live **on the slide** (`Slide.drawings: Stroke[]`,
  [deck.ts](../shared/src/types/deck.ts)) — per-slide, always loaded with the
  slide, not a separate collection. Coordinates are normalized `0..1` to the
  slide box, so marks survive layout/aspect changes.
- Persisted via the `slide.editDrawings` action
  ([slide.ts](../server/src/actions/slide.ts)) — the client owns the full stroke
  set and sends it wholesale (last-write-wins), debounced ~600 ms. This is a
  **separate pipeline** from speech (`session.phrase`), so drawings keep saving
  even while generation is paused.

## Anchoring & synced playback (WB-2)

Full rationale in [DECISIONS.md](DECISIONS.md) "Whiteboard drawings:
transcript-anchored strokes". In short:

- Each stroke's timing is a **character offset into the slide's
  `sourceTranscript`** (`anchor.charAnchor`), used proportionally — engine-
  independent, refine-proof. Google-Cloud word timings _sharpen_ it when present.
- **Erase is a timestamped event when it can replay, otherwise a deletion.** A
  synced stroke erased during recording keeps its data and gains an
  `erasedAnchor`, so playback shows it appear at its draw anchor and vanish at
  its erase anchor. But an `unsynced` mark (drawn mic-off) or an erase made
  mic-off has no transcript timeline to replay on, so erasing it simply
  **removes** the stroke (`erasureReplays`, [drawing.ts](../client/src/lib/drawing.ts)).
  Refine rescales retained anchors proportionally
  ([drawing-anchor.ts](../shared/src/lib/drawing-anchor.ts) →
  [reconcile.ts](../server/src/actions/reconcile.ts)).
- Marks made with the **mic off** (`source: 'unsynced'`) are always shown.
- The visibility decision is the pure `strokeVisible`
  ([drawing.ts](../client/src/lib/drawing.ts)).
- **Retention consequence:** "has marks" means _visible_ strokes, not array
  length (retained — replayable — erased strokes linger) — see
  `hasVisibleDrawings` ([drawing-anchor.ts](../shared/src/lib/drawing-anchor.ts)),
  used by every guard below.

## Whiteboard layout

- Every design template **must** include a `whiteboard` layout — a blank slate
  with no content slots — enforced by the template loader
  ([builtin.ts](../server/src/templates/builtin.ts)); see
  [TEMPLATES.md](TEMPLATES.md). Renderer:
  [WhiteboardLayout](../client/src/components/slide/layouts/WhiteboardLayout.tsx).
- It is **withheld from the AI's layout menu** — generation never picks it;
  users add one via the toolbar button or the layout picker. `slide.add` accepts
  a `layoutType` so a whiteboard slide is created truly blank.

## Live generation interaction (WB-3)

While the mic is recording, drawing changes how speech becomes slides. All in
[session.phrase](../server/src/actions/deck.ts) and the pause state machine in
[DeckViewerPage](../client/src/pages/DeckViewerPage.tsx).

### Content-generation pause

Two independent pause modes, surfaced by one pill
([NotificationPill](../client/src/components/NotificationPill.tsx)) with a
**Resume** button:

1. **Drawing debounce** — while actively drawing on any slide (within
   `WHITEBOARD_SUPPRESS_DEBOUNCE_MS` of the last gesture), generation is fully
   paused; it **auto-resumes** after the debounce, or on Resume.
2. **Whiteboard slide** — on a `whiteboard`-layout slide, generation is paused
   **manually only** (no debounce): it stays paused until the user clicks Resume
   or **makes a new regular slide** (toolbar `+` / "new slide" command), which
   navigates off the canvas.

While paused:

- The phrase carries `pauseGeneration`; the server **records the transcript**
  (deck transcript, structured segment, and the slide's `sourceTranscript`) but
  **skips slide generation** — no new slide, no content or layout change.
- **Transcription keeps running** and strokes keep saving, so both speech and
  markup are retained for playback.
- **Voice commands still work.** Wake-worded commands are matched client-side
  before the server; AI-recognized commands still run server-side while paused
  when `GENERATION_VOICE_COMMANDS` is on (otherwise a no-LLM fast path is taken).

### Protecting marked-up slides

A slide with **visible** drawings must not shift under the strokes. When such a
slide is the update target, generation is **additive only**: layout pinned, **no
refit** (no reformat/re-map), content only appended; an overflowing update still
spills to a **new** slide. (`keepLayout` in [deck.ts](../server/src/actions/deck.ts).)

### Refine confirmation

Because refine _can_ reflow content, refining a marked-up slide prompts first
([ConfirmDialog](../client/src/components/ConfirmDialog.tsx)):

- **"Refine this slide"** (kebab) — confirms when that slide has marks
  ([DeckViewerPage](../client/src/pages/DeckViewerPage.tsx) `requestRefineSlide`).
- **"Refine all slides"** (lecture settings) — confirms when any slide has marks
  and the slide pass is selected ([DeckSettingsModal](../client/src/components/DeckSettingsModal.tsx)).

## Prompt & model context

[generation.txt](../config/prompts/generation.txt) /
[gemini-generation.ts](../server/src/providers/gemini-generation.ts):

- The model receives the current slide's **`sourceTranscript`** (recent window)
  so it can see what the slide already covers.
- It is told to fill **only slots the chosen layout lists** (no `body` on a
  title layout), which pairs with the server rule that content a header
  (title/section) layout can't show spills to a new slide (`isHeaderLayout`,
  [layout-refit.ts](../server/src/lib/layout-refit.ts)).
- `refit` may change the layout _or_, when `GENERATION_LIVE_REPHRASE` is on,
  keep the same layout and re-state existing content for clearer phrasing.

## Configuration

| Var | Default | Effect |
| --- | --- | --- |
| `WHITEBOARD_SUPPRESS_DEBOUNCE_MS` | `5000` | Grace after the last gesture during which drawing keeps generation paused. `0` disables the grace. Exposed to the client via runtime config ([runtime-config.ts](../client/src/runtime-config.ts)). |
| `GENERATION_LIVE_REPHRASE` | `true` | Allow a same-layout `refit` to re-state committed content for quality. Off keeps slide text verbatim mid-lecture (server drops same-layout refits). Needs `GENERATION_LAYOUT_REFIT` on. |

Theme `penColor` / `highlighterColor` set the default mark colors per template.

## Tests

- Client: `client/src/components/whiteboard/*.test.tsx`, whiteboard/pause and
  refine-confirmation cases in `client/src/pages/DeckViewerPage.test.tsx`.
- Server: `whiteboard-layout` / `pause-generation` / `voice-commands` integration
  tests, plus marked-slide and header-slide cases in `decks.test.ts`.
- E2E: `e2e/tests/whiteboard.spec.ts`.
