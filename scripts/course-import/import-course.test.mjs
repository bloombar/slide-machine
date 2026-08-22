/**
 * Unit tests for the importer's command line and file selection.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseArgs,
  titleFromSlug,
  deriveCoursePath,
  listLectures,
  outlineOf,
  convertLecture,
  uploadMaterials,
  repointPictures,
} from './import-course.mjs'

describe('parseArgs', () => {
  it('reads both --flag value and --flag=value', () => {
    expect(parseArgs(['--dir', '/a', '--limit=3'])).toEqual({
      dir: '/a',
      limit: '3',
    })
  })

  it('camel-cases a hyphenated flag', () => {
    expect(parseArgs(['--base-url', 'http://x']).baseUrl).toBe('http://x')
    expect(parseArgs(['--study-label=pilot']).studyLabel).toBe('pilot')
  })

  it('treats a valueless flag as true', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true)
    expect(parseArgs(['--dry-run', '--dir', '/a'])).toEqual({
      dryRun: true,
      dir: '/a',
    })
  })

  it('keeps an empty value rather than reading it as a switch', () => {
    expect(parseArgs(['--continuation=']).continuation).toBe('')
  })

  it('recognises help in both spellings', () => {
    expect(parseArgs(['-h']).help).toBe(true)
    expect(parseArgs(['--help']).help).toBe(true)
  })
})

describe('titleFromSlug', () => {
  it('turns a directory name into a readable title', () => {
    expect(titleFromSlug('software-engineering')).toBe('Software Engineering')
    expect(titleFromSlug('intro_to_computer-science')).toBe(
      'Intro To Computer Science',
    )
  })
})

describe('deriveCoursePath', () => {
  /**
   * The sources are published at the same path they sit at below
   * `content/`, so that part of the path on disk is the course's path on
   * the site — which is what relative image paths resolve against.
   */
  it('reads the published course path out of the path on disk', () => {
    expect(
      deriveCoursePath(
        '/home/me/kk/content/courses/software-engineering/slides',
      ),
    ).toBe('content/courses/software-engineering')
  })

  it('falls back to the parent directory when there is no content root', () => {
    expect(deriveCoursePath('/somewhere/my-course/slides')).toBe('my-course')
  })
})

describe('file selection', () => {
  let dir
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'course-import-'))
    for (const name of ['beta.md', 'alpha.md', 'gamma.md', 'notes.txt']) {
      fs.writeFileSync(
        path.join(dir, name),
        `---\ntitle: ${name}\ndescription: "About ${name}."\n---\n\n# H\n\nProse.\n`,
      )
    }
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('lists only markdown, alphabetically', () => {
    expect(listLectures(dir)).toEqual(['alpha.md', 'beta.md', 'gamma.md'])
  })

  it('honours --only, with or without the extension', () => {
    expect(listLectures(dir, { only: 'gamma,alpha.md' })).toEqual([
      'alpha.md',
      'gamma.md',
    ])
  })

  it('honours --order, leaving unlisted files after the listed ones', () => {
    expect(listLectures(dir, { order: 'gamma,beta' })).toEqual([
      'gamma.md',
      'beta.md',
      'alpha.md',
    ])
  })

  it('summarises a lecture from its frontmatter alone', () => {
    expect(outlineOf(dir, 'alpha.md')).toBe('alpha.md — About alpha.md.')
  })

  it('converts a lecture to titled slides', () => {
    const deck = convertLecture('alpha.md', dir, {
      siteBase: 'https://site',
      coursePath: 'c',
    })
    expect(deck.title).toBe('alpha.md')
    expect(deck.deckName).toBe('alpha')
    expect(deck.slides.length).toBeGreaterThan(0)
  })

  it('names a lecture after its file when frontmatter gives no title', () => {
    fs.writeFileSync(path.join(dir, 'no-title.md'), '# H\n\nProse.\n')
    const deck = convertLecture('no-title.md', dir, {
      siteBase: 'https://site',
      coursePath: 'c',
    })
    expect(deck.title).toBe('No Title')
  })
})

describe('uploadMaterials', () => {
  /** A lecture directory holding one picture to send. */
  let root
  let file

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-materials-'))
    file = path.join(root, 'waterfall.png')
    fs.writeFileSync(file, 'png-bytes')
  })

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  // Built per test: `file` only exists once beforeAll has run.
  const oneUpload = () => [
    {
      filePath: file,
      name: 'waterfall.png',
      mime: 'image/png',
      size: 9,
      caption: 'Waterfall — Process models',
    },
  ]

  /** A client whose asset list reports every uploaded asset as extracted. */
  const stubClient = ({ existing = [], uploadImpl } = {}) => {
    const acts = []
    const uploaded = []
    return {
      acts,
      uploaded,
      act: vi.fn(async (name, input) => {
        acts.push([name, input])
        if (name === 'seedAsset.list') {
          return [
            ...existing,
            ...uploaded.map(a => ({ ...a, status: 'ready' })),
          ]
        }
        return {}
      }),
      upload: vi.fn(async args => {
        if (uploadImpl) return uploadImpl(args)
        const asset = { id: `sa-${uploaded.length + 1}`, name: args.filename }
        uploaded.push(asset)
        return asset
      }),
    }
  }

  it('uploads each file against the lecture and its project', async () => {
    const client = stubClient()
    const result = await uploadMaterials(client, {
      projectId: 'p-1',
      deckId: 'd-1',
      uploads: oneUpload(),
    })
    expect(result).toMatchObject({
      uploaded: 1,
      skipped: 0,
      failed: 0,
      bytes: 9,
    })
    expect(client.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'waterfall.png',
        mime: 'image/png',
        fields: { projectId: 'p-1', deckId: 'd-1' },
      }),
    )
  })

  /**
   * The caption is what generation matches the picture on, and extraction
   * saves the asset itself — so it is set after the upload, not before.
   */
  it('labels each upload with its caption', async () => {
    const client = stubClient()
    await uploadMaterials(client, {
      projectId: 'p-1',
      deckId: 'd-1',
      uploads: oneUpload(),
    })
    expect(client.acts).toContainEqual([
      'seedAsset.update',
      { assetId: 'sa-1', caption: 'Waterfall — Process models' },
    ])
  })

  /** Re-running an interrupted import must not attach the file twice. */
  it('leaves material already attached to the lecture alone', async () => {
    const client = stubClient({
      existing: [{ id: 'old', name: 'waterfall.png', status: 'ready' }],
    })
    const result = await uploadMaterials(client, {
      projectId: 'p-1',
      deckId: 'd-1',
      uploads: oneUpload(),
    })
    expect(result).toMatchObject({ uploaded: 0, skipped: 1 })
    expect(client.upload).not.toHaveBeenCalled()
  })

  /** One rejected file must not cost the lecture the rest of its material. */
  it('counts a failed upload and carries on', async () => {
    const client = stubClient({
      uploadImpl: async () => {
        throw new Error('unsupported_type')
      },
    })
    const logged = []
    const result = await uploadMaterials(client, {
      projectId: 'p-1',
      deckId: 'd-1',
      uploads: oneUpload(),
      log: m => logged.push(m),
    })
    expect(result).toMatchObject({ uploaded: 0, failed: 1 })
    expect(logged.join()).toContain('unsupported_type')
  })

  it('does nothing, and asks nothing of the API, with no material', async () => {
    const client = stubClient()
    const result = await uploadMaterials(client, {
      projectId: 'p-1',
      deckId: 'd-1',
      uploads: [],
    })
    expect(result).toMatchObject({
      uploaded: 0,
      skipped: 0,
      failed: 0,
      bytes: 0,
    })
    expect(client.act).not.toHaveBeenCalled()
  })

  /** Waiting for extraction must not hang an import when it never finishes. */
  it('captions anyway when extraction does not finish in time', async () => {
    const client = {
      act: vi.fn(async name =>
        name === 'seedAsset.list' ? [{ id: 'sa-1', status: 'processing' }] : {},
      ),
      upload: vi.fn(async () => ({ id: 'sa-1', name: 'waterfall.png' })),
    }
    const result = await uploadMaterials(client, {
      projectId: 'p-1',
      deckId: 'd-1',
      uploads: oneUpload(),
      timeoutMs: 0,
    })
    expect(result.uploaded).toBe(1)
    expect(client.act).toHaveBeenCalledWith('seedAsset.update', {
      assetId: 'sa-1',
      caption: 'Waterfall — Process models',
    })
  })
})

describe('parseArgs --replace', () => {
  it('reads the flag', () => {
    expect(parseArgs(['--replace']).replace).toBe(true)
  })

  /** Absent by default: a re-run resumes around existing lectures. */
  it('is absent when not passed', () => {
    expect(parseArgs(['--dir', '/a']).replace).toBeUndefined()
  })
})

describe('repointPictures', () => {
  /**
   * A slide's picture box is given a URL on the published course site, but
   * the site is built from its own revision of the notes — a picture the
   * local source names may not be served there. A box holding a dead URL
   * shows nothing and, counting as filled, is never sourced an image either.
   */
  const boxes = [
    { slideId: 's-1', name: 'image', ref: 'https://site.test/images/a.png' },
    { slideId: 's-2', name: 'image', ref: 'https://site.test/images/b.png' },
  ]

  const stubClient = ({ failOn } = {}) => {
    const acts = []
    return {
      acts,
      act: vi.fn(async (name, input) => {
        if (failOn && input.slideId === failOn) throw new Error('nope')
        acts.push([name, input])
        return {}
      }),
    }
  }

  it('points a box at the uploaded copy of its picture', async () => {
    const client = stubClient()
    const moved = await repointPictures(
      client,
      boxes,
      new Map([
        ['https://site.test/images/a.png', 'http://app.test/seed/a.png'],
      ]),
    )
    expect(moved).toBe(1)
    expect(client.acts).toEqual([
      [
        'slide.editContent',
        {
          slideId: 's-1',
          slots: {
            image: {
              kind: 'image',
              ref: 'http://app.test/seed/a.png',
              source: 'seeded',
            },
          },
        },
      ],
    ])
  })

  it('leaves a box whose picture was not uploaded alone', async () => {
    const client = stubClient()
    expect(await repointPictures(client, boxes, new Map())).toBe(0)
    expect(client.act).not.toHaveBeenCalled()
  })

  it('does nothing when nothing was uploaded', async () => {
    const client = stubClient()
    expect(await repointPictures(client, boxes, undefined)).toBe(0)
    expect(client.act).not.toHaveBeenCalled()
  })

  /** A slide that will not take the new URL keeps the one it has. */
  it('carries on past a slide that refuses the edit', async () => {
    const client = stubClient({ failOn: 's-1' })
    const moved = await repointPictures(
      client,
      boxes,
      new Map([
        ['https://site.test/images/a.png', 'http://app.test/seed/a.png'],
        ['https://site.test/images/b.png', 'http://app.test/seed/b.png'],
      ]),
    )
    expect(moved).toBe(1)
    expect(client.acts[0][1].slideId).toBe('s-2')
  })
})
