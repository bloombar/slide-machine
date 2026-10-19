/**
 * The de-identified research export bundle (SPEC EVAL-2): one zip for a date
 * range holding lectures and slides, transcript segments, per-session
 * telemetry summaries (EVAL-1), quiz references, votes, and cost events
 * (BILL-7) — every account keyed by its opaque study id (P-14), never by
 * user id, email, or display name.
 *
 * This is where P-7's "anonymized before analysis" is *enforced*: identity is
 * replaced on the way out, so nothing downstream has to remember to do it.
 * Free text that could still name a person — titles, slide bodies, spoken
 * transcripts — leaves as-is and is scrubbed downstream; the bundle's README
 * says so plainly rather than implying a guarantee the export does not make.
 *
 * Assembled in memory, one dataset at a time (EVAL-2): each dataset is read
 * as plain rows limited to the columns its CSV writes, turned into CSV text,
 * added to the zip, and dropped before the next is read. Peak memory is
 * roughly one dataset's rows plus the CSV text so far, not every dataset as
 * full documents at once — which a small server cannot hold. The zip itself
 * cannot be streamed entry-by-entry without giving up its central directory.
 */
import AdmZip from 'adm-zip'
import { Types } from 'mongoose'
import type { SlideRefineParts } from '@slide-machine/shared'
import { csvRow } from '../audit/csv'
import { MICROS_PER_UNIT } from '../billing/pricing'
import { CostEventModel } from '../models/cost-event'
import { DeckViewModel } from '../models/deck-view'
import { DeckModel } from '../models/deck'
import { RefineJobModel } from '../models/refine-job'
import { SessionTelemetryEventModel } from '../models/session-telemetry-event'
import { SlideModel } from '../models/slide'
import {
  TranscriptSegmentModel,
  type TranscriptSegmentDb,
} from '../models/transcript-segment'
import { VoteModel } from '../models/vote'
import { sessionSummaries } from '../telemetry/session-report'
import { SESSION_CSV_COLUMNS, sessionCsvValues } from '../telemetry/session-csv'
import { windowFilter, type ReportWindow } from '../routes/report-window'
import { ensureStudyIds } from './study-id'

/** Tombstoned rows are exported too, marked by their `deletedAt` column: a
 * deleted lecture's sessions still happened, and the analyst — not the
 * export — decides what a retraction means for the study. */
const seen = { withDeleted: true } as const

const iso = (date?: Date | null): string | undefined => date?.toISOString()

/** Serializes structured cells (bullets, slot maps) so a CSV field can carry
 * them without inventing a sub-format. */
const json = (value: unknown): string | undefined =>
  value === undefined || value === null ? undefined : JSON.stringify(value)

/** One CSV file: a header row and one row per record. */
const csvFile = (header: string[], rows: unknown[][]): string =>
  csvRow(header) + rows.map(csvRow).join('')

const readme = (window: ReportWindow): string => `# Research export bundle

De-identified research export (SPEC EVAL-2), generated ${new Date().toISOString()}.
Window: ${iso(window.from) ?? 'open'} to ${iso(window.to) ?? 'open'}.

## Keys

Every account is identified ONLY by its opaque study id — a random
pseudonym stable across exports, so bundles of different windows join.
No user id, email, or display name appears in any file. Entity ids
(lecture, project, slide, session) are database ids: opaque, and the
join keys between files.

## What is NOT de-identified

Free text is exported as-is and can still name a person: lecture and
project titles, slide bodies, and spoken transcripts say whatever was
said. This bundle is pseudonymous, not anonymous — scrub free text
downstream before analysis, as the study protocol (P-7, P-14) requires.

## Files

- lectures.csv — every lecture created in the window, plus any lecture
  referenced by in-window activity so no join dangles. Carries the study
  label (EVAL-3) and the published quiz reference (QUIZ-3), if any.
- slides.csv — the slides of those lectures.
- transcript-segments.csv — finalized phrases created in the window, with
  timing but without per-word detail.
- session-telemetry.csv — one row per live capture session overlapping the
  window (EVAL-1), the same shape as the admin telemetry export.
- votes.csv — votes cast in the window, voter keyed by study id.
- cost-events.csv — the cost ledger over the window (BILL-7), payer and
  actor keyed by study id. Read a blank actor with the actorKind column
  beside it: 'system' means work no request was attributed to, and
  anything else means an account purged since the event, or a row from
  before translated viewing required one. The channel column is how the
  request arrived: 'app' is the product's own front end, 'agent' is an
  external AI assistant over MCP, and a row written before the field
  existed reads as 'app'. The locale column is the language the lecture
  was read or heard in; it is blank for work that has no language, which
  is not the same as English. The deckId column is the lecture the work
  belonged to, and the slideId column beside it is the one slide it was
  for — present for per-slide work (narration), blank for whole-lecture
  work (translating a deck, generating slides, extracting seed material).
  Blank means "not slide-specific", never "unknown". Count distinct
  actorStudyId per (deckId, locale) for how many students used a language,
  and count rows for how many times — never sum quantity, which is 0 on a
  cache hit. Treat a language as a quasi-identifier when you do: a lecture
  with one reader in a language singles that pseudonym out, and every other
  row it appears in with it. Suppress small cells before publishing.
  The trigger column is blank except on translation rows, where it says why
  the translation happened: 'reading' is somebody opening the lecture in
  that language, 'narration' is translation performed only so narration
  could speak the words. To count how many *times* a lecture was read in a
  language, filter to trigger = 'reading' — counting narration rows too
  inflates that figure in proportion to how much students listened, since a
  single reading can be followed by many playbacks. Then choose the metric
  deliberately, because whose reading it was decides which unit it was
  billed in (BILL-3): a student's reading lands on audienceLocales, and the
  owner's or an editor's own lands on translationCharacters. Filtering to
  audienceLocales counts student readings only, and drops every reading the
  instructor made without saying so. Counting distinct students per language
  is unaffected either way: audience membership does not change with how
  they read.

- refine-jobs.csv — one row per post-lecture refinement run (GEN-4) started
  in the window. Failed and soft-deleted runs are included: a run that
  errored is a fact about the machine, and leaving it out would make
  refinement look more reliable than it was. The identifySpeakers,
  slidesLevel, slidesParts, transcriptLevel and allowSplit columns are what
  the run was asked to do; reframed, slidesRefined, slidesSplit and
  transcriptsUpdated are what it actually changed — a run that touched two
  slides at strength 1 and one that touched two at strength 5 are different
  observations, and the outcome counts alone cannot tell them apart.

- deck-views.csv — one row per time a lecture was opened in the viewer over
  the window (EVAL-7). A blank viewerStudyId is a signed-out reader: those
  are counted as openings and deliberately never identified, so distinct
  readers can be counted for signed-in viewers only. actorKind separates the
  lecture's own owner from its audience. A reload or a return visit is a new
  row, so this counts readings rather than people even when signed in.
  occurredAt is a full-precision timestamp, which makes it a quasi-identifier
  in a small cohort: a signed-in reader's rows here sit next to their rows in
  cost-events.csv, and adjacent timestamps reconstruct a reading session for
  one person. Aggregate before publishing, and suppress small cells here too.
  slidesReached and activeMs are both a floor, not an exact figure: a reader
  who closes the browser abruptly reports nothing further, so either column
  can understate how far a reading actually went. activeMs counts only time
  the page was visible in the foreground, never a backgrounded or locked tab.
  Both are blank when no depth report ever arrived for that opening.

Rows with a deletedAt value were soft-deleted in the application but are
exported for completeness; exclude them downstream if the analysis calls
for it.
`

/** Builds the whole bundle for a window; returns the zip's bytes. */
export const buildResearchBundle = async (
  window: ReportWindow,
): Promise<Buffer> => {
  // The lecture set is the union of lectures created in the window and
  // lectures referenced by any in-window activity — telemetry, transcript
  // segments, votes, cost events — so every deckId in the other files has
  // a row here to join against.
  const [
    created,
    segmentDecks,
    telemetryDecks,
    voteDecks,
    costDecks,
    refineDecks,
    viewDecks,
  ] = await Promise.all([
    DeckModel.find(windowFilter('createdAt', window))
      .select('_id')
      .lean()
      .setOptions(seen),
    TranscriptSegmentModel.distinct('deckId', {
      ...windowFilter('createdAt', window),
    }).setOptions(seen),
    SessionTelemetryEventModel.distinct('deckId', {
      deckId: { $ne: null },
      ...windowFilter('at', window),
    }),
    VoteModel.distinct('targetId', {
      targetType: 'deck',
      ...windowFilter('createdAt', window),
    }),
    CostEventModel.distinct('deckId', {
      deckId: { $ne: null },
      ...windowFilter('occurredAt', window),
    }),
    RefineJobModel.distinct('deckId', {
      ...windowFilter('createdAt', window),
    }).setOptions(seen),
    DeckViewModel.distinct('deckId', windowFilter('occurredAt', window)),
  ])
  const deckIds = [
    ...new Set(
      [
        ...created.map(d => d._id),
        ...segmentDecks,
        ...telemetryDecks,
        ...voteDecks,
        ...costDecks,
        ...refineDecks,
        ...viewDecks,
      ]
        .filter((id): id is Types.ObjectId => id != null)
        .map(id => id.toString()),
    ),
  ].map(id => new Types.ObjectId(id))

  // EVAL-2: each dataset below is read, turned into CSV text, added to the
  // zip, and dropped before the next is read — never all of them at once.
  const zip = new AdmZip()
  const add = (name: string, content: string): void => {
    zip.addFile(name, Buffer.from(content, 'utf-8'))
  }
  const sid = studyIdLookup()

  add('README.md', readme(window))
  add('lectures.csv', await lecturesCsv(deckIds, sid))
  add('slides.csv', await slidesCsv(deckIds))
  add('transcript-segments.csv', await segmentsCsv(window))
  add(
    'session-telemetry.csv',
    csvFile(
      [...SESSION_CSV_COLUMNS],
      (await sessionSummaries({}, window)).map(sessionCsvValues),
    ),
  )
  add('votes.csv', await votesCsv(window, sid))
  add('cost-events.csv', await costEventsCsv(window, sid))
  add('refine-jobs.csv', await refineJobsCsv(window))
  add('deck-views.csv', await deckViewsCsv(window, sid))

  return zip.toBuffer()
}

/** Pseudonymizes accounts a dataset references; resolves any user reference
 * to its study id. Accounts are keyed as each dataset is read (EVAL-2) rather
 * than in one pass over every dataset, but the ids are the same: each is
 * assigned once, guarded on being absent. */
interface StudyIds {
  /** Assigns a study id to every account in `refs` not yet keyed. */
  load: (refs: Iterable<Types.ObjectId>) => Promise<void>
  /** The pseudonym for a user reference; blank when there is no identity
   * (anonymous actor) or none left (account purged) — blank, not withheld. */
  (id?: Types.ObjectId | null): string | undefined
}

const studyIdLookup = (): StudyIds => {
  const known = new Map<string, string>()
  const lookup = ((id?: Types.ObjectId | null) =>
    id ? known.get(id.toString()) : undefined) as StudyIds
  lookup.load = async refs => {
    for (const [user, studyId] of await ensureStudyIds(refs)) {
      known.set(user, studyId)
    }
  }
  return lookup
}

/** Lectures (lectures.csv). `slideOrder` is read only for its length. */
const lecturesCsv = async (
  deckIds: Types.ObjectId[],
  sid: StudyIds,
): Promise<string> => {
  const decks = await DeckModel.find({ _id: { $in: deckIds } })
    .select(
      '_id projectId ownerId title studyLabel language templateId slideOrder voteScore quiz.formId quiz.publishedAt createdAt updatedAt deletedAt',
    )
    .lean()
    .setOptions(seen)
  await sid.load(decks.map(d => d.ownerId))
  return csvFile(
    [
      'deckId',
      'projectId',
      'ownerStudyId',
      'title',
      'studyLabel',
      'language',
      'templateId',
      'slideCount',
      'voteScore',
      'quizFormId',
      'quizPublishedAt',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    decks.map(d => [
      d._id.toString(),
      d.projectId.toString(),
      sid(d.ownerId),
      d.title,
      d.studyLabel,
      d.language,
      d.templateId,
      // Plain rows carry no schema defaults: restore the ones that show.
      (d.slideOrder ?? []).length,
      d.voteScore ?? 0,
      d.quiz?.formId,
      iso(d.quiz?.publishedAt),
      iso(d.createdAt),
      iso(d.updatedAt ?? d.createdAt),
      iso(d.deletedAt),
    ]),
  )
}

/** Slides of the bundled lectures (slides.csv). */
const slidesCsv = async (deckIds: Types.ObjectId[]): Promise<string> => {
  const slides = await SlideModel.find({ deckId: { $in: deckIds } })
    .select(
      '_id deckId index layoutType title body bullets caption imageSource slots manuallyEdited sourceTranscript deletedAt',
    )
    .sort({ deckId: 1, index: 1 })
    .lean()
    .setOptions(seen)
  return csvFile(
    [
      'slideId',
      'deckId',
      'index',
      'layoutType',
      'title',
      'body',
      'bullets',
      'caption',
      'imageSource',
      'slots',
      'manuallyEdited',
      'sourceTranscript',
      'deletedAt',
    ],
    slides.map(s => [
      s._id.toString(),
      s.deckId.toString(),
      s.index,
      s.layoutType,
      s.title,
      s.body,
      json(s.bullets),
      s.caption,
      s.imageSource,
      json(s.slots),
      s.manuallyEdited,
      s.sourceTranscript,
      iso(s.deletedAt),
    ]),
  )
}

/** A transcript segment as read for the export: the word count stands in for
 * the `words` array, which is never loaded. */
type SegmentRow = Omit<TranscriptSegmentDb, 'words'> & {
  _id: Types.ObjectId
  wordCount?: number
}

/** Transcript segments (transcript-segments.csv). The word list is the bulk of
 * a segment, so only its length is computed in the database: blank when a
 * segment has no list, 0 for an empty one (EVAL-2). */
const segmentsCsv = async (window: ReportWindow): Promise<string> => {
  const segments = await TranscriptSegmentModel.find(
    windowFilter('createdAt', window),
  )
    .select({
      deckId: 1,
      sessionId: 1,
      slideId: 1,
      startMs: 1,
      endMs: 1,
      text: 1,
      confidence: 1,
      action: 1,
      speaker: 1,
      role: 1,
      createdAt: 1,
      deletedAt: 1,
      wordCount: {
        $cond: [{ $isArray: '$words' }, { $size: '$words' }, '$$REMOVE'],
      },
    })
    .sort({ createdAt: 1 })
    .lean<SegmentRow[]>()
    .setOptions(seen)
  return csvFile(
    [
      'segmentId',
      'deckId',
      'sessionId',
      'slideId',
      'startMs',
      'endMs',
      'text',
      'confidence',
      'wordCount',
      'action',
      'speaker',
      'role',
      'createdAt',
      'deletedAt',
    ],
    segments.map(s => [
      s._id.toString(),
      s.deckId.toString(),
      s.sessionId,
      s.slideId?.toString(),
      s.startMs,
      s.endMs,
      s.text,
      s.confidence,
      s.wordCount,
      s.action ?? 'none',
      s.speaker,
      s.role,
      iso(s.createdAt),
      iso(s.deletedAt),
    ]),
  )
}

/** Votes (votes.csv). */
const votesCsv = async (
  window: ReportWindow,
  sid: StudyIds,
): Promise<string> => {
  const votes = await VoteModel.find(windowFilter('createdAt', window))
    .select('_id userId targetType targetId value createdAt')
    .sort({ createdAt: 1 })
    .lean()
  await sid.load(votes.map(v => v.userId))
  return csvFile(
    ['voterStudyId', 'targetType', 'targetId', 'value', 'createdAt'],
    votes.map(v => [
      sid(v.userId),
      v.targetType,
      v.targetId.toString(),
      v.value,
      iso(
        (v as unknown as { createdAt?: Date }).createdAt ??
          v._id.getTimestamp(),
      ),
    ]),
  )
}

/** The cost ledger (cost-events.csv). */
const costEventsCsv = async (
  window: ReportWindow,
  sid: StudyIds,
): Promise<string> => {
  const costEvents = await CostEventModel.find(
    windowFilter('occurredAt', window),
  )
    .select(
      'occurredAt payerId actorId actorKind channel projectId projectName deckId deckName slideId locale trigger metric quantity billable costMicros currency',
    )
    .sort({ occurredAt: 1 })
    .lean()
  await sid.load([
    ...costEvents.map(e => e.payerId),
    ...costEvents.flatMap(e => (e.actorId ? [e.actorId] : [])),
  ])
  return csvFile(
    [
      'occurredAt',
      'payerStudyId',
      'actorStudyId',
      'actorKind',
      'channel',
      'projectId',
      'projectName',
      'deckId',
      'deckName',
      'slideId',
      'locale',
      'trigger',
      'metric',
      'quantity',
      'billable',
      'cost',
      'currency',
    ],
    costEvents.map(e => [
      iso(e.occurredAt),
      sid(e.payerId),
      sid(e.actorId),
      e.actorKind,
      // Plain rows carry no schema defaults, and the README promises a row
      // from before the field existed reads as 'app' (BILL-7).
      e.channel ?? 'app',
      e.projectId?.toString(),
      e.projectName,
      e.deckId?.toString(),
      e.deckName,
      e.slideId?.toString(),
      e.locale,
      e.trigger,
      e.metric,
      e.quantity,
      e.billable ?? true,
      ((e.costMicros ?? 0) / MICROS_PER_UNIT).toFixed(6),
      e.currency,
    ]),
  )
}

/** The `slidesParts` cell: the keys that are set, in schema order. A run
 * with a request but no parts reads `{}`, as the hydrated document did. */
const partsJson = (parts?: SlideRefineParts): string => {
  const set: SlideRefineParts = {}
  if (parts?.text !== undefined) set.text = parts.text
  if (parts?.layout !== undefined) set.layout = parts.layout
  if (parts?.imagery !== undefined) set.imagery = parts.imagery
  return JSON.stringify(set)
}

/** Refinement runs (refine-jobs.csv). */
const refineJobsCsv = async (window: ReportWindow): Promise<string> => {
  const refineJobs = await RefineJobModel.find(
    windowFilter('createdAt', window),
  )
    .select(
      '_id deckId status request summary error createdAt updatedAt deletedAt',
    )
    .sort({ createdAt: 1 })
    .lean()
    .setOptions(seen)
  return csvFile(
    [
      'jobId',
      'deckId',
      'status',
      'identifySpeakers',
      'slidesLevel',
      'slidesParts',
      'transcriptLevel',
      'allowSplit',
      'reframed',
      'slidesRefined',
      'slidesSplit',
      'transcriptsUpdated',
      'error',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    refineJobs.map(j => [
      j._id.toString(),
      j.deckId.toString(),
      j.status ?? 'running',
      j.request?.identifySpeakers,
      j.request?.slidesLevel,
      j.request ? partsJson(j.request.slidesParts) : undefined,
      j.request?.transcriptLevel,
      j.request?.allowSplit,
      j.summary?.reframed,
      j.summary?.slidesRefined,
      j.summary?.slidesSplit,
      j.summary?.transcriptsUpdated,
      j.error,
      iso(j.createdAt),
      iso(j.updatedAt ?? j.createdAt),
      iso(j.deletedAt),
    ]),
  )
}

/** Lecture openings (deck-views.csv). */
const deckViewsCsv = async (
  window: ReportWindow,
  sid: StudyIds,
): Promise<string> => {
  const deckViews = await DeckViewModel.find(windowFilter('occurredAt', window))
    .select(
      'occurredAt deckId deckName projectId projectName ownerId viewerId actorKind channel slidesReached activeMs',
    )
    .sort({ occurredAt: 1 })
    .lean()
  await sid.load([
    ...deckViews.map(v => v.ownerId),
    ...deckViews.flatMap(v => (v.viewerId ? [v.viewerId] : [])),
  ])
  return csvFile(
    [
      'occurredAt',
      'deckId',
      'deckName',
      'projectId',
      'projectName',
      'ownerStudyId',
      'viewerStudyId',
      'actorKind',
      'channel',
      'slidesReached',
      'activeMs',
    ],
    deckViews.map(v => [
      iso(v.occurredAt),
      v.deckId.toString(),
      v.deckName,
      v.projectId?.toString(),
      v.projectName,
      sid(v.ownerId),
      sid(v.viewerId),
      v.actorKind,
      v.channel ?? 'app',
      // Both a floor, never exact — see the README bullet: a reader who
      // closed the tab abruptly reports nothing further.
      v.slidesReached ?? undefined,
      v.activeMs ?? undefined,
    ]),
  )
}
