# Slide Machine V2 — Delivery Roadmap & Phasing

Companion to the [SDD](SPEC.md). This plans **how** the spec gets built within the available time and people. Requirement IDs (e.g., `GEN-1`, `QUIZ-3`) refer to the SDD.

## 1. Context & Constraints

- **Hard deadline:** 2026-09-01 (build complete before the Fall 2026 pilot).
- **Window:** ~9 working weeks (July + August 2026).
- **People:**
  - **RA1 — intermediate**, available **now → Sept 1** (all 9 weeks).
  - **RA2 — entry-level**, available **July only** (~4 weeks).
  - Both are **AI-assisted** in their coding.
- **Binding constraint:** **August is a single-developer month (RA1 only).** July has ~2× the capacity of August. Front-load anything hard or parallelizable into July while RA2 is available.

## 2. Capacity-Driven Strategy

1. **Do the architecture-defining work first** (provider abstractions, shared types, action layer, deploy/CI) so later features slot in instead of forcing rewrites.
2. **Maximize July throughput** with two parallel streams (RA1 backend/integration, RA2 frontend/UI) joined by a shared-types contract.
3. **Protect the pilot-critical core.** The Fall pilot needs the **speak → slides → exit-ticket quiz** loop plus editing/templates/seeding — *not* billing, the social network, or i18n. Those are product features and are the natural flex if time runs short ([§7 Risks](#7-risks--recommended-cut-line)).
4. **Leave August's solo developer the work that doesn't need a second pair of hands**, and make sure RA2's July output is tested and documented so RA1 can own it after July.

## 3. Phase Overview

| Phase | Window (approx.) | People | Theme |
| --- | --- | --- | --- |
| **Foundations** | Jul wk 1 (continuous after) | RA1 + RA2 | Scaffold, shared types, provider interfaces, deploy/CI |
| **Phase 1 — MVP** | Jul wk 1–3 | RA1 + RA2 | Core loop: sign in → speak → AI slides → save/view |
| **Phase 2 — Fuller** | Jul wk 4 → Aug wk 2 | RA2 (to Jul 31) + RA1 | Quiz integration, seeding, templates, preflight, editing depth |
| **Phase 3 — Complete** | Aug wk 3–4 (+buffer) | RA1 solo | Billing, social, i18n/translation, reformat, hardening |

"Complete" = everything in the SDD **except** items already marked Future Work (SDD §18).

## 4. Cross-Cutting Foundations (start in week 1, maintained throughout)

These are not a phase — they are built first and grown continuously:

- **Stack scaffold** — React+Vite+Tailwind, Express, MongoDB, monorepo with the **shared TypeScript types** module (`TECH-1/2/3/5/6`). The shared types are the contract that lets the two streams run in parallel.
- **Provider abstraction interfaces** (`TECH-8`) — define `TranscriptionProvider`, `GenerationProvider`, `ImageGenerationProvider`, `QuizGenerationProvider` up front, even with a single adapter each. Cheap now, expensive to retrofit.
- **Action/command layer** (`TECH-13`) — route all deck/project mutations through it from the start so UI, voice, and future agents share one path.
- **Deploy + CI/CD** (`TECH-10/11`) — DO App Platform + `docker compose` + GitHub Actions on day ~2, so integration is continuous, not a big-bang at the end.
- **Testing** (`TECH-7`) — write tests alongside features. Treat the **100% gate as a Phase-3 enforcement** target (with documented exclusions, SDD Open Q #9); enforcing it from day 1 would slow the MVP spike.

## 5. Phase 1 — MVP

**Goal:** one instructor can sign in, create a project (with optional typed seed notes), speak, watch coherent AI-generated slides appear with sensible layouts and images, control playback, and save + view the deck — deployed on DO.

**In scope (SDD IDs):** `AUTH-1` (email+password + Google sign-in), `AUTH-2`; `PROJ-1/2` (text seed only); `CAP-1/2/3` (Google Cloud STT); `GEN-1/2/3/5/6`; `TMPL-2/3/6` (2–3 built-in templates with minimal layout descriptors); `IMG-1/2` (seeded + one search source); `PLAY-1`; `SHARE-1` (private save + viewer + permalink); `EDIT-1` (basic). Plus the §4 foundations.

**Explicitly deferred from MVP:** quiz integration, file/Drive/GitHub seeding, preflight, template editor, billing, social, i18n, translation, voice commands, disambiguation, AI image generation, animated transitions, reformat.

### 5.1 MVP Labor Division

Two parallel streams joined by the **shared-types contract**. RA1 owns the types/DTOs and the hard integration; RA2 builds the UI against those types, mocking the API until it's live so neither blocks the other.

| Stream | Owner | Work |
| --- | --- | --- |
| **A — Backend, integration, architecture** | **RA1 (intermediate)** | Monorepo + shared types + provider interfaces (`TECH-6/8`); Express API; **auth** (`AUTH-1` email+Google, `AUTH-2`, JWT); MongoDB models (User/Project/Deck/Slide); **Google Cloud STT** streaming (`CAP-3`); **Gemini** generation adapter + **layout-selection** logic (`GEN-1/2/6`); **image enrichment** service (`IMG-1/2`); action-layer seed (`TECH-13`); **DO deploy + CI** (`TECH-10/11`). |
| **B — Frontend & UI** | **RA2 (entry-level, AI-assisted)** | React+Vite+Tailwind app + design system (`TECH-1/5`); auth screens; project-create + text-seed UI (`PROJ-1`); **live slide renderer** + skeleton loaders (`GEN-3/5`); **playback controls** (`PLAY-1`); built-in **template/layout rendering** (`TMPL-2/3`); **deck viewer + permalink** page (`SHARE-1`); basic **deck editor** (`EDIT-1`); component unit tests. |

**Why this split:** RA1's stream is integration-heavy and architecturally load-bearing (STT streaming, LLM orchestration, auth, deploy) — the work that most needs intermediate judgment. RA2's stream is well-bounded, visually verifiable React/CRUD/presentation work that AI assistance accelerates well and where mistakes are low-blast-radius.

**Keeping them unblocked:**
- Agree the **shared types + a couple of fixture payloads** (a sample generated slide, a sample deck) on **day 1–2**. RA2 builds the renderer/editor against fixtures immediately; swapping mocks for the real API is a late, low-risk step.
- Define the **generation event shape** (how streamed slide updates reach the client) early — it's the seam between Stream A's pipeline and Stream B's live renderer.
- RA2 **documents and tests** every component as built, because RA1 inherits this UI solo in August.

**Suggested 3-week MVP cadence (July wk 1–3):**

- **Week 1** — RA1: scaffold + shared types + auth + DB + deploy skeleton + STT spike. RA2: React scaffold + design system + static slide renderer against fixtures + auth screens.
- **Week 2** — RA1: Gemini generation + layout selection + image enrichment behind the API; wire STT streaming. RA2: live renderer consuming generation events (mock→real), playback controls, template rendering, project/seed UI.
- **Week 3** — End-to-end integration (real STT → Gemini → render), deck save/view/edit, polish, deploy, demo. Both pair on integration and bug-fixing.

**MVP exit criteria:** the core loop works on the deployed environment for a single user; CI green; RA2's components documented + tested for handoff.

## 6. Phase 2 — Fuller Version

**Goal:** the full pilot-critical experience — quizzes, rich seeding, templates, preflight, and editing depth. Most of this overlaps RA2's last July week (use RA2 on UI-heavy items: template editor, seeding UI, export views) before RA1 continues solo.

**In scope:** `QUIZ-1..6` (generate YAML + Quiz Generator publish + publish config + delegated Google access); `SEED-1/2/3` + `EXP-4` (Google Drive/Docs/Slides + uploads + seed images; GitHub connect if time); `PREP-1/2/3` (preflight extraction + honing UI); `TMPL-1/4/5` (library + custom template editor); `GEN-7`, `IMG-3` (image guidance + disambiguation); `GEN-8` (new-vs-update + manual mode); `GEN-9` (animated transitions); `EDIT-2/3`; `EXP-1/2/3` (export/import); `CAP-4` (voice commands); `AUTH-3/4/5` + GitHub sign-in. Action layer fully realized; coverage ramping.

## 7. Phase 3 — Complete (all non-future)

**Goal:** finish everything else in the SDD and harden. **Solo RA1, August** — the highest-risk phase for scope.

**In scope:** `BILL-1..6` + Stripe + metering/enforcement (`P-8`); `SOC-1..4` (voting, browse/search/sort, feeds, profiles); `TECH-12` (i18n) + `SHARE-2` (translation); `GEN-4` (post-lecture reformat); `IMG-4` (AI imagery); `PREP-4` (verbal preflight); full `P-1..P-9` hardening, accessibility (reduced-motion), **100% coverage gate enforced**, and docs.

## 8. Risks & Recommended Cut-Line

- **August is one developer doing the largest, most integration-heavy slice** (Stripe, social, i18n, translation) plus the 100% coverage gate. **Phase 3 is unlikely to land in full.** Plan for it, don't discover it.
- **100% coverage across this surface in 9 weeks is itself a major cost.** Recommend: enforce the gate only from Phase 3, with documented exclusions (SDD Open Q #9), or it will drag every earlier phase.
- **Recommended cut order** if time runs short (cut from the top — none are needed for the Fall pilot): `IMG-4` (AI imagery) → `SHARE-2` + non-English i18n → `PREP-4` (voice preflight) → `SOC-3/4` depth (keep `SOC-1` voting) → reduce billing to simple tier-gating (defer full self-serve Stripe `BILL-2/5`).
- **Protect Phases 1–2** at all costs — they are the pilot. If the schedule slips, it should slip into Phase 3 product features, never into the core loop or quiz integration.
- **RA2 handoff risk** — if RA2's July UI work isn't tested/documented, RA1 loses August time maintaining it. Make handoff quality an MVP exit criterion (§5).

## 9. Milestones

| Date (approx.) | Milestone |
| --- | --- |
| ~Jul 3 | Foundations up: scaffold, shared types, CI, deployed skeleton |
| ~Jul 21 | **Phase 1 (MVP) complete** — core loop demoable on DO |
| ~Jul 31 | RA2 departs; Phase 2 well underway (quiz + seeding + templates) |
| ~Aug 11 | **Phase 2 complete** — full pilot-critical experience |
| ~Aug 29 | **Phase 3 as far as it goes**; hardening + coverage |
| **Sep 1** | **Deadline** — build freeze for the Fall pilot |
