# Slide-machine vs. Canva

Feature comparison against Canva's AI/design stack (Magic Studio, Brand Kit,
AI Voice, transcription). Captured July 2026 from public Canva documentation
and product coverage; Canva's AI feature set changes quickly, so treat dates
as approximate.

## Legend

- 🔴 **CANVA EXCEEDS US** — Canva is clearly ahead today (gaps to close for parity)
- ⚪ **CANVA DOES NOT COMPETE** — no meaningful Canva equivalent; structural moat for us
- 🟡 **Parity / mixed** — roughly even, or a different purpose

## Comparison

| Capability | Ours | Canva | Marker |
|---|---|---|---|
| AI slide generation | From seed/transcript | Magic Design / Magic Studio (prompt, outline, doc) | 🟡 Parity |
| Refinement | Transcript-fed | Magic Studio chat / Magic Write (generic, prompt-driven) | 🟡 Parity |
| TTS narration | AI voiceover of slides | 120+ voices, ~30 languages, pitch/speed/tone | 🔴 Canva exceeds |
| Image sourcing | Sources images for slides | Millions of stock assets + Dream Lab & Magic Media AI gen, inline | 🔴 Canva exceeds |
| Design templates (editable/shareable/constraining) | Partial today; extending | Brand Templates + Brand Kit + Brand Controls: element/positional locking, approved palettes/fonts, approval workflows, AI respects locks | 🔴 Canva exceeds |
| Multilingual narration/translation | Planned | Magic Switch translate (100+ langs) + TTS (~30 langs) | 🔴 Canva exceeds (today) |
| STT | Transcription + speaker diarization + live STT | Audio/video-to-text + captions, no diarization | 🟡 Mixed — we lead on diarization/live |
| Whiteboard | Draws on slides, transcript-synced playback | Standalone collaborative brainstorming canvas | 🟡 Different purpose |
| Keyboard shortcuts | Nav, Space=narration, `[`/`]`=layout, Esc | Extensive editor/present shortcuts, animations, timers | 🟡 Overlap on nav/Esc |
| Multilingual: slides from speech | Integrated, can be live | Has pieces (STT + translate) but no direct speech→deck | 🟡 We lead on integration |
| Real-time slide gen during a live lecture | ✅ Core feature | ❌ Decks built in advance, static path | ⚪ Canva does not compete |
| Seed material — project level | ✅ Applied to every lecture | ❌ Projects are folders; no shared AI seed context | ⚪ Canva does not compete |
| Seed material — lecture level | ✅ Per-lecture + inherited + live mid-lecture seeding | ⚠️ One-shot doc upload only; not persistent/layered/live | ⚪ Canva does not compete (on the live/layered model) |

## 🔴 Where Canva exceeds us (close these to reach parity)

1. **TTS narration** — far broader voice/language catalog (120+ voices, ~30
   languages) with fine-grained pitch/speed/tone controls.
2. **Image sourcing** — huge curated stock library plus two native AI
   generators (Dream Lab, Magic Media), dropped in inline.
3. **Design templates / brand governance** — granular element + positional
   locking, admin Brand Controls (approved colors/fonts, approval workflows),
   and AI that respects locks.
4. **Multilingual translation + narration** — translate a deck into 100+
   languages and voice it in ~30; we haven't shipped this yet.

## ⚪ Where Canva does not compete (our structural moat)

1. **Real-time slide generation during a live lecture** — Canva's build-ahead
   model can't do this at all.
2. **Project-level seed material** — persistent shared context feeding AI
   across every lecture; Canva Projects are just folders.
3. **Lecture-level seed material with inheritance + live mid-lecture seeding**
   — Canva only offers a one-shot doc-to-deck upload, not persistent, layered,
   or live.
4. (Adjacent) **Speaker-diarized + live STT** and **transcript-synced
   whiteboard playback** — Canva has transcription and a whiteboard, but
   neither the diarization nor the lecture-timeline sync.

## Takeaway

Canva wins the static authoring toolkit (voices, imagery, brand templates,
translation). We win the live, lecture-native + seeded pipeline — capabilities
that are hard for Canva to bolt on without abandoning its build-ahead
architecture. Roadmap items like multilingual narration and richer constraining
templates mostly close gaps toward Canva parity; the real-time + seed +
diarization stack is where we are structurally differentiated.

## Sources

- [Design with Brand Kits and Brand Templates](https://www.canva.com/help/using-brand-templates/)
- [Setting up Brand Controls](https://www.canva.com/help/brand-control/)
- [Turn text into voiceovers using AI voice](https://www.canva.com/help/canva-ai-voice/)
- [Canva AI Image Generator 2026](https://pxz.ai/blog/canva-ai-image-generator-guide)
- [Create a presentation with Canva AI](https://www.canva.com/help/using-magic-presentations/)
- [Magic Switch translates presentations in 100 languages](https://www.smartcompany.com.au/technology/artificial-intelligence/canva-studiomagic-switch-ai-language-translation/)
- [Convert speech to text online](https://www.canva.com/features/speech-to-text/)
- [Reformat documents with Magic Studio](https://catalog.bensbites.com/tutorial/reformat-documents-plans-and-projects-with-canvas-magic-studio)
