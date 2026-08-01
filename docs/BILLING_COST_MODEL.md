# Billing Cost Model

How the per-tier caps in [config/plans.json](../config/plans.json) were derived
([BILL-1](SPEC.md#bill-1-subscription-tiers)/[BILL-3](SPEC.md#bill-3-usage-caps--metering)/[BILL-6](SPEC.md#bill-6-configurable-pricing--caps)).
Every figure below comes from a stated parameter times a vendor price, so when
an assumption changes the caps can be recomputed rather than re-guessed.

Unit prices live in [config/service-prices.json](../config/service-prices.json)
so cost accounting ([BILL-7](SPEC.md#bill-7-cost-attribution--admin-cost-reporting))
re-prices without a code change.

## 1. Parameters

Adjustable inputs. Lecture duration is the headline knob — §9 shows how to
re-run everything from a different value.

| Parameter | Value | Confidence |
| --- | --- | --- |
| **Average lecture duration** | **75 min** (standard Tue/Thu block) | product decision |
| Billable mic-open time | 80 min (75 + setup/teardown, plus ~15 s per-request rounding across stream restarts) | derived |
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

Verified 2026-07-31. Re-check before pricing goes live — two lines are not
first-party.

| Service | Price | Source |
| --- | --- | --- |
| Gemini 3.1 Flash-Lite | $0.25 / 1M input, $1.50 / 1M output | Google pricing page ✅ |
| `gemini-embedding-001` | $0.15 / 1M input | Google pricing page ✅ |
| Gemini 3.1 Flash-Lite Image | ~$0.034 / image | Google pricing page ✅ |
| Cloud STT streaming | ~$0.016 / min | **aggregator only (±20%)** ⚠️ |
| Cloud STT batch (diarization) | ~$0.004 / min | **aggregator only (±20%)** ⚠️ |
| Cloud TTS standard (Neural2) | $16 / 1M chars | **aggregator only (±20%)** ⚠️ |
| Cloud TTS premium (Chirp3-HD) | $30 / 1M chars | **aggregator only (±20%)** ⚠️ |
| Cloud Translation | $20 / 1M chars, first 500,000 chars/month free | Google pricing page ✅ |
| DO Spaces | $5/mo (250 GiB + 1 TiB transfer), then $0.02/GiB-month, $0.01/GiB egress | DO pricing page ✅ |
| MongoDB Atlas M10 | $56.94/mo + ~$10 backups (snapshot storage, grows with data) | Atlas pricing page ✅ |
| DO App Platform | `basic-xxs` $5/mo; 1 vCPU / 2 GiB $25/mo | DO pricing page ✅ |
| Stripe | 2.9% + $0.30 per charge, plus 0.7% Billing | Stripe pricing page ✅ |

Google's STT and TTS pricing pages truncated on fetch, so those four rates come
from vendor aggregators. TTS drives the largest single line in the audience
model, so it is the first number to confirm by hand.

The translation free allowance is **per Google Cloud account**, not per user —
roughly 27 deck-locales a month across the whole deployment. Treat it as
headroom, never as budget: caps are sized against the $20/1M marginal price.

## 3. Per-minute rates

| Rate | Value | Arithmetic |
| --- | --- | --- |
| Finalized phrases | 9 / min | ~130 wpm ÷ ~14 words per phrase |
| AI tokens (live) | 30,000 / min | 9 calls/min × (~3,000 in + ~350 out) |
| Slides produced | 0.6 / min | 45 slides ÷ 75 min |
| Narration characters | 360 / min | 600 chars/slide × 0.6 slides/min |
| Image enrichments | 0.6 / min | one attempt per slide produced |
| Retained audio | 2.88 MB / min | 24 kHz × 16-bit mono (`STT_CAPTURE_SAMPLE_RATE`) |
| Cloud STT | 1.07 min / min | restart rounding; **zero** unless `TRANSCRIPTION_PROVIDER=google-cloud` |

The tokens-per-minute figure carries **±30%** — an independent estimate put
input at 2,200 tokens/call rather than 3,000, which moves a lecture's
generation cost between $0.62 and $0.84.

## 4. Cost per 100 lectures

The fastest read in this document. One row per service, with the usage assumed
on each side.

| Service | Instructor usage | Student usage | Cost / 100 lectures | Share |
| --- | --- | --- | --- | --- |
| **Cloud STT** | 8,300 min | — | **$133.00** | 42% |
| **Gemini (all LLM)** | 234M tokens | — | **$89.00** | 28% |
| **TTS** | 3.0M chars | 1.35M chars | **$69.50** | 22% |
| **Translation** | — | 900K chars | **$18.00** | 6% |
| **Diarization** | 2,300 min | — | **$9.00** | 3% |
| **Image search APIs** | 5,000 lookups | — | **$0.00** | free |
| **Object storage** | 21.6 GB held | — | **$0.30** | 0.1% |
| **Egress** | — | 30 GB (2,000 playbacks) | **$0.30** | 0.1% |
| **Total** | | | **$319** | |

Browser capture drops the total to **$186**. **Instructor-driven cost is $279
(88%); student-driven is $40 (12%).**

Five conclusions:

- **Cloud STT and Gemini are 70% of all cost.** Everything else is rounding
  error beside them.
- **Browser capture removes 42% with one config value** — which is why Free and
  Fresh are browser-only.
- **TTS is 22% in aggregate**, two-thirds of it the first narration of each
  deck. "Don't narrate decks nobody plays" is the next-largest saving.
- **Students are an eighth of cost** even at 2,000 playbacks, because cache
  hits are free and only new languages spend.
- **Storage and egress are 0.2%** — they dominate the operational constraints
  while being financially irrelevant.

## 5. Cost of one lecture

**Live capture** — 2.25M tokens, 45 slides, 216 MB audio:

| Line | Cost |
| --- | --- |
| Slide generation (2.03M in / 0.22M out) | $0.84 |
| Image re-rank + quiz + embeddings | $0.04 |
| Cloud STT, 80 billable min | $1.28 (zero on browser capture) |
| **Live subtotal** | **$2.16 cloud / $0.88 browser** |

**Post-lecture**, light revision profile:

| Line | Quantity | Cost |
| --- | --- | --- |
| Refine + narrate passes | ~11 slides | $0.02 |
| TTS narration of the deck | 27,000 chars | $0.43 |
| Re-synthesis after edits | ~5 slides | $0.05 |
| Image enrichment redos | ~5 slides | $0.01 |
| Re-transcribing an edited clip | 3 min (streaming-priced) | $0.05 |
| Diarization | 30% of lectures | $0.09 |
| **Post-lecture subtotal** | | **~$0.65** |

**Per lecture, all in: ~$1.53 browser capture, ~$2.81 with cloud STT.**

Two things worth knowing. Re-transcribing a saved clip runs through the
*streaming* recognizer, so it is billed at $0.016/min, not the batch rate. And
every narration edit re-synthesizes that slide, so revision volume matters more
than it looks.

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
   spends.
3. **Audience work draws on its own allowance** (`audienceTtsCharacters`,
   `audienceLocales`), so a popular deck cannot exhaust its author's budget.
4. **Exhaustion hard-blocks with a 402** and a viewer-safe message that never
   reveals the instructor's billing state.

## 7. Cap formulas

```
cap = lectures_per_month × lecture_minutes × per_minute_rate × revision_factor
```

plus, for the audience metrics:

```
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

`sttMinutes` is deliberately **not** full coverage: 600 minutes covers ~8 of
Pro's 26 lectures, because browser capture handles the rest for free and full
cloud coverage would cost $33/month by itself.

## 8. Tier economics and break-even

| Plan | Lectures/mo | Students | Cost expected | Cost at caps | Price floor | Price |
| --- | --- | --- | --- | --- | --- | --- |
| Free | 4 | 30 | ~$3 | ~$6 | $6.50 | **$0** |
| Fresh | 6 | 30 | ~$5.50 | ~$11 | $11.66 | **$19** |
| Pro | 26 | 90 | ~$36 | ~$71 | $74 | **$99** |
| Max | 40 | 120 | ~$88 | ~$175 | $182 | **$299** |

Price floor = `(cost_at_caps + $0.30) ÷ 0.964` — services plus Stripe's cut and
nothing else. It recovers no fixed costs and leaves no margin. Caps are sized so
worst case sits near 60% of price.

**Fixed costs**

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

**Break-even** against $278/month, at expected / heavy / capped use:
Fresh **22 / 30 / 38**, Pro **5 / 8 / 12**, Max **2 / 2 / 3**.

A cheap tier carries fixed costs badly: Stripe's $0.30 + 3.6% is the same
whatever the price, so Fresh needs three times Pro's subscriber count. It earns
its place as the conversion step off Free, not as the plan the economics rest
on. Free users are pure cost at ~$6/month each — thirteen fully-active free
users cost about as much as the entire pilot infrastructure.

## 9. Recalculating

To re-run for a different lecture duration:

1. Change **lecture duration** in §1.
2. Multiply each §3 per-minute rate by the new duration for per-lecture usage.
3. Multiply by each tier's monthly lecture count for caps (§7).
4. Re-price with §2 and re-check that worst case sits near 60% of price (§8).

Sensitivity at the tier volumes above:

| Duration | Cost/lecture (browser) | Cost/lecture (cloud STT) | Pro `aiTokens` cap |
| --- | --- | --- | --- |
| 50 min | ~$1.02 | ~$1.87 | 43,000,000 |
| **75 min** | **~$1.53** | **~$2.81** | **65,000,000** |
| 110 min | ~$2.24 | ~$4.12 | 95,000,000 |

Every number in this document is a starting point. The audience parameters and
the revision profile are guesses that a semester of pilot data will replace —
which is the entire reason they are written down as parameters rather than
baked into the caps.
