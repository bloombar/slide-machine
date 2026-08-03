/**
 * derive-caps.mjs — size a tier's usage caps from its recording allowance.
 *
 * WHY THIS EXISTS
 * `sttMinutes` — "Audio recording time" on the plans page — is the one cap a
 * human decides. Everything downstream of it is arithmetic: N minutes of
 * lecture implies so many slides, so many tokens to generate and refine them,
 * so many characters to narrate, so many megabytes of audio to keep. Those
 * numbers were previously derived by hand from an assumed lectures-per-month
 * and pasted into config/plans.json, which meant changing a recording
 * allowance silently left eight other caps describing a different product.
 *
 * This script makes the derivation the source of truth. Set `sttMinutes`, run
 * it, and the dependent caps follow.
 *
 * WHAT IT DERIVES
 *   aiTokens, ttsCharacters, ttsPremiumCharacters, diarizationMinutes,
 *   translationCharacters, audioStorageMb, audienceTtsCharacters,
 *   audienceLocales
 *
 * WHAT IT LEAVES ALONE
 *   sttMinutes (the input), audioRetentionDays (a policy), and the caps that
 *   do not scale with lecture length — aiImages, imageLookups, importMb,
 *   exports. Those bound discrete actions a user chooses to take, not the
 *   volume of recorded material, so they stay hand-set.
 *
 * USAGE
 *   node scripts/pricing/derive-caps.mjs              # report, write nothing
 *   node scripts/pricing/derive-caps.mjs --write      # update config/plans.json
 *   node scripts/pricing/derive-caps.mjs --check      # exit 1 if caps have drifted
 *
 * FLAGS
 *   --write          Apply the derived caps to config/plans.json.
 *   --check          Report only, exiting non-zero if any cap differs from what
 *                    the assumptions imply. For CI, so a hand-edited cap cannot
 *                    quietly outlive the model that justified it.
 *   --mode=floor     Only ever raise a cap (default). A cap already larger than
 *                    the allowance implies stays where it is, so no subscriber
 *                    loses allowance they have today. Tiers whose recording
 *                    allowance is rationed below their designed lecture volume
 *                    — Pro records 600 minutes but is built for far more — keep
 *                    the larger caps that volume justified.
 *   --mode=fit       Size every cap to the recording allowance exactly, lowering
 *                    it where it currently exceeds what the allowance implies.
 *   --json           Emit the derived caps as JSON instead of a table.
 *   --stt tier=N     Derive as if that tier's recording allowance were N
 *                    minutes, without touching config/plans.json. Repeatable.
 *                    For answering "what would Pro need at 1,200 minutes?"
 *                    before committing to the allowance. Ignored by --write.
 *
 * INPUTS
 *   cost-model/assumptions.json  usage assumptions + the `capSizing` block
 *   config/plans.json            `sttMinutes` and `audioRetentionDays` per tier
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PLANS_PATH = `${ROOT}config/plans.json`
const ASSUMPTIONS_PATH = `${ROOT}cost-model/assumptions.json`

const read = path => JSON.parse(readFileSync(path, 'utf8'))

/** Every cap this script owns, in the order the plans page lists them. */
export const DERIVED_METRICS = [
  'aiTokens',
  'ttsCharacters',
  'ttsPremiumCharacters',
  'diarizationMinutes',
  'translationCharacters',
  'audioStorageMb',
  'audienceTtsCharacters',
  'audienceLocales',
]

/**
 * Rounds a raw requirement up to a readable cap — 2,435,500 becomes 2,500,000.
 *
 * Caps are published numbers, and a plan advertising "2,435,500 tokens" reads
 * as a system talking to itself. Rounding *up* also supplies the only headroom
 * in the model: a subscriber whose month is slightly heavier than average is
 * not cut off at exactly the assumed figure.
 */
export const roundCap = (value, significantDigits = 2) => {
  if (value <= 0) return 0
  const magnitude =
    10 ** (Math.floor(Math.log10(value)) - significantDigits + 1)
  return Math.ceil(value / magnitude) * magnitude
}

/**
 * What one minute of recorded lecture implies, per metric, before rounding.
 *
 * The whole model hangs off `durationMinutes`: a standard lecture is that long
 * and produces `slidesPerLecture` slides, so any other quantity of minutes
 * scales its slide count — and everything derived from it — proportionally.
 * The quiz and the embeddings are the exception: they are billed once per
 * lecture rather than per slide, so they scale with lecture *count*.
 */
export const requirementsFor = (minutes, retentionDays, A) => {
  const L = A.lecture
  const X = A.perLectureExtras
  const R = A.revision
  const AU = A.audience
  const C = A.capSizing

  const lectures = minutes / L.durationMinutes
  const slides = lectures * L.slidesPerLecture

  // --- AI tokens: generation while speaking, then the refinement passes -----
  // One call per finalised phrase of speech, each sending a prompt and getting
  // a slide back.
  const generation =
    L.phrasesPerMinute *
    minutes *
    (L.inputTokensPerCall + L.outputTokensPerCall)
  const rerank =
    slides * (X.rerankInputTokensPerSlide + X.rerankOutputTokensPerSlide)
  const quiz = lectures * (X.quizInputTokens + X.quizOutputTokens)
  const embeddings = lectures * X.embeddingTokens
  // "Plus expected refinement": the share of slides an average instructor
  // tidies afterwards, and the narration rewrite that follows an edit.
  const refined = slides * R.refinedSlideShare
  const refine =
    refined * (R.refineInputTokensPerSlide + R.refineOutputTokensPerSlide)
  const narrate =
    refined * (R.narrateInputTokensPerSlide + R.narrateOutputTokensPerSlide)

  // --- Narration: every slide once, plus what editing invalidates -----------
  // Editing a slide's words throws away its cached audio, so it is synthesised
  // again — the same refinement level, expressed in characters.
  const resynthesised =
    lectures * R.resynthesizedSlides * L.narrationCharsPerSlide
  const narrationChars = slides * L.narrationCharsPerSlide + resynthesised

  // --- Text volumes --------------------------------------------------------
  const deckTextChars = slides * L.slideTextChars
  // Audio is raw PCM: sample rate x bytes per sample x 60 seconds per minute.
  const audioMb =
    (minutes * L.captureSampleRateHz * L.captureBytesPerSample * 60) / 1e6
  // An unlimited retention policy means audio accumulates instead of being
  // swept, so the gauge has to allow for several periods' worth at once.
  const heldPeriods = retentionDays === null ? C.unlimitedRetentionPeriods : 1

  // --- The audience's own pool --------------------------------------------
  // Viewers spend per (deck, locale) pair, not per viewer: the first person to
  // ask for a language pays for it and everyone after reads the stored copy.
  const audienceLocales = lectures * AU.localesPerDeck
  // Each of those languages needs the deck's narration synthesised in it.
  const audienceNarrationChars =
    audienceLocales * L.slidesPerLecture * L.narrationCharsPerSlide

  return {
    aiTokens: generation + rerank + quiz + embeddings + refine + narrate,
    ttsCharacters: narrationChars,
    // Premium voices are an upgrade applied to some of the same narration, not
    // extra narration on top — so this is a share of the same characters.
    ttsPremiumCharacters: narrationChars * C.premiumNarrationShare,
    diarizationMinutes: minutes * C.diarizationShareOfRecording,
    translationCharacters: deckTextChars * C.instructorLocalesPerDeck,
    audioStorageMb: audioMb * heldPeriods,
    audienceTtsCharacters: audienceNarrationChars,
    audienceLocales,
  }
}

/** The derived caps for one tier: requirements, rounded, mode applied. */
export const capsFor = (plan, A, mode = 'floor') => {
  const raw = requirementsFor(plan.caps.sttMinutes, plan.audioRetentionDays, A)
  const out = {}
  for (const metric of DERIVED_METRICS) {
    // Locale counts are whole languages; a cap of 3.5 has no meaning.
    const digits =
      metric === 'audienceLocales' ? 1 : A.capSizing.roundToSignificantDigits
    const derived =
      metric === 'audienceLocales'
        ? Math.max(1, Math.ceil(raw[metric]))
        : roundCap(raw[metric], digits)
    const current = plan.caps[metric]
    out[metric] =
      mode === 'floor' && typeof current === 'number'
        ? Math.max(current, derived)
        : derived
  }
  return out
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const flag = name => process.argv.includes(name)
const modeArg = process.argv.find(a => a.startsWith('--mode='))
const mode = modeArg ? modeArg.slice('--mode='.length) : 'floor'

if (!['fit', 'floor'].includes(mode)) {
  console.error(`unknown --mode=${mode}; expected 'fit' or 'floor'`)
  process.exit(2)
}

const plans = read(PLANS_PATH)
const A = read(ASSUMPTIONS_PATH)

if (!A.capSizing) {
  console.error('cost-model/assumptions.json has no capSizing block')
  process.exit(2)
}

// `--stt pro=1200` explores an allowance without committing to it. Applied to
// an in-memory copy so a preview can never leak into what ships: --write is
// refused while an override is in play.
const overrides = process.argv.flatMap((arg, i) =>
  arg === '--stt' ? [process.argv[i + 1] ?? ''] : [],
)
for (const override of overrides) {
  const [tier, minutes] = override.split('=')
  if (!plans[tier] || !Number.isFinite(Number(minutes))) {
    console.error(`bad --stt ${override}; expected e.g. --stt pro=1200`)
    process.exit(2)
  }
  plans[tier].caps.sttMinutes = Number(minutes)
}
if (overrides.length && flag('--write')) {
  console.error('--stt is a preview; refusing to --write overridden allowances')
  process.exit(2)
}

const derived = Object.fromEntries(
  Object.entries(plans).map(([tier, plan]) => [tier, capsFor(plan, A, mode)]),
)

if (flag('--json')) {
  console.log(JSON.stringify(derived, null, 2))
  process.exit(0)
}

const tiers = Object.keys(plans)
const num = n => n.toLocaleString('en-US')

// Report every derived cap beside what ships today, so a change is reviewable
// before it is written.
const changes = []
const width = Math.max(...DERIVED_METRICS.map(m => m.length))
console.log(
  `\nDerived from sttMinutes (${mode} mode): ` +
    tiers.map(t => `${t} ${num(plans[t].caps.sttMinutes)}min`).join(' | '),
)
console.log('')
for (const metric of DERIVED_METRICS) {
  const cells = tiers.map(tier => {
    const was = plans[tier].caps[metric]
    const now = derived[tier][metric]
    if (was !== now) changes.push({ tier, metric, was, now })
    return was === now ? num(now) : `${num(was)} → ${num(now)}`
  })
  console.log(`  ${metric.padEnd(width)}  ${cells.join('  |  ')}`)
}

if (flag('--check')) {
  if (changes.length) {
    console.log(
      `\n✗ ${changes.length} cap(s) differ from what the assumptions imply.` +
        `\n  Run: npm run caps:derive -- --write`,
    )
    process.exit(1)
  }
  console.log('\n✓ every derived cap matches the assumptions')
  process.exit(0)
}

if (!flag('--write')) {
  console.log(
    `\n${changes.length} cap(s) would change. Re-run with --write to apply.`,
  )
  process.exit(0)
}

for (const tier of tiers) Object.assign(plans[tier].caps, derived[tier])
writeFileSync(PLANS_PATH, `${JSON.stringify(plans, null, 2)}\n`)
console.log(`\n✓ wrote ${changes.length} cap(s) to config/plans.json`)
