/**
 * Integration tests for the deck export actions (EXP-1/EXP-2/EXP-4) against a
 * real MongoDB, with the Google side mock-backed (EXPORT_MODE=mock). Exercises
 * status, direct PDF/YAML downloads, saving to Drive (fabricated URLs), Google
 * Slides, connection gating, and ownership enforcement — no network.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest'
import request from 'supertest'
import YAML from 'yaml'

// Hermetic: a developer's local EXPORT_MODE=live in .env must not leak in — this
// suite exercises mock mode (fabricated Drive URLs). (QUIZ_PUBLISH_MODE is
// already pinned to mock by the vitest config, so quiz.connectGoogle connects.)
vi.mock('../../src/config/env', async importActual => {
  const actual = await importActual<typeof import('../../src/config/env')>()
  return { ...actual, env: { ...actual.env, EXPORT_MODE: 'mock' } }
})

import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { TemplateModel } from '../../src/models/template'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { UsageRecordModel } from '../../src/models/usage-record'
import { capFor, recordUsage, usedThisPeriod } from '../../src/billing/usage'
import { buildExportDeck } from '../../src/actions/export'
import { deckToPptx } from '../../src/lib/deck-pptx'
import AdmZip from 'adm-zip'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

let ada: string
let bob: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})
afterAll(async () => disconnectMongo())

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  bob = await registerUser('bob@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Photosynthesis',
    templateId: 'classic',
  })
  deckId = deck.body.id
  const deckDoc = await DeckModel.findOne({ title: 'Photosynthesis' })
  await SlideModel.create({
    deckId: deckDoc!._id,
    index: 0,
    layoutType: 'list',
    title: 'Where it happens',
    bullets: ['In chloroplasts'],
    imageRef: 'https://img/leaf.jpg',
    attribution: { creator: 'Ada', license: 'CC BY 4.0' },
    sourceTranscript: 'Photosynthesis happens inside the chloroplasts.',
  })
})

describe('export actions (mock mode)', () => {
  it('reports the deck title, connection, whiteboard, and no saved exports', async () => {
    const res = await act(ada, 'export.status', { deckId })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      googleConnected: false,
      deckTitle: 'Photosynthesis',
      hasWhiteboard: false,
      // Off unless the deployment turns it on (EXPORT_REUSABLE_LAYOUTS).
      layoutsOffered: false,
      exports: [],
    })
  })

  /**
   * EXP-1's second export shape, behind a deployment flag
   * (`EXPORT_REUSABLE_LAYOUTS`). Off here, as it is by default.
   */
  it('ignores a request for reusable layouts where they are switched off', async () => {
    // The field is accepted and disregarded rather than refused: a stale tab
    // asking for a shape this deployment does not offer should still get its
    // export, as the flat file it would have got anyway.
    const res = await act(ada, 'export.download', {
      deckId,
      format: 'pptx',
      withLayouts: true,
    })
    expect(res.status).toBe(200)
    const bytes = Buffer.from(res.body.contentBase64, 'base64')
    const layouts = new AdmZip(bytes)
      .getEntries()
      .filter(e => /ppt\/slideLayouts\/.*\.xml$/.test(e.entryName))
    // Only the package's own default layout: the template's are not written.
    expect(layouts).toHaveLength(1)
  })

  it('downloads a YAML export capturing the deck content', async () => {
    const res = await act(ada, 'export.download', { deckId, format: 'yaml' })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('photosynthesis.yaml')
    expect(res.body.mimeType).toBe('application/x-yaml')
    const yaml = Buffer.from(res.body.contentBase64, 'base64').toString('utf8')
    const parsed = YAML.parse(yaml)
    expect(parsed.kind).toBe('deck')
    expect(parsed.title).toBe('Photosynthesis')
    expect(parsed.slides[0].image.attribution.creator).toBe('Ada')
  })

  it('downloads a real PDF export', async () => {
    const res = await act(ada, 'export.download', { deckId, format: 'pdf' })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('photosynthesis.pdf')
    expect(res.body.mimeType).toBe('application/pdf')
    const pdf = Buffer.from(res.body.contentBase64, 'base64')
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('rejects an unknown download format', async () => {
    const res = await act(ada, 'export.download', {
      deckId,
      format: 'google-slides',
    })
    expect(res.status).toBe(400)
  })

  it('blocks saving to Drive until Google is connected', async () => {
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'pdf',
      driveFolderId: 'root',
    })
    expect(res.status).toBe(403)
  })

  it('connects, then saves a PDF to Drive, recording it on the deck', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'pdf',
      driveFolderId: 'folder-1',
      driveFolderName: 'Lectures',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      fileName: 'photosynthesis.pdf',
      format: 'pdf',
      driveFolderName: 'Lectures',
    })
    // The mock file id carries a random suffix so repeat exports never collide.
    expect(res.body.fileId).toMatch(/^mock-photosynthesis-pdf-[0-9a-f]+$/)
    expect(res.body.fileUrl).toBe(
      `https://drive.google.com/file/d/${res.body.fileId}/view`,
    )
    expect(typeof res.body.exportedAt).toBe('string')
    const fileId = res.body.fileId

    // It is now listed in the deck's status, and can be deleted.
    const status = await act(ada, 'export.status', { deckId })
    expect(status.body.exports).toHaveLength(1)
    expect(status.body.exports[0].fileId).toBe(fileId)

    const del = await act(ada, 'export.delete', { deckId, fileId })
    // Ada saved it, so it is trashed outright — nothing lingers elsewhere.
    expect(del.body).toEqual({ deleted: true, remainsInOtherDrive: false })
    const after = await act(ada, 'export.status', { deckId })
    expect(after.body.exports).toEqual([])
  })

  it('two exports of the same deck get distinct ids (no collision)', async () => {
    await act(ada, 'quiz.connectGoogle')
    const first = await act(ada, 'export.toDrive', {
      deckId,
      format: 'pdf',
      driveFolderId: 'root',
    })
    const second = await act(ada, 'export.toDrive', {
      deckId,
      format: 'pdf',
      driveFolderId: 'root',
    })
    expect(first.body.fileId).not.toBe(second.body.fileId)
    const status = await act(ada, 'export.status', { deckId })
    expect(status.body.exports).toHaveLength(2)
  })

  it('exports to Google Slides (always Drive) with a presentation URL', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'google-slides',
      driveFolderId: 'root',
    })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('Photosynthesis')
    expect(res.body.fileUrl).toMatch(
      /^https:\/\/docs\.google\.com\/presentation\/d\/mock-photosynthesis-google-slides-[0-9a-f]+\/edit$/,
    )
  })

  it('saves an untitled deck to Google Slides with a non-empty file name', async () => {
    // An empty deck title must not produce an empty file name (Mongoose's
    // `required` rejects '' — this once broke saving untitled lectures).
    await DeckModel.updateOne({ title: 'Photosynthesis' }, { title: '' })
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'export.toDrive', {
      deckId,
      format: 'google-slides',
      driveFolderId: 'root',
    })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('Untitled lecture')
    const status = await act(ada, 'export.status', { deckId })
    expect(status.body.exports).toHaveLength(1)
  })

  it('reports hasWhiteboard when a slide carries freehand marks', async () => {
    const deckDoc = await DeckModel.findOne({ title: 'Photosynthesis' })
    await SlideModel.updateOne(
      { deckId: deckDoc!._id, index: 0 },
      {
        $set: {
          drawings: [
            {
              id: 's1',
              tool: 'pen',
              color: '#000000',
              thickness: 0.005,
              points: [
                { x: 0.1, y: 0.2 },
                { x: 0.4, y: 0.5 },
              ],
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              anchor: { charAnchor: 0, source: 'unsynced' },
            },
          ],
        },
      },
    )
    const res = await act(ada, 'export.status', { deckId })
    expect(res.body.hasWhiteboard).toBe(true)
  })

  it('reports hasWhiteboard false when every mark is erased/orphaned', async () => {
    // The stored list is non-empty, but the only stroke is orphaned, so the
    // renderer would draw nothing — the status must agree (via visibleStrokes).
    const deckDoc = await DeckModel.findOne({ title: 'Photosynthesis' })
    await SlideModel.updateOne(
      { deckId: deckDoc!._id, index: 0 },
      {
        $set: {
          drawings: [
            {
              id: 'gone',
              tool: 'pen',
              color: '#000000',
              thickness: 0.005,
              points: [
                { x: 0.1, y: 0.2 },
                { x: 0.4, y: 0.5 },
              ],
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              anchor: { charAnchor: 0, source: 'unsynced', orphaned: true },
            },
          ],
        },
      },
    )
    const res = await act(ada, 'export.status', { deckId })
    expect(res.body.hasWhiteboard).toBe(false)
  })

  it('deleting an export saved by another user reports it stays in their Drive', async () => {
    const bobUser = await UserModel.findOne({ email: 'bob@example.com' })
    const deckDoc = await DeckModel.findOne({ title: 'Photosynthesis' })
    deckDoc!.exports = [
      {
        fileId: 'mock-other-pdf-deadbeef',
        fileUrl: 'https://drive.google.com/file/d/mock-other-pdf-deadbeef/view',
        fileName: 'photosynthesis.pdf',
        format: 'pdf',
        driveFolderId: 'root',
        exportedAt: new Date(),
        savedBy: bobUser!._id,
      },
    ]
    await deckDoc!.save()

    const del = await act(ada, 'export.delete', {
      deckId,
      fileId: 'mock-other-pdf-deadbeef',
    })
    // Removed from the lecture, but flagged as still living in Bob's Drive.
    expect(del.body).toEqual({ deleted: true, remainsInOtherDrive: true })
    const after = await act(ada, 'export.status', { deckId })
    expect(after.body.exports).toEqual([])
  })

  it('does not let a non-editor export someone else’s deck', async () => {
    expect((await act(bob, 'export.status', { deckId })).status).toBe(403)
    expect(
      (await act(bob, 'export.download', { deckId, format: 'yaml' })).status,
    ).toBe(403)
  })
})

/** Export metering (BILL-3): one unit per file produced, wherever it lands. */
describe('export metering', () => {
  const adaId = async () =>
    (await UserModel.findOne({ email: 'ada@example.com' }))!._id.toString()

  it('counts one export per download', async () => {
    await act(ada, 'export.download', { deckId, format: 'yaml' })
    await act(ada, 'export.download', { deckId, format: 'pdf' })

    expect(await usedThisPeriod(await adaId(), 'exports')).toBe(2)
  })

  it('counts a Drive export the same as a download', async () => {
    await act(ada, 'quiz.connectGoogle', { code: 'mock-code' })
    await act(ada, 'export.toDrive', {
      deckId,
      format: 'google-slides',
      driveFolderId: 'folder-1',
    })

    expect(await usedThisPeriod(await adaId(), 'exports')).toBe(1)
  })

  it('counts nothing for reading the export status or deleting a file', async () => {
    await act(ada, 'export.status', { deckId })
    await act(ada, 'export.delete', { deckId, fileId: 'nope' })

    expect(await usedThisPeriod(await adaId(), 'exports')).toBe(0)
  })

  it('402s once the allowance is spent', async () => {
    const id = await adaId()
    await recordUsage(id, 'exports', capFor('free', 'exports')!)

    const res = await act(ada, 'export.download', { deckId, format: 'yaml' })

    expect(res.status).toBe(402)
    expect(res.body.error.details).toEqual(['exports'])
  })

  it('does not charge for an export that failed to render', async () => {
    // Metered after the bytes exist, so a failed render leaves the allowance
    // where it was — the user got no file.
    const id = await adaId()
    const res = await act(ada, 'export.download', {
      deckId: 'not-a-real-deck',
      format: 'yaml',
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await usedThisPeriod(id, 'exports')).toBe(0)
  })
})

describe('what a deck carries into Google Slides (EXP-8)', () => {
  it('puts what the instructor said into the speaker notes', async () => {
    // The whole way from the stored transcript (EDIT-6) to the field a
    // presenter opens the deck expecting to find it in
    const deckDoc = await DeckModel.findById(deckId)
    const deckForExport = await buildExportDeck(deckDoc!, false)
    const bytes = await deckToPptx(deckForExport)
    const notes = new AdmZip(Buffer.from(bytes)).readAsText(
      'ppt/notesSlides/notesSlide1.xml',
    )
    expect(notes).toContain('Photosynthesis happens inside the chloroplasts.')
  })

  it('leaves the transcript out of the YAML', async () => {
    // The YAML is the content someone shares; what was said over a slide is
    // the instructor's own speech and does not belong in a file they hand out
    const res = await act(ada, 'export.download', { deckId, format: 'yaml' })
    const yaml = Buffer.from(res.body.contentBase64, 'base64').toString('utf8')
    expect(yaml).not.toContain('Photosynthesis happens inside')
  })
})

describe('specialized content on the way out (EXP-7)', () => {
  /**
   * A lecture whose design declares a formula box, with the given formulas on
   * its slide. Built per test, since every test here starts from a wiped
   * database.
   *
   * The design is a stored template rather than a built-in because no
   * built-in declares a maths box — an author who wants one makes their own.
   */
  const lectureWithFormulas = async (...texs: string[]): Promise<string> => {
    const owner = await UserModel.findOne({ email: 'ada@example.com' })
    const template = await TemplateModel.create({
      ownerId: owner!._id,
      name: 'Physics',
      permalinkSlug: `physics-${Date.now()}`,
      theme: { background: '#ffffff', text: '#111111', accent: '#0055ff' },
      layouts: [
        {
          type: 'content',
          label: 'Content',
          purpose: 'a worked example',
          slots: texs.map((_, i) => ({
            name: `eq${i}`,
            kind: 'math',
            label: `Equation ${i + 1}`,
          })),
          elementPositions: Object.fromEntries(
            texs.map((_, i) => [
              `eq${i}`,
              { x: 0.06, y: 0.1 + i * 0.35, w: 0.88, h: 0.3 },
            ]),
          ),
        },
        {
          type: 'whiteboard',
          label: 'Whiteboard',
          purpose: 'a blank slate',
          slots: [],
          elementPositions: {},
        },
      ],
      visibility: 'private',
    })
    const project = await act(ada, 'project.create', { title: 'Physics' })
    const created = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Motion',
      templateId: String(template._id),
    })
    const doc = await DeckModel.findById(created.body.id)
    // A lecture takes its project's design on creation and pins the version
    // it was built against (TMPL-11). Pointed at this one instead, unpinned,
    // so the export resolves the design that declares the formula box.
    await DeckModel.updateOne(
      { _id: doc!._id },
      {
        $set: { templateId: String(template._id) },
        $unset: { templateVersionId: '' },
      },
    )
    await SlideModel.create({
      deckId: doc!._id,
      index: 0,
      layoutType: 'content',
      slots: Object.fromEntries(
        texs.map((tex, i) => [`eq${i}`, { kind: 'math', tex }]),
      ),
    })
    return created.body.id as string
  }

  it('reports what the file could not carry', async () => {
    // One that typesets and one that cannot, so both halves of the
    // requirement are exercised in one export
    const lecture = await lectureWithFormulas('v = gt', '\\frac{1}{')
    const res = await act(ada, 'export.download', {
      deckId: lecture,
      format: 'pdf',
    })

    expect(res.status).toBe(200)
    // The file is produced either way — one broken formula does not cost an
    // instructor their lecture
    expect(
      Buffer.from(res.body.contentBase64, 'base64').subarray(0, 5).toString(),
    ).toBe('%PDF-')
    // ...and the user is told, rather than finding a hole in a slide later
    expect(res.body.notes).toEqual([
      { reason: 'math-not-typeset', detail: '\\frac{1}{' },
    ])
  })

  it('says nothing when everything went in', async () => {
    const lecture = await lectureWithFormulas('v = gt')
    const res = await act(ada, 'export.download', {
      deckId: lecture,
      format: 'pdf',
    })

    expect(res.status).toBe(200)
    // A report that appears when there is nothing to report trains people to
    // ignore it
    expect(res.body.notes).toBeUndefined()
  })
})
