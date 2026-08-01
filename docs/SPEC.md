# Slide Machine V2 — Software Design Document (SDD)

For how this is phased and staffed toward the Sept 1 build deadline, see the [Delivery Roadmap](ROADMAP.md).

## Part I — Product & Functional Requirements

### 1. Overview

Slide Machine V2 turns the relationship between lecturer and slides on its head: instead of speaking _to_ prepared slides, the instructor speaks freely and slides are generated _from_ their speech in real time. At the end of a lecture, an "exit-ticket" quiz is auto-generated from the slide content, distributed to students, and auto-graded — producing per-lecture comprehension signals for both instructor and students.

Where V1 was a single-page, vanilla-JS browser app with no server or accounts, **V2 is a full-stack web application**: a React front-end, an Express/JWT back-end, and a MongoDB database, shipped as a **modular monolith deployed on Digital Ocean App Platform** ([§13](#13-system-architecture)). This enables persistent user accounts, tiered subscription plans, saved slide projects and template libraries, shareable permalinks, and a lightweight social layer for browsing and rating others' work — in addition to the core speech-to-slides experience.

V2 also relates to a second, deliberately **separate** project — **The Quiz Generator** ([github.com/bloombar/google-forms-quiz-generator](https://github.com/bloombar/google-forms-quiz-generator)) — which converts quiz definitions into Google Forms quizzes. Rather than merging the two codebases, V2 keeps them in **separate repositories** and consumes the Quiz Generator as a **versioned, in-process library** ([§17](#17-quiz-generator-integration)).

This document specifies both the **functional** behavior (what the system does, for whom, under what rules) and the **technical** shape (stack, configuration, data models, testing) of V2.

### 2. Goals & Non-Goals

#### 2.1 Goals

1. Generate slides in real time from an instructor's live speech, optionally blended with seeded materials.
2. Give users full control over sessions and decks: start/pause/stop/rewind/forward, plus full post-hoc editing.
3. Let users register accounts, subscribe to a plan tier, and create/save slide **projects** and **style templates** they can share via permalink.
4. Provide a library of reusable, previewable slide-style templates with conventional layout types, extensible by users.
5. Auto-generate, publish, and auto-grade an exit-ticket quiz per lecture via the separate Quiz Generator.
6. Offer a lightweight social layer: browse, search, and up/down-vote decks and templates; user profiles; a "Latest" feed.
7. Support standards-based export/import: **YAML and Google Slides in both directions for decks and templates**, plus PDF export for decks. A style template can be derived from an existing Google Slides presentation, whether or not that presentation defines layouts of its own.
8. Meter and monetize usage through tiered plans (Free/Pro/Max) with server-configurable caps on costly services.
9. Keep the core logic provider-agnostic so AI engines (commercial or locally-hosted) and the billing provider can be swapped via configuration.
10. Provide a fully localized UI in English, French, Spanish, Russian, and Mandarin.
11. Keep all student data inside NYU-approved, FERPA-compliant systems. No student PII leaves the institution.
12. Remain discipline-agnostic and extensible so student teams can contribute features during the pilot.

#### 2.2 Non-Goals

- A pixel-perfect general-purpose design tool (e.g., a full PowerPoint/Keynote competitor). Editing and templating are first-class, but the system optimizes for fast, structured, AI-assisted decks rather than freeform graphic design.
- Real-time/live multilingual **translation** during the lecture (translating speech or generating translated slides on the fly). Post-lecture, on-demand translation of finished slides for viewing **is** supported ([SHARE-2](#share-2-post-lecture-translated-viewing)); only the live path is out of scope for the pilot ([§18](#18-future-work)).
- Locally-hosted / in-house AI models. The proposal names this as a _future_ direction; V2 uses commercial NYU-provided models.
- Running the Quiz Generator as a separate hosted service — V2 imports it **in-process as a versioned library** ([§17](#17-quiz-generator-integration)); it does not deploy, host, or proxy a standalone Quiz Generator service.
- Custom invoicing or purchase-order workflows — billing is subscription-based via the configured billing provider (Stripe by default; the provider is abstracted and swappable — [TECH-9](#tech-9-billing-provider-abstraction-layer)).

### 3. Personas & Roles

| Role                                | Description                                                                                        | Primary needs                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Instructor / author**             | Registered user who creates projects, delivers live lectures, and authors templates.               | Reliable real-time slides, seeding, editing, sharing, quiz oversight.        |
| **Student**                         | Receives the exit-ticket quiz; may also be a registered author (pilot students extend the system). | Timely quiz access; auto-grading; ability to browse/learn from public decks. |
| **Viewer (public/shared)**          | Anyone with a deck permalink.                                                                      | Read-only deck playback; optional voting if registered.                      |
| **Researcher / evaluator**          | PI and collaborators evaluating the pilot.                                                         | Anonymized exit-ticket scores, latency/reliability metrics, quality ratings. |
| **Administrator / operator**        | Allowlisted operator running the deployment ([§20](#20-administration-operations--moderation)).    | Oversight of users & content, audited moderation, health/config control.     |
| **Contributor (student developer)** | Pilot students extending the codebase.                                                             | Clear module boundaries, shared types, documented APIs.                      |

### 4. Accounts & Authentication

#### AUTH-1 Registration & sign-in methods

Users can register and log in by **either** of two supported methods:

- **Email + password** (with display name). Passwords are stored hashed (e.g., bcrypt/argon2); registration requires confirming an **email verification link** (AUTH-3) before the account is fully enabled.
- **Google sign-in** (OAuth 2.0 / OpenID Connect), which **supports NYU Google accounts** (NYU Workspace) as well as standard Google accounts. Google-verified email needs no separate verification step.
- **GitHub sign-in** (OAuth), for users who prefer their GitHub identity (convenient for the pilot's student developers).

A given **verified** email maps to a single account: if a user who registered with a password later signs in with Google or GitHub for that same verified email (or vice versa), the methods resolve to the same account rather than creating a duplicate. Where a provider does not expose a verified primary email (GitHub can omit this), the identity is treated as distinct until the user verifies/links it. Signing in is separate from **connecting** a Google or GitHub account for import/export, which requires broader scopes ([EXP-4](#exp-4-connected-accounts-google-drive--github)).

#### AUTH-2 Login & sessions

Email/password login issues JWT access + refresh tokens. Sessions persist across reloads; logout invalidates the refresh token.

#### AUTH-3 Email verification

Registration sends a verification link; unverified accounts have limited capability (e.g., cannot publish publicly) until verified.

#### AUTH-4 Password reset

Standard "forgot password" flow: time-limited, single-use reset link sent by email; resets invalidate existing sessions.

#### AUTH-5 Profile & ownership

Each user has a profile (display name, bio, avatar, **preferred locale**) and owns their projects, decks, and templates. The preferred locale drives the UI language ([TECH-12](#tech-12-internationalization-i18n--localization)); it is stored only once the user picks one, and the browser's language decides until then. Authorization enforces that users may only modify their own resources (except admins — [§20](#20-administration-operations--moderation), whose authorization comes from the allowlist, not ownership).

### 5. Plans, Billing & Usage Limits

#### BILL-1 Subscription tiers

The product offers four subscription tiers, each priced accordingly (exact prices set in configuration — BILL-6). **Every tier offers every service; they differ only in how much of each is allowed**, so no cap is ever `0`:

- **Free** — basic level for personal/occasional use; the default tier on registration. Sized to about two lectures a month.
- **Fresh** — entry paid tier, the step off Free; sized to about three lectures a month.
- **Pro** — mid level for professional / regular instructional use; sized to three courses, with substantially higher caps across every service.
- **Max** — highest tier; the largest usage caps. **Every cap is finite** — there is no unlimited tier, because unbounded usage is unbounded cost. Users who outgrow Max are invited to contact us rather than shown an upgrade path that does not exist (BILL-5).

Each tier defines what features are available and the usage caps that apply to costly services (BILL-3). **Speech capture works the same on every tier**: the engine is a deployment-wide choice ([TECH-4](#tech-4-server-configuration) `TRANSCRIPTION_PROVIDER`), not a per-tier one, so all users get whatever that deployment configured — cloud transcription with word timings, confidence, and retained audio, or the keyless browser engine without them. What differs by tier is the **allowance**: cloud transcription is the single largest cost driver in the product, so lower tiers get fewer minutes of it rather than a lesser engine.

**No tier withholds a service.** Every plan — Free included — offers every paid capability: both narration voice tiers, diarization, AI imagery, translation, and the audience allowances. Tiers differ only in how much of each they may use, so no cap is ever `0`. A capability that appears and disappears with the plan has to be explained wherever it might be missing; an allowance that runs out explains itself, and leaves the user with a number they can act on. The cost of the rule is that cheap tiers carry a little of every expensive line, so their allowances are correspondingly small ([docs/BILLING_COST_MODEL.md](BILLING_COST_MODEL.md)).

Per-tier cap values and the arithmetic behind them are in [BILLING_COST_MODEL.md](BILLING_COST_MODEL.md).

#### BILL-2 Billing provider (Stripe) integration

Payments and subscription management run through a configured **billing provider — Stripe by default**, integrated behind a provider-agnostic abstraction ([TECH-9](#tech-9-billing-provider-abstraction-layer)) so a different provider can be adopted later without reworking application logic:

- **Checkout** for new subscriptions and tier upgrades/downgrades.
- A hosted **customer/billing portal** for managing payment methods, invoices, and cancellation.
- **Webhooks** keep the user's subscription status (active, past-due, canceled) in sync with the provider as the source of truth for billing state; events are normalized to internal billing events at the adapter boundary.
- The app never handles raw card data; the billing provider is the system of record for payment instruments ([P-8](#16-privacy-security--compliance)).

#### BILL-3 Usage caps & metering

Each tier carries **usage caps on AI and other costly services**, metered per billing period and enforced **server-side**. Metrics are **provider-neutral** (`aiTokens`, not `geminiTokens`) so swapping an adapter ([TECH-8](#tech-8-ai-provider-abstraction-layer)) never renames a persisted metric. `null` means unlimited and **`0` means the capability is unavailable on that tier**, but no shipped tier uses `0` — every plan offers every service (BILL-1). The sentinel remains so a deployment can switch a service off entirely, and because "not included" and "used up" must read differently to whoever is blocked.

The metered resources:

- **`aiTokens`** — input + output across every LLM call: slide generation, refine, narrate, reformat, quiz, image re-rank, seed extraction, embeddings.
- **`sttMinutes`** — minutes streamed to cloud speech-to-text, summed across stream restarts, including post-lecture re-transcription (which is streaming-priced, not batch).
- **`diarizationMinutes`** — minutes submitted to batch diarization.
- **`ttsCharacters`** and **`ttsPremiumCharacters`** — characters synthesized on a cache miss, standard and premium voices metered separately since premium costs roughly twice as much.
- **`aiImages`** — AI-generated images ([IMG-4](#img-4-ai-generated-imagery-optional)), a Pro/Max capability.
- **`imageLookups`** — image-enrichment attempts, one per slide image resolved rather than one per provider HTTP request, so the number stays legible when the search fan-out is tuned.
- **`importMb`**, **`exports`** — document/Drive import volume and export operations.
- **`translationCharacters`** — source characters the owner translates ([SHARE-2](#share-2-post-lecture-translated-viewing)).
- **`audioStorageMb`** — retained lecture audio held at once. A **stock, not a per-period flow**: checked when audio is written, never reset by a period boundary. Each tier also sets **`audioRetentionDays`**, how long recordings are kept before the sweep deletes them. Both apply only where audio is retained at all, which today means the cloud capture engine — a browser-capture tier stores nothing, so its storage cap and retention window are reserved for a future that retains browser audio rather than live constraints.
- **`audienceTtsCharacters`**, **`audienceLocales`** — work caused by _viewers_ (a student's first playback of an un-narrated slide, or a translation they request), charged to the deck owner but drawn from a **separate allowance** so a widely-viewed deck can never exhaust its author's own budget.

**All usage is recorded, including cache hits.** Serving already-synthesized narration or an existing translation costs nothing and **never debits a cap**, but it is still recorded at zero cost — otherwise the count of users and students, and every average derived from it, reflects only the few who happened to trigger a paid call ([BILL-7](#bill-7-cost-attribution--admin-cost-reporting)).

Usage is recorded against the user's current period; the user can view remaining quota for each metered resource (BILL-4).

#### BILL-4 Enforcement & upgrade prompts

When a metered cap is reached, the system **fails gracefully**: the costly operation is blocked rather than silently incurring cost, and the user is shown a clear message with an **upgrade** path. Caps reset at the start of each billing period. Higher tiers raise the relevant caps.

- **Hard stop, never overage.** Exceeding a cap returns **HTTP 402** and the operation does not run; usage is never billed beyond the plan. Anything already generated and cached keeps working, so hitting a cap degrades what can be _created_, never what already exists.
- **Warn before blocking.** Crossing a cap is never the first the user hears of it; the thresholds, channels, and delivery rules are [BILL-8](#bill-8-cap-notifications-email--in-app).
- **Students are told least.** When a viewer's request is blocked, they see that the content is unavailable — never the instructor's billing state — and they receive no email: they may be anonymous, and the limit is not theirs to fix. The **instructor** is notified when their audience allowance is exhausted, with counts only and no student identities ([§16](#16-privacy-security--compliance)).
- **The call to action follows the tier.** Free, Fresh, and Pro see **Upgrade**; Max sees **Contact us**, since no larger plan exists (BILL-5).
- **Usage is visible before it binds.** A simplified view on the home page shows the metrics that are actually close to their limits; a detailed view in account settings lists every metric with used-versus-cap, the period reset date, and the instructor and audience allowances shown separately.

#### BILL-5 Plan management

Users can **upgrade, downgrade, or cancel** at any time via Stripe Checkout / the billing portal, with proration handled by Stripe. Feature access and caps update to match the active tier; downgrades take effect per the configured policy (immediately or at period end).

- **A downgrade can delete data.** Tiers differ in `audioRetentionDays` (BILL-3), so moving down shortens how long lecture audio is kept and may put existing recordings past the new limit. The user is warned about what will be removed **before** confirming ([P-10](#16-privacy-security--compliance)).
- **There is no tier above Max.** A Max user who needs more is directed to **contact us** for a custom arrangement rather than shown an upgrade that does not exist.

#### BILL-6 Configurable pricing & caps

Tier definitions — **price and per-tier usage caps** — live in **server-side configuration** (BILL config + Stripe price IDs in [TECH-4](#tech-4-server-configuration)) and are **adjustable without code changes**. Exact prices and cap values are TBD and will be tuned against real service costs ([§19](#19-open-questions)).

**Per-unit vendor prices are configuration too** — the rate per million tokens, per STT minute, per million TTS characters, and so on — so cost accounting (BILL-7) re-prices when a vendor changes its rates without touching code. Recorded cost is nevertheless **frozen at the moment it is written**: a later price change must never retroactively re-price history.

Adding a cap must not be able to take the server down: a metric absent from the config file reads as unlimited rather than failing validation, so a deployment whose config has not caught up degrades to permissive instead of refusing to boot.

The derivation of the shipped values — assumptions, vendor prices, per-lecture arithmetic, and how to recompute them — is documented in [BILLING_COST_MODEL.md](BILLING_COST_MODEL.md), which is the artifact to update when an assumption changes.

#### BILL-7 Cost attribution & admin cost reporting

Operators can see **what the deployment actually costs, and who it is spent on**. Every metered event (BILL-3) is recorded to an append-only cost ledger carrying the paying user, the acting user, the project and lecture it belongs to, the service, the quantity, and the money — priced from the configured service prices (BILL-6) and **frozen at write time**.

- **Attribution.** Cost rolls up per **user**, per **lecture**, and per **project** — a project's total being its lectures plus any project-scoped spend such as seed-material extraction. A lecture's owner is not always its project's owner, so both references are recorded when the event occurs rather than inferred later.
- **Instructor versus student.** Each view separates cost the instructor caused from cost their audience caused, since the two have different remedies: one is a plan-sizing question, the other an audience-reach question.
- **Who paid, who acted.** The deck owner always pays for audience activity (BILL-3), while the acting viewer is recorded separately — that pair is what makes both perspectives available from one ledger.
- **Counting people, not just spend.** Views report **how many students were involved** and the **average cost per student**. This is why cache hits are recorded at zero cost: a deck where two students trigger a translation and twenty-eight play the cached result costs what those two spent, but it reached **thirty** students, and an average computed over two would be an order of magnitude wrong.
- **Anonymous viewers are counted, not identified.** Unregistered playbacks are reported as an event count; assigning them tracking identities to make them countable would conflict with [§16](#16-privacy-security--compliance). Per-student averages are therefore scoped to registered students, and views say so rather than implying the average covers everyone. Student identities never appear in instructor-facing views or notifications.
- **Cache efficiency.** Because both billable and cached events are recorded, the cache-hit ratio and the resulting **cost avoided** fall out of the same data — the measure of whether caching is earning its complexity.
- **Where it appears.** Per-entity panels on the existing admin user, project, and lecture pages, plus deployment-wide averages — cost per user, per lecture, per project, per student, active users and students, and the largest spenders — on an admin overview ([§20](#20-administration-operations--moderation)). Exportable as CSV, like the other admin logs.
- **Retention.** Raw events are kept for a bounded window with monthly pre-aggregated roll-ups behind them, so queries stay cheap as the ledger grows ([P-11](#16-privacy-security--compliance)). Ledger rows are **never cascade-deleted** with the entities they describe — a deleted lecture's cost still happened — so the entity's name is denormalized onto the row.

#### BILL-8 Cap notifications (email & in-app)

A cap the user did not see coming is indistinguishable from a broken feature. Every metered resource (BILL-3) therefore notifies the account that pays for it **twice**: once while there is still room to act, and again when the work has actually been refused.

- **Two thresholds.** **Approaching** fires when usage crosses ~80% of a cap; **reached** fires when the cap blocks an operation. Both are sent **in-app and by email**, because the moment a cap binds is often not a moment the owner is looking at the app — a lecture stops recording, or a student cannot load a translation, hours after the owner last signed in.
- **The payer is notified, not the actor.** Notifications follow the account whose allowance was spent — the deck owner (BILL-3) — since they are the only person who can raise a cap. A viewer who triggers the block sees only that the content is unavailable ([BILL-4](#bill-4-enforcement--upgrade-prompts)), gets no email, and learns nothing about the owner's plan.
- **Audience exhaustion is reported to the owner in counts.** When an audience allowance runs out, the instructor is told how many playbacks or translations were refused — never which students, and never their identities ([§16](#16-privacy-security--compliance)). This is the case that most needs a notification, because the failure lands entirely on people the owner cannot see.
- **One message per (user, metric, period, threshold).** Recorded in `NotificationLog` ([§15](#15-data-models)) and checked before sending, so a blocked translation in a 30-student class produces one email rather than thirty. Crossings that occur close together coalesce into a single message listing each metric, so exhausting several caps in one lecture is not several emails. The record clears with the billing period, so the next period notifies afresh.
- **Delivery never affects the request.** Notifications are dispatched after the response is sent, and a send that fails is logged rather than raised — a mail outage must not turn a blocked action into a failed one, or a successful action into an error.
- **In-app state is persistent, not transient.** Approaching raises a dismissible notice; reached raises a banner that stays until the cap clears or the plan changes, because exhaustion is a standing condition rather than an event. Both carry the tier-appropriate action — **Upgrade** for Free, Fresh, and Pro; **Contact us** for Max (BILL-5).
- **Written for the person reading it.** Messages name the resource in plain language — "narration", "recording time" — not the metric identifier, and state how much was used, when it resets ([BILL-2](#bill-2-billing-provider-stripe-integration) period end, or the calendar month for tiers with no subscription), and what is now blocked.
- **Approaching emails can be silenced; reached emails cannot.** The 80% warning is advisory and users may turn it off per account. The exhaustion email explains why something the user just attempted did not happen, so it is transactional and always sent. In-app notices always appear regardless.
- **One mail transport, shared.** Notifications use the same sending module as account email ([AUTH-3](#auth-3-email-verification)); whichever ships first builds it, and the other consumes it. Two independent transports must not exist. Message text is localized from the user's stored locale, which requires server-side message catalogs — [TECH-12](#tech-12-internationalization-i18n--localization) covers client strings only, so this is a dependency and not an assumption.

### 6. Slide Projects & Seeding

#### PROJ-1 Pre-create a project

An instructor can create a **slide project** ahead of a lecture, with metadata (title, course, description) and optional **seed information** that informs later slide generation (topic outline, key terms, learning objectives, tone/style notes).

#### PROJ-2 Project lifecycle

Projects persist in MongoDB and can be reopened, duplicated, archived, and deleted. Deletion is a **soft delete** — recoverable during a retention window before a background sweep permanently purges it, and cascading to the project's decks ([P-10](#16-privacy-security--compliance)/[P-11](#16-privacy-security--compliance)). A project may contain multiple decks (e.g., one per lecture session).

#### SEED-1 Document seeding

Users can seed a project by importing content from:

- Uploaded **PDFs** and document files (e.g., `.docx`, `.pptx`, `.txt`, Markdown).
- A connected **Google Drive** account — **Google Docs**, Drive files, and **Google Slides** ([EXP-4](#exp-4-connected-accounts-google-drive--github)).
- A connected **GitHub** account — files from a repo or gist (e.g., previously-exported YAML decks/templates) ([EXP-4](#exp-4-connected-accounts-google-drive--github)).

Imported text is parsed, normalized, and stored as seed context for generation.

#### SEED-2 Image seeding

Users can upload **seed images** with **captions/descriptions/keywords**. Seeded images are preferred during generation when their captions match a slide's topic (see IMG-1).

#### SEED-3 Seed management

Users can view, edit captions for, reorder, enable/disable, and delete seeded content and images before or between sessions.

#### PREP-1 Preflight concept extraction

When a project has been seeded (SEED-1/SEED-2), the system can run an **optional, pre-lecture "preflight"**: the AI analyzes the uploaded files, the text description, and image captions to extract a ranked list of **concepts likely to come up** — key terms, named entities (people/places/orgs/products), jargon, and acronyms. Each candidate is presented with:

- a short **gloss** and the **source** it came from (which seed document/image);
- a **relevance score**;
- where a term is ambiguous, a **resolved sense / entity suggestion** (e.g., `Prince → Prince (musician)`, with the candidate Wikidata entity) to pre-empt mismatches ([IMG-3](#img-3-image-disambiguation)).

This is feasible with standard AI keyphrase/entity extraction over content the project already imports; it runs once and is cheap relative to the live session.

#### PREP-2 Instructor review & honing

The instructor refines the candidate set in an interactive back-and-forth before speaking. The UI allows the instructor to:

- **Add** concepts the AI missed (free text), **remove** irrelevant ones, and **edit** labels/glosses.
- **Disambiguate** an ambiguous term by choosing the intended entity/sense from suggestions (pre-resolving IMG-3 for the live run).
- Set **importance/priority** (e.g., "definitely cover" vs. "maybe") to weight downstream emphasis.
- Define **canonical names with synonyms/abbreviations** (e.g., "NYU" ↔ "New York University") so variants are recognized.
- Attach a **preferred image** per concept (from seeded images SEED-2 or a quick search) to be used when the concept arises.
- **Iterate with the AI** — ask it to suggest more concepts ("what am I missing?"), propose subtopics/definitions, or cluster related terms — a genuine honing loop.

These actions are available through the UI or **by voice** ([PREP-4](#prep-4-verbal-interaction-with-the-preflight)). Preflight is **optional and non-blocking**: the instructor may skip it and rely on live generation.

#### PREP-3 Use of the honed concept set

The confirmed concept set is saved to the project ([§15](#15-data-models)), reusable and editable across sessions, and drives the live lecture:

- **Generation bias** — supplied as part of seed context so slide generation ([GEN-1](#gen-1-speech-to-slide-generation)) frames and prioritizes these concepts correctly.
- **Transcription accuracy** — terms, names, acronyms, and synonyms are passed to Google Cloud Speech-to-Text **speech adaptation / phrase hints** ([CAP-3](#cap-3-speech-to-text-transcription)) so jargon and proper nouns transcribe correctly live.
- **Image pre-resolution** — disambiguated entities and preferred images mean the right picture is chosen the moment a concept is spoken ([GEN-7](#gen-7-ai-image-guidance) / IMG-3).

#### PREP-4 Verbal interaction with the preflight

The instructor can drive the preflight honing ([PREP-2](#prep-2-instructor-review--honing)) **by voice**, not just through the UI, using the existing speech-to-text ([CAP-3](#cap-3-speech-to-text-transcription)) and gen-AI text processing ([GEN-2](#gen-2-ai-provider-abstraction)) to interpret intent.

- The process **prompts** the instructor (e.g., "I found these 12 concepts — anything to add or remove?"), and the instructor responds naturally by speaking ("drop the last two, add photosynthesis, and Prince means the musician").
- Spoken input is transcribed (CAP-3) and parsed by the AI into concrete **honing actions** — add / remove / rename / disambiguate / set importance / define synonyms / "suggest more" — the same actions available in the PREP-2 UI.
- Unlike the fixed live command vocabulary ([CAP-4](#cap-4-voice-commands)), this is **conversational and free-form**: the model resolves intent from natural phrasing rather than matching set keywords.
- Each interpreted action is **echoed back for confirmation** (on screen, optionally spoken) before it is applied; **low-confidence or ambiguous** requests trigger a clarifying question instead of a wrong edit — a genuine back-and-forth.
- Voice is **complementary and optional** — the instructor can switch between speaking and the UI at any time — and doubles as a low-stakes rehearsal of the same speak-to-the-system interaction used during the lecture. Preflight STT and AI usage count against plan caps ([BILL-3](#bill-3-usage-caps--metering)).

### 7. Style Template Library

#### TMPL-1 Template library & preview

A browsable **template library** lets users preview and select slide-style templates. Each template defines a visual theme (colors, typography, spacing) plus a set of **layouts**.

#### TMPL-2 Conventional layout types

Each template provides multiple layout types, using conventional slide conventions, including at minimum:

- **Title / heading** slide
- **Section / subheading** slide
- **Content** (title + body) slide
- **List / bullet** slide
- **Image-heavy** (full-bleed or image-dominant) slide
- **Two-column** (text + image) slide
- **Quote / callout** slide

#### TMPL-3 Pre-made templates

Ship several polished, ready-to-use templates covering common lecture styles.

#### TMPL-4 Custom templates (create / edit / save)

Users can create, edit, save, and name their own templates — defining layouts and the **positioning** of slide content elements (title, body, image, caption) on each layout. Custom templates appear in the user's library and may be shared/published.

#### TMPL-5 Template application

A template (and any specific layout) can be applied at deck level and overridden per slide (see EDIT-3).

#### TMPL-6 Layout descriptors (for AI selection)

Every layout in a template carries a **machine-readable descriptor** so the AI can choose the right layout per slide ([GEN-6](#gen-6-ai-layout-selection)). A descriptor includes:

- a stable **`type`/id** and human label (e.g., `title`, `section`, `content`, `list`, `image-heavy`, `two-column`, `quote` — TMPL-2);
- a short **purpose / when-to-use** description the AI can reason over (e.g., "use for 3–6 parallel points");
- the **content slots** the layout expects (e.g., `title`, `body`, `bullets[]`, `image`, `caption`, `columns`) and any **constraints** (max bullets, approximate text length, whether an image is required/optional).

Descriptors are authored as part of the template (TMPL-3/TMPL-4), stored with it ([§15](#15-data-models)), and serialized into the generation request as the **option set** the AI must pick from.

#### TMPL-7 Whiteboard layout

Every design template **must** include a special **`whiteboard` layout** — a blank slate with **no content slots** — for freehand annotation ([EDIT-4](#edit-4-whiteboard-annotation) / [EDIT-5](#edit-5-whiteboard-tools)). Unlike the conventional layouts ([TMPL-2](#tmpl-2-conventional-layout-types)), it is **withheld from the AI's layout menu** ([GEN-6](#gen-6-ai-layout-selection)) — live generation never selects it. A user adds a whiteboard slide **explicitly**: the toolbar's new-whiteboard-slide button, the "new whiteboard" voice command ([CAP-4](#cap-4-voice-commands)), or the per-slide layout picker ([EDIT-3](#edit-3-per-slide-layout-switch)); the slide is created truly blank. (Behavior: [WHITEBOARD.md](WHITEBOARD.md); templates: [TEMPLATES.md](TEMPLATES.md).)

#### TMPL-8 Template import from Google Slides

A user can point at a **Google Slides presentation in their connected Drive** ([EXP-4](#exp-4-connected-accounts-google-drive--github)) and get its design back as a style template in their own library. Most instructors arrive with an existing deck rather than a design brief, so this — not the template editor ([TMPL-4](#tmpl-4-custom-templates-create--edit--save)) — is the realistic path to a template that looks like their own material.

Two sources, one result:

- **Presentations that define layouts.** The presentation's own masters and layouts are read directly and become the template's layouts.
- **Presentations that don't.** Most real decks are built by hand with no reusable layouts at all. The system then **derives** a template by analyzing how the slides are actually constructed — which content slots each slide carries, where they sit, and how they are styled.

**Near-identical slides must consolidate into one layout.** A hand-built deck typically contains the same design rebuilt many times over, each copy differing by a few pixels of slot position or size. Reproducing every variation would yield a template of twenty near-duplicate layouts, which is worse than useless. Slides that share a slot composition and sit within a tolerance of one another are recognized as **one design**, and the layout that results is **standardized** rather than copied from any single slide: representative positions, aligned edges and margins, and a quantized type scale, so the derived template is tidier than the deck it came from. One-off slides do not become layouts; they are mapped to the closest one.

What is captured: theme colors, typography, per-slot element geometry, and background images and logos (stored as the template's own assets). Each derived layout is mapped onto a conventional layout type ([TMPL-2](#tmpl-2-conventional-layout-types)) and given the machine-readable descriptor the AI selects from ([TMPL-6](#tmpl-6-layout-descriptors-for-ai-selection)); the required blank `whiteboard` layout ([TMPL-7](#tmpl-7-whiteboard-layout)) is synthesized on import. Fonts are mapped to available families rather than reproduced exactly, and no font is fetched from a third party at display time.

**Import is lossy and says so.** Because the conventional layout types are a fixed set, a presentation with more distinct designs than there are types yields fewer layouts than it had. The import returns a plain-language **report** of what happened — how many slides became how many layouts, what was merged, what was approximated, and any asset that could not be retrieved — surfaced to the user rather than logged. The imported template is saved as a normal user-owned template: renamable, duplicable, deletable, exportable ([EXP-6](#exp-6-template-export-to-google-slides)), and shareable under the same rules as any other ([TMPL-4](#tmpl-4-custom-templates-create--edit--save) / [SOC-1](#soc-1-voting)).

Importing a template never modifies the source presentation, and reads only presentations the user already has access to (P-5).

### 8. Live Lecture Capture

#### CAP-1 Session lifecycle

The user explicitly controls a live session with **Start**, **Pause/Resume**, and **Stop**. Stop finalizes the deck and can trigger quiz generation ([§17](#17-quiz-generator-integration)). Session state (listening / paused / stopped) is clearly indicated.

#### CAP-2 Microphone & permissions

The app requires microphone access, prompts for and reports permission state, and surfaces actionable errors rather than failing silently.

#### CAP-3 Speech-to-text transcription

- Uses **Google Cloud Speech-to-Text** for fast, accurate, low-latency transcription (removing V1's Chrome-only constraint).
- Audio is streamed and segmented into phrases on natural pauses; interim text may display as live captions, finalized phrases drive generation.
- **Speech adaptation** — when a preflight concept set exists ([PREP-3](#prep-3-use-of-the-honed-concept-set)), its terms, names, acronyms, and synonyms are supplied to Google Cloud STT as phrase hints/boosts so domain jargon and proper nouns transcribe correctly.
- Target: near-real-time latency suitable for live lecture (a key evaluation metric — [§12](#12-evaluation--metrics)). Raw audio is **not retained by default**; optional bounded retention (for diarization and original-audio playback) is governed by [P-6](#16-privacy-security--compliance).

#### CAP-4 Voice commands

The user can drive the slide generator hands-free by **speaking commands** — at minimum **start**, **stop**, **pause** (and resume), **rewind** (previous slide), and **fast-forward** (next slide) — mirroring the manual playback controls in [PLAY-1](#play-1-playback-controls).

- Commands are recognized from the same Google Cloud Speech-to-Text stream, using a small, configurable command vocabulary (with synonyms, e.g. "go back" → rewind) so they are **reliably transcribed** and unambiguous.
- A wake-word or command prefix (e.g., "slide machine, …") and/or a distinct command mode keeps ordinary lecture speech from being misinterpreted as a command; normal speech continues to drive slide generation (GEN-1).
- Recognized commands are confirmed visually (and optionally audibly) so the user can tell a command registered. Low-confidence matches are ignored rather than acted on, to avoid disrupting a live lecture.
- **AI command intent (experimental, flagged)** — in addition to the deterministic wake-word matcher, the generation model ([GEN-1](#gen-1-speech-to-slide-generation)) is offered the same command set and may classify a plain phrase ("let's go to the next slide") as a command instead of lecture content; the client executes it through the same path, and nothing persists. Off by default (`GENERATION_VOICE_COMMANDS`) because a misread phrase becomes a surprise navigation.

### 9. Slide Generation & Enrichment

#### GEN-1 Speech-to-slide generation

Each finalized phrase, combined with project **seed context**, is sent to the **Gemini API**, which identifies the topic, produces concise slide text, and maintains short rolling context across recent phrases so slides cohere across a topic. The model also **selects the slide layout** for each content block from the active template's options ([GEN-6](#gen-6-ai-layout-selection)), returning content already mapped to the chosen layout's slots, and **decides whether each phrase starts a new slide or updates the current one** ([GEN-8](#gen-8-new-slide-vs-update-current)).

#### GEN-2 AI-provider abstraction

The **core logic of the slide generator (and quiz maker) is decoupled from any specific LLM or AI engine.** All AI calls — speech-to-text, slide-content generation, and quiz generation — go through a provider-agnostic interface so engines can be swapped in/out without touching the generation logic.

- Gemini is the default provider for the pilot (migrating from V1's OpenAI integration), but the system must support substituting **other commercial providers or a locally-hosted/in-house model** purely via configuration and an adapter — no changes to the core generator.
- The abstraction spans every costly AI capability: **transcription** (CAP-3), **text generation** (GEN-1), and **quiz generation** (QUIZ-1) each define a stable internal contract that any provider adapter implements.
- The active provider per capability is selected in server configuration ([TECH-4](#tech-4-server-configuration)); multiple providers may be registered and chosen per capability (e.g., cloud STT + local LLM). See the adapter design in [TECH-8](#tech-8-ai-provider-abstraction-layer).

#### IMG-1 Real-time image enrichment

Slides are enriched with images using the AI's per-slide image guidance ([GEN-7](#gen-7-ai-image-guidance)), in priority order:

1. A **seeded** image the AI selected for the slide, or whose caption/keywords match the slide topic (SEED-2).
2. An image fetched in real time from **Wikimedia**, **Flickr**, and **Openverse** APIs using the AI's **recommended keywords** (falling back to the slide topic if none).
3. A graceful fallback (placeholder/solid layout) when no image is recommended or found.

#### IMG-2 Fault tolerance

Image enrichment is **fault-tolerant**: any single image API may be slow, rate-limited, or down without causing a hard failure. The system times out per source, falls back across sources, and never blocks slide display on image retrieval. Licensing/attribution metadata is captured where the source requires it.

#### IMG-3 Image disambiguation

Polysemous terms must not pull the wrong picture — speech about **"Prince" the musician** must not surface Wikipedia's imagery for the royal title. The system disambiguates both before and after fetching:

- **Disambiguated queries** — the AI's recommended keywords ([GEN-7](#gen-7-ai-image-guidance)) carry qualifying context from the lecture so the query targets the intended sense (e.g., `Prince (musician)` / `Prince Rogers Nelson`, not bare `Prince`). The model has the full phrase, rolling context, and seed context needed to resolve it.
- **Entity resolution** — for the Wikimedia path, the disambiguated term is resolved to a specific **Wikidata/Wikipedia entity** (choosing among candidates by best contextual match) and that entity's image is fetched, rather than a free-text page-title match that can land on the wrong article.
- **Relevance ranking & rejection** — candidate images carry metadata (titles, captions, tags, categories); candidates are ranked by similarity to the slide topic/keywords, and low-confidence matches are **rejected in favor of the graceful fallback** ([IMG-2](#img-2-fault-tolerance)). A missing image is preferable to a misleading one.
- **Consistency & caching** — the same disambiguated query is applied across Wikimedia / Flickr / Openverse, and the resolved entity/decision is cached per slide so re-runs ([GEN-4](#gen-4-post-lecture-ai-reformat-holistic-regeneration)) stay stable.
- **User override** — if disambiguation still picks poorly, the user can edit the keywords or replace the image ([EDIT-1](#edit-1-full-content-editing)).

#### IMG-4 AI-generated imagery (optional)

For slides that warrant a **custom diagram or infographic** rather than a stock photo, an image can be **AI-generated** instead of fetched. This is an **optional, off-by-default** enrichment source the AI may choose per slide ([GEN-7](#gen-7-ai-image-guidance)).

- **Provider-agnostic** — generation goes through an `ImageGenerationProvider` adapter ([TECH-8](#tech-8-ai-provider-abstraction-layer)); most major engines support this (e.g., Google's Gemini/Imagen "Nano Banana" family, OpenAI's image models), so the engine is configurable/swappable like every other AI capability ([GEN-2](#gen-2-ai-provider-abstraction)).
- **Best in the latency-tolerant paths** — generation is slower and costlier than a stock fetch, so it is favored in the **post-lecture reformat** ([GEN-4](#gen-4-post-lecture-ai-reformat-holistic-regeneration)) and on demand; live use is optional and limited.
- **Tiered & metered** — image generation is its own metered capability ([BILL-3](#bill-3-usage-caps--metering)), typically a **Pro/Max-tier** feature; results are cached per slide.
- **Provenance & disclosure** — AI-generated images are **labeled as such** (and may carry a provider watermark, e.g., SynthID); their provenance and licensing differ from stock imagery and are recorded for sharing/export ([§11](#11-exportimport-voting--social), licensing — [§19](#19-open-questions)).
- **Accuracy caveat** — generated infographics may contain factual or textual errors; the original content remains authoritative and the user can review, regenerate, or replace ([EDIT-1](#edit-1-full-content-editing)).

#### IMG-5 Image attribution & licensing display

Every image can carry a **caption** and **copyright/license attribution**, and this metadata is **captured, displayed, and editable** — regardless of source (seeded uploads, enrichment fetches from Wikimedia/Flickr/Openverse — [IMG-1](#img-1-real-time-image-enrichment), or AI-generated — [IMG-4](#img-4-ai-generated-imagery-optional)). Attribution is frequently a **legal requirement of the image's license** (e.g., Creative Commons `BY` clauses require crediting the author), so the system must surface it on the slide, not merely store it.

- **Captured at enrichment** — when an image is fetched, its licensing/attribution metadata is recorded on the slide ([IMG-2](#img-2-fault-tolerance)). The stored attribution follows the **TASL** convention where available: **T**itle of the work, **A**uthor/creator, **S**ource URL, and **L**icense name + license URL (plus a modifications note when the image was altered). Seeded and AI-generated images ([IMG-4](#img-4-ai-generated-imagery-optional)) carry attribution appropriate to their provenance.
- **On-slide indicator** — any image that has license/attribution data shows a **discreet information "i" icon** superimposed over the image's **bottom-right corner**. The icon is unobtrusive so it does not distract from the slide, but visible enough to be discoverable. Images with no attribution data show no icon.
- **Attribution dialog** — clicking (or activating via keyboard) the "i" icon opens a **modal dialog** presenting the full attribution: caption, title, author, source, license (as a link to the license text), and any modifications note. Links open the source and license in a new tab.
- **Owner/editor editing** — a user who is the **owner or an editor** of the deck ([SHARE-1](#share-1-saved-deck-viewer--permalink), [EDIT-1](#edit-1-full-content-editing)) can **modify** the caption and every attribution field from this dialog — to correct enrichment metadata, add missing credit, or supply attribution for an uploaded image. Viewers see the dialog read-only. Edits are subject to the same access control as other slide edits ([§16](#16-privacy-security--compliance)).
- **Preserved on share & export** — attribution travels with the image wherever the deck is shown or published: the on-slide indicator and dialog appear in the shared **deck viewer** ([SHARE-1](#share-1-saved-deck-viewer--permalink)), and attribution/license text is embedded in **exports** ([EXP-1](#exp-1-deck-export)/[EXP-2](#exp-2-standards-based-data-export)) so downstream copies remain license-compliant. This is the mechanism that resolves the image-licensing question in [§19](#19-open-questions).

#### GEN-3 Live display

Generated slides render full-screen in real time as the user speaks, advancing as new slides are produced, with a configurable minimum dwell time per slide.

#### GEN-4 Post-lecture AI reformat (holistic regeneration)

Once a session ends ([CAP-1](#cap-1-session-lifecycle) Stop) and the **full transcript** is available, the user is offered a **"Reformat with AI"** option that regenerates the deck holistically from the complete transcript plus project seed context — something the live, phrase-by-phrase pipeline (GEN-1) cannot do because it lacks the full picture.

Delivered as a **"Refine"** action with three **independently-toggleable passes** (identify speakers / refine slide content / refine spoken narration), run together as one background job the client polls; it can also be run **per slide** on demand. (Design: [DECISIONS.md](DECISIONS.md) "Refine: three opt-in passes".)

- **Identifies speakers (diarization)** — post-hoc, the retained lecture audio ([P-6](#16-privacy-security--compliance)) is grouped into speakers and roles are mapped by talk-time (lecturer vs. students), so **student turns can be reframed as questions** while the lecturer's words stay authoritative. Speaker/role tags are joined onto the timestamped transcript segments ([§15](#15-data-models)) by a pure time-join. Diarization runs behind a `DiarizationProvider` (Google Cloud), post-hoc rather than live to avoid added latency and a single-provider live dependency ([DECISIONS.md](DECISIONS.md)).
- **Improves and re-organizes content** — tighten wording, merge or split slides, add structure, and reconcile mid-lecture backtracking now that the whole lecture is known.
- **Re-selects template layouts per slide** — choose the most fitting layout type (heading, section, list, two-column, image-heavy, quote — [TMPL-2](#tmpl-2-conventional-layout-types)) for each slide given the overall arc, within the deck's chosen template ([EDIT-2](#edit-2-deck-level-template-switch) / [EDIT-3](#edit-3-per-slide-layout-switch)).
- **Re-enriches images** — re-runs image enrichment ([IMG-1](#img-1-real-time-image-enrichment) / IMG-2) for new or changed slides.
- **Refines spoken narration** — rewrites each slide's stored narration (`sourceTranscript`, [§15](#15-data-models)) so the read-aloud ([PLAY-2](#play-2-narration-playback)) stays in-line with the (possibly reformatted) slide; student slides are narrated as questions.
- **Non-destructive** — hand-edited slides are protected in every pass; a reformat proposes changes the user can preview/accept and preserves manual edits ([EDIT-1](#edit-1-full-content-editing)) where possible (with a warning when it would overwrite them).
- Uses the abstracted AI provider ([GEN-2](#gen-2-ai-provider-abstraction)) and counts against the user's AI usage caps ([BILL-3](#bill-3-usage-caps--metering) / BILL-4). The deck retains the finalized transcript ([§15](#15-data-models)) so reformatting can be re-run later.

#### GEN-5 Progressive slide rendering (skeleton loaders)

Live generation has unavoidable lag: slide text trails the spoken phrase ([CAP-3](#cap-3-speech-to-text-transcription)), and an enriched image ([IMG-1](#img-1-real-time-image-enrichment)) may arrive later still. Slides therefore render **progressively**, so the audience always sees forward motion without being confused by constantly changing content.

- **Render-as-ready** — a slide shows whatever parts are ready (e.g., title and body) immediately; each part still pending shows a **skeleton placeholder sized to the final layout**, so its space is reserved up front.
- **Slot-in on arrival** — slower content (typically the image, occasionally a refined heading) fades into its **reserved slot** when it arrives, without reflowing or reordering content already on screen — **no layout shift**.
- **Always-on activity indicator** — a subtle, persistent cue (a pulsing skeleton, a "generating…" affordance, and/or the live speech caption from CAP-3) signals that something is happening even while a slide is momentarily incomplete.
- **Stability over freshness** — once a slide's text is committed it stays put; interim transcription corrections are **debounced** so they settle before changing a displayed slide. If a slide's layout ([TMPL-2](#tmpl-2-conventional-layout-types)) must change after it is shown, the change happens through an **animated transition** ([GEN-9](#gen-9-animated-layout-transitions)), never an abrupt swap. The minimum dwell time (GEN-3) prevents rapid flips, and late content that would be too disruptive is deferred to the next slide rather than rewriting the current one.
- **Bounded waiting** — if an optional element never arrives (e.g., image enrichment exhausts all sources — [IMG-2](#img-2-fault-tolerance)), its skeleton resolves to the layout's graceful fallback rather than lingering indefinitely.

#### GEN-6 AI layout selection

The AI does not only write slide text — it also **chooses which layout each content block uses**.

- The active template's **layout descriptors** ([TMPL-6](#tmpl-6-layout-descriptors-for-ai-selection)) are serialized into the generation request as the explicit **option set** the model must select from.
- For each content block the model returns a **chosen `layoutType`** plus the content mapped to that layout's slots (title/body/bullets/image/caption/columns), so a list-like block becomes a list layout, a single striking idea becomes a quote/callout, etc.
- The choice is **constrained to the template's available layouts**; if the model returns an unknown or ill-fitting type, the system falls back to a sensible default layout (e.g., `content`).
- The user can always override the AI's choice per slide ([EDIT-3](#edit-3-per-slide-layout-switch)), and the post-lecture reformat ([GEN-4](#gen-4-post-lecture-ai-reformat-holistic-regeneration)) re-runs this selection holistically.

#### GEN-7 AI image guidance

For each slide, the AI also **recommends the supporting imagery**, feeding image enrichment ([IMG-1](#img-1-real-time-image-enrichment)):

- It returns **search keywords / query terms** to use against the image-enrichment providers (Wikimedia / Flickr / Openverse), **context-qualified to disambiguate polysemous names** (e.g., `Prince (musician)`, not bare `Prince`) — see [IMG-3](#img-3-image-disambiguation).
- When the project has **teacher-supplied (seeded) images** ([SEED-2](#seed-2-image-seeding)), their captions/keywords are sent to the model as context options, and the model may **select a specific seeded image** it deems the best fit for a given slide (or indicate that no image is needed).
- For a slide better served by a **custom diagram/infographic** than a stock photo, the model may instead recommend **generating** the image ([IMG-4](#img-4-ai-generated-imagery-optional)).
- This guidance is per-slide and optional: a slide may warrant no image, in which case the model says so and the layout adapts (TMPL-6).

#### GEN-8 New slide vs. update current

Not every phrase deserves a brand-new slide. As each finalized phrase arrives, the AI decides whether it **continues the current slide** or **starts a new one**, rather than always emitting a fresh slide.

- The model classifies the phrase against the **currently displayed slide** and rolling context and returns a structured action: **update current** (append a bullet, extend/refine the body, tighten the title), **new slide** (a topic shift), or **no visible change** (filler/aside).
- **Update** operations are **additive and contained** to preserve live stability ([GEN-5](#gen-5-progressive-slide-rendering-skeleton-loaders)): a new bullet slots into the reserved layout area, but already-committed text is not rewritten on screen; a change too disruptive to apply in place is deferred to a new slide instead.
- **Re-fit the layout on update** — just as it chooses a layout for new slides ([GEN-6](#gen-6-ai-layout-selection)), the AI can decide to **keep the current slide's layout or switch it** to better accommodate added content (e.g., promote a single-column `content` slide to `two-column` or `list` as it grows). Changing the layout of an already-displayed slide is done via an **animated transition** ([GEN-9](#gen-9-animated-layout-transitions)) so it reads as intentional.
- **Heading slides keep their layout** — a title or section slide introduces a topic rather than accumulating content, so the AI never re-fits one to a different layout mid-lecture: the title card a lecture opens with stays a title card, and material that needs body text or bullets spills into a new slide. The AI may still sharpen a heading's title/caption in place, and the instructor can switch its layout by hand ([EDIT-3](#edit-3-per-slide-layout-switch)).
- A slide's **layout slot capacity** ([TMPL-6](#tmpl-6-layout-descriptors-for-ai-selection)) bounds updates — when no available layout can hold the growing content, the overflow **spills into a new slide** with its own AI-selected layout ([GEN-6](#gen-6-ai-layout-selection)) rather than overstuffing the current one.
- These decisions are expressed as [TECH-13](#tech-13-application-actioncommand-layer) actions (`slide.append`, `slide.editContent`, `slide.setLayout`, `slide.new`), so the same logic serves live generation, the post-lecture reformat ([GEN-4](#gen-4-post-lecture-ai-reformat-holistic-regeneration)), and any agent.
- **Manual new-slide mode (opt-in)** — the instructor can require that new slides are created **only on an explicit spoken cue** such as "**next slide**" (a [CAP-4](#cap-4-voice-commands)-style command, with synonyms and the same reliable-transcription/confirmation handling). This is configurable **per project when pre-planning** ([PROJ-1](#proj-1-pre-create-a-project)) **or** as a **user-settings default that applies to all new projects** (overridable per project). In this mode the AI no longer decides _when_ to start a slide — ongoing speech only **updates the current slide**, and a new one appears solely on the cue — while the AI still handles content and layout (GEN-6) within each slide. Default is the automatic decision above; manual mode gives instructors deterministic pacing.

#### GEN-9 Animated layout transitions

When an **already-displayed** slide changes layout — whether from an AI update ([GEN-8](#gen-8-new-slide-vs-update-current)) or a user-driven template/layout change ([EDIT-2](#edit-2-deck-level-template-switch) / [EDIT-3](#edit-3-per-slide-layout-switch)) — the change is **animated** so it looks deliberate, not like a technical glitch.

- **Morph, don't snap** — shared elements (title, body, image, caption) **move, resize, and reflow** from their old positions to the new layout using stable element identity, animating smoothly between old and new placement rather than jumping; entering elements fade/slide in, leaving elements fade out.
- **Brief and bounded** — transitions use a short, consistent duration, and are **queued/debounced** so updates never overlap or trigger rapid re-animation (consistent with live stability — [GEN-5](#gen-5-progressive-slide-rendering-skeleton-loaders)).
- **Content-stable** — committed text/content is preserved across the transition; the layout (element arrangement) changes, the meaning does not.
- **Accessibility** — the **reduced-motion** preference is honored, falling back to a quick cross-fade or instant change.
- **Opt-out setting** — animated transitions **default to on**, and can be turned off **per project** ([PROJ-1](#proj-1-pre-create-a-project)) or as a **user-settings default applied to all new projects** (the same default/override pattern as GEN-8's manual mode). When off, layout changes apply instantly.
- One shared transition system covers live layout re-fits, new-slide advances, and post-lecture editing for a consistent feel.

#### GEN-10 Whiteboard generation pause & resume

While a live session is recording, whiteboard use ([EDIT-4](#edit-4-whiteboard-annotation) / [EDIT-5](#edit-5-whiteboard-tools)) **pauses slide generation** so the AI never shifts content out from under a mark. Two pause modes are surfaced by a single notification carrying a **Resume** control:

- **Drawing debounce** — while the instructor is actively drawing on any slide, generation pauses and **auto-resumes** shortly after the last gesture (a configurable grace window — `WHITEBOARD_SUPPRESS_DEBOUNCE_MS`, [TECH-4](#tech-4-server-configuration); `0` disables the grace), or immediately on **Resume**.
- **Whiteboard slide** — on a blank whiteboard-layout slide ([TMPL-7](#tmpl-7-whiteboard-layout)), generation pauses **manually** (no auto-resume): it stays paused until the user clicks **Resume**, speaks the "resume" voice command ([CAP-4](#cap-4-voice-commands)), or **creates a new regular slide** (the **+** button or the "new slide" voice command), which navigates off the canvas.

The spoken **"resume"** command is equivalent to the Resume control in both pause modes — the same action and the same confirmation — so an instructor working at the board never needs the mouse. It applies only while generation is actually paused.

**While paused, nothing is lost:** speech is still **transcribed** and the transcript is **recorded** (deck transcript, timestamped segments, and the slide's `sourceTranscript` — [§15](#15-data-models)); strokes keep saving on their own pipeline; and **voice commands keep working**. Only the creation of new slides and any content/layout change is skipped, and generation resumes where it left off once the pause clears.

A slide that already carries **visible** marks is further protected whenever it is the update target: updates are **additive only**, its layout is **pinned** (no refit/reformat), and an overflowing update spills to a **new** slide rather than reflowing the marked one ([GEN-8](#gen-8-new-slide-vs-update-current)). (Behavior: [WHITEBOARD.md](WHITEBOARD.md); design: [DECISIONS.md](DECISIONS.md) "Whiteboard ↔ live generation".)

**Metering note.** Gemini, Speech-to-Text, and image-API usage in §8–§9 all count against the user's plan caps (BILL-3) and are subject to enforcement (BILL-4).

### 10. Playback, Editing & Sharing

#### PLAY-1 Playback controls

During and after a session, simple UI controls let the user **start**, **pause**, **stop**, **rewind** (previous slide), and **forward** (next slide) through the deck. The same actions are available hands-free via spoken commands ([CAP-4](#cap-4-voice-commands)).

#### PLAY-2 Narration playback

Saved decks can be **spoken aloud**: play the whole deck (auto-advancing slide to slide) or a single slide from its menu, using **text-to-speech** of each slide's stored narration (`sourceTranscript`, [§15](#15-data-models); the server narrates from slide content when a slide has none). TTS runs behind a **provider-agnostic adapter** ([GEN-2](#gen-2-ai-provider-abstraction) / [TECH-8](#tech-8-ai-provider-abstraction-layer)) and synthesized audio is cached per slide; usage is metered ([BILL-3](#bill-3-usage-caps--metering)). Where a lecture's **original audio was retained** ([P-6](#16-privacy-security--compliance)), the owner can also **play a slide's original recording** from its menu.

#### EDIT-1 Full content editing

Users can **add, edit, and delete** all slide content: slide text (title/body/bullets/caption), images (replace from seed, re-fetch, upload, or remove), and slide order.

#### EDIT-2 Deck-level template switch

Users can switch the **entire deck's style template**, re-flowing all slides into the new theme/layouts.

#### EDIT-3 Per-slide layout switch

Users can change the **layout type** of an individual slide (e.g., convert a content slide to image-heavy or two-column) independent of the deck default.

#### EDIT-4 Whiteboard annotation

Users can **draw on slides like a whiteboard** — **pen** (opaque), **highlighter** (semi-transparent), and **eraser** — from a floating, draggable tool palette. Freehand strokes are stored **per slide** ([§15](#15-data-models)), with coordinates normalized to the slide so they survive layout/aspect changes; default colors come from the deck's design template.

- **Timed to the narration** — each stroke (and each **erase**, treated as a timestamped event, not a deletion) is anchored to a position in the slide's transcript, so during narration playback ([PLAY-2](#play-2-narration-playback)) the marks **appear and disappear in sync with the spoken words**, and a [GEN-4](#gen-4-post-lecture-ai-reformat-holistic-regeneration) narration refine re-anchors them proportionally. Marks made while **not recording** aren't tied to speech and are **always shown** on their slide.
- **Doesn't hijack live capture** — while the instructor is actively drawing (or on a blank whiteboard slide) during a live session, slide **generation pauses** ([GEN-10](#gen-10-whiteboard-generation-pause--resume)) — the speech is still transcribed but no slide is created or changed — with a Resume control and auto-resume after drawing stops; voice commands keep working. A slide that already carries marks stays additive-only (layout fixed, content never reformatted). Explicit new slides (the **+** button or the "new slide" voice command — [CAP-4](#cap-4-voice-commands)) still work. (Behavior: [WHITEBOARD.md](WHITEBOARD.md); design: [DECISIONS.md](DECISIONS.md) "Whiteboard drawings" and "Whiteboard ↔ live generation".)

#### EDIT-5 Whiteboard tools

The whiteboard drawing surface ([EDIT-4](#edit-4-whiteboard-annotation)) is driven by a **floating, draggable tool palette** whose position is remembered per lecture. It captures pointer events only while a tool is active, so it never blocks normal slide interaction.

- **Tools** — **pen** (opaque), **highlighter** (semi-transparent), and **eraser**.
- **Per-tool color & thickness** — each pen/highlighter keeps its own color and stroke thickness. **Press-and-hold** (or a small corner-triangle affordance) opens a color + thickness picker; default colors come from the deck's design-template theme (`penColor` / `highlighterColor`).
- **Undo / redo**, per slide.
- **New whiteboard slide** — a dedicated toolbar button (and the "new whiteboard" voice command — [CAP-4](#cap-4-voice-commands)) appends a blank whiteboard-layout slide ([TMPL-7](#tmpl-7-whiteboard-layout)) and arms the pen.

The tools write the per-slide stroke model ([§15](#15-data-models), `Slide.drawings`) that [EDIT-4](#edit-4-whiteboard-annotation) replays in sync with narration.

#### EDIT-6 Spoken transcript editing

Each slide's menu opens an editor for its **spoken transcript** (`sourceTranscript`, [§15](#15-data-models)) — the text read aloud during narration playback ([PLAY-2](#play-2-narration-playback)) — so a user can correct mis-transcribed speech or rewrite what the deck says. Changes save or cancel outright.

- **Whiteboard marks are preserved** — marks are timed by position within the transcript ([EDIT-4](#edit-4-whiteboard-annotation)), so a save **re-anchors** them onto the edited text by the phrase each was drawn over, exactly as a [GEN-4](#gen-4-post-lecture-ai-reformat-holistic-regeneration) narration refine does; a mark whose phrase no longer exists is orphaned — kept but hidden, in editing as well as playback — rather than left pointing at unrelated words, and reappears if wording it matches returns. The editor says so when the slide carries marks.
- **Clearing it is allowed** — an empty transcript returns the slide to being narrated from its own content ([PLAY-2](#play-2-narration-playback)).

#### SHARE-1 Saved deck viewer & permalink

Saved decks have a **deck viewer** reachable via a stable **permalink** that can be shared. Sharing visibility is controllable (private / unlisted-by-link / public). Public/shared class artifacts respect [§16](#16-privacy-security--compliance).

#### SHARE-2 Post-lecture translated viewing

When viewing a saved deck, students and instructors can switch the **displayed language of the slide content** to any supported locale (English, French, Spanish, Russian, Mandarin — [TECH-12](#tech-12-internationalization-i18n--localization)). This is an on-demand, **post-lecture viewing** option — distinct from the out-of-scope live/real-time translated generation ([§2.2](#22-non-goals)).

- Translation uses **Google Cloud Translation** (key already provisioned — [TECH-4](#tech-4-server-configuration)), behind a provider-agnostic adapter consistent with [GEN-2](#gen-2-ai-provider-abstraction).
- **Non-destructive** — the translated text is an alternate view layered over the deck; the original authored/generated content is preserved and remains authoritative (machine translation may be imperfect).
- Translations are computed on demand and **cached per deck + locale** ([§15](#15-data-models)), so repeat views are fast and the work is metered once ([BILL-3](#bill-3-usage-caps--metering)).
- Only **slide content** is translated (not quizzes). Translated text is lecture-derived and de-identified, consistent with [P-2](#16-privacy-security--compliance).

### 11. Export/Import, Voting & Social

#### EXP-1 Deck export

Decks can be exported to **PDF**, **Google Slides**, and other easily supportable common formats.

Google Slides export offers a **choice of two shapes**, because the two reasons to export are different:

- **A flat deck** (the default) — slides with their formatting baked in and no reusable layouts. The right answer for handing someone a finished lecture: nothing to maintain, nothing to break.
- **A deck carrying reusable layouts** — the deck's style template is exported alongside it as the presentation's own layouts, and each slide is attached to the layout it uses. The right answer for continuing to work in Google Slides, restyling the deck there, or re-importing it later ([TMPL-8](#tmpl-8-template-import-from-google-slides)).

The second shape needs a template that carries element positioning, so it is offered only for decks whose template has it. Exporting a template on its own is [EXP-6](#exp-6-template-export-to-google-slides).

#### EXP-2 Standards-based data export

Both **slide decks** and **style templates** can be exported to a standard, human-readable format (**YAML** or equivalent) capturing structure, content, and styling. For a template this includes its **layout geometry** — where each content slot sits and how it is styled — not merely the layout descriptors, so the exported file describes the design fully enough to reconstruct it.

#### EXP-3 Round-trip import

The exported format is **import-compatible**: a user can re-import a previously exported deck and/or template and restore it faithfully. Import validates and reports errors without partial-corrupting existing data. Imports may come from an upload or a connected account (EXP-4).

Round-tripping is a **stated guarantee, not a hope**: a deck or template exported and re-imported must come back materially unchanged, including a template's theme, layouts, and geometry (EXP-2). Where the format has versions, older exports remain readable.

The two directions differ in how they treat an unresolvable reference. A **deck** import that names an unknown template falls back to a default and warns — the lecture's content is the point and is still worth recovering. A **template** import cannot do that: there is nothing to fall back to, so it **fails with an explanation** rather than substituting a design the user did not ask for.

#### EXP-4 Connected accounts (Google Drive & GitHub)

Users can connect their **own Google Drive and/or GitHub** accounts via OAuth to import from and export to those resources:

- **Import** — pull source documents and previously-exported decks/templates from Drive or a GitHub repo/gist ([SEED-1](#seed-1-document-seeding)).
- **Export** — push outputs to the connected destination: **PDF / Google Slides / YAML** to Google Drive, and **YAML** deck/template files to a GitHub repo (round-trippable via EXP-3).
- Connecting an account is **separate from sign-in identity** (AUTH-1): it grants broader, purpose-specific scopes (Drive files / repo contents) and a user who signed in by email can still connect Drive and GitHub. Connections are listed in the profile and are **revocable** at any time; tokens are stored encrypted ([P-9](#16-privacy-security--compliance)).
- Reading a user's **existing** Google Slides presentations (TMPL-8 / EXP-5) requires a **presentation-read scope** beyond those needed to create files. Because a stored authorization only carries the scopes granted when it was issued, **adding a scope requires already-connected users to reconnect once**; the app detects the missing grant and prompts, rather than failing without explanation. Setup: [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md).

#### EXP-5 Lecture import from Google Slides

A user can create a lecture from an **existing Google Slides presentation** in their connected Drive, rather than starting from speech or a YAML file. The presentation's design is derived into a style template exactly as [TMPL-8](#tmpl-8-template-import-from-google-slides) describes, and its **content** is imported onto that template as the lecture's slides.

- **Layout assignment comes free from the same analysis.** Deriving the template already determines which design each source slide belongs to, so each imported slide is placed on the layout it actually came from — not re-guessed afterwards.
- **Content maps by slot.** A slide's title, body text, bullet lists, images, and captions are mapped onto the corresponding content slots ([TMPL-2](#tmpl-2-conventional-layout-types)); images are copied into the app so the lecture does not depend on the Google file continuing to exist.
- The result is an ordinary deck: editable ([EDIT-1](#edit-1-full-content-editing)), narratable, shareable, and exportable. The instructor can then lecture over it, refine it ([GEN-4](#gen-4-post-lecture-ai-reformat-holistic-regeneration)), or keep only the template.
- The same **report** described in TMPL-8 covers the content side: slides whose material did not fit the layout it was mapped to are named rather than silently truncated.

Importing a lecture never modifies the source presentation.

#### EXP-6 Template export to Google Slides

A style template can be exported to the user's Google Drive as a **Google Slides presentation whose layouts are the template's layouts**, with one demonstration slide per layout so the design is visible and immediately usable.

Google Slides has **no separate "template" file type** — a template there is simply a presentation whose layouts define a design, which is what users copy and build on. Exporting a template therefore means producing exactly that, not a document of a special kind.

- The template's theme, per-layout geometry, and background images and logos are carried into the exported presentation, so the file stands on its own without referring back to this app.
- Export is **round-trip compatible with [TMPL-8](#tmpl-8-template-import-from-google-slides)**: a template exported to Google Slides and imported back is materially the same template.
- The `whiteboard` layout ([TMPL-7](#tmpl-7-whiteboard-layout)) is an app-only blank slate with no visual design to carry, so it is omitted from the export and re-synthesized on import.

#### SOC-1 Voting

Registered users can **up/down-vote** slide decks and style templates. Vote tallies inform ranking and discovery; one vote per user per item, changeable.

#### SOC-2 Browse, search & sort

A simple social layer lets users **browse and search** others' public decks and style templates, by title, author, tags, and content. Every browsable list — decks and templates alike — is **sortable by recency** (most recently published first) and **by rank** (highest net vote score first, from SOC-1), and the chosen sort applies to search results as well.

#### SOC-3 Feeds

Two default views surface public content, both searchable/filterable and available for decks and templates: a **"Latest"** feed (sorted by recency) and a **"Top"** feed (sorted by rank). These are the SOC-2 sorts applied to the global public listing.

#### SOC-4 User profiles

Each user has a public **profile page** listing their published decks and templates, with search and the same recency/rank sorting (SOC-2) within the profile.

### 12. Evaluation & Metrics

The system must surface data supporting the grant's mixed-methods evaluation ([GRANT_PROPOSAL.md](GRANT_PROPOSAL.md) §4):

#### Process measures

- System reliability (session completion rate, API error rates, image-enrichment fallbacks).
- Speech-to-text latency (phrase finalization time) and slide-generation latency.
- Slide- and quiz-relevance ratings (via the SOC voting layer and/or instructor/student 1–5 ratings).

#### Learning measures

- Exit-ticket scores as a per-lecture comprehension signal.
- Comparison across Slide-Machine-delivered units vs. traditionally-delivered units in the same course.
- Student survey on clarity, engagement, perceived usefulness.

#### Extensibility measure

- Count and nature of student-contributed features merged during the pilot.

All metrics are anonymized before analysis.

## Part II — Technical Design

### 13. System Architecture

#### Architecture style: modular monolith ("monolith-first")

V2 ships as a **modular monolith** — a single deployable Express application (serving the React SPA and the REST API) backed by one MongoDB database — rather than a fleet of microservices. The candidate services one might split out (auth, enrichment, speech-to-text, slide generation, quiz generation, web UI, data logging) exist instead as **cohesive internal modules** behind clean seams.

This is a deliberate "monolith-first" choice for the build team (PI + one grad student), a single-course Fall-2026 pilot, a tight Summer-2026 timeline, and a $2k services budget. Microservices' costs — independent deploys, inter-service auth, network-failure handling, distributed tracing, and Kubernetes operations — buy scaling and team-autonomy benefits this project does not yet need, while making the system harder for pilot students to run and extend. The monolith keeps **one deploy and one local `docker compose up`** ([TECH-10](#tech-10-deployment-topology-digital-ocean-app-platform), [TECH-11](#tech-11-local-dev--cicd)).

Crucially, the existing **provider abstractions** (TECH-8 AI, TECH-9 billing) and **shared-types seams** (TECH-6) keep module boundaries explicit, so a module can later be extracted into its own service **if** load ever justifies it — with no rewrite. The **first extraction candidate** is the latency-sensitive real-time **STT → slide-generation pipeline** ([§18](#18-future-work)). The Quiz Generator is a **separate repository imported in-process** as a versioned library ([§17](#17-quiz-generator-integration)) — reusable on its own, but not a separate deployment.

**Internal modules** of the Express monolith: `auth`, `billing`, `projects`, `seeding/ingest` (incl. Drive/GitHub connected accounts), `transcription` (STT adapter), `generation` (slide-gen), `enrichment` (images), `social` (votes/feed/search), `export/import`, `logging/metrics`, and a `quiz-bridge` that wraps the **imported Quiz Generator library** ([§17](#17-quiz-generator-integration)). External engines (Google Cloud STT, Gemini, image APIs, Stripe, Google/GitHub APIs, and the Google Forms/Drive API the imported library calls) sit behind the modules as the diagram shows.

```text
┌──────────────────────────── Client (browser) ────────────────────────────┐
│  React + Vite + TailwindCSS SPA                                           │
│   • Auth UI (register / login / reset)   • Billing UI (Stripe Checkout)   │
│   • Project & seeding UI       • Live capture + real-time slide display   │
│   • Template library + editor  • Deck editor   • Social feed / profiles   │
│   • Playback controls (start/pause/stop/rewind/forward)                   │
└───────┬───────────────────────────────────────────────────┬──────────────┘
        │ Web Speech / mic                                   │ REST + JWT
        ▼                                                    ▼
┌─────────────────┐                          ┌──────────────────────────────┐
│ Google Cloud    │                          │  Express.js API (Node)        │
│ Speech-to-Text  │◀── audio/stream          │   • Auth (JWT, password reset)│
└─────────────────┘                          │   • Billing + usage metering  │
┌─────────────────┐                          │   • Projects / decks / slides │
│ Gemini API      │◀── speech + seed ───────▶│   • Templates / library       │
└─────────────────┘    slide/quiz content    │   • Seeding ingest (PDF/Docs) │
┌──────────────────────────────────┐         │   • Image enrichment proxy    │
│ Wikimedia · Flickr · Openverse   │◀───────▶│   • Social: votes/feed/search │
└──────────────────────────────────┘         │   • Export/import             │
┌──────────────────────────────────┐         └──────┬─────────────┬──────────┘
│ Google Drive / Docs / Slides API │◀───────────────┤             │
└──────────────────────────────────┘                │             ▼
┌──────────────────────────────────┐   webhooks  ┌───────────┐ ┌───────────┐
│ Stripe (payments/subscriptions)  │◀───────────▶│  Express  │ │  MongoDB  │
└──────────────────────────────────┘             └───────────┘ └───────────┘
┌──────────────────────────────────┐   quiz-bridge imports the Quiz
│ Google Forms / Drive API         │◀── Generator library, which calls
└──────────────────────────────────┘   Forms/Drive in-process (§17)
```

The **Express.js API** box above is the **modular monolith** (its bulleted responsibilities are the internal modules listed earlier); everything outside it — Google Cloud STT, Gemini, image APIs, Stripe, Google/GitHub APIs, MongoDB, and the Google Forms/Drive API — is an external dependency or a separate deployment. The Quiz Generator remains a **separate repository** but is **imported in-process as a versioned library** (not a separate deployment); Slide Machine consumes it through its exported function contracts ([§17](#17-quiz-generator-integration)).

### 14. Technical Stack & Conventions

#### TECH-1 Front-end

- **React** (function components + hooks) built with **Vite**, styled with **TailwindCSS**.
- Client-side routing for projects, deck viewer/permalinks, template library, billing, social feed, and profiles.
- Real-time slide rendering driven by streamed transcription/generation events.

#### TECH-2 Back-end

- **Express.js** (Node) REST API.
- **JWT-based authentication**: short-lived access tokens + refresh, sent as `Authorization: Bearer` (or secure httpOnly cookie). Protected routes enforce role/ownership checks.
- Stateless API layer; all persistence in MongoDB. Billing state is reconciled from Stripe webhooks.

#### TECH-3 Database

- **MongoDB** (via an ODM such as Mongoose). Collections defined in [§15](#15-data-models). Stores users, subscriptions, usage records, projects, decks, slides, templates, votes, and social/feed metadata. Raw lecture audio is **not** persisted.

#### TECH-4 Server configuration

Server-side secrets and global settings live in a `.env` file (never committed), including:

- `OPENAI_API_KEY` _(legacy)_ / `GEMINI_API_KEY` _(post-migration)_ and model/endpoint settings.
- `GOOGLE_APPLICATION_CREDENTIALS` (service account for real-time Speech-to-Text streaming) and `GOOGLE_CLOUD_TRANSLATION_KEY`.
- `TRANSLATION_PROVIDER` — the active slide-content translation adapter (SHARE-2): `google-cloud` (default, needs the key above), `none` to disable translated viewing, or `mock` for tests. Without a usable key the client hides the viewer's slide-language switcher.
- `GOOGLE_OAUTH_CLIENT_ID/SECRET` — used both for **Google sign-in** (AUTH-1) and for **connected Google Drive** import/export with broader scopes (EXP-4); plus any service-account credentials for Docs/Slides.
- `GITHUB_OAUTH_CLIENT_ID/SECRET` — used both for **GitHub sign-in** (AUTH-1) and for **connected GitHub** repo/gist import/export (EXP-4).
- `CONNECTED_ACCOUNT_TOKEN_ENC_KEY` — key for encrypting stored connected-account OAuth tokens at rest (P-9). App-generated (not a Google credential): 32 random bytes, base64-encoded — see [generating the key](GOOGLE_API_KEYS.md#encryption-key-for-stored-tokens-connected_account_token_enc_key).
- `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, token TTLs.
- Image-API keys/config (Flickr; Wikimedia and Openverse are keyless/optional).
- Billing-provider credentials (adapter-specific; for the default Stripe adapter: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and per-tier price IDs) plus a `BILLING_PROVIDER` selector ([TECH-9](#tech-9-billing-provider-abstraction-layer)).
- Object-storage credentials for **DO Spaces** (S3-compatible) used by uploads/exports (TECH-10).
- SMTP / email-provider settings for verification and password-reset mail.
- `DELETED_DATA_RETENTION_DAYS` — days a soft-deleted record ([P-10](#16-privacy-security--compliance)) is retained before the daily background sweep permanently purges it (default **90**; `0` = keep tombstones indefinitely — [P-11](#16-privacy-security--compliance)).
- `ADMIN_EMAILS` — comma-separated allowlist of account emails granted admin access ([§20](#20-administration-operations--moderation) ADMIN-1). Read on **every** request (not captured at import), so adding/removing an email takes effect without a code deploy or migration.
- `STT_CAPTURE_SAMPLE_RATE` — rate (Hz) the browser downsamples mic audio to before streaming ([CAP-3](#cap-3-speech-to-text-transcription)), published to the client via `/api/config`. Default **24000** — 16 kHz is what the models expect, the extra is for per-slide playback fidelity ([PLAY-2](#play-2-narration-playback)); range 8000–48000, or `0` for no downsampling at all. Raising it multiplies socket traffic, server-side retention memory, and stored WAV size for no transcription gain, and shortens how long a session runs before AUDIO_RETENTION_MAX_SESSION_MB truncates it.
- `AUDIO_RETENTION_MAX_SESSION_MB` / `AUDIO_RETENTION_MAX_TOTAL_MB` — ceilings (MB) on audio buffered in server memory for one live session and for all concurrent sessions ([GEN-4](#gen-4-post-lecture-ai-reformat-holistic-regeneration) Phase 2 / [P-6](#16-privacy-security--compliance)); defaults **300** and **1024**, `0` = no limit. Past either, the affected sessions transcribe **without** retaining audio — transcription and generation are never affected.

**Numeric-`0` convention.** Across the retention ceilings, retention-day counts, and `STT_CAPTURE_SAMPLE_RATE`, `0` means **"no limit"**, never "off" — it removes a bound and therefore costs _more_ (audio kept forever, unbounded buffers, no downsampling). `WHITEBOARD_SUPPRESS_DEBOUNCE_MS` is the exception, where `0` is a literal zero-length grace window.

**Plan definitions** — the Free/Fresh/Pro/Max **prices, usage caps, and retention policy** (BILL-1, BILL-3) live in an adjustable server-side config (`config/plans.json`, path overridable) so pricing and caps can be tuned **without code changes** (see BILL-6 and TECH-4). Illustrative shape, one tier shown:

```jsonc
{
  "fresh": {
    "priceId": "price_fresh_xxx",
    "audioRetentionDays": 14,
    "caps": {
      "aiTokens": 14000000,
      "sttMinutes": 0, // 0 = unavailable on this tier (browser capture only)
      "ttsCharacters": 200000,
      "audienceLocales": 3,
      // …one entry per metered resource (BILL-3)
    },
  },
}
```

(`null` = unlimited, `0` = unavailable on that tier, an absent metric reads as unlimited. Shipped values and their derivation: [BILLING_COST_MODEL.md](BILLING_COST_MODEL.md).)

**Service prices** — the per-unit vendor rates those caps were derived from live beside them in `config/service-prices.json`, so cost accounting (BILL-7) re-prices without a code change.

#### TECH-5 Client configuration

Client build/runtime variables live in a Vite env file (`.env.local`, `VITE_`-prefixed), e.g. `VITE_API_BASE_URL`, `VITE_STRIPE_PUBLISHABLE_KEY`, public Google/GitHub OAuth client IDs (for sign-in and connect flows), feature flags, and analytics toggles. **No secrets** are exposed to the client.

#### TECH-6 Shared types & data models

Where feasible, front-end and back-end share **TypeScript** types and data-model definitions (e.g., a shared `packages/types` or `shared/` module) so DTOs, deck/slide/template/plan schemas, and API contracts have a single source of truth. The codebase is TypeScript end-to-end.

#### TECH-7 Testing & coverage

- **100% code coverage** target across **unit**, **integration**, and **end-to-end** tests.
- Unit/integration via a standard runner (e.g., Vitest/Jest) for both client and server; integration tests exercise the Express API against a test MongoDB instance.
- **End-to-end tests use a Playwright harness** covering the critical user journeys (register → subscribe → create project → seed → live capture → edit → share → export → vote), including cap-enforcement and upgrade paths.
- External services (Gemini, Google Cloud, image APIs, Stripe, Google Forms/Drive) are mocked/stubbed in CI; coverage gates block merges below target.

#### TECH-8 AI-provider abstraction layer

The system implements GEN-2 with a **capability-based adapter layer** so the core slide-generation and quiz-generation logic depends only on interfaces, never on a concrete AI vendor (dependency inversion):

- **Capability interfaces** (defined once in the shared types module, [TECH-6](#tech-6-shared-types--data-models)): `TranscriptionProvider` (audio → text), `GenerationProvider` (speech + seed context + layout descriptors + seeded-image descriptors → slide content with a chosen layout and image guidance — GEN-6/GEN-7), `QuizGenerationProvider` (slide text → quiz definition), and `ImageGenerationProvider` (prompt → generated image — IMG-4). Each interface fixes the request/response contract independent of any vendor.
- **Adapters** implement those interfaces per engine — e.g. `GeminiGenerationProvider`, `GoogleCloudTranscriptionProvider`, and future `LocalLlmProvider` / `LocalWhisperProvider` for self-hosted models — with no other code aware of which is active.
- A **provider registry** resolves the active adapter **per capability** from server config ([TECH-4](#tech-4-server-configuration)), so capabilities can mix sources (e.g., cloud STT + locally-hosted LLM) and a provider can be swapped by configuration alone, with no change to generator logic.
- Usage metering (BILL-3) and cost accounting hook in at the adapter boundary, so caps and pricing remain consistent regardless of provider.
- The imported Quiz Generator library follows the **same principle** ([§17](#17-quiz-generator-integration)): its Forms-publishing logic is **decoupled from auth** — the caller injects the authorized Google client — so, like the monolith's own adapters, it depends on an injected contract rather than a fixed environment.

#### TECH-9 Billing-provider abstraction layer

Billing is decoupled from any specific payment vendor, the same way AI is (TECH-8), so the provider can change without touching application logic:

- A single **`BillingProvider` interface** abstracts the operations the app needs — create/checkout subscription, change tier, open billing portal, cancel, and **normalize provider webhooks into internal billing events** (`subscription.active`, `subscription.past_due`, `subscription.canceled`).
- A **`StripeBillingProvider` adapter** implements it for the pilot; future adapters (e.g., Paddle, Braintree, Chargebee) implement the same interface. Only the adapter knows vendor-specific objects, API shapes, and webhook formats.
- Application and UI logic deal exclusively in **internal, provider-neutral concepts** — tier, subscription status, and opaque customer/subscription references — never vendor-specific types.
- The active provider and its credentials are selected in server config ([TECH-4](#tech-4-server-configuration)); provider-specific keys and price IDs are isolated to the adapter.
- Persisted billing references are **provider-neutral** ([§15](#15-data-models)): a `billingProvider` discriminator plus opaque `billingCustomerId` / `providerSubscriptionId`, so a future migration is an adapter + data backfill, not an application rewrite.

#### TECH-10 Deployment topology (Digital Ocean App Platform)

The modular monolith ([§13](#13-system-architecture)) deploys to **Digital Ocean App Platform** (PaaS), chosen for minimal operational overhead (step-by-step setup: [DEPLOY.md](DEPLOY.md)):

- **App components** — one **API service** (the Express monolith) plus a **static site** component for the built React/Vite SPA (or the API serves the static bundle). App Platform provides managed TLS, build-on-push, and rolling deploys. Secrets are set as App Platform env vars, mirroring [TECH-4](#tech-4-server-configuration).
- **Database** — **MongoDB Atlas** (automated backups, point-in-time restore) rather than self-hosted.
- **Object storage** — **DO Spaces** (S3-compatible) for uploaded seed assets, cached enrichment images, and generated exports.
- **Scaling** — the API is stateless (JWT), so App Platform can run multiple horizontal instances behind its load balancer. The one caveat is **real-time STT streaming**: a WebSocket pipeline needs sticky sessions, or the client streams audio **directly to Google Cloud STT** with the back-end only brokering credentials (see [§19](#19-open-questions)).
- **Quiz Generator** — **not** a separate deployment: it is imported in-process as a versioned library ([§17](#17-quiz-generator-integration)); its Google Forms/Drive calls run inside the monolith using the instructor's connected-account token (EXP-4).

#### TECH-11 Local dev & CI/CD

- **Local dev** — a `Dockerfile` plus `docker compose` (app + MongoDB, with Spaces mockable via an S3-compatible local service) lets contributors — including pilot students — run the whole stack with **one command**, and lets the Playwright e2e harness ([TECH-7](#tech-7-testing--coverage)) run against a realistic environment.
- **CI/CD** — GitHub Actions runs unit + integration + e2e tests and enforces the **100% coverage gate**, then **auto-deploys to App Platform on push to the default branch** (App Platform's GitHub integration), replacing V1's GitHub Pages workflow (`.github/workflows/static.yml`). Failed gates block deploy.

#### TECH-12 Internationalization (i18n) & localization

The application UI is fully internationalized — no hardcoded user-facing strings.

- **Supported locales** at launch: **English (`en`), French (`fr`), Spanish (`es`), Russian (`ru`), and Mandarin Chinese (`zh`)**. All five are left-to-right; the i18n layer should not preclude adding a right-to-left locale later (use logical CSS properties and a per-document `dir`).
- **Implementation** — an i18n library (e.g., **react-i18next** / FormatJS with **ICU message format**) with one resource bundle per locale; pluralization and date/number/currency formatting via the `Intl` API. Adding a locale is a resource-bundle addition, not a code change.
- **Locale selection** — detected from the browser on every visit and matched against the locales supported at that moment, falling back to English when none is; overridable by an in-app language switcher, whose choice is **persisted to the user profile** (`User.locale`, AUTH-5). Nothing is stored until a language is explicitly chosen, and the switcher's default option clears it again — so an account that never chose one keeps following its browser, and a newly supported locale reaches those accounts without a migration.
- **Scope boundary** — i18n localizes the application UI/chrome only and does **not** automatically translate slide/quiz content. Translating **slide content** is a separate, explicit, on-demand **post-lecture viewing** feature ([SHARE-2](#share-2-post-lecture-translated-viewing)); live/real-time translated generation remains out of scope ([§2.2](#22-non-goals), [§18](#18-future-work)).
- **Relationship to speech/generation** — the STT language ([CAP-3](#cap-3-speech-to-text-transcription)) and the language the generator is asked to produce ([GEN-1](#gen-1-speech-to-slide-generation)) default to the user's locale but remain independently selectable, so an instructor can run the UI in one language while lecturing/generating in another.
- **Testing** — locale resource-bundle completeness is checked in CI, and at least one non-English locale is exercised in the Playwright e2e suite ([TECH-7](#tech-7-testing--coverage)).

#### TECH-13 Application action/command layer

All operations that modify a project, concept set, or deck are exposed through a **single channel-agnostic action/command layer** — a named set of operations (e.g., `concept.add`, `concept.disambiguate`, `slide.editContent`, `slide.setLayout`, `deck.switchTemplate`, `deck.reformat`, `slide.setImageGuidance`) rather than logic embedded in individual UI handlers.

- Each action validates input, enforces **authorization/ownership** and **plan-cap metering** (BILL-3), and records the change once — so every channel behaves identically and securely.
- The layer is consumed by **multiple front ends**: the React UI, the verbal preflight loop ([PREP-4](#prep-4-verbal-interaction-with-the-preflight)), the post-lecture reformat ([GEN-4](#gen-4-post-lecture-ai-reformat-holistic-regeneration)), and any future agent interface.
- This makes a future **MCP server** ([§18](#18-future-work)) a thin facade that maps MCP tools onto existing actions, with no duplicated editing logic and the same auth/metering guarantees.
- AI-driven channels (PREP-4, and any agent) translate natural-language intent into these typed actions via the gen-AI provider ([GEN-2](#gen-2-ai-provider-abstraction)); the action contracts are the stable boundary between intent interpretation and effect.
- To make that translation possible, the layer exposes a **machine-readable action catalog** — for each registered action, its `name`, a human-readable description, and its input JSON Schema (derived from the action's validation schema). AI channels feed this catalog to the model as its function-calling tool list so intent is resolved against the actual action contracts rather than a hardcoded prompt; adding or changing an action updates the catalog automatically, keeping the model in sync with no separate maintenance. The same catalog is the tool list a future **MCP server** ([§18](#18-future-work)) advertises — built once for PREP-4, reused there.

### 15. Data Models

Indicative MongoDB collections, expressed as shared TypeScript types ([TECH-6](#tech-6-shared-types--data-models)):

- **User** — `{ id, email, displayName, passwordHash, emailVerified, bio, avatarUrl, locale: 'en'|'fr'|'es'|'ru'|'zh', projectDefaults?: { manualSlideAdvance?, animatedTransitions?, ... }, planTier: 'free'|'pro'|'max', billingProvider?, billingCustomerId?, createdAt }` (`projectDefaults` apply to all new projects unless overridden — GEN-8)
- **Subscription** — `{ id, userId, tier, billingProvider, billingCustomerId, providerSubscriptionId, status: 'active'|'past_due'|'canceled', currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd }` (provider-neutral by design — a discriminator plus opaque references, TECH-9)
- **UsageRecord** — `{ id, userId, period, metric: 'aiTokens'|'sttMinutes'|'diarizationMinutes'|'ttsCharacters'|'ttsPremiumCharacters'|'aiImages'|'imageLookups'|'importMb'|'exports'|'translationCharacters'|'audioStorageMb'|'audienceTtsCharacters'|'audienceLocales', used, cap }` (BILL-3; `audioStorageMb` is a gauge — current holdings, not a per-period total)
- **CostEvent** — `{ id, userId, actorUserId?, actorRole: 'instructor'|'student'|'anonymous', projectId?, deckId?, deckTitle, service, metric, eventKind: 'billable'|'cached', units, unitPrice, cost, createdAt }` (append-only cost ledger — BILL-7; cost frozen at write time, rows never cascade-deleted, `deckTitle` denormalized so a deleted lecture keeps its history)
- **NotificationLog** — `{ id, userId, metric, period, threshold: 'approaching'|'reached', channel: 'email'|'in_app', sentAt }` (makes cap notifications idempotent — BILL-8)
- **ConnectedAccount** — `{ id, userId, provider: 'google'|'github', scopes[], accessTokenEnc, refreshTokenEnc?, externalAccountLabel, connectedAt }` (for import/export — EXP-4; tokens encrypted at rest — P-9)
- **Project** — `{ id, ownerId, title, course, description, seedContext, settings?: { manualSlideAdvance?, animatedTransitions?, ... }, createdAt }` (`settings` override the user's `projectDefaults`)
- **SeedAsset** — `{ id, projectId, type: 'doc'|'pdf'|'gdoc'|'gdrive'|'gslides'|'image', text?, imageUrl?, caption?, keywords[], enabled }`
- **Concept** — `{ id, projectId, label, canonical, synonyms[], gloss?, entityId?, preferredImageRef?, importance: 'must'|'maybe', source?, confirmed }` (preflight concept set — PREP-1/2/3; `entityId` = resolved entity e.g. Wikidata QID)
- **Deck** — `{ id, projectId, ownerId, title, templateId, visibility: 'private'|'unlisted'|'public', permalinkSlug, slideOrder[], transcript?, ttsVoice?, recordings?, voteScore, createdAt }` (`transcript` = finalized full lecture transcript, retained for post-lecture reformat — GEN-4; `recordings` = **server-only** references to retained session audio — P-6, never exposed in a DTO)
- **Slide** — `{ id, deckId, index, layoutType, title?, body?, bullets[]?, imageRef?, imageSource?: 'seeded'|'stock'|'generated', imageKeywords[]?, caption?, sourceTranscript?, attribution?: { title?, author?, sourceUrl?, licenseName?, licenseUrl?, modifications? }, drawings[]? }` (`layoutType` chosen by the AI — GEN-6; `imageKeywords` are AI-recommended search terms — GEN-7; `imageSource` records provenance incl. AI-generated — IMG-4; `attribution` is the image's TASL license metadata surfaced on-slide and editable by owners/editors — IMG-5; `sourceTranscript` = the slide's spoken narration, spoken by PLAY-2 and refined by GEN-4; `drawings` = whiteboard strokes with per-stroke tool/color/points + transcript timing anchors — EDIT-4)
- **TranscriptSegment** — `{ id, deckId, sessionId?, startMs?, endMs?, text, words?: { word, startMs, endMs }[], action, slideId?, speaker?, role?: 'lecturer'|'student', createdAt }` — one finalized phrase, **append-only** in its own collection (kept off the deck doc to dodge the 16 MB cap on long lectures). Carries the per-word timings used to time whiteboard playback (EDIT-4) and the speaker/role tags the diarization pass joins on (GEN-4).
- **SlideTranslation** — `{ id, deckId, locale: 'en'|'fr'|'es'|'ru'|'zh', perSlide: { slideId: { title?, body?, bullets[]?, caption?, sourceHash? } }, createdAt }` (on-demand slide-content translation cache — SHARE-2; one document per deck + locale, in its own collection. `sourceHash` fingerprints the slide text an entry was translated from, so an edited slide re-translates on its next view and its neighbours do not. A derived cache with no authored content in it, so the delete cascade removes it outright rather than tombstoning it — a restored deck simply re-translates.)
- **Template** — `{ id, ownerId, name, theme, layouts: Layout[], deletedLayouts?: { layout, deletedAt }[], renderMode: 'components'|'positioned', source: 'builtin'|'google-slides'|'yaml', sourceFileId?, assetKeys[]?, visibility, voteScore, createdAt }` where `Layout = { type, label, purpose, slots[], constraints?, elementPositions, decorations? }` (`purpose`/`slots`/`constraints` are the AI-facing descriptor — TMPL-6 / GEN-6; `elementPositions` places each slot and `decorations` holds a layout's static logos/rules — TMPL-8; `renderMode` states which renderer draws the template rather than letting it be inferred from whether geometry is present, since geometry is also used for export — EXP-6; `assetKeys` are the stored files the template owns, so the retention sweep can find them — P-11). **Built-in templates ship as files, not records** ([TMPL-3](#tmpl-3-pre-made-templates)); user templates are stored, and both are served through one resolver.
- **Vote** — `{ id, userId, targetType: 'deck'|'template', targetId, value: 1|-1 }`
- **QuizRef** — `{ id, deckId, formId, formUrl, status, publishConfig: { authMode, defaultPoints, driveFolderId, title } }` (link to the published Google Form + the publish config used — QUIZ-2/QUIZ-3)

**Soft delete** — deletable entities (`User`, `Project`, `Deck`, `Slide`, `Template`, `SeedAsset`, `Concept`, and other owned records above) carry an optional `deletedAt` tombstone. A set `deletedAt` hides the record from every read/query and shared surface and marks it for eventual purge; absent/`null` = live. This is the mechanism behind soft delete ([P-10](#16-privacy-security--compliance)) and the retention sweep ([P-11](#16-privacy-security--compliance)), and it backs **both** user-initiated deletion and admin moderation deletes ([§20](#20-administration-operations--moderation) ADMIN-4). Soft-deleted records stay readable to admins for recovery/audit (ADMIN-6) until the sweep purges them.

**A single layout inside a template is deletable the same way** — the one place the retention model applies to part of a record rather than a whole one. A deleted layout is moved to `deletedLayouts` with its own tombstone, so it disappears from the template immediately and from storage at the same retention cutoff as everything else, and is restorable until then. Deletion is refused where it would break an invariant or strand content: the required `whiteboard` layout ([TMPL-7](#tmpl-7-whiteboard-layout)) and the last remaining content layout cannot be deleted, nor can a layout still used by live slides or a template still used by a live deck or project — in each case the user is told what is blocking it. Built-in templates are files rather than records and cannot be deleted at all.

The same definitions back API request/response DTOs and validation on both tiers.

### 16. Privacy, Security & Compliance

| ID      | Requirement                                                                                                                                                                                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P-1** | All student data (rosters, quiz responses, scores) stays within NYU-approved, FERPA-compliant systems (NYU Google Workspace, NYU-provided models).                                                                                                                                                                      |
| **P-2** | No student PII is sent to external AI models. Only de-identified lecture/slide/seed text drives slide and quiz generation.                                                                                                                                                                                              |
| **P-3** | All secrets live in server-side `.env` (Gemini/OpenAI, Google Cloud, OAuth, JWT, SMTP, Stripe) — never committed and never exposed to the client. (V1's committed `openai.key` and `localStorage` key storage are removed in V2.)                                                                 |
| **P-4** | Passwords hashed; JWTs signed with rotating secrets; reset/verification links time-limited and single-use; ownership/role checks on every mutating route.                                                                                                                                                               |
| **P-5** | Google Drive/Docs/Slides access uses per-user OAuth consent and least-privilege scopes; imported content is the user's own. Reads of a user's existing presentations ([TMPL-8](#tmpl-8-template-import-from-google-slides)/[EXP-5](#exp-5-lecture-import-from-google-slides)) are **read-only** and never modify the source file; adding a scope requires already-connected users to reconnect, which the app detects and prompts for (EXP-4). |
| **P-6** | Microphone audio drives transcription; capture is bounded by explicit start/stop with clear UI state. Audio is **not retained by default**. When retention is explicitly enabled (for diarization — GEN-4 — and per-slide original-audio playback — PLAY-2), it applies only to the server-proxied engine, is **gated on deck edit access**, is **server-only** (never exposed in a DTO or shared surface), and is **auto-deleted** after a bounded window (and as soon as diarization consumes it). Retained student voices remain subject to P-1/P-2. (Design: [DECISIONS.md](DECISIONS.md) "Audio retention".) |
| **P-7** | Evaluation data is anonymized before analysis and submitted for IRB/program review; findings (positive or negative) shared with the NYU community.                                                                                                                                                                      |
| **P-8** | Payments are processed by the configured billing provider (**Stripe** by default); the app stores no raw card data. Provider webhooks are signature-verified; only minimal, provider-neutral billing references (`billingCustomerId`, subscription status) are stored.                                                  |
| **P-9** | Connected-account (Google Drive / GitHub — EXP-4) OAuth tokens are stored **encrypted at rest**, request only **least-privilege scopes**, are **per-user and revocable**, and are never exposed to the client. Exports that contain student data must not be pushed to public GitHub/Drive locations (FERPA — P-1/P-2). |
| **P-10** | Deletion — **user-initiated or admin-initiated** ([§20](#20-administration-operations--moderation) ADMIN-4) — of any entity (user accounts, projects, decks, slides, templates, seed assets, concepts, and other owned records — [§15](#15-data-models)) is a **soft delete**: the record is marked with a `deletedAt` tombstone rather than removed, is excluded from all reads, queries, and shared surfaces (but stays visible to admins for recovery/audit — ADMIN-6), and can be **restored during the retention window**. Deleting a parent tombstones its children (a deleted project takes its decks with it — [PROJ-2](#proj-2-project-lifecycle)), guarding against accidental, unrecoverable loss. Deletion still enforces ownership/role checks (P-4). |
| **P-11** | Soft-deleted records (P-10) are **permanently purged** by a scheduled daily background sweep once their `deletedAt` is older than a configurable window (`DELETED_DATA_RETENTION_DAYS`, **default 90 days** — [TECH-4](#tech-4-server-configuration)). Purge is a **hard cascade delete** that also removes owned children and stored blobs (seed assets, exports, retained audio — P-6 — synthesized narration, and a template's own imported assets such as backgrounds and logos — [TMPL-8](#tmpl-8-template-import-from-google-slides)), so no orphaned data survives. Blobs that more than one thing can point at are **reference-counted** rather than deleted with the first referent: narration is cached under a hash of the words spoken, so one file can serve two lectures that say the same thing and is deleted with the last lecture that played it; likewise a template asset shared by several layouts survives until no live layout, restorable deleted layout, or theme still refers to it. Template assets are deliberately **not** metered against any storage cap — there is no template-storage allowance in [BILL-3](#bill-3-usage-caps--metering), and the retention sweep is what bounds them. `0` disables the sweep (tombstones kept indefinitely). This bounds storage cost and honors data-minimization, consistent with the audio-retention sweep (P-6). |
| **P-12** | **Administrative access** is an out-of-band **email allowlist** (`ADMIN_EMAILS` — [§20](#20-administration-operations--moderation) ADMIN-1), never a self-granted role. Admin reads **bypass per-object ACLs** and can reach student-derived content (P-1/P-2), so the allowlist is kept minimal, admins **cannot moderate other admins**, and any admin action that **exposes a user's private content or credentials** — viewing a private lecture/project, resetting/revealing a password (ADMIN-3) — requires **explicit confirmation** before it proceeds. |
| **P-13** | **Admin audit trail.** Every admin action that **changes or exposes** user data — private lecture/project views, password resets, bans/unbans, deletes, settings edits, and views of soft-deleted content ([§20](#20-administration-operations--moderation) ADMIN-3..6) — is recorded in an **append-only** log (acting admin, action, target, details, timestamp) that **no API can edit or delete** (ADMIN-7). The log is the accountability control over the ACL bypass in P-12 and is exportable as CSV. |

### 17. Quiz Generator Integration

The Quiz Generator remains a **separate repository** ([github.com/bloombar/google-forms-quiz-generator](https://github.com/bloombar/google-forms-quiz-generator)), but V2 consumes it as a **versioned, in-process library** (a pinned git dependency) rather than a separate HTTP service. Responsibilities are still split by concern:

- **Slide Machine (monolith)** — **generates** the quiz definition, owns the instructor configuration UI, orchestrates publishing, and stores the result.
- **Quiz Generator (imported library)** — **publishes**: given a quiz definition, a publish configuration, and an **authorized Google client**, it creates the **Google Form** quiz, applies its settings, places it in Drive, and returns the form's id and link.

Consuming it in-process (rather than over HTTP) means there is **no cross-service token handoff**: the monolith already holds the instructor's Google credentials (EXP-4) and passes an authorized client straight into the library. The Quiz Generator's Forms/Drive surface stays out of hand-written monolith code — it lives in the imported library behind a small `quiz-bridge` module — while AI generation stays where the provider abstraction already lives (GEN-2 / [TECH-8](#tech-8-ai-provider-abstraction-layer)).

#### QUIZ-1 Quiz YAML generation (in the monolith)

On session **Stop** (or on demand), the monolith's `QuizGenerationProvider` ([TECH-8](#tech-8-ai-provider-abstraction-layer)) turns finalized, de-identified slide text into an exit-ticket quiz definition in the **Quiz Generator library's quiz shape** (its YAML maps 1:1 to the in-memory object the library validates and publishes). The user may review/edit the questions before publishing ([BILL-3](#bill-3-usage-caps--metering) metering applies).

#### QUIZ-2 Instructor publish configuration

Before publishing, the instructor controls publish options, passed with the quiz definition as a structured **publish request**:

- **Authentication** — how responses are gated: **email collection** (verified / responder-entered / none). Restricting responses to the **NYU Workspace domain** is **not** settable through the Google Forms API (see the known limitation below); the pilot uses **verified-email** collection.
- **Default point value** applied to each question (overridable per question).
- **Drive destination** — the folder in the instructor's Google Drive where the Form is created/moved.
- **Form metadata** — title, description, and grading/feedback release options.

Defaults for these are configurable and remembered per project.

#### QUIZ-3 Publishing & link return

The `quiz-bridge` calls the imported library with the **{quiz definition + publish config + authorized Google client}**; the library creates the **Google Form** quiz, applies the point/email/quiz settings, moves it to the specified Drive folder, and returns the **form id and shareable link**. The monolith stores a `QuizRef` (form id/URL, status, and the config used) against the deck ([§15](#15-data-models)).

#### QUIZ-4 Delegated Google access

Because the Form is created in the **instructor's** Drive, publishing uses the instructor's **connected Google account** ([EXP-4](#exp-4-connected-accounts-google-drive--github)): the monolith builds an authorized, least-privilege Forms/Drive client from the instructor's stored (encrypted, per-user — [P-9](#16-privacy-security--compliance)) refresh token and injects it into the library. Running in-process means the token **never leaves the monolith** — there is no second service to delegate to, which resolves the earlier cross-service token question ([§19](#19-open-questions)). **Prerequisite:** this depends on EXP-4's connected-account flow (offline Google OAuth with Forms/Drive scopes and an encrypted token store), a hard predecessor to publishing that is **not yet built**.

#### QUIZ-5 Distribution & grading

The published Google Form is distributed to enrolled students within NYU Google Workspace and **auto-graded** via answer keys; per-lecture comprehension is reported back for evaluation ([§12](#12-evaluation--metrics)).

#### QUIZ-6 Loose coupling

The two repositories stay decoupled: neither depends on the other's internals, and the contract is the library's **exported function signatures**, versioned by **semver and a pinned git ref** (not an HTTP API). The Quiz Generator stays independently usable as its own CLI and keeps its publishing logic **auth-agnostic** — the caller injects the authorized client — so it remains reusable outside Slide Machine.

**Known limitation — domain restriction.** Restricting Form responses to the NYU Workspace organization is **not exposed by the Google Forms REST API** (only quiz settings and email-collection are); it is an admin/UI-level control. So `authMode: 'domain-restricted'` in the publish config is **not enforceable** by the library today. The pilot ships **verified-email** collection; true org-restriction is deferred ([§18](#18-future-work)) and would require the Workspace admin default and/or an Apps Script hop.

### 18. Future Work

Out of scope for the Fall 2026 pilot:

- Locally-hosted / in-house AI models for transcription and generation (the grant addendum's long-term thesis) — the provider abstraction (GEN-2 / TECH-8) is built now so this is a configuration/adapter change later, not a rewrite.
- Real-time multilingual **translation** of speech into translated slides (the Translation key supports optional captions only for now).
- Extracting the latency-sensitive real-time **STT → slide-generation pipeline** into its own Digital Ocean service (and, only if pilot scale demands, moving from App Platform to DO Kubernetes/DOKS) — the modular-monolith seams ([§13](#13-system-architecture)) make this an extraction, not a rewrite.
- A remote, OAuth-authenticated, multi-user **MCP server** that exposes the action/command layer ([TECH-13](#tech-13-application-actioncommand-layer)) as agent tools, letting users modify upcoming or saved decks through back-and-forth with an external AI agent (preflight and post-lecture). Built as a thin facade over existing actions — reusing the same auth, ownership, and plan-cap metering — so it adds reach without duplicating logic. Deferred from the pilot for scope/timeline; a good student-contribution target.
- **Narrating slides in the student's translated language** — pairing text-to-speech narration ([PLAY-2](#play-2-narration-playback)) with the post-lecture translated viewing ([SHARE-2](#share-2-post-lecture-translated-viewing)) so a student can hear a deck spoken in their own locale (the base narration and translated viewing exist; synthesizing the translated text is the remaining step).
- Real-time collaborative (multi-user) editing of a single deck.
- Team/organization (seat-based) billing and institutional licensing beyond individual Free/Pro/Max plans.
- Richer analytics dashboards and recommendation/ranking beyond simple vote tallies.
- Publishing a setup guide for other NYU faculty (dissemination deliverable).

### 19. Open Questions

1. **Plan pricing & caps** — exact Free/Pro/Max prices and per-metric caps, tuned against measured per-lecture Gemini + Speech-to-Text + image-API costs.
2. **Pilot vs. paid** — are NYU pilot instructors/students exempt from paid tiers (e.g., a comped institutional tier) during Fall 2026?
3. **STT streaming path** — does Speech-to-Text audio stream client→Google directly, or proxy through the Express back-end (affects latency, credential exposure, cost accounting, and metering)? This also determines whether App Platform needs **WebSocket sticky sessions** for horizontal scaling ([TECH-10](#tech-10-deployment-topology-digital-ocean-app-platform)).
4. **Student identity / roster source** — how are enrolled students resolved for quiz distribution (NYU SIS, Google Classroom, manual roster)?
5. **Latency target** — what phrase-to-slide latency counts as "near real-time" for pilot acceptance?
6. **Image licensing** — how are Wikimedia/Flickr/Openverse license terms surfaced and enforced on shared/exported decks? _(Addressed by [IMG-5](#img-5-image-attribution--licensing-display): attribution is captured per image, shown via an on-slide "i" indicator + dialog, editable by owners/editors, and preserved through sharing and export. Remaining question: automated enforcement of per-license obligations beyond display.)_
7. **Image disambiguation depth** ([IMG-3](#img-3-image-disambiguation)) — is Wikidata/Wikipedia entity resolution plus metadata ranking sufficient, or is an added AI relevance-verification pass on candidate images worth its latency/cost?
8. **Google Slides export fidelity** — native Slides API generation vs. import of an exported format; how faithfully are custom templates mapped?
9. **100% coverage feasibility** — which boundaries (third-party SDK glue, generated code) are excluded via documented ignore rules to keep the 100% gate realistic?
10. **Speech-adaptation limits** ([PREP-3](#prep-3-use-of-the-honed-concept-set)) — how large a preflight concept set can be supplied to Google Cloud STT phrase hints/boost without latency or cost penalty, and how to prioritize terms if the set exceeds that limit.
11. **MCP server auth & scope** ([§18](#18-future-work)) — for the future MCP server: the remote-OAuth model, tool granularity, FERPA boundaries on agent-driven edits, and how plan-cap metering applies to agent tool calls.
12. **Quiz publishing token model** ([QUIZ-4](#quiz-4-delegated-google-access)) — **Resolved.** The Quiz Generator is imported **in-process as a library** rather than run as a separate service ([§17](#17-quiz-generator-integration)), so there is no cross-service delegation: the monolith builds an authorized Forms/Drive client from the instructor's own connected-account token (EXP-4) and injects it into the library. No token ever leaves the monolith, and the Quiz Generator never stores instructor tokens. (Remaining dependency: EXP-4's connected-account flow must be built first.)
13. **AI-generated infographic accuracy** ([IMG-4](#img-4-ai-generated-imagery-optional)) — how much to rely on generated diagrams/infographics given factual/text-rendering errors: default off, require user confirmation before display, and/or prefer search-grounded generation where the provider supports it.

### 20. Administration, Operations & Moderation

Operator-facing capabilities for running the platform: who is an admin, a read-mostly console for seeing who uses the system and what they have made, and the tightly-audited actions that touch a user's private data. These are functional requirements (below) whose operational how-to lives in the operator's guide ([ADMINISTRATION.md](ADMINISTRATION.md)); they build on soft delete ([§15](#15-data-models)), privacy/security ([§16](#16-privacy-security--compliance), esp. P-12/P-13), and ownership/role checks ([AUTH-5](#auth-5-profile--ownership)).

The governing principle: **admin power is broad but never silent.** Admin reads bypass per-object ACLs, so every action that **exposes** a user's private content or credentials, **deletes** data, or **changes** an entity's settings is **explicitly confirmed and written to an immutable audit log** ([ADMIN-7](#admin-7-audit-log)).

#### ADMIN-1 Admin identity & authorization

- Admin status is an **email allowlist** (`ADMIN_EMAILS` — [TECH-4](#tech-4-server-configuration)), **not** a role or field on the account; there is deliberately **no in-app way to grant it**. The list is read on **every** request, so access changes take effect without a code deploy.
- Every `/api/admin` route is gated by `requireAuth` + `requireAdmin`; the client menu and route guard are **cosmetic** — the allowlist is the real security boundary.
- Admin reads **bypass per-object ACLs** ([P-4](#16-privacy-security--compliance)): an allowlisted account can read any user's projects, lectures, and seed material — so the list is kept minimal ([P-12](#16-privacy-security--compliance); FERPA — [P-1](#16-privacy-security--compliance)/[P-2](#16-privacy-security--compliance)).
- **Admins moderate but are not moderated:** any moderation, settings, or deletion action ([ADMIN-4](#admin-4-moderation-actions)/[ADMIN-5](#admin-5-editing-any-entitys-settings)) targeting an allowlisted email is **refused** (`target_is_admin`) until that email is removed from the allowlist.

#### ADMIN-2 Admin console

A read-mostly console (`/app/admin`) answers "who is using this and what have they made," and carries the moderation surface.

- **Secondary navigation** — every admin page shows a horizontal secondary nav bar, **just below the standard header**, linking the top-level sections: **Overview**, **Users**, **Projects**, **Lectures**, and **Logs**.
- **Overview** — deployment-wide averages and totals, chiefly **cost**: per user, per lecture, per project, and per student, alongside active users, active students, and the largest spenders ([BILL-7](#bill-7-cost-attribution--admin-cost-reporting)).
- **Site-wide directories**, each **paginated and sortable**: **Users** (email, handle, join date), **Projects** (title, owner, visibility, lecture count, timestamps), and **Lectures** (title, project, owner, effective visibility, slide count, timestamps). Private lectures are **always listed** ([ADMIN-3](#admin-3-viewing-user-content--seed-material)).
- **Detail (drill-down) pages** for each **user** (plan, email-verification, locale, profile visibility, project/lecture counts, and the user's projects/lectures), **project** (owner + a table of its lectures), and **lecture** (project, owner, details, and a link to the live viewer `/d/:slug`). Each also carries a **cost panel** — instructor versus student spend, students involved, and average per student ([BILL-7](#bill-7-cost-attribution--admin-cost-reporting)). Settings are edited in the product view those pages link to — the user's profile page, the project, the lecture — not here ([ADMIN-5](#admin-5-editing-any-entitys-settings)).
- **Object identity** — every user, project, and lecture **detail page shows the entity's database `_id`**, so an operator can correlate console records with direct database operations.
- **Consistent linking** — across **all** admin pages, every **username** links to that user's detail page, every **project title** to its project detail page, and every **lecture title** to its lecture detail page.
- **Consistent "view in product" affordance** — each detail page carries, in the same style, a link to that entity's **public/product view**: the **user** detail page links to the user's **public profile** ([SOC-4](#soc-4-user-profiles)), the **project** detail page to the **product project view**, and the **lecture** detail page to the **live viewer** (`/d/:slug`). Where the target is private, following it is confirmed and audited ([ADMIN-3](#admin-3-viewing-user-content--seed-material)).

#### ADMIN-3 Viewing user content & seed material

- An admin can open **any lecture** in the deck viewer (`/d/:slug`) and **any project** in the product view, **regardless of visibility**, on the allowlist's authority. The **content** there is read-only — slides, recordings, and generation runs stay with the owner; only its settings are editable ([ADMIN-5](#admin-5-editing-any-entitys-settings)).
- Admin project and lecture detail pages **surface the seed material** ([SEED-1](#seed-1-document-seeding)/[SEED-2](#seed-2-image-seeding)) — documents, seed text, and image captions — so an operator can see what fed generation.
- **Privacy-infringing views are confirmed and audited** — opening a **private** lecture or a **private** project requires **explicit confirmation** and writes an audit-log entry ([ADMIN-7](#admin-7-audit-log)); routine viewing of already-public content is not logged.

#### ADMIN-4 Moderation actions

Every action here **asks for confirmation and writes an audit-log entry** ([ADMIN-7](#admin-7-audit-log)):

- **Delete a project / lecture / user** — a **soft delete** ([P-10](#16-privacy-security--compliance)): the record is tombstoned and cascades to its children (a deleted project takes its lectures, slides, seed material, transcripts, and retained audio), recoverable during the retention window and purged by the same sweep ([P-11](#16-privacy-security--compliance)) as user-initiated deletion — **not** an immediate hard delete.
- **Ban / unban an email** — a banned email can no longer sign in (password or OAuth) or register, and its sessions end immediately; content persists until deleted separately. **Unban** lifts it (also confirmed + audited).
- **Reset a user's password** — sets a new password and signs the user out everywhere. Because the new secret is **revealed to the operator**, this is treated as privacy-infringing ([ADMIN-3](#admin-3-viewing-user-content--seed-material)/[P-12](#16-privacy-security--compliance)) — confirmed + audited; the app does not email it.

#### ADMIN-5 Editing any entity's settings

- An admin can **modify the settings of any user, project, or lecture** — e.g. a lecture's/project's visibility or generation settings, or a user's profile/account fields — even when not the owner.
- **Settings are edited in the product itself**, in the **same settings UI the entity's owner uses** ([ADMIN-2](#admin-2-admin-console) links there from each detail page): an account's from the **Settings** button on the user's profile page, a project's or a lecture's from its settings modal. The console carries **no separate settings form** for any of them, and its detail lists are read-only.
- Every such edit **requires explicit confirmation and is audited** ([ADMIN-7](#admin-7-audit-log)), recording **what changed**. Editing an entity that is not the admin's own is **confirmed once, on entry**, and **flagged on screen** for as long as those settings are open. (Billing state — plan tier — remains governed by [§5](#5-plans-billing--usage-limits).)

#### ADMIN-6 Viewing soft-deleted content

- Soft-deleted records are hidden from all normal reads ([P-10](#16-privacy-security--compliance)), but an admin can **view soft-deleted entities** (users, projects, lectures, and other owned records) in the console — for recovery or audit — until the retention sweep purges them ([P-11](#16-privacy-security--compliance)).
- **Every access to soft-deleted content is audited** ([ADMIN-7](#admin-7-audit-log)).

#### ADMIN-7 Audit log

- An **append-only, immutable** log of admin actions that **change or expose** user data: private lecture/project views ([ADMIN-3](#admin-3-viewing-user-content--seed-material)), password resets, bans/unbans, deletes ([ADMIN-4](#admin-4-moderation-actions)), settings edits ([ADMIN-5](#admin-5-editing-any-entitys-settings)), and views of soft-deleted content ([ADMIN-6](#admin-6-viewing-soft-deleted-content)).
- Each entry records the **acting admin** (id + email snapshot), a **namespaced action name** (e.g. `user.delete`, `deck.delete`, `project.private_view`), an optional **target** (type + id), optional action-specific **details**, and a **timestamp**.
- Entries are written through one server module into a dedicated collection and **no API can edit or delete them**; every admin mutation endpoint must record itself. The `Logs` page ([ADMIN-2](#admin-2-admin-console)) lists them newest-first, paginated, with **CSV export** of the whole log ([P-13](#16-privacy-security--compliance)).

#### ADMIN-8 Settings change log

- A **second, separate** append-only log, beside the admin audit log ([ADMIN-7](#admin-7-audit-log)): where that one records **what admins did**, this one records **every settings change on the platform, whoever made it** — a user changing their own account settings, a collaborator with edit access changing a project's or lecture's, or an admin editing on someone's behalf ([ADMIN-5](#admin-5-editing-any-entitys-settings)). An admin's settings edit appears in **both**.
- Each entry records the **acting user** (id + email snapshot), the **role** they acted in (`owner`, `editor`, `admin`), the **entity** whose settings changed (kind, id, and its name snapshotted at the time), the **owner** those settings belong to, the **changed fields** as `{field: {from, to}}`, and a **timestamp**. An edit that changes nothing writes no entry.
- What counts as a "setting" is defined **once** and shared by both logs, so a field added to any settings editor is covered by both automatically. Content edits (slides, recordings, refine runs) are not settings and are not recorded.
- Entries are written through one server module into a dedicated collection and **no API can edit or delete them**. The `User Logs` page ([ADMIN-2](#admin-2-admin-console)) lists them newest-first, paginated, **filterable by entity kind**, with **CSV export** of the current filter ([P-13](#16-privacy-security--compliance)). The API also filters by entity id (one record's history) and owner id (one account's).
