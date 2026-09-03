/**
 * A slide's picture is stored twice: in the slot map (`slots.image.ref`,
 * the store) and in the derived legacy field (`imageRef`, kept for readers
 * that predate the map). `slide.save()` folds one into the other on every
 * save (models/slide.ts's pre-save hook) — but when the document being
 * saved was loaded BEFORE an out-of-band write (an enrichment result, most
 * often) landed a picture, the fold has nothing but its own stale copy of
 * the map to work from, and republishing that copy takes the picture back
 * out of the slot without touching `imageRef` (docs/DECISIONS.md, "The
 * image poll checks promptly, then backs off"). Needs a real Mongo
 * connection: the defect only shows up against a genuinely stale, already-
 * hydrated Mongoose document, not a plain object.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest'
import { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { SlideModel } from '../../src/models/slide'
import { enrichSlideImage } from '../../src/enrichment/enrich'

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
})

afterAll(async () => {
  await disconnectMongo()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  await SlideModel.deleteMany({})
})

/** Any deck id; nothing here reads through to a real deck document. */
const aDeckId = () => new Types.ObjectId()

describe('a stale slide save and the picture slot', () => {
  it('never leaves slots.image.ref and imageRef disagreeing after a save built from a stale load', async () => {
    const created = await SlideModel.create({
      deckId: aDeckId(),
      index: 0,
      layoutType: 'image-heavy',
      title: 'Mitochondria',
    })

    // The document an editor is holding, read BEFORE the picture lands —
    // exactly what a request that loaded the slide at the top of the
    // handler, then did other work before saving, would be holding.
    const stale = await SlideModel.findById(created._id)
    expect(stale).not.toBeNull()

    // Enrichment lands the picture out-of-band, atomically, exactly the way
    // enrichSlideImage/maybeEnrich write it: both representations together
    // in one update, bypassing the stale in-memory document entirely.
    await SlideModel.updateOne(
      { _id: created._id },
      {
        $set: {
          'slots.image': {
            kind: 'image',
            ref: 'http://img/mitochondria.png',
            source: 'stock',
          },
          imageRef: 'http://img/mitochondria.png',
          imageSource: 'stock',
        },
      },
    )

    // The editor's unrelated text edit lands on the stale document.
    stale!.title = 'The Mitochondria'
    await stale!.save()

    const after = await SlideModel.findById(created._id).lean()
    const slotRef = (after!.slots as Record<string, { ref?: string }>)?.image
      ?.ref

    // The two representations must agree: either both carry the picture or
    // neither does. Losing the slot while imageRef survives is the
    // deadlock — enrichment's empty-slot guard requires imageRef empty
    // before it will fill the slot, and the client stops polling the
    // moment it sees imageRef set, so a slide in that state never recovers
    // on its own.
    expect(Boolean(slotRef)).toBe(Boolean(after!.imageRef))
    // The safe direction: the already-found picture stays reachable rather
    // than being thrown away.
    expect(after!.imageRef).toBe('http://img/mitochondria.png')
    expect(slotRef).toBe('http://img/mitochondria.png')
    // The unrelated edit this save actually asked for still landed.
    expect(after!.title).toBe('The Mitochondria')
  })

  it('leaves the slot empty on both sides when the stale save is the one that never saw a picture', async () => {
    // No out-of-band write in this one: the ordinary case where the slide
    // genuinely has no picture yet must still save as "no picture" on both
    // sides, not half of one.
    const created = await SlideModel.create({
      deckId: aDeckId(),
      index: 0,
      layoutType: 'image-heavy',
      title: 'Mitochondria',
    })
    const doc = await SlideModel.findById(created._id)
    doc!.title = 'The Mitochondria'
    await doc!.save()

    const after = await SlideModel.findById(created._id).lean()
    expect(after!.imageRef).toBeFalsy()
    expect(
      (after!.slots as Record<string, { ref?: string }> | undefined)?.image,
    ).toBeUndefined()
  })
})

describe('healing a slide already left in the contradictory state', () => {
  it('is still fillable by enrichment', async () => {
    // Constructed directly against the collection (bypassing slide.save()
    // and its fold entirely), the way the pre-fix bug used to leave a row:
    // a real slot map that simply never got an image entry, alongside a
    // leftover imageRef from before the map existed. This must not read as
    // "already has a picture" forever.
    const created = await SlideModel.create({
      deckId: aDeckId(),
      index: 0,
      layoutType: 'image-heavy',
      title: 'Mitochondria',
    })
    await SlideModel.updateOne(
      { _id: created._id },
      { $set: { imageRef: 'http://stale/orphaned.png' } },
    )
    const before = await SlideModel.findById(created._id).lean()
    expect(before!.imageRef).toBe('http://stale/orphaned.png')
    expect(
      (before!.slots as Record<string, unknown> | undefined)?.image,
    ).toBeUndefined()

    // No live source may answer; the seeded candidate below is what wins.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network disabled in tests')
      }),
    )

    await enrichSlideImage(
      created._id.toString(),
      ['mitochondria'],
      [
        {
          url: 'http://img/mitochondria.png',
          title: 'Mitochondria diagram',
          tags: ['mitochondria'],
          source: 'wikimedia',
          width: 1024,
        },
      ],
    )

    const after = await SlideModel.findById(created._id).lean()
    const slotRef = (after!.slots as Record<string, { ref?: string }>)?.image
      ?.ref
    expect(slotRef).toBe('http://img/mitochondria.png')
    expect(after!.imageRef).toBe('http://img/mitochondria.png')
  })
})
