/**
 * Integration tests for seed material (SEED-1/SEED-2): multipart
 * upload with level-scoped authorization, background extraction of
 * PDF text, DOCX text + embedded photos, and direct image uploads;
 * asset management actions; local-file serving; and the seed layers
 * plus seeded images reaching the generation provider.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'
import request from 'supertest'
import AdmZip from 'adm-zip'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { registry } from '../../src/providers/registry'
import type {
  GenerationProvider,
  SlideGenerationRequest,
} from '@slide-machine/shared'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { SeedAssetModel } from '../../src/models/seed-asset'
import { RefreshTokenModel } from '../../src/models/refresh-token'

// One long-lived server per file: supertest's default per-request
// ephemeral servers intermittently lost requests to localhost port
// churn on macOS (bare 404s with no Express headers)
const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) {
    throw new Error(
      `registration failed: ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

const uploadFile = (
  token: string,
  fields: Record<string, string>,
  file: { name: string; type: string; body: Buffer },
) => {
  let req = request(server)
    .post('/api/seed-assets')
    .set('Authorization', `Bearer ${token}`)
  for (const [key, value] of Object.entries(fields)) {
    req = req.field(key, value)
  }
  return req.attach('file', file.body, {
    filename: file.name,
    contentType: file.type,
  })
}

/** Extraction is fire-and-forget; poll the asset until it settles. */
const settled = async (assetId: string) =>
  vi.waitFor(
    async () => {
      const asset = await SeedAssetModel.findById(assetId)
      if (!asset || asset.status === 'processing') {
        throw new Error('still processing')
      }
      return asset
    },
    { timeout: 10_000, interval: 100 },
  )

/** A minimal single-page PDF with real xref offsets — enough for pdfjs. */
const buildTinyPdf = (text: string): Buffer => {
  const header = '%PDF-1.4\n'
  const stream = `BT /F1 24 Tf 72 712 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = ''
  const offsets: number[] = []
  objects.forEach((content, i) => {
    offsets.push(header.length + body.length)
    body += `${i + 1} 0 obj\n${content}\nendobj\n`
  })
  const xrefStart = header.length + body.length
  const pad = (n: number) => String(n).padStart(10, '0')
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map(o => `${pad(o)} 00000 n \n`).join('')
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(header + body + xref + trailer, 'latin1')
}

/** A minimal DOCX (zip) with body text and one embedded "photo". */
const buildTinyDocx = (text: string, withImage: boolean): Buffer => {
  const zip = new AdmZip()
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
  )
  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
  )
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    ),
  )
  if (withImage) {
    // Content is never parsed, only stored; size must clear the
    // embedded-image floor (10 KiB)
    zip.addFile('word/media/cell-membrane.png', Buffer.alloc(12_000, 7))
  }
  return zip.toBuffer()
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let ada: string
let byron: string
let projectId: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(async () => {
  await disconnectMongo()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    SeedAssetModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  byron = await registerUser('byron@example.com')
  const project = await act(ada, 'project.create', { title: 'Biology' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'Cells',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
})

describe('upload authorization and validation', () => {
  it('rejects strangers at both levels and editors at project level', async () => {
    const png = { name: 'cell.png', type: 'image/png', body: PNG }
    expect((await uploadFile(byron, { projectId }, png)).status).toBe(403)
    expect((await uploadFile(byron, { projectId, deckId }, png)).status).toBe(
      403,
    )

    await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'editor',
    })
    // Editors may add lecture-level material but not project-level
    expect((await uploadFile(byron, { projectId, deckId }, png)).status).toBe(
      201,
    )
    expect((await uploadFile(byron, { projectId }, png)).status).toBe(403)
  })

  it('rejects unsupported file types', async () => {
    const res = await uploadFile(
      ada,
      { projectId },
      {
        name: 'notes.txt',
        type: 'text/plain',
        body: Buffer.from('hello'),
      },
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('unsupported_type')
  })
})

describe('extraction pipeline', () => {
  it('image uploads become ready photo assets served from storage', async () => {
    const res = await uploadFile(
      ada,
      { projectId },
      {
        name: 'golgi-apparatus.png',
        type: 'image/png',
        body: PNG,
      },
    )
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('processing')

    const asset = await settled(res.body.id)
    expect(asset.status).toBe('ready')
    expect(asset.keywords).toEqual(
      expect.arrayContaining(['golgi', 'apparatus']),
    )
    expect(asset.imageUrl).toMatch(/^\/api\/files\//)

    const file = await request(server).get(asset.imageUrl!)
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('image/png')
    expect(file.body.equals(PNG)).toBe(true)
  })

  it('extracts text from PDFs', async () => {
    const res = await uploadFile(
      ada,
      { projectId },
      {
        name: 'syllabus.pdf',
        type: 'application/pdf',
        body: buildTinyPdf(
          'Photosynthesis converts light into chemical energy',
        ),
      },
    )
    expect(res.status).toBe(201)
    const asset = await settled(res.body.id)
    expect(asset.status).toBe('ready')
    expect(asset.text).toContain('Photosynthesis converts light')
  })

  it('extracts DOCX text and spins embedded photos into image assets', async () => {
    const res = await uploadFile(
      ada,
      { projectId },
      {
        name: 'lecture-notes.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: buildTinyDocx(
          'Mitochondria are the powerhouse of the cell',
          true,
        ),
      },
    )
    expect(res.status).toBe(201)
    const asset = await settled(res.body.id)
    expect(asset.status).toBe('ready')
    expect(asset.text).toContain('Mitochondria are the powerhouse')

    const children = await vi.waitFor(
      async () => {
        const list = await SeedAssetModel.find({ projectId, type: 'image' })
        if (list.length === 0) throw new Error('no extracted images yet')
        return list
      },
      { timeout: 10_000, interval: 100 },
    )
    expect(children[0]!.status).toBe('ready')
    expect(children[0]!.name).toContain('cell-membrane.png')
    expect(children[0]!.imageUrl).toMatch(/^\/api\/files\//)
  })

  it('marks unparseable files failed without surfacing errors', async () => {
    const res = await uploadFile(
      ada,
      { projectId },
      {
        name: 'broken.pdf',
        type: 'application/pdf',
        body: Buffer.from('this is not a pdf at all'),
      },
    )
    expect(res.status).toBe(201)
    const asset = await settled(res.body.id)
    expect(asset.status).toBe('failed')
  })
})

describe('asset management actions', () => {
  it('lists per level, updates captions into keywords, and deletes', async () => {
    const projectLevel = await uploadFile(
      ada,
      { projectId },
      {
        name: 'a.png',
        type: 'image/png',
        body: PNG,
      },
    )
    const deckLevel = await uploadFile(
      ada,
      { projectId, deckId },
      {
        name: 'b.png',
        type: 'image/png',
        body: PNG,
      },
    )
    await settled(projectLevel.body.id)
    await settled(deckLevel.body.id)

    const projectList = await act(ada, 'seedAsset.list', { projectId })
    expect(projectList.body.map((a: { name: string }) => a.name)).toEqual([
      'a.png',
    ])
    const deckList = await act(ada, 'seedAsset.list', { deckId })
    expect(deckList.body.map((a: { name: string }) => a.name)).toEqual([
      'b.png',
    ])

    const updated = await act(ada, 'seedAsset.update', {
      assetId: projectLevel.body.id,
      caption: 'Golgi apparatus under a microscope',
      enabled: false,
    })
    expect(updated.body.enabled).toBe(false)
    expect(updated.body.keywords).toEqual(
      expect.arrayContaining(['golgi', 'apparatus', 'microscope']),
    )

    const url = (await SeedAssetModel.findById(projectLevel.body.id))!.imageUrl!
    expect(
      (await act(ada, 'seedAsset.delete', { assetId: projectLevel.body.id }))
        .status,
    ).toBe(200)
    expect(await SeedAssetModel.findById(projectLevel.body.id)).toBeNull()
    // Soft delete (P-10) keeps the stored file for restore; the retention purge
    // removes it later.
    expect((await request(server).get(url)).status).toBe(200)
  })

  it('keeps management scoped: strangers get 403', async () => {
    const res = await uploadFile(
      ada,
      { projectId },
      {
        name: 'a.png',
        type: 'image/png',
        body: PNG,
      },
    )
    await settled(res.body.id)
    expect((await act(byron, 'seedAsset.list', { projectId })).status).toBe(403)
    expect(
      (
        await act(byron, 'seedAsset.update', {
          assetId: res.body.id,
          enabled: false,
        })
      ).status,
    ).toBe(403)
    expect(
      (await act(byron, 'seedAsset.delete', { assetId: res.body.id })).status,
    ).toBe(403)
  })
})

describe('project.delete cascade', () => {
  it('removes decks, slides, and seed material at both levels', async () => {
    await act(ada, 'slide.add', { deckId })
    const projectAsset = await uploadFile(
      ada,
      { projectId },
      { name: 'p.png', type: 'image/png', body: PNG },
    )
    const deckAsset = await uploadFile(
      ada,
      { projectId, deckId },
      { name: 'd.png', type: 'image/png', body: PNG },
    )
    await settled(projectAsset.body.id)
    await settled(deckAsset.body.id)
    const fileUrl = (await SeedAssetModel.findById(projectAsset.body.id))!
      .imageUrl!

    const res = await act(ada, 'project.delete', { projectId })
    expect(res.status).toBe(200)

    expect(await DeckModel.countDocuments({ projectId })).toBe(0)
    expect(await SlideModel.countDocuments({ deckId })).toBe(0)
    expect(await SeedAssetModel.countDocuments({ projectId })).toBe(0)
    // Soft delete (P-10) hides the records but keeps their files for restore;
    // the retention purge removes them later.
    expect((await request(server).get(fileUrl)).status).toBe(200)
  })
})

describe('generation integration', () => {
  it('joins asset text into seed layers and lists seeded images', async () => {
    const pdf = await uploadFile(
      ada,
      { projectId },
      {
        name: 'syllabus.pdf',
        type: 'application/pdf',
        body: buildTinyPdf('PROJECT-DOC-TEXT about cell biology'),
      },
    )
    const photo = await uploadFile(
      ada,
      { projectId, deckId },
      {
        name: 'cell-wall.png',
        type: 'image/png',
        body: PNG,
      },
    )
    await settled(pdf.body.id)
    await settled(photo.body.id)
    await act(ada, 'project.update', { projectId, seedContext: 'NOTES' })

    const provider = registry.get<GenerationProvider>('generation')
    const original = provider.generateSlideContent.bind(provider)
    const seen: SlideGenerationRequest[] = []
    provider.generateSlideContent = async request => {
      seen.push(request)
      return original(request)
    }
    try {
      await act(ada, 'session.phrase', {
        deckId,
        phrase: 'The cell wall protects plant cells',
      })
      expect(seen).toHaveLength(1)
      expect(seen[0]!.seedContext?.project).toContain('NOTES')
      expect(seen[0]!.seedContext?.project).toContain('PROJECT-DOC-TEXT')
      expect(seen[0]!.seededImages).toEqual([
        expect.objectContaining({
          id: photo.body.id,
          keywords: expect.arrayContaining(['cell', 'wall']),
        }),
      ])
    } finally {
      provider.generateSlideContent = original
    }
  })

  it('disabled assets stay out of the seed layers', async () => {
    const pdf = await uploadFile(
      ada,
      { projectId },
      {
        name: 'old-syllabus.pdf',
        type: 'application/pdf',
        body: buildTinyPdf('OUTDATED-TEXT from last year'),
      },
    )
    await settled(pdf.body.id)
    await act(ada, 'seedAsset.update', {
      assetId: pdf.body.id,
      enabled: false,
    })

    const provider = registry.get<GenerationProvider>('generation')
    const original = provider.generateSlideContent.bind(provider)
    const seen: SlideGenerationRequest[] = []
    provider.generateSlideContent = async request => {
      seen.push(request)
      return original(request)
    }
    try {
      await act(ada, 'session.phrase', {
        deckId,
        phrase: 'Cell walls are made of cellulose fibers',
      })
      expect(seen[0]!.seedContext?.project ?? '').not.toContain('OUTDATED-TEXT')
    } finally {
      provider.generateSlideContent = original
    }
  })
})
