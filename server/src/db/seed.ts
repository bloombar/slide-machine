/**
 * Database seeding (dev only): pre-populates the app with realistic
 * users, projects, lectures, and slides.
 *
 * Lectures are NOT hand-authored. For each lecture we first generate a
 * simulated spoken-lecture transcript on a random academic topic, store
 * it on the deck (the GEN-4 transcript field), then replay it phrase by
 * phrase through the real `session.phrase` pipeline — the same contract
 * live speech uses. So every seeded slide is produced by the actual
 * generation provider (layout choice, slide-fit, deck titling) and every
 * image comes from the real enrichment sources (IMG-1). The seed data is
 * therefore an honest sample of what the app produces in production.
 *
 * The account/project/lecture *structure* is driven by a seeded PRNG so
 * runs are reproducible in shape (content still varies — the model is
 * non-deterministic). All seed users live under @seed.slidemachine.dev;
 * a run wipes and rebuilds only that domain's data, never real accounts.
 *
 *   npm run seed -w server                # full seed (spec ranges)
 *   npm run seed -w server -- --smoke     # 1 user / 1 project / 1 lecture
 *   npm run seed -w server -- --no-images # skip image enrichment
 *   npm run seed -w server -- --append    # keep existing seed data
 *   npm run seed -w server -- --seed=42   # different structure RNG
 */
import { env } from '../config/env'
import { connectMongo, disconnectMongo } from './mongoose'
import { UserModel } from '../models/user'
import { ProjectModel } from '../models/project'
import { DeckModel } from '../models/deck'
import { SlideModel } from '../models/slide'
import { SeedAssetModel } from '../models/seed-asset'
import { hashPassword } from '../auth/password'
import { permalinkSlug } from '../lib/slug'
import { listBuiltinTemplates } from '../templates/builtin'
import { sessionPhrase } from '../actions/deck'
import { enrichSlideImage } from '../enrichment/enrich'
import { DISCIPLINES, PERSONAS, SEED_DOMAIN, SEED_PASSWORD } from './seed-data'
// Side-effect imports: register the generation providers in the registry
// exactly as the server does at boot, so session.phrase can resolve one.
import '../providers/mock-generation'
import '../providers/gemini-generation'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Seed accounts and lecture content live in JSON fixtures loaded via
// ./seed-data (seed-accounts.json, seed-disciplines.json), so they can be
// edited without touching the generation logic. Imported at the top.

interface CliOptions {
  smoke: boolean
  images: boolean
  append: boolean
  rngSeed: number
  /** Distinct decks generated concurrently. Every Gemini call is also
   * globally rate-limited and 429-retried, so this bounds burst, not the
   * request rate. Phrases within a deck stay sequential. */
  concurrency: number
  /** Cap total lectures (0 = no cap); handy for a bounded paid test. */
  limit: number
}

const parseArgs = (argv: string[]): CliOptions => {
  const has = (flag: string): boolean => argv.includes(flag)
  const num = (prefix: string, fallback: number): number => {
    const hit = argv.find(a => a.startsWith(prefix))
    const parsed = hit ? Number(hit.slice(prefix.length)) : NaN
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return {
    smoke: has('--smoke'),
    images: !has('--no-images'),
    append: has('--append'),
    rngSeed: num('--seed=', 1337),
    concurrency: Math.max(1, num('--concurrency=', 2)),
    limit: Math.max(0, num('--limit=', 0)),
  }
}

// ---------------------------------------------------------------------------
// Gemini call pacing: a global concurrency gate + 429-aware backoff, so a
// burst of phrase calls stays under the model's per-minute rate limit
// instead of getting dropped.
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/** A simple async semaphore bounding concurrent Gemini calls. */
const makeGate = (limit: number): (<T>(fn: () => Promise<T>) => Promise<T>) => {
  let active = 0
  const queue: Array<() => void> = []
  const acquire = (): Promise<void> =>
    active < limit
      ? (active++, Promise.resolve())
      : new Promise<void>(resolve => queue.push(resolve)).then(() => {
          active++
        })
  const release = (): void => {
    active--
    queue.shift()?.()
  }
  return async fn => {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

/** Backoff schedule (ms) for successive transient failures; the delays
 * ramp up then hold at 60s, giving many patient retries before a call is
 * finally given up on (the dev key's per-minute quota recovers slowly). */
const BACKOFF_MS = [
  3000, 8000, 20000, 45000, 60000, 60000, 60000, 60000, 60000, 60000, 60000,
  60000,
]

/** A transient failure worth retrying: a rate limit, a request timeout,
 * or a 5xx — all mean nothing was persisted, so replaying the same unit
 * of work is safe. Persistent errors (bad input, 4xx) propagate. */
const isRetryable = (message: string): boolean =>
  message.includes('429') ||
  /aborted|timeout/i.test(message) ||
  /\b(500|502|503|504)\b/.test(message) ||
  message.includes('fetch failed')

/** A short, human label for why a call failed, so the log distinguishes
 * a rate limit from a timeout from a server error. */
const failureReason = (message: string): string => {
  if (message.includes('429')) return 'rate limit (429)'
  if (/aborted|timeout/i.test(message)) return 'timeout'
  const status = /\b(500|502|503|504)\b/.exec(message)
  if (status) return `server error (${status[1]})`
  if (message.includes('fetch failed')) return 'network error'
  return 'transient error'
}

/**
 * Runs `fn`, retrying transient failures with backoff. Honors the
 * server's suggested retry delay (429 RetryInfo) when present, and logs
 * the actual reason (rate limit / timeout / server error) each attempt.
 */
const withRateLimitRetry = async <T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const message = (err as Error).message ?? ''
      if (!isRetryable(message) || attempt >= BACKOFF_MS.length) throw err
      const suggested = /retryDelay"?:\s*"?(\d+)s/.exec(message)
      const wait = suggested
        ? Number(suggested[1]) * 1000
        : BACKOFF_MS[attempt]!
      console.warn(
        `  ${failureReason(message)} on ${label} (attempt ${attempt + 1}/${BACKOFF_MS.length}); retrying in ${wait / 1000}s...`,
      )
      await sleep(wait)
    }
  }
}

/** Global gate wrapping every Gemini call; initialized in main() once the
 * requested concurrency is known. Both the transcript call and each
 * session.phrase call pass through it. */
let geminiGate: <T>(fn: () => Promise<T>) => Promise<T> = fn => fn()

/** Paces one Gemini-backed call: bounded concurrency + 429 retry. */
const gemini = <T>(fn: () => Promise<T>, label: string): Promise<T> =>
  geminiGate(() => withRateLimitRetry(fn, label))

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — reproducible account/lecture structure
// ---------------------------------------------------------------------------

const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Inclusive integer in [min, max]. */
const randInt = (rng: () => number, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1))

const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)]!

/** Fisher–Yates shuffle of a copy. */
const shuffle = <T>(rng: () => number, items: readonly T[]): T[] => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

// Persona/Discipline fixtures load from JSON via ./seed-data (imported
// at the top of this file); this index resolves a persona's discipline
// keys to their course + topic content.
const disciplineByKey = new Map(DISCIPLINES.map(d => [d.key, d]))

// ---------------------------------------------------------------------------
// Transcript generation: a simulated spoken lecture, via a raw Gemini call
// ---------------------------------------------------------------------------

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Rough word budgets shaping how many slides a lecture yields. */
const LENGTH_TARGETS = {
  short: { words: 320, label: 'a brief 3-minute lecture' },
  medium: { words: 560, label: 'a 5-minute lecture' },
  long: { words: 820, label: 'a fuller 8-minute lecture' },
} as const

type LengthKey = keyof typeof LENGTH_TARGETS

/**
 * Generates a natural, spoken-style lecture transcript on `topic`. Plain
 * prose in the first person, as if captured live by speech-to-text — no
 * headings or slide markers, since the pipeline consumes raw speech.
 */
const generateTranscript = async (
  topic: string,
  courseBlurb: string,
  length: LengthKey,
): Promise<string> => {
  if (!env.GEMINI_API_KEY) {
    throw new Error('Transcript generation requires GEMINI_API_KEY')
  }
  const target = LENGTH_TARGETS[length]
  const prompt = `You are a university professor delivering ${target.label} out loud to a class. The topic is "${topic}". Course context: ${courseBlurb}

Produce a transcript of exactly what you SAY — as if a speech-to-text system captured it live. Requirements:
- First person, conversational, spoken cadence (contractions, the occasional aside like "now, here's the interesting part").
- About ${target.words} words.
- Move through a natural arc: a hook, two or three subtopics with concrete examples and a few real numbers or named entities, and a short wrap-up.
- NO headings, NO bullet points, NO slide directions, NO stage directions, NO markdown. Just the spoken words as flowing prose in a few paragraphs.
- Do not address "slides" — you are lecturing, not narrating a deck.`

  return gemini(async () => {
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${env.GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY!,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `Transcript request failed (${res.status}): ${detail.slice(0, 200)}`,
      )
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!text) throw new Error('Transcript generation returned no text')
    return text
  }, `transcript: ${topic}`)
}

/**
 * Splits a spoken transcript into utterance-sized phrases, approximating
 * how the STT layer finalizes speech (roughly one sentence per finalized
 * phrase). Short fragments are dropped.
 */
const splitPhrases = (transcript: string): string[] =>
  (transcript.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [])
    .map(s => s.trim())
    .filter(s => s.length > 3)

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

/** Runs `worker` over `items` with at most `limit` in flight. */
const pool = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await worker(items[i]!, i)
      }
    },
  )
  await Promise.all(runners)
  return results
}

// ---------------------------------------------------------------------------
// Reset: wipe only seed-domain data (never touches real accounts)
// ---------------------------------------------------------------------------

const resetSeedData = async (): Promise<void> => {
  const users = await UserModel.find({
    email: { $regex: `@${SEED_DOMAIN.replace('.', '\\.')}$` },
  }).select('_id')
  const userIds = users.map(u => u._id)
  if (!userIds.length) return

  const projects = await ProjectModel.find({
    ownerId: { $in: userIds },
  }).select('_id')
  const decks = await DeckModel.find({ ownerId: { $in: userIds } }).select(
    '_id',
  )
  const projectIds = projects.map(p => p._id)
  const deckIds = decks.map(d => d._id)

  await SlideModel.deleteMany({ deckId: { $in: deckIds } })
  await SeedAssetModel.deleteMany({ projectId: { $in: projectIds } })
  await DeckModel.deleteMany({ ownerId: { $in: userIds } })
  await ProjectModel.deleteMany({ ownerId: { $in: userIds } })
  await UserModel.deleteMany({ _id: { $in: userIds } })
  console.log(
    `Reset: removed ${userIds.length} seed users, ${projectIds.length} projects, ${deckIds.length} lectures.`,
  )
}

// ---------------------------------------------------------------------------
// Seeding a single lecture (deck) end-to-end
// ---------------------------------------------------------------------------

interface LecturePlan {
  ownerId: string
  projectId: string
  templateId: string
  topic: string
  courseBlurb: string
  length: LengthKey
  useImages: boolean
}

interface LectureResult {
  topic: string
  slides: number
  images: number
  title: string
}

/**
 * Creates a deck, generates its transcript, replays it through the real
 * session.phrase pipeline phrase by phrase, then runs live image
 * enrichment on the slides the model flagged for an image.
 */
const seedLecture = async (plan: LecturePlan): Promise<LectureResult> => {
  const deck = await DeckModel.create({
    projectId: plan.projectId,
    ownerId: plan.ownerId,
    // Start untitled so the generation pipeline proposes the deck title,
    // exercising that path exactly as a live session would.
    title: '',
    templateId: plan.templateId,
    permalinkSlug: permalinkSlug(plan.topic),
    voteScore: 0,
  })

  const transcript = await generateTranscript(
    plan.topic,
    plan.courseBlurb,
    plan.length,
  )
  const phrases = splitPhrases(transcript)

  const ctx = { userId: plan.ownerId, requestId: `seed-${deck._id}` }
  const deckId = deck._id.toString()
  for (const phrase of phrases) {
    try {
      // Each phrase makes exactly one Gemini call inside the action, so
      // gate + 429-retry it the same as the transcript call.
      await gemini(
        () => sessionPhrase.execute(ctx, { deckId, phrase }),
        `phrase (${plan.topic})`,
      )
    } catch (err) {
      // One lost phrase must never abort a lecture (matches live behavior).
      console.warn(`  phrase skipped: ${(err as Error).message}`)
    }
  }

  // Store the FULL spoken transcript on the deck (GEN-4). session.phrase
  // accumulates only the phrases that produced content; we want the
  // complete lecture text retained for post-lecture reformatting.
  const fresh = await DeckModel.findById(deck._id)
  if (fresh) {
    fresh.transcript = transcript
    if (!fresh.title) fresh.title = plan.topic // fallback if none proposed
    await fresh.save()
  }

  // Live image enrichment (IMG-1): the pipeline fires this in the
  // background and unawaited; here we await it so images are present
  // before the script exits. enrichSlideImage no-ops when it finds no
  // image above threshold, leaving the slide imageless (IMG-3).
  let images = 0
  if (plan.useImages && env.IMAGE_ENRICHMENT_ENABLED) {
    const needImages = await SlideModel.find({
      deckId: deck._id,
      imageRef: { $exists: false },
      imageKeywords: { $exists: true, $ne: [] },
    })
    for (const slide of needImages) {
      await enrichSlideImage(slide._id.toString(), slide.imageKeywords ?? [])
    }
    images = await SlideModel.countDocuments({
      deckId: deck._id,
      imageRef: { $exists: true },
    })
  }

  const slides = await SlideModel.countDocuments({ deckId: deck._id })
  const titled = await DeckModel.findById(deck._id).select('title')
  return {
    topic: plan.topic,
    slides,
    images,
    title: titled?.title || plan.topic,
  }
}

// ---------------------------------------------------------------------------
// Plan the whole seed structure, then execute
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const opts = parseArgs(process.argv.slice(2))
  const rng = makeRng(opts.rngSeed)
  const templateIds = listBuiltinTemplates().map(t => t.id)
  geminiGate = makeGate(opts.concurrency)

  console.log(
    `Seeding via provider "${env.GENERATION_PROVIDER}" (model ${env.GEMINI_MODEL}); ` +
      `structure RNG seed ${opts.rngSeed}, concurrency ${opts.concurrency}` +
      `${opts.limit ? `, limit ${opts.limit}` : ''}${opts.smoke ? ' [smoke]' : ''}.`,
  )
  await connectMongo(env.MONGODB_URI)

  if (!opts.append) await resetSeedData()

  const personas = opts.smoke ? PERSONAS.slice(0, 1) : PERSONAS
  const passwordHash = await hashPassword(SEED_PASSWORD)

  // Build the lecture plan first so we can report scale before spending
  // any API calls.
  interface PendingLecture extends LecturePlan {
    userName: string
  }
  const lectures: PendingLecture[] = []
  const summaryRows: string[] = []

  for (const persona of personas) {
    const email = `${persona.handle}@${SEED_DOMAIN}`
    // Reuse an existing seed user in --append mode (a plain reset run has
    // already removed them, so this only matches when appending); a fresh
    // create would collide with the unique email index.
    const user =
      (await UserModel.findOne({ email })) ??
      (await UserModel.create({
        email,
        displayName: persona.displayName,
        passwordHash,
        emailVerified: true,
        profileVisibility: persona.profileVisibility,
        bio: persona.bio,
        locale: persona.locale,
        planTier: persona.planTier,
      }))
    const userId = user._id.toString()

    const projectCount = opts.smoke ? 1 : randInt(rng, 0, 3)
    const disciplines = shuffle(rng, persona.disciplines)
    let projectsMade = 0

    for (let p = 0; p < projectCount; p++) {
      const discipline = disciplineByKey.get(
        disciplines[p % disciplines.length]!,
      )!
      const project = await ProjectModel.create({
        ownerId: userId,
        title: discipline.course,
        course: discipline.course.split(':')[0]!.trim(),
        description: discipline.blurb,
        seedContext: discipline.blurb,
        visibility: rng() < 0.7 ? 'public' : 'restricted',
        templateId: pick(rng, templateIds),
      })
      projectsMade++

      // A text seed asset so the SEED-1 layer is exercised and populated.
      await SeedAssetModel.create({
        projectId: project._id,
        type: 'gdoc',
        name: `${discipline.course} — syllabus notes`,
        status: 'ready',
        text: discipline.blurb,
        keywords: [discipline.key.replace(/-/g, ' ')],
        enabled: true,
      })

      const lectureCount = opts.smoke ? 1 : randInt(rng, 0, 10)
      const topics = shuffle(rng, discipline.topics)
      for (let l = 0; l < lectureCount; l++) {
        lectures.push({
          userName: persona.displayName,
          ownerId: userId,
          projectId: project._id.toString(),
          templateId: pick(rng, templateIds),
          topic: topics[l % topics.length]!,
          courseBlurb: discipline.blurb,
          length: opts.smoke
            ? 'short'
            : pick(rng, ['short', 'medium', 'long'] as const),
          useImages: opts.images,
        })
      }
    }
    summaryRows.push(
      `  ${persona.displayName}: ${projectsMade} project(s), ` +
        `${lectures.filter(x => x.ownerId === userId).length} lecture(s)`,
    )
  }

  console.log(
    `\nPlanned structure (${personas.length} users, ${lectures.length} lectures):`,
  )
  summaryRows.forEach(r => console.log(r))

  const toRun = opts.limit ? lectures.slice(0, opts.limit) : lectures
  console.log(
    `\nGenerating ${toRun.length} lectures (~${toRun.length * 25} Gemini calls). This may take a while...\n`,
  )

  let done = 0
  const results = await pool(toRun, opts.concurrency, async lec => {
    const r = await seedLecture(lec)
    done++
    console.log(
      `[${done}/${toRun.length}] ${lec.userName} — "${r.title}": ${r.slides} slides, ${r.images} images`,
    )
    return r
  })

  const totalSlides = results.reduce((n, r) => n + r.slides, 0)
  const totalImages = results.reduce((n, r) => n + r.images, 0)
  console.log(
    `\nDone. ${personas.length} users, ${results.length} lectures, ` +
      `${totalSlides} slides, ${totalImages} images.`,
  )
  console.log(
    `Sign in with any seed address (e.g. ada.lovelace@${SEED_DOMAIN}) / password "${SEED_PASSWORD}".`,
  )

  await disconnectMongo()
}

main().catch(async err => {
  console.error('Seeding failed:', err)
  await disconnectMongo().catch(() => undefined)
  process.exit(1)
})
