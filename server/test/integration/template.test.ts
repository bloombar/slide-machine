/**
 * Integration tests for the style-template actions (TMPL-1 library, TMPL-4
 * custom templates) against a real MongoDB. Covers the library a user sees,
 * duplicating as the way a template is created, editing and deleting one you
 * authored, the read-only built-ins, ownership, and the fact that a template
 * stored in the database is interchangeable with one shipped as a file
 * everywhere a template is resolved.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { TemplateModel } from '../../src/models/template'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import {
  layoutDescriptors,
  listBuiltinTemplates,
} from '../../src/templates/builtin'
import { deleteUserCascade } from '../../src/lib/cascade'

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

/** The first template the deployment ships; never named literally, so this
 * suite keeps passing if the starter set is replaced. */
const builtinId = (): string => listBuiltinTemplates()[0]!.id

let ada: string
let bob: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
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
    TemplateModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  bob = await registerUser('bob@example.com')
})

describe('template.list (TMPL-1)', () => {
  it('offers the built-in library to a signed-in user', async () => {
    const res = await act(ada, 'template.list')
    expect(res.status).toBe(200)
    const ids = res.body.map((t: { id: string }) => t.id)
    for (const builtin of listBuiltinTemplates()) {
      expect(ids).toContain(builtin.id)
    }
  })

  it('every template carries a whiteboard layout (TMPL-7)', async () => {
    const res = await act(ada, 'template.list')
    for (const template of res.body as { layouts: { type: string }[] }[]) {
      expect(template.layouts.some(l => l.type === 'whiteboard')).toBe(true)
    }
  })

  it("lists the caller's own templates ahead of the built-ins", async () => {
    await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada Style',
    })
    const res = await act(ada, 'template.list')
    expect(res.body[0].name).toBe('Ada Style')
    expect(res.body[0].ownerId).not.toBe('system')
  })

  it("does not show one user's templates to another", async () => {
    await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada Style',
    })
    const res = await act(bob, 'template.list')
    expect(res.body.map((t: { name: string }) => t.name)).not.toContain(
      'Ada Style',
    )
  })
})

describe('template.duplicate (TMPL-4)', () => {
  it('copies a built-in into the caller library, theme and layouts intact', async () => {
    const source = listBuiltinTemplates()[0]!
    const res = await act(ada, 'template.duplicate', {
      templateId: source.id,
      name: 'My Style',
    })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('My Style')
    expect(res.body.theme).toEqual(source.theme)
    expect(res.body.layouts).toHaveLength(source.layouts.length)
    // Its own template, private until shared
    expect(res.body.visibility).toBe('private')
  })

  it('numbers a copy from the one it came from', async () => {
    // The original is the first, so the copy is the second — never "X 1".
    const source = listBuiltinTemplates()[0]!
    const first = await act(ada, 'template.duplicate', {
      templateId: source.id,
    })
    expect(first.body.name).toBe(`${source.name} 2`)

    const second = await act(ada, 'template.duplicate', {
      templateId: source.id,
    })
    expect(second.body.name).toBe(`${source.name} 3`)
  })

  it('counts on from a copy rather than stacking suffixes', async () => {
    const source = listBuiltinTemplates()[0]!
    const copy = await act(ada, 'template.duplicate', { templateId: source.id })
    const again = await act(ada, 'template.duplicate', {
      templateId: copy.body.id,
    })
    expect(again.body.name).toBe(`${source.name} 3`)
  })

  it('can duplicate a template the caller already authored', async () => {
    const first = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'One',
    })
    const second = await act(ada, 'template.duplicate', {
      templateId: first.body.id,
      name: 'Two',
    })
    expect(second.status).toBe(200)
    expect(second.body.id).not.toBe(first.body.id)
  })

  it("refuses someone else's private template as a source", async () => {
    const ownd = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada Style',
    })
    expect(
      (await act(bob, 'template.duplicate', { templateId: ownd.body.id }))
        .status,
    ).toBe(403)
  })

  // Forbidden, not invalid input: this must answer the same way as the
  // private-template case above, or the two can be told apart by probing.
  it('rejects an unknown template', async () => {
    expect(
      (await act(ada, 'template.duplicate', { templateId: 'nope' })).status,
    ).toBe(403)
  })

  it('requires authentication', async () => {
    const res = await request(server)
      .post('/api/actions/template.duplicate')
      .send({ templateId: builtinId() })
    expect(res.status).toBe(401)
  })
})

describe('template.export access (EXP-2)', () => {
  const own = async (name = 'Ada Style') =>
    (await act(ada, 'template.duplicate', { templateId: builtinId(), name }))
      .body

  it('exports a built-in for anyone', async () => {
    const res = await act(bob, 'template.export', { templateId: builtinId() })
    expect(res.status).toBe(200)
  })

  it('exports the caller’s own design', async () => {
    const mine = await own()
    const res = await act(ada, 'template.export', { templateId: mine.id })
    expect(res.status).toBe(200)
  })

  // Exporting is a read: it must not be a way around the visibility rule
  // that template.get enforces on the same design.
  it("refuses someone else's private design", async () => {
    const adas = await own()
    const res = await act(bob, 'template.export', { templateId: adas.id })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('forbidden')
  })

  // Someone editing a shared lecture already sees its design on every
  // slide, so the export offered in that lecture's own settings has to
  // work — withholding the file would protect nothing.
  it('lets an editor of a lecture export the design it is drawn with', async () => {
    const adas = await own()
    const project = await act(ada, 'project.create', { title: 'Bio' })
    const deck = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Photosynthesis',
    })
    // deck.create takes the project's design; switching is what pins this one.
    await act(ada, 'deck.switchTemplate', {
      deckId: deck.body.id,
      templateId: adas.id,
    })
    await act(ada, 'deck.share', {
      deckId: deck.body.id,
      email: 'bob@example.com',
      role: 'editor',
    })

    expect(
      (await act(bob, 'template.export', { templateId: adas.id })).status,
    ).toBe(200)
  })

  it('still refuses a viewer of that lecture', async () => {
    const adas = await own()
    const project = await act(ada, 'project.create', { title: 'Bio' })
    const deck = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Photosynthesis',
    })
    // deck.create takes the project's design; switching is what pins this one.
    await act(ada, 'deck.switchTemplate', {
      deckId: deck.body.id,
      templateId: adas.id,
    })
    await act(ada, 'deck.share', {
      deckId: deck.body.id,
      email: 'bob@example.com',
      role: 'viewer',
    })

    expect(
      (await act(bob, 'template.export', { templateId: adas.id })).status,
    ).toBe(403)
  })

  it('answers an unknown id exactly as it answers a private one', async () => {
    const adas = await own()
    const foreign = await act(bob, 'template.export', { templateId: adas.id })
    const missing = await act(bob, 'template.export', {
      templateId: '507f1f77bcf86cd799439011',
    })
    expect(missing.status).toBe(foreign.status)
    expect(missing.body.error.code).toBe(foreign.body.error.code)
    expect(missing.body.error.message).toBe(foreign.body.error.message)
  })
})

describe('template.get and permalinks (TMPL-4)', () => {
  const own = async (name = 'Mine') =>
    (await act(ada, 'template.duplicate', { templateId: builtinId(), name }))
      .body

  it('gives a new template a readable permalink of its own', async () => {
    const made = await own('Lab Style')
    expect(made.permalinkSlug).toMatch(/^lab-style-[0-9a-f]{8}$/)
  })

  it('keeps the permalink when the design is renamed', async () => {
    const made = await own('Lab Style')
    const res = await act(ada, 'template.update', {
      templateId: made.id,
      name: 'Something Else',
      theme: made.theme,
      layouts: made.layouts,
    })
    expect(res.status).toBe(200)
    // A link to a design must survive its author renaming it
    expect(res.body.permalinkSlug).toBe(made.permalinkSlug)
  })

  /**
   * What a design asks the AI for, deck-wide (GEN-11) — the audience, the
   * register, the words to avoid. Stored on the template so every lecture
   * drawn with it is written the same way, and bounded because it is author
   * text flowing into a prompt that runs once per spoken phrase.
   */
  describe('the design’s instructions for the AI', () => {
    const update = (
      made: { id: string; theme: unknown; layouts: unknown },
      aiInstructions?: string,
    ) =>
      act(ada, 'template.update', {
        templateId: made.id,
        name: 'Lab Style',
        theme: made.theme,
        layouts: made.layouts,
        ...(aiInstructions === undefined ? {} : { aiInstructions }),
      })

    it('is saved and comes back', async () => {
      const made = await own('Lab Style')
      const res = await update(made, 'Write for nine-year-olds.')
      expect(res.status).toBe(200)
      expect(res.body.aiInstructions).toBe('Write for nine-year-olds.')

      const read = await act(ada, 'template.get', { slug: made.permalinkSlug })
      expect(read.body.aiInstructions).toBe('Write for nine-year-olds.')
    })

    it('is absent, not empty, when the box is cleared', async () => {
      // Stored blank it would become a labelled but empty line in every
      // prompt, on a call that runs once per phrase.
      const made = await own('Lab Style')
      await update(made, 'Something.')
      const res = await update(made, '   ')
      expect(res.status).toBe(200)
      expect(res.body.aiInstructions).toBeUndefined()
    })

    it('refuses one longer than the cap', async () => {
      const made = await own('Lab Style')
      const res = await update(made, 'x'.repeat(601))
      expect(res.status).toBe(400)
    })

    it('travels with a copy, which is a copy of the design', async () => {
      const made = await own('Lab Style')
      await update(made, 'Write for nine-year-olds.')
      const copy = await act(ada, 'template.duplicate', { templateId: made.id })
      expect(copy.status).toBe(200)
      expect(copy.body.aiInstructions).toBe('Write for nine-year-olds.')
    })
  })

  it('reads a template by its permalink, naming the author', async () => {
    const made = await own()
    const res = await act(ada, 'template.get', { slug: made.permalinkSlug })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(made.id)
    expect(res.body.owner).toEqual({
      id: expect.any(String),
      displayName: 'ada',
    })
  })

  it('reads a built-in by its id, which is its permalink', async () => {
    const res = await act(ada, 'template.get', { slug: builtinId() })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(builtinId())
  })

  it("refuses someone else's private design, and a missing one, alike", async () => {
    const made = await own()
    const mine = await act(bob, 'template.get', { slug: made.permalinkSlug })
    const missing = await act(bob, 'template.get', { slug: 'no-such-design' })
    expect(mine.status).toBe(403)
    expect(missing.status).toBe(403)
  })

  it('lets anyone read a design its author shared', async () => {
    const made = await own()
    await act(ada, 'template.update', {
      templateId: made.id,
      name: made.name,
      theme: made.theme,
      layouts: made.layouts,
      visibility: 'unlisted',
    })
    const res = await act(bob, 'template.get', { slug: made.permalinkSlug })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Mine')
  })
})

describe('template.update (TMPL-4)', () => {
  const own = async () =>
    (
      await act(ada, 'template.duplicate', {
        templateId: builtinId(),
        name: 'Mine',
      })
    ).body

  it('renames, rethemes and retunes a layout', async () => {
    const template = await own()
    const layouts = template.layouts.map(
      (l: { type: string; label: string }) =>
        l.type === 'content'
          ? { ...l, label: 'Main', purpose: 'Body text' }
          : l,
    )
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: 'Renamed',
      theme: { ...template.theme, accent: '#123456' },
      layouts,
    })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Renamed')
    expect(res.body.theme.accent).toBe('#123456')
    expect(
      res.body.layouts.find((l: { type: string }) => l.type === 'content')
        .label,
    ).toBe('Main')
  })

  it('carries a retuned text style’s limits into generation', async () => {
    // What the editor's "Default text styles" writes. The preview fills every
    // box to the same numbers (`slotLimits`), so a design judged at capacity
    // is judged at the capacity slides are actually generated to.
    const template = await own()
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: {
        ...template.theme,
        textStyles: { bullet: { maxChars: 40, maxItems: 2 } },
      },
      layouts: template.layouts,
    })
    expect(res.status).toBe(200)
    const list = layoutDescriptors(res.body).find(
      (d: { type: string }) => d.type === 'list',
    )!
    // The style outranks the layout's own maxBullets, which no editor shows.
    expect(list.constraints?.maxBullets).toBe(2)
    expect(list.slots.find(s => s.kind === 'bullets')?.maxChars).toBe(40)
  })

  it('refuses to save a template without a whiteboard layout (TMPL-7)', async () => {
    const template = await own()
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: template.layouts.filter(
        (l: { type: string }) => l.type !== 'whiteboard',
      ),
    })
    expect(res.status).toBe(400)
  })

  it('refuses to edit a built-in', async () => {
    const source = listBuiltinTemplates()[0]!
    const res = await act(ada, 'template.update', {
      templateId: source.id,
      name: 'Hijacked',
      theme: source.theme,
      layouts: source.layouts,
    })
    expect(res.status).toBe(400)
  })

  it("refuses to edit someone else's template", async () => {
    const template = await own()
    const res = await act(bob, 'template.update', {
      templateId: template.id,
      name: 'Theirs',
      theme: template.theme,
      layouts: template.layouts,
    })
    expect(res.status).toBe(403)
  })
})

describe('arrangement (TMPL-4 positioning)', () => {
  const own = async () =>
    (await act(ada, 'template.duplicate', { templateId: builtinId() })).body

  /** The same layout with its slots positioned. */
  const arrange = (template: {
    layouts: { type: string; slots: { name: string }[] }[]
  }) =>
    template.layouts.map(l =>
      l.type === 'content'
        ? {
            ...l,
            elementPositions: Object.fromEntries(
              l.slots.map((s, i) => [
                s.name,
                { x: 0.1, y: 0.1 + i * 0.3, w: 0.8, h: 0.25 },
              ]),
            ),
          }
        : l,
    )

  it('saves where each slot sits, and gives it back', async () => {
    const template = await own()
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: arrange(template),
    })
    expect(res.status).toBe(200)
    const content = res.body.layouts.find(
      (l: { type: string }) => l.type === 'content',
    )
    expect(content.elementPositions.title).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.8,
      h: 0.25,
    })
  })

  it('refuses a box that runs off the slide', async () => {
    const template = await own()
    const layouts = template.layouts.map((l: { type: string }) =>
      l.type === 'content'
        ? {
            ...l,
            elementPositions: { title: { x: 0.6, y: 0.1, w: 0.8, h: 0.2 } },
          }
        : l,
    )
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts,
    })
    expect(res.status).toBe(400)
  })

  it('refuses a box for a slot the layout does not have', async () => {
    const template = await own()
    const layouts = template.layouts.map((l: { type: string }) =>
      l.type === 'content'
        ? {
            ...l,
            elementPositions: { nope: { x: 0, y: 0, w: 0.1, h: 0.1 } },
          }
        : l,
    )
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts,
    })
    expect(res.status).toBe(400)
  })

  it('saves how a box is styled, not only where it sits', async () => {
    const template = await own()
    const layouts = template.layouts.map((l: { type: string }) =>
      l.type === 'content'
        ? {
            ...l,
            elementPositions: {
              title: {
                x: 0,
                y: 0,
                w: 1,
                h: 0.3,
                align: 'center',
                vAlign: 'end',
                fontSize: 8,
                fontWeight: 700,
                color: 'accent',
              },
            },
          }
        : l,
    )
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts,
    })
    expect(res.status).toBe(200)
    const content = res.body.layouts.find(
      (l: { type: string }) => l.type === 'content',
    )
    expect(content.elementPositions.title).toMatchObject({
      align: 'center',
      vAlign: 'end',
      fontSize: 8,
      fontWeight: 700,
      color: 'accent',
    })
  })

  it('refuses a box measured in percent rather than fractions', async () => {
    const template = await own()
    const layouts = template.layouts.map((l: { type: string }) =>
      l.type === 'content'
        ? {
            ...l,
            elementPositions: { title: { x: 10, y: 10, w: 80, h: 25 } },
          }
        : l,
    )
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts,
    })
    expect(res.status).toBe(400)
  })

  it('remembers which renderer the template asked for', async () => {
    const template = await own()
    const saved = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      renderMode: 'positioned',
      theme: template.theme,
      layouts: arrange(template),
    })
    expect(saved.body.renderMode).toBe('positioned')
    // and a copy of it starts out drawing the same way
    const copy = await act(ada, 'template.duplicate', {
      templateId: template.id,
    })
    expect(copy.body.renderMode).toBe('positioned')
  })

  it('keeps a custom layout’s design across a save and a re-read', async () => {
    const template = await own()
    const custom = {
      type: 'content-image',
      label: 'Content + Image',
      purpose: 'Content beside a picture',
      slots: [
        { name: 'title', kind: 'text' as const, label: 'Slide title' },
        { name: 'picture', kind: 'image' as const, label: 'Image' },
      ],
      tree: {
        id: 'root',
        container: { mode: 'flex', direction: 'row', gap: 3 },
        style: { paddingX: 6 },
        children: [
          { id: 'title', slot: 'title', style: { textStyle: 'heading' } },
          { id: 'picture', slot: 'picture', grow: 1, style: { radius: 1 } },
        ],
      },
      elementPositions: {},
    }
    const saved = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: [...template.layouts, custom],
    })
    expect(saved.status).toBe(200)

    // Read it back the way reopening the editor does.
    const list = await act(ada, 'template.list')
    const reread = list.body
      .find((t: { id: string }) => t.id === template.id)
      .layouts.find((l: { type: string }) => l.type === 'content-image')
    // The design, not just the slots: how it is arranged and how each box is
    // set are what an author would notice losing.
    expect(reread.tree).toEqual(custom.tree)
  })

  it('gives a custom layout that lost its tree something to edit again', async () => {
    // A layout an author named has no conventional definition to fall back
    // on, so one saved without a tree would come back with no boxes at all —
    // a dead end rather than a starting point.
    const template = await own()
    await TemplateModel.updateOne(
      { _id: template.id },
      {
        $set: {
          layouts: [
            ...template.layouts,
            {
              type: 'content-image',
              label: 'Content + Image',
              purpose: 'Content beside a picture',
              slots: [
                { name: 'title', kind: 'text', label: 'Slide title' },
                { name: 'picture', kind: 'image', label: 'Image' },
              ],
              elementPositions: {},
            },
          ],
        },
      },
    )
    const list = await act(ada, 'template.list')
    const rescued = list.body
      .find((t: { id: string }) => t.id === template.id)
      .layouts.find((l: { type: string }) => l.type === 'content-image')
    expect(rescued.tree).toBeDefined()
    expect(rescued.tree.children.map((c: { slot: string }) => c.slot)).toEqual([
      'title',
      'picture',
    ])
  })

  it('takes a layout the author gave four pictures (TMPL-4)', async () => {
    const template = await own()
    const images = [1, 2, 3, 4].map(n => ({
      name: `image-${n}`,
      kind: 'image' as const,
      label: `Image ${n}`,
    }))
    const layouts = template.layouts.map((l: { type: string }) =>
      l.type === 'content'
        ? {
            ...l,
            slots: images,
            // The tree is replaced along with the slots. A layout that showed
            // a title and a body cannot keep showing them once neither
            // exists, and the editor removes a box and its slot together.
            tree: {
              id: 'root',
              container: { mode: 'grid', columns: 2, gap: 2 },
              style: { padding: 4 },
              children: images.map(p => ({ id: p.name, slot: p.name })),
            },
            elementPositions: Object.fromEntries(
              images.map((p, i) => [
                p.name,
                {
                  x: i % 2 === 0 ? 0.04 : 0.52,
                  y: i < 2 ? 0.04 : 0.52,
                  w: 0.44,
                  h: 0.44,
                },
              ]),
            ),
          }
        : l,
    )
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      renderMode: 'positioned',
      theme: template.theme,
      layouts,
    })
    expect(res.status).toBe(200)
    const content = res.body.layouts.find(
      (l: { type: string }) => l.type === 'content',
    )
    expect(content.slots).toHaveLength(4)
    expect(
      content.slots.every((s: { kind: string }) => s.kind === 'image'),
    ).toBe(true)
    expect(Object.keys(content.elementPositions)).toHaveLength(4)
  })

  it('rescales a template saved when boxes were percentages', async () => {
    const template = await own()
    // Write percentages straight to the document, the way the editor did
    // before boxes became fractions
    const doc = await TemplateModel.findById(template.id)
    doc!.layouts = doc!.layouts.map(l =>
      l.type === 'content'
        ? { ...l, elementPositions: { title: { x: 6, y: 6, w: 88, h: 42.5 } } }
        : l,
    )
    doc!.markModified('layouts')
    await doc!.save()

    const res = await act(ada, 'template.list', {})
    const reloaded = res.body.find((x: { id: string }) => x.id === template.id)
    const content = reloaded.layouts.find(
      (l: { type: string }) => l.type === 'content',
    )
    // Read back as fractions, so it is drawn on the slide rather than
    // eighty-eight slides to the right
    expect(content.elementPositions.title).toEqual({
      x: 0.06,
      y: 0.06,
      w: 0.88,
      h: 0.425,
    })
  })

  it('reaches the viewer, so a lecture is drawn from the arrangement', async () => {
    const template = await own()
    await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: arrange(template),
    })
    const project = await act(ada, 'project.create', { title: 'Physics' })
    await act(ada, 'project.switchTemplate', {
      projectId: project.body.id,
      templateId: template.id,
    })
    const deck = await act(ada, 'deck.create', { projectId: project.body.id })
    const view = await act(ada, 'deck.get', { deckId: deck.body.id })
    const content = view.body.template.layouts.find(
      (l: { type: string }) => l.type === 'content',
    )
    expect(Object.keys(content.elementPositions).length).toBeGreaterThan(0)
  })
})

describe('layouts an author named themselves (TMPL-9)', () => {
  const own = async () =>
    (await act(ada, 'template.duplicate', { templateId: builtinId() })).body

  const withLayout = (
    template: { layouts: unknown[] },
    layout: Record<string, unknown>,
  ) => [...template.layouts, layout]

  it('saves a layout type that is not one of the conventional names', async () => {
    const template = await own()
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: withLayout(template, {
        type: 'lab-safety',
        label: 'Lab safety',
        purpose: 'The rules to read out before an experiment',
        slots: [{ name: 'title', kind: 'text', label: 'Slide title' }],
        elementPositions: {},
      }),
    })
    expect(res.status).toBe(200)
    expect(
      res.body.layouts.some((l: { type: string }) => l.type === 'lab-safety'),
    ).toBe(true)
  })

  it('a slide can be put on it, and stays there', async () => {
    const template = await own()
    await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: withLayout(template, {
        type: 'lab-safety',
        label: 'Lab safety',
        purpose: 'The rules to read out before an experiment',
        slots: [{ name: 'title', kind: 'text', label: 'Slide title' }],
        elementPositions: {},
      }),
    })
    const project = await act(ada, 'project.create', { title: 'Chemistry' })
    await act(ada, 'project.switchTemplate', {
      projectId: project.body.id,
      templateId: template.id,
    })
    const deck = await act(ada, 'deck.create', { projectId: project.body.id })
    const slide = await act(ada, 'slide.add', {
      deckId: deck.body.id,
      layoutType: 'lab-safety',
    })
    expect(slide.status).toBe(200)
    expect(slide.body.layoutType).toBe('lab-safety')

    const reloaded = await act(ada, 'slide.get', { slideId: slide.body.id })
    expect(reloaded.body.layoutType).toBe('lab-safety')
  })

  it('refuses a name that would not work as a key', async () => {
    const template = await own()
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: withLayout(template, {
        type: 'Lab Safety!',
        label: 'Lab safety',
        purpose: 'The rules',
        slots: [{ name: 'title', kind: 'text', label: 'Slide title' }],
        elementPositions: {},
      }),
    })
    expect(res.status).toBe(400)
  })

  it('refuses two layouts sharing one type', async () => {
    const template = await own()
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: withLayout(template, {
        // 'content' is already in the duplicated template
        type: 'content',
        label: 'Content again',
        purpose: 'A second content layout',
        slots: [{ name: 'title', kind: 'text', label: 'Slide title' }],
        elementPositions: {},
      }),
    })
    expect(res.status).toBe(400)
  })
})

describe('slot metadata (TMPL-10)', () => {
  const own = async () =>
    (await act(ada, 'template.duplicate', { templateId: builtinId() })).body

  /** The template's content layout with its first box annotated — which is
   * what an author does: pick a box and say what it is for. */
  const annotate = (
    template: { layouts: { type: string; slots: unknown[] }[] },
    metadata: Record<string, unknown>,
  ) =>
    template.layouts.map(l =>
      l.type === 'content'
        ? {
            ...l,
            slots: l.slots.map((s, i) =>
              i === 0 ? { ...(s as object), ...metadata } : s,
            ),
          }
        : l,
    )

  const authored = {
    description: 'A runnable Python snippet, at most eight lines.',
    maxChars: 400,
    maxWords: 60,
    required: true,
    options: { language: 'python' },
  }

  it('saves what the author wrote and gives it back', async () => {
    const template = await own()
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: annotate(template, authored),
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const content = res.body.layouts.find(
      (l: { type: string }) => l.type === 'content',
    )
    expect(content.slots[0]).toMatchObject({
      description: 'A runnable Python snippet, at most eight lines.',
      maxChars: 400,
      maxWords: 60,
      required: true,
      options: { language: 'python' },
    })
  })

  it('refuses an instruction longer than the cap', async () => {
    const template = await own()
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      // Untrusted author text on a per-phrase prompt
      layouts: annotate(template, { description: 'x'.repeat(500) }),
    })
    expect(res.status).toBe(400)
  })

  it('travels with the template through export', async () => {
    const template = await own()
    await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: annotate(template, authored),
    })
    const res = await act(ada, 'template.export', { templateId: template.id })
    const yaml = Buffer.from(res.body.contentBase64, 'base64').toString('utf8')
    // A template that exported without its instructions would come back a
    // different template (TMPL-10 / EXP-2)
    expect(yaml).toContain('A runnable Python snippet, at most eight lines.')
    expect(yaml).toContain('maxWords')
    expect(yaml).toContain('required')
  })
})

describe('template.delete (TMPL-4)', () => {
  it('removes it from the library', async () => {
    const template = (
      await act(ada, 'template.duplicate', {
        templateId: builtinId(),
        name: 'Doomed',
      })
    ).body
    expect(
      (await act(ada, 'template.delete', { templateId: template.id })).status,
    ).toBe(200)
    const list = await act(ada, 'template.list')
    expect(list.body.map((t: { id: string }) => t.id)).not.toContain(
      template.id,
    )
  })

  it('refuses to delete a built-in', async () => {
    expect(
      (await act(ada, 'template.delete', { templateId: builtinId() })).status,
    ).toBe(400)
  })

  it("refuses to delete someone else's", async () => {
    const template = (
      await act(ada, 'template.duplicate', { templateId: builtinId() })
    ).body
    expect(
      (await act(bob, 'template.delete', { templateId: template.id })).status,
    ).toBe(403)
  })

  it('tombstones the templates of a deleted account (P-10)', async () => {
    const template = (
      await act(ada, 'template.duplicate', { templateId: builtinId() })
    ).body
    const adaUser = await UserModel.findOne({ email: 'ada@example.com' })
    await deleteUserCascade(adaUser!._id.toString())
    expect(await TemplateModel.findById(template.id)).toBeNull()
  })
})

describe('a stored template behaves like a built-in', () => {
  it('a project and its lectures can use one', async () => {
    const template = (
      await act(ada, 'template.duplicate', {
        templateId: builtinId(),
        name: 'Course Style',
      })
    ).body
    const project = await act(ada, 'project.create', { title: 'Physics' })
    expect(
      (
        await act(ada, 'project.switchTemplate', {
          projectId: project.body.id,
          templateId: template.id,
        })
      ).status,
    ).toBe(200)

    const deck = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Waves',
      templateId: template.id,
    })
    expect(deck.status).toBe(200)
    // The viewer resolves it the same way it resolves a built-in
    const view = await act(ada, 'deck.get', { deckId: deck.body.id })
    expect(view.status).toBe(200)
    expect(view.body.template.name).toBe('Course Style')
  })

  it('exports to YAML like a built-in does (EXP-2)', async () => {
    const template = (
      await act(ada, 'template.duplicate', {
        templateId: builtinId(),
        name: 'Exportable',
      })
    ).body
    const res = await act(ada, 'template.export', { templateId: template.id })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('exportable.template.yaml')
    const yaml = Buffer.from(res.body.contentBase64, 'base64').toString('utf8')
    expect(yaml).toContain('Exportable')
  })

  it('a deck whose template was deleted still opens, in the style it pinned', async () => {
    const template = (
      await act(ada, 'template.duplicate', { templateId: builtinId() })
    ).body
    const project = await act(ada, 'project.create', { title: 'Physics' })
    // A lecture takes its project's template, so switch the project first —
    // deck.create does not accept one directly.
    await act(ada, 'project.switchTemplate', {
      projectId: project.body.id,
      templateId: template.id,
    })
    const deck = await act(ada, 'deck.create', { projectId: project.body.id })
    expect(
      (await act(ada, 'deck.get', { deckId: deck.body.id })).body.template.id,
    ).toBe(template.id)

    expect(
      (await act(ada, 'template.delete', { templateId: template.id })).status,
    ).toBe(200)

    // Deleting your own template must not make a lecture unopenable. It no
    // longer drops the lecture to the deployment default either: the lecture
    // pinned this template's structure (TMPL-11), and that outlives the
    // template itself, so it keeps looking exactly as it did.
    const view = await act(ada, 'deck.get', { deckId: deck.body.id })
    expect(view.status).toBe(200)
    expect(view.body.template.id).toBe(template.id)
    expect(view.body.template.name).toBe(template.name)
    // Its own layouts, not the deployment default's. Compared by shape rather
    // than deep equality: the DTO normalizes geometry on read, so the two
    // objects are equivalent without being identical.
    expect(
      (view.body.template.layouts as { type: string }[]).map(l => l.type),
    ).toEqual((template.layouts as { type: string }[]).map(l => l.type))
    const stored = await DeckModel.findById(deck.body.id)
    expect(stored!.templateId).toBe(template.id)
  })
})
