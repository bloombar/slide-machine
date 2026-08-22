/**
 * Unit tests for finding the files a lecture links to and labelling them.
 *
 * The link shapes here are the ones the real course sources use, so a
 * change that stops resolving any of them fails a test rather than quietly
 * importing a lecture with none of its material.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  isMaterialLink,
  collectMaterialLinks,
  candidatePaths,
  resolveMaterialPath,
  captionFor,
  mimeFor,
  materialsFor,
  MAX_MATERIAL_BYTES,
} from './materials.mjs'

/**
 * A throwaway course tree shaped like the real one: the lecture files sit in
 * `slides/`, their pictures in `slides/images/` and `slides/assets/<lecture>/`.
 */
let root
let dir
const deckName = 'what-is-software-engineering'

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-material-'))
  dir = path.join(root, 'software-engineering', 'slides')
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'assets', deckName), { recursive: true })
  fs.writeFileSync(path.join(dir, 'images', 'waterfall.png'), 'png-bytes')
  fs.writeFileSync(path.join(dir, 'images', 'crisis.pdf'), 'pdf-bytes')
  fs.writeFileSync(path.join(dir, 'images', 'notes.txt'), 'text')
  fs.writeFileSync(path.join(dir, 'assets', deckName, 'diagram.png'), 'png')
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('isMaterialLink', () => {
  it('accepts pictures and documents', () => {
    expect(isMaterialLink('../images/waterfall.png')).toBe(true)
    expect(isMaterialLink('/slides/images/crisis.pdf')).toBe(true)
    expect(isMaterialLink('handout.docx')).toBe(true)
  })

  /** Cross-lecture links have no extension and are navigation, not files. */
  it('rejects a link to another lecture, an anchor or an address', () => {
    expect(isMaterialLink('../version-control-systems')).toBe(false)
    expect(isMaterialLink('../uml-diagrams#use-cases')).toBe(false)
    expect(isMaterialLink('#definition')).toBe(false)
    expect(isMaterialLink('mailto:someone@example.edu')).toBe(false)
  })

  /** A web page is not material even though it ends in an extension. */
  it('rejects a web page', () => {
    expect(
      isMaterialLink('https://www.bls.gov/ooh/software-developers.htm'),
    ).toBe(false)
  })

  it('ignores a query string or anchor after the extension', () => {
    expect(isMaterialLink('../images/waterfall.png?v=2')).toBe(true)
    expect(isMaterialLink('../images/crisis.pdf#page=3')).toBe(true)
  })
})

describe('collectMaterialLinks', () => {
  const parsed = {
    slides: [
      {
        section: 'Process models',
        blocks: [
          { type: 'heading', depth: 1, text: 'Process models' },
          { type: 'image', alt: 'Waterfall', url: '../images/waterfall.png' },
          {
            type: 'paragraph',
            text: 'See [the crisis]({{ site.baseurl }}/slides/images/crisis.pdf) for more.',
          },
        ],
      },
      {
        section: 'Reading',
        blocks: [
          // A repeat of the same target is one material, not two.
          { type: 'image', alt: 'Again', url: '../images/waterfall.png' },
          {
            type: 'list',
            items: ['A [handout](../assets/x/diagram.png) here'],
          },
          { type: 'code', language: 'md', source: '![no](../images/nope.png)' },
        ],
      },
    ],
  }

  it('finds images and document links, keeping the slide heading', () => {
    const links = collectMaterialLinks(parsed)
    expect(links.map(l => l.url)).toEqual([
      '../images/waterfall.png',
      '{{ site.baseurl }}/slides/images/crisis.pdf',
      '../assets/x/diagram.png',
    ])
    expect(links[0]).toMatchObject({
      label: 'Waterfall',
      isImage: true,
      section: 'Process models',
    })
    expect(links[1]).toMatchObject({ label: 'the crisis', isImage: false })
  })

  /** Course sources put reading lists in tables; those links count too. */
  it('finds a link inside a table cell', () => {
    const links = collectMaterialLinks({
      slides: [
        {
          section: 'Reading',
          blocks: [
            {
              type: 'table',
              header: ['Topic', 'Handout'],
              rows: [['Waterfall', 'See [the paper](../images/crisis.pdf)']],
            },
          ],
        },
      ],
    })
    expect(links.map(l => l.url)).toEqual(['../images/crisis.pdf'])
    expect(links[0].label).toBe('the paper')
  })

  /** A listing is a sample for the class to read, not a link to follow. */
  it('never reads a link out of a code block', () => {
    const urls = collectMaterialLinks(parsed).map(l => l.url)
    expect(urls).not.toContain('../images/nope.png')
  })
})

describe('candidatePaths', () => {
  /**
   * The source is published at `/…/slides/<lecture>/`, so `../images/x.png`
   * climbs out of the page directory and means `slides/images/x.png` — the
   * reading that makes the source's "extra" `../` correct. It is tried first.
   */
  it('reads a relative path against the published page first', () => {
    const [first] = candidatePaths('../images/waterfall.png', { dir, deckName })
    expect(first).toBe(path.join(dir, 'images', 'waterfall.png'))
  })

  it('offers the path with its leading ../ removed as a fallback', () => {
    const candidates = candidatePaths('../images/waterfall.png', {
      dir,
      deckName,
    })
    expect(candidates).toContain(path.join(dir, 'images', 'waterfall.png'))
    expect(candidates).toContain(
      path.resolve(dir, '..', 'images', 'waterfall.png'),
    )
  })

  it('has nothing to offer for a remote URL', () => {
    expect(
      candidatePaths('https://example.com/a.pdf', { dir, deckName }),
    ).toEqual([])
  })
})

describe('resolveMaterialPath', () => {
  it('resolves the extra ../ that the real sources carry', () => {
    expect(
      resolveMaterialPath('../images/waterfall.png', { dir, deckName }),
    ).toBe(path.join(dir, 'images', 'waterfall.png'))
  })

  it('resolves a Jekyll {{ site.baseurl }} path', () => {
    expect(
      resolveMaterialPath('{{ site.baseurl }}/slides/images/crisis.pdf', {
        dir,
        deckName,
      }),
    ).toBe(path.join(dir, 'images', 'crisis.pdf'))
  })

  it('resolves a site-absolute path by its tail', () => {
    expect(
      resolveMaterialPath(
        '/content/courses/software-engineering/slides/images/waterfall.png',
        { dir, deckName },
      ),
    ).toBe(path.join(dir, 'images', 'waterfall.png'))
  })

  it('resolves a lecture’s own assets directory', () => {
    expect(
      resolveMaterialPath(`../assets/${deckName}/diagram.png`, {
        dir,
        deckName,
      }),
    ).toBe(path.join(dir, 'assets', deckName, 'diagram.png'))
  })

  it('returns null when nothing on disk matches', () => {
    expect(resolveMaterialPath('../images/absent.png', { dir, deckName })).toBe(
      null,
    )
  })
})

describe('mimeFor', () => {
  it('maps the formats the upload route accepts', () => {
    expect(mimeFor('a.png')).toBe('image/png')
    expect(mimeFor('a.JPG')).toBe('image/jpeg')
    expect(mimeFor('a.pdf')).toBe('application/pdf')
  })

  it('refuses anything the route would reject', () => {
    expect(mimeFor('a.txt')).toBe(null)
    expect(mimeFor('a.drawio')).toBe(null)
    expect(mimeFor('a.gif')).toBe(null)
  })
})

describe('captionFor', () => {
  /**
   * The caption is the only thing generation matches an uploaded picture on,
   * so it has to carry the alt text, the slide's topic and the lecture.
   */
  it('builds a label from the alt text, section, lecture and filename', () => {
    expect(
      captionFor({
        label: 'Waterfall',
        section: 'Process models',
        lectureTitle: 'What is Software Engineering',
        filePath: '/x/software_lifecycles_waterfall.png',
      }),
    ).toBe(
      'Waterfall — Process models — What is Software Engineering — software lifecycles waterfall',
    )
  })

  it('drops a part that repeats words already present', () => {
    expect(
      captionFor({
        label: 'Waterfall diagram',
        section: 'Waterfall',
        lectureTitle: 'Process models',
        filePath: '/x/waterfall.png',
      }),
    ).toBe('Waterfall diagram — Process models')
  })

  it('copes with a missing label or section', () => {
    expect(
      captionFor({
        label: '',
        section: '',
        lectureTitle: 'Lecture',
        filePath: '/x/a_b.png',
      }),
    ).toBe('Lecture — a b')
  })

  it('stays inside the caption limit the action enforces', () => {
    const caption = captionFor({
      label: 'x'.repeat(400),
      section: 'y'.repeat(400),
      lectureTitle: 'z'.repeat(400),
      filePath: '/x/a.png',
    })
    expect(caption.length).toBeLessThanOrEqual(500)
  })
})

describe('materialsFor', () => {
  const parsed = {
    slides: [
      {
        section: 'Process models',
        blocks: [
          { type: 'image', alt: 'Waterfall', url: '../images/waterfall.png' },
          {
            type: 'paragraph',
            text: 'A [handout](../images/notes.txt) and a [remote one](https://x.test/a.pdf) and a [gone](../images/absent.png).',
          },
        ],
      },
    ],
  }

  it('returns the uploadable files with their captions', () => {
    const { uploads } = materialsFor(parsed, {
      dir,
      deckName,
      lectureTitle: 'What is Software Engineering',
    })
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({
      name: 'waterfall.png',
      mime: 'image/png',
      filePath: path.join(dir, 'images', 'waterfall.png'),
    })
    expect(uploads[0].caption).toContain('Waterfall')
    expect(uploads[0].caption).toContain('Process models')
  })

  /** An instructor should be told what was left behind, and why. */
  it('reports what it could not take, with a reason for each', () => {
    const { skipped } = materialsFor(parsed, {
      dir,
      deckName,
      lectureTitle: 'What is Software Engineering',
    })
    expect(skipped.map(s => s.reason).sort()).toEqual([
      'missing',
      'remote',
      'unsupported',
    ])
  })

  /** The URL the slide's picture box was given, so it can be repointed. */
  it('records the URL the lecture resolver gave the same link', () => {
    const { uploads } = materialsFor(parsed, {
      dir,
      deckName,
      lectureTitle: 'L',
      resolve: url => `https://site.test/${url.replace(/^\.\.\//, '')}`,
    })
    expect(uploads[0].resolvedUrl).toBe(
      'https://site.test/images/waterfall.png',
    )
  })

  it('uploads a file linked from several slides only once', () => {
    const twice = {
      slides: [
        {
          section: 'A',
          blocks: [
            { type: 'image', alt: 'One', url: '../images/waterfall.png' },
          ],
        },
        {
          section: 'B',
          blocks: [
            {
              type: 'image',
              alt: 'Two',
              // A different spelling of the same file on disk.
              url: '/content/courses/software-engineering/slides/images/waterfall.png',
            },
          ],
        },
      ],
    }
    const { uploads } = materialsFor(twice, {
      dir,
      deckName,
      lectureTitle: 'L',
    })
    expect(uploads).toHaveLength(1)
  })

  it('skips a file over the upload limit', () => {
    const big = path.join(dir, 'images', 'big.png')
    fs.writeFileSync(big, Buffer.alloc(MAX_MATERIAL_BYTES + 1))
    try {
      const { uploads, skipped } = materialsFor(
        {
          slides: [
            {
              section: 'A',
              blocks: [{ type: 'image', alt: 'Big', url: '../images/big.png' }],
            },
          ],
        },
        { dir, deckName, lectureTitle: 'L' },
      )
      expect(uploads).toHaveLength(0)
      expect(skipped[0].reason).toBe('too-large')
    } finally {
      fs.rmSync(big)
    }
  })
})
