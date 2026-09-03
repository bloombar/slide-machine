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
 * Assembled in memory: at the deployment scale this instrument serves (one
 * pilot course, a semester per bundle) the datasets are far below anything a
 * buffer minds, and a zip cannot be streamed entry-by-entry anyway without
 * giving up its central directory.
 */
import AdmZip from 'adm-zip'
import { Types } from 'mongoose'
import { csvRow } from '../audit/csv'
import { MICROS_PER_UNIT } from '../billing/pricing'
import { CostEventModel } from '../models/cost-event'
import { DeckModel } from '../models/deck'
import { SessionTelemetryEventModel } from '../models/session-telemetry-event'
import { SlideModel } from '../models/slide'
import { TranscriptSegmentModel } from '../models/transcript-segment'
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
  actor keyed by study id. A blank actor is an anonymous viewer; a blank
  study id is an account purged since the event. The locale column is the
  language the lecture was read or heard in; it is blank for work that has
  no language, which is not the same as English. Count distinct
  actorStudyId per (deckId, locale) for how many students used a language,
  and count rows for how many times — never sum quantity, which is 0 on a
  cache hit. Treat a language as a quasi-identifier when you do: a lecture
  with one reader in a language singles that pseudonym out, and every other
  row it appears in with it. Suppress small cells before publishing.

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
  const [created, segmentDecks, telemetryDecks, voteDecks, costDecks] =
    await Promise.all([
      DeckModel.find(windowFilter('createdAt', window))
        .select('_id')
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
    ])
  const deckIds = [
    ...new Set(
      [
        ...created.map(d => d._id),
        ...segmentDecks,
        ...telemetryDecks,
        ...voteDecks,
        ...costDecks,
      ]
        .filter((id): id is Types.ObjectId => id != null)
        .map(id => id.toString()),
    ),
  ].map(id => new Types.ObjectId(id))

  const [decks, slides, segments, sessions, votes, costEvents] =
    await Promise.all([
      DeckModel.find({ _id: { $in: deckIds } }).setOptions(seen),
      SlideModel.find({ deckId: { $in: deckIds } })
        .sort({ deckId: 1, index: 1 })
        .setOptions(seen),
      TranscriptSegmentModel.find(windowFilter('createdAt', window))
        .sort({ createdAt: 1 })
        .setOptions(seen),
      sessionSummaries({}, window),
      VoteModel.find(windowFilter('createdAt', window)).sort({ createdAt: 1 }),
      CostEventModel.find(windowFilter('occurredAt', window)).sort({
        occurredAt: 1,
      }),
    ])

  // Every account any row references, pseudonymized in one pass.
  const studyIds = await ensureStudyIds([
    ...decks.map(d => d.ownerId),
    ...votes.map(v => v.userId),
    ...costEvents.map(e => e.payerId),
    ...costEvents.flatMap(e => (e.actorId ? [e.actorId] : [])),
  ])
  /** The pseudonym for a user reference; blank when there is no identity
   * (anonymous actor) or none left (account purged) — blank, not withheld. */
  const sid = (id?: Types.ObjectId | null): string | undefined =>
    id ? studyIds.get(id.toString()) : undefined

  const zip = new AdmZip()
  const add = (name: string, content: string): void => {
    zip.addFile(name, Buffer.from(content, 'utf-8'))
  }

  add('README.md', readme(window))

  add(
    'lectures.csv',
    csvFile(
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
        d.slideOrder.length,
        d.voteScore,
        d.quiz?.formId,
        iso(d.quiz?.publishedAt),
        iso(d.createdAt),
        iso(d.updatedAt ?? d.createdAt),
        iso(d.deletedAt),
      ]),
    ),
  )

  add(
    'slides.csv',
    csvFile(
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
    ),
  )

  add(
    'transcript-segments.csv',
    csvFile(
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
        s.words?.length,
        s.action,
        s.speaker,
        s.role,
        iso(s.createdAt),
        iso(s.deletedAt),
      ]),
    ),
  )

  add(
    'session-telemetry.csv',
    csvFile([...SESSION_CSV_COLUMNS], sessions.map(sessionCsvValues)),
  )

  add(
    'votes.csv',
    csvFile(
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
    ),
  )

  add(
    'cost-events.csv',
    csvFile(
      [
        'occurredAt',
        'payerStudyId',
        'actorStudyId',
        'actorKind',
        'projectId',
        'projectName',
        'deckId',
        'deckName',
        'locale',
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
        e.projectId?.toString(),
        e.projectName,
        e.deckId?.toString(),
        e.deckName,
        e.locale,
        e.metric,
        e.quantity,
        e.billable,
        (e.costMicros / MICROS_PER_UNIT).toFixed(6),
        e.currency,
      ]),
    ),
  )

  return zip.toBuffer()
}
