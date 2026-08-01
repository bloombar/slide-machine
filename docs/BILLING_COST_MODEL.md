# Billing Cost Model

How the per-tier caps in [config/plans.json](../config/plans.json) were derived
([BILL-1](SPEC.md#bill-1-subscription-tiers)/[BILL-3](SPEC.md#bill-3-usage-caps--metering)/[BILL-6](SPEC.md#bill-6-configurable-pricing--caps)).
Every figure below comes from a stated parameter times a vendor price, so when
an assumption changes the caps can be recomputed rather than re-guessed.

The workings are reproducible: [`cost-model/`](../cost-model/) holds a Jupyter
notebook that computes every figure below from two editable data files, so an
assumption can be changed and the consequences re-read rather than re-derived.

Unit prices live in [config/service-prices.json](../config/service-prices.json),
keyed by **model and voice family**, so switching `GEMINI_MODEL` or a narration
voice does not strand the cost model. Cost accounting
([BILL-7](SPEC.md#bill-7-cost-attribution--admin-cost-reporting)) prices usage
from that file and freezes the result at write time.

## 1. Parameters

Adjustable inputs. Lecture duration is the headline knob — §9 shows how to
re-run everything from a different value.

| Parameter | Value | Confidence |
| --- | --- | --- |
| **Average lecture duration** | **75 min** (standard Tue/Thu block) | product decision |
| Slides per lecture | 45 | estimate |
| Slide text | 400 chars/slide → 18,000 per deck | **weak** — unmeasured |
| Narration text | 600 chars/slide → 27,000 per deck | **weak** — unmeasured |
| Instructor revision profile | **light**: refine ~25% of slides, re-synthesize ~5, redo enrichment on ~10%, re-transcribe ~3 min, diarize ~30% of lectures | **weak** — pilot data will replace this |
| Free tier volume | 4 lectures/month = 300 lecture-min | product decision |
| Fresh tier volume | 6 lectures/month = 450 lecture-min | sized backwards from a $19 price |
| Pro tier volume | 26 lectures/month (3 courses × 2/week) = 1,950 lecture-min | product decision |
| Max tier volume | 40 lectures/month (4 courses × 2/week) = 3,000 lecture-min | product decision |

### Audience parameters

These drive the entire student-cost picture and are the least certain numbers
in the model.

| Parameter | Value | Confidence |
| --- | --- | --- |
| Students per class section | 30 | estimate |
| Students who open a given deck | 50% → 15 | **weak** |
| Playbacks per viewing student | 1.3 | **weak** |
| **Playbacks per deck** | **20** | derived |
| Students who request a translation | 5% → 1.5 per deck | **weak** |
| **Distinct locales per deck** | **0.5** (requests collapse onto the same few languages, each cached after the first) | **weak** |

## 2. Vendor prices

Verified 2026-07-31 against the vendors' own pricing pages.

### Speech-to-Text ([source](https://cloud.google.com/speech-to-text/pricing))

We use the **V2 API**, where one rate covers both streaming and standard batch:

| Item | Price |
| --- | --- |
| Recognition (streaming **and** standard batch), 0–500k min/month | **$0.016 / min** |
| …500k–1M / 1M–2M / 2M+ min per month | $0.010 / $0.008 / $0.004 per min |
| **Dynamic Batch** Recognition (opt-in, up to 24 h turnaround) | **$0.003 / min** |
| Free tier | **none on V2** |

Three corrections to earlier assumptions, all of which matter:

- **Diarization is not cheap batch.** Our adapter calls `BatchRecognize`
  without dynamic batching, so it bills at the **same $0.016/min as streaming**,
  not the $0.003 dynamic-batch rate — 5.3× what was first assumed. Opting into
  Dynamic Batch would recover that 5.3×, at the cost of up to 24 hours'
  turnaround, which the per-slide "identify speakers" flow cannot absorb.
- **There is no free STT tier on V2.** The 60 free minutes/month belong to the
  V1 SKUs; V1 also prices *without* data logging at $0.024/min.
- **Requests round up to 1 second**, not 15, so stream restarts add a
  negligible fraction of a minute rather than the ~7% first assumed.

Chirp models (including the `chirp_3` our diarization uses) are Standard-priced
— no premium.

### Text-to-Speech ([source](https://cloud.google.com/text-to-speech/pricing))

Billed per **character of input**, with a monthly free allowance per family:

| Voice family | Price | Free per month |
| --- | --- | --- |
| Standard / WaveNet | $4 / 1M chars | 4,000,000 chars |
| **Neural2** (our standard voices) | **$16 / 1M chars** | 1,000,000 chars |
| **Chirp 3: HD** (our premium voices) | **$30 / 1M chars** | 1,000,000 chars |
| Studio | $160 / 1M chars | 1,000,000 chars |
| Instant custom voice | $60 / 1M chars | — |

**What counts as a character.** Google's own wording: "the total number of
characters in the input string are counted for billing purposes, including
spaces and newline characters. All SSML tags (except the `<mark>` tag) are also
included." Two consequences for us, neither large enough to move the caps but
both worth knowing:

- Our [SSML builder](../server/src/tts/ssml.ts) wraps each request in
  `<speak>…</speak>` and adds a space per phrase, so **billed characters run
  ~3% above the plain narration text**. The `<mark>` timepoints that make
  whiteboard playback work are excluded, which is the expensive part avoided.
- The adapter tries SSML first and **re-sends plain text when a voice rejects
  it** — which Chirp3-HD does. If Google bills the rejected attempt, premium
  synthesis costs roughly twice its character count. Worth confirming against a
  real bill before premium voices ship.

**A different unit lives on the same page.** The **Gemini-TTS** family
(`Gemini 2.5 Flash TTS` and successors) is priced per **token**, not per
character: $0.50/1M text-input tokens plus $10/1M audio-output tokens, where
audio tokens run at 25 per second of speech. We use Neural2 and Chirp3-HD, so
the per-character rates above apply — but switching narration to a Gemini-TTS
model would change the **metric's unit**, not just its price, and
`ttsCharacters` would have to become a token count.

The free allowances are **per Google Cloud account per month**, not per user —
about 37 decks' worth of Neural2 narration across the whole deployment. Real
headroom at pilot scale, gone at any scale worth having. **Caps are sized
against the paid rate**, never the free allowance.

### Everything else

| Service | Price | Source |
| --- | --- | --- |
| Gemini 3.1 Flash-Lite (`GEMINI_MODEL` default) | $0.25 / 1M input, $1.50 / 1M output | Google ✅ |
| Other Gemini models (2.5/3/3.5/3.6 Flash and Flash-Lite) | see `service-prices.json` — $0.10–$1.50 in, $0.40–$9.00 out | Google ✅ |
| Embeddings | $0.15 / 1M tokens | Google ✅ |
| Gemini image generation | ~$0.034–$0.067 / image | Google ✅ |
| Cloud Translation | $20 / 1M chars, first 500,000 free per account | Google ✅ |
| DO Spaces | $5/mo (250 GiB + 1 TiB transfer), then $0.02/GiB-month, $0.01/GiB egress | DO ✅ |
| MongoDB Atlas M10 | $56.94/mo + ~$10 backups (snapshot storage, grows with data) | Atlas ✅ |
| DO App Platform | `basic-xxs` $5/mo; 1 vCPU / 2 GiB $25/mo | DO ✅ |
| Stripe | 2.9% + $0.30 per charge, plus 0.7% Billing | Stripe ✅ |

Switching `GEMINI_MODEL` changes cost sharply — 2.5 Flash-Lite is 2.5× cheaper
than the current default, 3.5 Flash is 6× dearer on input and 6× on output — so
the model map is keyed by the exact model id the adapter uses.

## 3. Per-minute rates

| Rate | Value | Arithmetic |
| --- | --- | --- |
| Finalized phrases | 9 / min | ~130 wpm ÷ ~14 words per phrase |
| AI tokens (live) | 30,000 / min | 9 calls/min × (~3,000 in + ~350 out) |
| Slides produced | 0.6 / min | 45 slides ÷ 75 min |
| Narration characters | 360 / min | 600 chars/slide × 0.6 slides/min |
| Image enrichments | 0.6 / min | one attempt per slide produced |
| Retained audio | 2.88 MB / min | 24 kHz × 16-bit mono (`STT_CAPTURE_SAMPLE_RATE`) |
| Cloud STT | 1.0 min / min | 1-second request rounding is negligible; **zero** unless `TRANSCRIPTION_PROVIDER=google-cloud` |

The tokens-per-minute figure carries **±30%** — an independent estimate put
input at 2,200 tokens/call rather than 3,000, moving a lecture's generation
cost between $0.62 and $0.84.

## 4. Cost per 100 lectures

The fastest read in this document. One row per service, with the usage assumed
on each side.

| Service | Instructor usage | Student usage | Cost / 100 lectures | Share |
| --- | --- | --- | --- | --- |
| **Cloud STT** | 7,800 min (75 live + 3 re-transcribe per lecture) | — | **$124.80** | 36.5% |
| **Gemini (all LLM)** | 226M tokens | — | **$92.83** | 27.1% |
| **TTS** | 3.0M chars | 1.35M chars | **$69.60** | 20.4% |
| **Diarization** | 2,250 min (30% of lectures) | — | **$36.00** | 10.5% |
| **Translation** | — | 900K chars | **$18.00** | 5.3% |
| **Image search APIs** | 5,000 lookups | — | **$0.00** | free |
| **Object storage + egress** | 21.6 GB held | 30 GB (2,000 playbacks) | **$0.70** | 0.2% |
| **Total** | | | **$341.93** | |

Browser-capture tiers cost **$181** — they lose both the STT line and the
diarization line, since retention only happens on the cloud engine.
**Instructor-driven cost is $302 (88%); student-driven is $40 (12%).**

Five conclusions:

- **Cloud STT and Gemini are 64% of all cost.** Everything else is a rounding
  error beside them.
- **Browser capture removes 47%** — STT plus the diarization it enables — which
  is why Free and Fresh are browser-only.
- **Diarization is now the fourth-largest line at 11%**, having been assumed to
  be 3%. It costs the same per minute as live capture, so diarizing every
  lecture roughly doubles its transcription bill.
- **Students are an eighth of cost** even at 2,000 playbacks, because cache
  hits are free and only new languages spend.
- **Storage and egress are 0.2%** — they dominate the operational constraints
  while being financially irrelevant.

## 5. Cost of one lecture

**Live capture** — 2.25M tokens, 45 slides, 216 MB audio:

| Line | Cost |
| --- | --- |
| Slide generation (2.03M in / 0.24M out) | $0.86 |
| Image re-rank + quiz + embeddings | $0.04 |
| Cloud STT, 75 min | $1.20 (zero on browser capture) |
| **Live subtotal** | **$2.10 cloud / $0.90 browser** |

**Post-lecture**, light revision profile:

| Line | Quantity | Cost |
| --- | --- | --- |
| Refine + narrate passes | ~11 slides | $0.03 |
| TTS narration of the deck | 27,000 chars | $0.43 |
| Re-synthesis after edits | ~5 slides | $0.05 |
| Image enrichment redos | ~5 slides | $0.01 |
| Re-transcribing an edited clip | 3 min | $0.05 |
| Diarization | 30% of lectures × 75 min | $0.36 |
| **Post-lecture subtotal** | | **~$0.92** |

**Audience** — 0.5 locales and 20 playbacks per deck: **~$0.40**.

**Per lecture, all in: ~$3.42 with cloud capture, ~$1.81 on browser capture.**

Three things worth knowing. Re-transcribing a saved clip runs through the
*streaming* recognizer, so it bills at the full $0.016/min. Every narration edit
re-synthesizes that slide. And browser-capture tiers cannot diarize or
re-transcribe at all, because retention only happens on the cloud engine —
their `audioStorageMb` and `audioRetentionDays` are therefore reserved for a
future where browser audio is retained, not live constraints today.

## 6. Audience costs

One deck-locale, built once and cached for every later student:

| Component | Quantity | Cost |
| --- | --- | --- |
| Translating deck text | 18,000 chars | $0.36 |
| Re-synthesizing narration | 27,000 chars | $0.43 |
| **One deck, one language** | | **~$0.80** |

A playback of already-cached content costs only egress: ~9 MB of images plus
~5.4 MB of narration audio ≈ **$0.00015**. Replaying the original recording
adds 216 MB (~$0.0022). Spaces includes 1 TiB of transfer — roughly 68,000
light playbacks a month.

Four rules follow, and they are what keep audience cost bounded:

1. **The deck owner's plan pays**, registered viewer or anonymous.
2. **Cache hits are never metered** — only a first synthesis or a new locale
   spends — though they are still *recorded* at zero cost, so student counts
   and averages stay honest ([BILL-7](SPEC.md#bill-7-cost-attribution--admin-cost-reporting)).
3. **Audience work draws on its own allowance** (`audienceTtsCharacters`,
   `audienceLocales`), so a popular deck cannot exhaust its author's budget.
4. **Exhaustion hard-blocks with a 402** and a viewer-safe message that never
   reveals the instructor's billing state.

## 7. Cap formulas

```text
cap = lectures_per_month × lecture_minutes × per_minute_rate × revision_factor
```

plus, for the audience metrics:

```text
audienceLocales       = lectures_per_month × locales_per_deck
audienceTtsCharacters = audienceLocales × narration_chars_per_deck + headroom
```

Worked for Pro (26 lectures, 1,950 lecture-min):

| Metric | Arithmetic | Rounded cap |
| --- | --- | --- |
| `aiTokens` | 1,950 × 30,000 = 58.5M | 65,000,000 |
| `ttsCharacters` | 26 × 30,000 = 780,000 | 800,000 |
| `imageLookups` | 26 × 50 = 1,300 | 1,500 |
| `audienceLocales` | 26 × 0.5 = 13 | 15 |
| `audienceTtsCharacters` | 15 × 27,000 = 405,000 | 450,000 |
| `audioStorageMb` | 21 days ≈ 18 lectures × 216 MB = 3.9 GB | 8,000 |

Two caps are deliberately **below** full coverage, because at $0.016/min each
would otherwise dominate the tier:

- **`sttMinutes: 600`** covers ~8 of Pro's 26 lectures. Browser capture handles
  the rest for free; full cloud coverage would cost $31/month by itself.
- **`diarizationMinutes: 350`** covers ~5 lectures. Diarizing all 26 would cost
  another $31. Adopting Dynamic Batch (§2) would make full coverage affordable
  at the price of 24-hour turnaround.

## 8. Tier economics and break-even

| Plan | Lectures/mo | Light (25%) | Expected (50%) | Heavy (80%) | At caps | Price floor | Price | Maxed as % of price |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Free | 4 | ~$1.45 | ~$2.89 | ~$4.63 | ~$5.79 | $6.32 | **$0** | — |
| Fresh | 6 | ~$2.58 | ~$5.16 | ~$8.25 | ~$10.31 | $11.01 | **$19** | 54% |
| Pro | 26 | ~$17.76 | ~$35.53 | ~$56.84 | ~$71.05 | $74.02 | **$99** | 72% |
| Max | 40 | ~$43.43 | ~$86.86 | ~$138.98 | ~$173.73 | $180.53 | **$299** | 58% |

Four utilisation levels, because subscribers are not all the same shape.
**Light** is someone who subscribed for the capability rather than the volume —
a few lectures a month, little revision; common, and the most profitable.
**Expected** is the planning case. **Heavy** is a power user near the limits.
**At caps** is everything consumed: rare, but the number the price has to
survive.

Price floor = `(cost_at_caps + $0.30) ÷ 0.964` — services plus Stripe's cut and
nothing else. It recovers no fixed costs and leaves no margin.

### Fixed costs

| Line | Pilot | Production |
| --- | --- | --- |
| App Platform (API) | $5 | $25 |
| Spaces | $5 | $5 |
| Atlas M10 + backups | $66.94 | $66.94 |
| Transactional email | — | ~$15 |
| Domain | ~$1.50 | ~$1.50 |
| **Infrastructure** | **~$78** | **~$113** |
| Claude accounts (2 × $100) | $200 | $200 |
| **Total** | **~$278/mo** | **~$313/mo** |

Excludes RA/PI salaries (grant-funded) and CI (free tier).

**Break-even** against $278/month:

| Tier | Light | Expected | Heavy | At caps |
| --- | --- | --- | --- | --- |
| Fresh | 19 | 22 | 29 | 37 |
| Pro | 4 | 5 | 8 | 12 |
| Max | 2 | 2 | 2 | 3 |

The spread matters most at the cheap end: Fresh needs 19 subscribers even when
they barely use it, against Pro's 4, because the $0.30 per charge and the 3.6%
cut do not shrink with the price.

A cheap tier carries fixed costs badly: Stripe's $0.30 + 3.6% is the same
whatever the price, so Fresh needs three times Pro's subscriber count. It earns
its place as the conversion step off Free, not as the plan the economics rest
on. Free users are pure cost at ~$5.79/month each at their caps — thirteen
fully-active free users cost about as much as the entire pilot infrastructure.

## 9. Recalculating

To re-run for a different lecture duration:

1. Change **lecture duration** in §1.
2. Multiply each §3 per-minute rate by the new duration for per-lecture usage.
3. Multiply by each tier's monthly lecture count for caps (§7).
4. Re-price with §2 and re-check that worst case sits at a sane fraction of
   price (§8).

Sensitivity at the tier volumes above:

| Duration | Cost/lecture (browser) | Cost/lecture (cloud) | Pro `aiTokens` cap |
| --- | --- | --- | --- |
| 50 min | ~$1.23 | ~$2.31 | 39M needed → cap 45,000,000 |
| **75 min** | **~$1.81** | **~$3.42** | **59M needed → cap 65,000,000** |
| 110 min | ~$2.63 | ~$4.97 | 86M needed → cap 95,000,000 |

Re-running is a notebook away: [`cost-model/billing-cost-model.ipynb`](../cost-model/)
computes all of the above from `pricing.json`, `assumptions.json`, and the
shipped `config/plans.json`, including a check that the shipped caps still sit
above what the assumptions imply.

Every number in this document is a starting point. The audience parameters and
the revision profile are guesses that a semester of pilot data will replace —
which is the entire reason they are written down as parameters rather than
baked into the caps.
