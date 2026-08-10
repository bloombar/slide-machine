/**
 * Soft delete (P-10/P-11): the tombstone plugin hides deleted records from every
 * read while keeping them recoverable; cascades tombstone children; restore
 * brings a subtree back; the retention purge permanently removes expired
 * tombstones. Exercised against a real MongoDB via the cascade + purge helpers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { SeedAssetModel } from '../../src/models/seed-asset'
import { VoteModel } from '../../src/models/vote'
import { TemplateVersionModel } from '../../src/models/template-version'
import {
  deleteProjectCascade,
  deleteDeckCascade,
  restoreProjectCascade,
} from '../../src/lib/cascade'
import { purgeExpiredSoftDeletes } from '../../src/jobs/soft-delete-purge'
import { UsageRecordModel } from '../../src/models/usage-record'
import { adjustGauge, usedThisPeriod } from '../../src/billing/usage'

const DAY_MS = 24 * 60 * 60 * 1000

let ownerId: string

/** A project with one deck that has one slide and one deck-level seed asset. */
const makeProject = async () => {
  const project = await ProjectModel.create({ ownerId, title: 'Bio' })
  const deck = await DeckModel.create({
    ownerId,
    projectId: project._id,
    title: 'Photosynthesis',
    templateId: 'classic',
    permalinkSlug: `p-${project._id}`,
  })
  const slide = await SlideModel.create({
    deckId: deck._id,
    index: 0,
    layoutType: 'title',
    title: 'Intro',
  })
  const asset = await SeedAssetModel.create({
    projectId: project._id,
    deckId: deck._id,
    type: 'pdf',
    name: 'notes.pdf',
    status: 'ready',
  })
  const vote = await VoteModel.create({
    userId: ownerId,
    targetType: 'deck',
    targetId: deck._id,
    value: 1,
  })
  return { project, deck, slide, asset, vote }
}

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
})
afterAll(async () => disconnectMongo())

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    SeedAssetModel.deleteMany({}),
    VoteModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
    TemplateVersionModel.deleteMany({}),
  ])
  const owner = await UserModel.create({
    email: 'ada@x.com',
    displayName: 'Ada',
  })
  ownerId = owner._id.toString()
})

describe('soft delete (P-10)', () => {
  it('excludes tombstoned records from reads, but keeps them for withDeleted', async () => {
    const { project } = await makeProject()
    await deleteProjectCascade(project._id)

    // Hidden from every normal read…
    expect(await ProjectModel.findById(project._id)).toBeNull()
    expect(await DeckModel.find({ projectId: project._id })).toHaveLength(0)
    expect(await SlideModel.countDocuments({})).toBe(0)
    expect(await SeedAssetModel.countDocuments({})).toBe(0)

    // …but still there, tombstoned, via the escape hatch.
    const tomb = await ProjectModel.findById(project._id).setOptions({
      withDeleted: true,
    })
    expect(tomb?.deletedAt).toBeInstanceOf(Date)
    const decks = await DeckModel.find({ projectId: project._id }).setOptions({
      withDeleted: true,
    })
    expect(decks).toHaveLength(1)
    expect(decks[0]!.deletedAt).toBeInstanceOf(Date)
  })

  it('deleteMany still hard-deletes tombstoned records (purge/tests)', async () => {
    const { project } = await makeProject()
    await deleteProjectCascade(project._id)
    // The exclusion middleware does not touch deletes, so a raw deleteMany
    // reaches the tombstoned rows (this is what test cleanup relies on).
    await ProjectModel.deleteMany({})
    expect(
      await ProjectModel.countDocuments({}).setOptions({ withDeleted: true }),
    ).toBe(0)
  })

  it('restores a project and the children tombstoned with it', async () => {
    const { project, deck, slide } = await makeProject()
    // A slide deleted on its own BEFORE the project delete must stay deleted.
    const extra = await SlideModel.create({
      deckId: deck._id,
      index: 1,
      layoutType: 'content',
      title: 'Deleted earlier',
    })
    await new Promise(r => setTimeout(r, 5))
    extra.deletedAt = new Date(Date.now() - DAY_MS)
    await extra.save()

    await deleteProjectCascade(project._id)
    await restoreProjectCascade(project._id)

    expect(await ProjectModel.findById(project._id)).not.toBeNull()
    expect(await DeckModel.findById(deck._id)).not.toBeNull()
    expect(await SlideModel.findById(slide._id)).not.toBeNull()
    // The independently-deleted slide is NOT resurrected.
    expect(await SlideModel.findById(extra._id)).toBeNull()
  })

  it('purges tombstones past the retention window, keeping fresh ones', async () => {
    const { project, deck } = await makeProject()
    await deleteProjectCascade(project._id)

    // Not yet expired (deleted just now, 90-day window): nothing purged.
    expect(await purgeExpiredSoftDeletes(90, Date.now())).toBe(0)
    expect(
      await ProjectModel.countDocuments({}).setOptions({ withDeleted: true }),
    ).toBe(1)

    // Far enough in the future that the window has passed: purged for real.
    const purged = await purgeExpiredSoftDeletes(90, Date.now() + 100 * DAY_MS)
    expect(purged).toBeGreaterThan(0)
    expect(
      await ProjectModel.countDocuments({}).setOptions({ withDeleted: true }),
    ).toBe(0)
    expect(
      await DeckModel.countDocuments({ _id: deck._id }).setOptions({
        withDeleted: true,
      }),
    ).toBe(0)
    expect(
      await SlideModel.countDocuments({}).setOptions({ withDeleted: true }),
    ).toBe(0)
    // The purged deck's votes (SOC-1) are hard-deleted with it.
    expect(await VoteModel.countDocuments({})).toBe(0)
  })

  it('tombstones a single deck and its slides without touching siblings', async () => {
    const { project, deck } = await makeProject()
    const sibling = await DeckModel.create({
      ownerId,
      projectId: project._id,
      title: 'Sibling',
      templateId: 'classic',
      permalinkSlug: `s-${project._id}`,
    })
    await deleteDeckCascade(deck)

    expect(await DeckModel.findById(deck._id)).toBeNull()
    expect(await SlideModel.countDocuments({ deckId: deck._id })).toBe(0)
    // The sibling deck and the project itself are untouched.
    expect(await DeckModel.findById(sibling._id)).not.toBeNull()
    expect(await ProjectModel.findById(project._id)).not.toBeNull()
  })
})

/**
 * Purging a lecture gives its owner their storage back (BILL-3). The gauge is a
 * stock, so every path that deletes retained audio has to credit it — otherwise
 * it only ever climbs and a user who deleted everything stays "full".
 */
describe('storage gauge on purge', () => {
  /** Attaches one minute of 16 kHz LINEAR16 mono to a deck. */
  const withRecording = async (deckId: unknown, sessionId = 'r1') =>
    DeckModel.updateOne(
      { _id: deckId as string },
      {
        $push: {
          recordings: {
            sessionId,
            audioKey: `audio/${String(deckId)}/${sessionId}.pcm`,
            sampleRate: 16_000,
            durationMs: 60_000,
            createdAt: new Date(),
          },
        },
      },
    ).setOptions({ withDeleted: true })

  /** One minute at 16 kHz, 16-bit mono, in MB. */
  const ONE_MINUTE_MB = (60 * 16_000 * 2) / (1024 * 1024)

  it('credits the owner when a purged lecture had retained audio', async () => {
    const { project, deck } = await makeProject()
    await withRecording(deck._id)
    await adjustGauge(ownerId, 'audioStorageMb', 10)

    await deleteProjectCascade(project._id)
    await purgeExpiredSoftDeletes(90, Date.now() + 100 * DAY_MS)

    expect(await usedThisPeriod(ownerId, 'audioStorageMb')).toBeCloseTo(
      10 - ONE_MINUTE_MB,
      6,
    )
  })

  it('sums several recordings into one credit per owner', async () => {
    const { project, deck } = await makeProject()
    await withRecording(deck._id, 'r1')
    await withRecording(deck._id, 'r2')
    await adjustGauge(ownerId, 'audioStorageMb', 10)

    await deleteProjectCascade(project._id)
    await purgeExpiredSoftDeletes(90, Date.now() + 100 * DAY_MS)

    expect(await usedThisPeriod(ownerId, 'audioStorageMb')).toBeCloseTo(
      10 - 2 * ONE_MINUTE_MB,
      6,
    )
  })

  it('leaves the gauge alone for a lecture that retained nothing', async () => {
    const { project } = await makeProject()
    await adjustGauge(ownerId, 'audioStorageMb', 4)

    await deleteProjectCascade(project._id)
    await purgeExpiredSoftDeletes(90, Date.now() + 100 * DAY_MS)

    expect(await usedThisPeriod(ownerId, 'audioStorageMb')).toBe(4)
  })
})

/**
 * Template versions (TMPL-11) have no tombstone of their own — they sit outside
 * the cascade on purpose, so a lecture can outlive its template and its author.
 * That leaves the sweep as the only thing that ever collects them, once no
 * lecture pins them any more.
 */
describe('unpinned template versions (TMPL-11 / P-11)', () => {
  /** A stored version, optionally backdated past the retention cutoff. */
  const makeVersion = async (contentHash: string, createdAt?: Date) => {
    const version = await TemplateVersionModel.create({
      templateId: 'classic',
      source: 'builtin',
      contentHash,
      name: 'Classic',
      theme: {},
      layouts: [],
    })
    if (createdAt)
      await TemplateVersionModel.updateOne(
        { _id: version._id },
        { $set: { createdAt } },
      )
    return version
  }

  /** Pins a lecture to a version, reaching tombstoned ones too. */
  const pin = async (deckId: unknown, versionId: unknown) =>
    DeckModel.updateOne(
      { _id: deckId as string },
      { $set: { templateVersionId: String(versionId) } },
    ).setOptions({ withDeleted: true })

  const versionCount = async () => TemplateVersionModel.countDocuments({})

  it('collects a version in the same sweep that purges its last lecture', async () => {
    const { project, deck } = await makeProject()
    const version = await makeVersion('orphaned')
    await pin(deck._id, version._id)

    await deleteProjectCascade(project._id)
    await purgeExpiredSoftDeletes(90, Date.now() + 100 * DAY_MS)

    expect(await versionCount()).toBe(0)
  })

  it('keeps a version a live lecture is still drawn with', async () => {
    const { deck } = await makeProject()
    const version = await makeVersion('in-use')
    await pin(deck._id, version._id)

    await purgeExpiredSoftDeletes(90, Date.now() + 100 * DAY_MS)

    expect(await versionCount()).toBe(1)
  })

  it('keeps a version pinned by a tombstoned lecture still inside the window', async () => {
    // The lecture is recoverable until the window passes (P-10), and has to come
    // back drawn the way it was — so the structure it holds outlives the sweep.
    const { project, deck } = await makeProject()
    const version = await makeVersion(
      'recoverable',
      new Date(Date.now() - 200 * DAY_MS),
    )
    await pin(deck._id, version._id)
    await deleteProjectCascade(project._id)

    await purgeExpiredSoftDeletes(90, Date.now())

    expect(await versionCount()).toBe(1)
  })

  it('spares a version too young for the lecture that will pin it to exist yet', async () => {
    // A version is written before the lecture that pins it, so a sweep landing
    // between the two would otherwise take a version about to be used.
    await makeVersion('just-made')

    await purgeExpiredSoftDeletes(90, Date.now())

    expect(await versionCount()).toBe(1)
  })
})
