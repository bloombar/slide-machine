/**
 * Integration tests for the style-template actions (TMPL-1 library, TMPL-4
 * custom templates) against a real MongoDB. Covers the library a user sees,
 * duplicating as the way a template is created, editing and deleting one you
 * authored, the read-only built-ins, ownership, and the fact that a template
 * stored in the database is interchangeable with one shipped as a file
 * everywhere a template is resolved.
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
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { TemplateModel, type TemplateDb } from '../../src/models/template'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { BannedEmailModel } from '../../src/models/banned-email'
import * as mailer from '../../src/lib/mailer'
import { resetShareMailLimit } from '../../src/lib/share-emails'
import {
  defaultTemplateId,
  layoutDescriptors,
  listBuiltinTemplates,
} from '../../src/templates/builtin'
import { deleteUserCascade } from '../../src/lib/cascade'

const server = createApp().listen(0)
afterAll(() => server.close())

/** Every message the server tried to send during a test (SHARE-3), mirroring
 * `share-notify.test.ts`'s stub. */
let sent: { to: string; subject: string; text: string }[] = []

/** The verification token out of the message registration mailed. */
const verificationTokenFor = async (email: string): Promise<string> => {
  await vi.waitFor(() =>
    expect(
      sent.some(m => m.to === email && m.text.includes('verify-email')),
    ).toBe(true),
  )
  // The verification message specifically: a share notification to the same
  // address may well have arrived after it.
  const mail = sent
    .filter(m => m.to === email && m.text.includes('verify-email'))
    .at(-1)!
  return decodeURIComponent(mail.text.match(/verify-email\?token=(\S+)/)![1]!)
}

/**
 * Registers and confirms the address through the mailed verification link —
 * the same flow a real signup takes, and the only thing that actually claims
 * a pending share invitation (SHARE-3): confirming a user's row directly in
 * the database would prove nothing about that path.
 */
const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  await request(server)
    .post('/api/auth/verify-email')
    .send({ token: await verificationTokenFor(email) })
  return res.body.accessToken as string
}

/** Registers without confirming the address — no invitation is claimed. */
const registerUnverified = async (email: string): Promise<string> => {
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
let carol: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})
afterAll(async () => {
  vi.restoreAllMocks()
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
  await BannedEmailModel.deleteMany({})
  sent = []
  resetShareMailLimit()
  vi.spyOn(mailer, 'mailerAvailable').mockReturnValue(true)
  vi.spyOn(mailer, 'sendMail').mockImplementation(async mail => {
    sent.push({ to: mail.to, subject: mail.subject, text: mail.text })
  })
  ada = await registerUser('ada@example.com')
  bob = await registerUser('bob@example.com')
  carol = await registerUser('carol@example.com')
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
    // Its own template, restricted until shared (TMPL-26)
    expect(res.body.visibility).toBe('restricted')
    expect(res.body.myRole).toBe('owner')
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

  it('lets anyone read a design its owner made public (TMPL-26)', async () => {
    const made = await own()
    await act(ada, 'template.setAccess', {
      templateId: made.id,
      visibility: 'public',
    })
    const res = await act(bob, 'template.get', { slug: made.permalinkSlug })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Mine')
  })

  it('lets a viewer the owner shared with read a restricted design (TMPL-26)', async () => {
    const made = await own()
    await act(ada, 'template.share', {
      templateId: made.id,
      email: 'bob@example.com',
      role: 'viewer',
    })
    const res = await act(bob, 'template.get', { slug: made.permalinkSlug })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Mine')
    expect(res.body.myRole).toBe('viewer')
  })
})

describe('template.getById (TMPL-28)', () => {
  const own = async () =>
    (
      await act(ada, 'template.duplicate', {
        templateId: builtinId(),
        name: 'Mine',
      })
    ).body

  it('reads a stored template by its id', async () => {
    const made = await own()
    const res = await act(ada, 'template.getById', { templateId: made.id })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(made.id)
  })

  it('reads a built-in by its id', async () => {
    const res = await act(ada, 'template.getById', {
      templateId: builtinId(),
    })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(builtinId())
  })

  it("refuses someone else's private design, and a missing one, alike", async () => {
    const made = await own()
    const mine = await act(bob, 'template.getById', { templateId: made.id })
    const missing = await act(bob, 'template.getById', {
      templateId: 'no-such-design',
    })
    expect(mine.status).toBe(403)
    expect(missing.status).toBe(403)
  })

  it('lets anyone read a design its owner made public (TMPL-26)', async () => {
    const made = await own()
    await act(ada, 'template.setAccess', {
      templateId: made.id,
      visibility: 'public',
    })
    const res = await act(bob, 'template.getById', { templateId: made.id })
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

describe('template access and sharing (TMPL-26)', () => {
  const own = async (name = 'Ada Style') =>
    (await act(ada, 'template.duplicate', { templateId: builtinId(), name }))
      .body

  describe('access levels', () => {
    it('refuses a non-member on a restricted design', async () => {
      const made = await own()
      expect(
        (
          await act(bob, 'template.update', {
            templateId: made.id,
            name: made.name,
            theme: made.theme,
            layouts: made.layouts,
          })
        ).status,
      ).toBe(403)
      expect(
        (await act(bob, 'template.get', { slug: made.permalinkSlug })).status,
      ).toBe(403)
    })

    it('lets a viewer read and duplicate, but not update', async () => {
      const made = await own()
      await act(ada, 'template.share', {
        templateId: made.id,
        email: 'bob@example.com',
        role: 'viewer',
      })
      expect(
        (await act(bob, 'template.get', { slug: made.permalinkSlug })).status,
      ).toBe(200)
      expect(
        (await act(bob, 'template.duplicate', { templateId: made.id })).status,
      ).toBe(200)
      const update = await act(bob, 'template.update', {
        templateId: made.id,
        name: made.name,
        theme: made.theme,
        layouts: made.layouts,
      })
      expect(update.status).toBe(403)
    })

    it('lets an editor update, but not delete, share or setAccess', async () => {
      const made = await own()
      await act(ada, 'template.share', {
        templateId: made.id,
        email: 'bob@example.com',
        role: 'editor',
      })
      const update = await act(bob, 'template.update', {
        templateId: made.id,
        name: 'Edited by Bob',
        theme: made.theme,
        layouts: made.layouts,
      })
      expect(update.status).toBe(200)
      expect(update.body.name).toBe('Edited by Bob')
      expect(update.body.myRole).toBe('editor')

      expect(
        (await act(bob, 'template.delete', { templateId: made.id })).status,
      ).toBe(403)
      expect(
        (
          await act(bob, 'template.share', {
            templateId: made.id,
            email: 'carol@example.com',
            role: 'viewer',
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await act(bob, 'template.setAccess', {
            templateId: made.id,
            visibility: 'public',
          })
        ).status,
      ).toBe(403)
      expect(
        (await act(bob, 'template.shares', { templateId: made.id })).status,
      ).toBe(403)
      // template.update carries no visibility field at all (TMPL-26) — an
      // editor sending one anyway (the shape a stale client might still
      // send) has it silently ignored rather than smuggled through, and the
      // design's own access is untouched.
      const withStrayField = await act(bob, 'template.update', {
        templateId: made.id,
        name: made.name,
        theme: made.theme,
        layouts: made.layouts,
        visibility: 'public',
      })
      expect(withStrayField.status).toBe(200)
      expect(withStrayField.body.visibility).toBe('restricted')
    })

    it('lets the owner do everything', async () => {
      const made = await own()
      expect(
        (
          await act(ada, 'template.setAccess', {
            templateId: made.id,
            visibility: 'public',
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await act(ada, 'template.share', {
            templateId: made.id,
            email: 'bob@example.com',
            role: 'editor',
          })
        ).status,
      ).toBe(200)
      expect(
        (await act(ada, 'template.shares', { templateId: made.id })).status,
      ).toBe(200)
      expect(
        (await act(ada, 'template.delete', { templateId: made.id })).status,
      ).toBe(200)
    })

    // Publishing to everyone needs a confirmed address (AUTH-3), the same
    // rule deck.setAccess/project.setAccess apply — going public reaches the
    // public, not just a person the owner names.
    it('refuses an unverified owner going public (TMPL-26)', async () => {
      const eve = await registerUnverified('eve@example.com')
      const made = (
        await act(eve, 'template.duplicate', { templateId: builtinId() })
      ).body
      const res = await act(eve, 'template.setAccess', {
        templateId: made.id,
        visibility: 'public',
      })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('email_unverified')
    })
  })

  describe('share, invite and unshare round trip', () => {
    it('grants a confirmed account directly', async () => {
      const made = await own()
      const shares = await act(ada, 'template.share', {
        templateId: made.id,
        email: 'bob@example.com',
        role: 'viewer',
      })
      expect(shares.status).toBe(200)
      expect(shares.body).toEqual([
        expect.objectContaining({ email: 'bob@example.com', role: 'viewer' }),
      ])
      expect(
        (await act(bob, 'template.get', { slug: made.permalinkSlug })).status,
      ).toBe(200)
    })

    it('holds an unknown address as a pending invitation, claimed at registration', async () => {
      const made = await own()
      const shares = await act(ada, 'template.share', {
        templateId: made.id,
        email: 'dana@example.com',
        role: 'editor',
      })
      expect(shares.status).toBe(200)
      expect(shares.body).toEqual([
        expect.objectContaining({
          email: 'dana@example.com',
          role: 'editor',
          pending: true,
        }),
      ])
      // An account with no confirmed address yet has not claimed anything —
      // the invitation is still only a promise (SHARE-3).
      const danaUnverified = await registerUnverified('dana@example.com')
      const before = await act(danaUnverified, 'template.update', {
        templateId: made.id,
        name: made.name,
        theme: made.theme,
        layouts: made.layouts,
      })
      expect(before.status).toBe(403)

      // Confirming the address through the real verify-email link is what
      // claims it (SHARE-3, `claimShareInvites`) — the same token flow a
      // person follows from their inbox, not a database field flipped by
      // the test.
      await request(server)
        .post('/api/auth/verify-email')
        .send({ token: await verificationTokenFor('dana@example.com') })
      const update = await act(danaUnverified, 'template.update', {
        templateId: made.id,
        name: made.name,
        theme: made.theme,
        layouts: made.layouts,
      })
      expect(update.status).toBe(200)
    })

    it('withdraws a granted share by user id, and an invitation by email', async () => {
      const made = await own()
      await act(ada, 'template.share', {
        templateId: made.id,
        email: 'bob@example.com',
        role: 'viewer',
      })
      await act(ada, 'template.share', {
        templateId: made.id,
        email: 'dana@example.com',
        role: 'viewer',
      })
      const bobId = (await UserModel.findOne({ email: 'bob@example.com' }))!.id
      await act(ada, 'template.unshare', {
        templateId: made.id,
        userId: bobId,
        role: 'viewer',
      })
      await act(ada, 'template.unshare', {
        templateId: made.id,
        email: 'dana@example.com',
        role: 'viewer',
      })
      const shares = await act(ada, 'template.shares', {
        templateId: made.id,
      })
      expect(shares.body).toEqual([])
      expect(
        (await act(bob, 'template.get', { slug: made.permalinkSlug })).status,
      ).toBe(403)
    })

    // Both addresses look free and are not: neither can ever register, so
    // an invitation would strand the share and mail someone who may have
    // asked to be forgotten (see deck.share / share-notify.test.ts).
    it('refuses a banned address', async () => {
      const adaId = (await UserModel.findOne({ email: 'ada@example.com' }))!._id
      await BannedEmailModel.create({
        email: 'banned@example.com',
        bannedBy: adaId,
      })
      const made = await own()
      const res = await act(ada, 'template.share', {
        templateId: made.id,
        email: 'banned@example.com',
        role: 'viewer',
      })
      expect(res.status).toBe(400)
    })

    it('refuses an address still held by a deleted account', async () => {
      await registerUser('gone@example.com')
      await UserModel.updateOne(
        { email: 'gone@example.com' },
        { deletedAt: new Date() },
      )
      const made = await own()
      const res = await act(ada, 'template.share', {
        templateId: made.id,
        email: 'gone@example.com',
        role: 'viewer',
      })
      expect(res.status).toBe(400)
    })

    it('refuses an editor unsharing (owner-only, TMPL-26)', async () => {
      const made = await own()
      await act(ada, 'template.share', {
        templateId: made.id,
        email: 'bob@example.com',
        role: 'editor',
      })
      const carolId = (await UserModel.findOne({ email: 'carol@example.com' }))!
        .id
      const res = await act(bob, 'template.unshare', {
        templateId: made.id,
        userId: carolId,
        role: 'viewer',
      })
      expect(res.status).toBe(403)
    })

    it('mails the design’s own /t/:slug link', async () => {
      const made = await own()
      sent = []
      await act(ada, 'template.share', {
        templateId: made.id,
        email: 'bob@example.com',
        role: 'viewer',
      })
      const mail = sent.find(m => m.subject.includes('shared a'))
      expect(mail?.text).toContain(`/t/${made.permalinkSlug}`)
    })

    it('gives a copy of a shared design an empty people list of its own', async () => {
      const made = await own()
      await act(ada, 'template.share', {
        templateId: made.id,
        email: 'bob@example.com',
        role: 'editor',
      })
      const copy = await act(bob, 'template.duplicate', {
        templateId: made.id,
      })
      expect(copy.status).toBe(200)
      // Bob owns the copy outright, and it carries no one else's access —
      // carol was never on the source's list, ada was its owner, neither
      // rides along onto something Bob just made his own.
      expect(copy.body.myRole).toBe('owner')
      const shares = await act(bob, 'template.shares', {
        templateId: copy.body.id,
      })
      expect(shares.body).toEqual([])
    })
  })

  describe('template.list (TMPL-26)', () => {
    it('includes a design shared with the caller, and excludes another', async () => {
      const shared = await own('Shared with Bob')
      await own('Not shared')
      await act(ada, 'template.share', {
        templateId: shared.id,
        email: 'bob@example.com',
        role: 'viewer',
      })
      const list = await act(bob, 'template.list')
      const names = list.body.map((t: { name: string }) => t.name)
      expect(names).toContain('Shared with Bob')
      expect(names).not.toContain('Not shared')
    })

    it('does not count a shared design toward duplicate name choosing', async () => {
      // Bob owns nothing named "Style A" or "Style A 2" — both names are only
      // on designs shared with him, by two different owners. If the shared
      // ones counted, his own next copy would be numbered past both; since
      // they must not, it lands on "Style A 2".
      const stylea = await own('Style A')
      await act(ada, 'template.share', {
        templateId: stylea.id,
        email: 'bob@example.com',
        role: 'viewer',
      })
      const dana = await registerUser('dana@example.com')
      const stylea2 = (
        await act(dana, 'template.duplicate', {
          templateId: builtinId(),
          name: 'Style A 2',
        })
      ).body
      await act(dana, 'template.share', {
        templateId: stylea2.id,
        email: 'bob@example.com',
        role: 'viewer',
      })

      const copy = await act(bob, 'template.duplicate', {
        templateId: stylea.id,
      })
      expect(copy.status).toBe(200)
      expect(copy.body.name).toBe('Style A 2')
    })
  })

  describe('myRole', () => {
    it('is null for a built-in and for a public design nobody added the caller to', async () => {
      const builtin = await act(ada, 'template.get', { slug: builtinId() })
      expect(builtin.body.myRole).toBeNull()

      const made = await own()
      await act(ada, 'template.setAccess', {
        templateId: made.id,
        visibility: 'public',
      })
      const seenByBob = await act(bob, 'template.get', {
        slug: made.permalinkSlug,
      })
      expect(seenByBob.body.myRole).toBeNull()
    })

    it('is owner/editor/viewer for the respective people, in template.list', async () => {
      const made = await own()
      await act(ada, 'template.share', {
        templateId: made.id,
        email: 'bob@example.com',
        role: 'editor',
      })
      await act(ada, 'template.share', {
        templateId: made.id,
        email: 'carol@example.com',
        role: 'viewer',
      })
      const findRole = (list: { id: string; myRole: string | null }[]) =>
        list.find(t => t.id === made.id)!.myRole

      expect(findRole((await act(ada, 'template.list')).body)).toBe('owner')
      expect(findRole((await act(bob, 'template.list')).body)).toBe('editor')
      expect(findRole((await act(carol, 'template.list')).body)).toBe('viewer')
    })

    it('is owner on the design carried by deck.get and GET /decks/:slug, for a lecture drawn with it', async () => {
      const made = await own()
      const project = await act(ada, 'project.create', { title: 'Physics' })
      await act(ada, 'project.switchTemplate', {
        projectId: project.body.id,
        templateId: made.id,
      })
      const deck = await act(ada, 'deck.create', {
        projectId: project.body.id,
        title: 'Waves',
      })

      const got = await act(ada, 'deck.get', { deckId: deck.body.id })
      expect(got.body.template.myRole).toBe('owner')

      const viaRoute = await request(server)
        .get(`/api/decks/${deck.body.permalinkSlug}`)
        .set('Authorization', `Bearer ${ada}`)
      expect(viaRoute.body.template.myRole).toBe('owner')
    })
  })

  describe('applying a template requires read access (TMPL-26)', () => {
    // Otherwise pointing a deck of your own at a restricted template you
    // cannot read, then reading it back through deck.get's own design
    // resolution, is a way around every access check above.
    const bobsDeck = async () => {
      const project = await act(bob, 'project.create', { title: 'Bob U' })
      const deck = await act(bob, 'deck.create', {
        projectId: project.body.id,
        title: 'Waves',
      })
      return deck.body.id as string
    }

    it('refuses a non-member switching a deck onto a restricted design', async () => {
      const made = await own()
      const deckId = await bobsDeck()
      const res = await act(bob, 'deck.switchTemplate', {
        deckId,
        templateId: made.id,
      })
      expect(res.status).toBe(400)
    })

    it('lets a non-member switch onto a public design', async () => {
      const made = await own()
      await act(ada, 'template.setAccess', {
        templateId: made.id,
        visibility: 'public',
      })
      const deckId = await bobsDeck()
      const res = await act(bob, 'deck.switchTemplate', {
        deckId,
        templateId: made.id,
      })
      expect(res.status).toBe(200)
    })

    it('lets someone the design was shared with switch onto it', async () => {
      const made = await own()
      await act(ada, 'template.share', {
        templateId: made.id,
        email: 'bob@example.com',
        role: 'viewer',
      })
      const deckId = await bobsDeck()
      const res = await act(bob, 'deck.switchTemplate', {
        deckId,
        templateId: made.id,
      })
      expect(res.status).toBe(200)
    })

    describe('project.switchTemplate', () => {
      it('refuses a non-member switching a project onto a restricted design', async () => {
        const made = await own()
        const project = await act(bob, 'project.create', { title: 'Bob U' })
        const res = await act(bob, 'project.switchTemplate', {
          projectId: project.body.id,
          templateId: made.id,
        })
        expect(res.status).toBe(400)
      })

      it('lets a non-member switch onto a public design', async () => {
        const made = await own()
        await act(ada, 'template.setAccess', {
          templateId: made.id,
          visibility: 'public',
        })
        const project = await act(bob, 'project.create', { title: 'Bob U' })
        const res = await act(bob, 'project.switchTemplate', {
          projectId: project.body.id,
          templateId: made.id,
        })
        expect(res.status).toBe(200)
      })

      it('lets someone the design was shared with switch onto it', async () => {
        const made = await own()
        await act(ada, 'template.share', {
          templateId: made.id,
          email: 'bob@example.com',
          role: 'viewer',
        })
        const project = await act(bob, 'project.create', { title: 'Bob U' })
        const res = await act(bob, 'project.switchTemplate', {
          projectId: project.body.id,
          templateId: made.id,
        })
        expect(res.status).toBe(200)
      })
    })

    describe('user.setTemplate', () => {
      it('refuses a non-member setting a restricted design as their default', async () => {
        const made = await own()
        const res = await act(bob, 'user.setTemplate', {
          templateId: made.id,
        })
        expect(res.status).toBe(400)
      })

      it('lets a non-member set a public design as their default', async () => {
        const made = await own()
        await act(ada, 'template.setAccess', {
          templateId: made.id,
          visibility: 'public',
        })
        const res = await act(bob, 'user.setTemplate', {
          templateId: made.id,
        })
        expect(res.status).toBe(200)
      })

      it('lets someone the design was shared with set it as their default', async () => {
        const made = await own()
        await act(ada, 'template.share', {
          templateId: made.id,
          email: 'bob@example.com',
          role: 'viewer',
        })
        const res = await act(bob, 'user.setTemplate', {
          templateId: made.id,
        })
        expect(res.status).toBe(200)
      })
    })

    describe("deck.import's settings restore", () => {
      /** A minimal, well-formed deck export naming `templateId`. */
      const yamlNaming = (templateId: string): string =>
        YAML.stringify({
          version: 1,
          kind: 'deck',
          title: 'Imported',
          templateId,
          settings: {},
          slides: [{ layout: 'title', title: 'Imported' }],
        })

      const bobsProject = async () =>
        (await act(bob, 'project.create', { title: 'Bob U' })).body.id as string

      it('falls back to the default design, with a warning, for a restricted one Bob may not read', async () => {
        const made = await own()
        const res = await act(bob, 'deck.import', {
          projectId: await bobsProject(),
          content: yamlNaming(made.id),
        })
        expect(res.status).toBe(200)
        expect(res.body.deck.templateId).toBe(defaultTemplateId())
        expect(res.body.warnings.join(' ')).toMatch(/Unknown template/)
      })

      it('imports onto a public design without a warning', async () => {
        const made = await own()
        await act(ada, 'template.setAccess', {
          templateId: made.id,
          visibility: 'public',
        })
        const res = await act(bob, 'deck.import', {
          projectId: await bobsProject(),
          content: yamlNaming(made.id),
        })
        expect(res.status).toBe(200)
        expect(res.body.deck.templateId).toBe(made.id)
        expect(res.body.warnings).toEqual([])
      })

      it('imports onto a shared design without a warning', async () => {
        const made = await own()
        await act(ada, 'template.share', {
          templateId: made.id,
          email: 'bob@example.com',
          role: 'viewer',
        })
        const res = await act(bob, 'deck.import', {
          projectId: await bobsProject(),
          content: yamlNaming(made.id),
        })
        expect(res.status).toBe(200)
        expect(res.body.deck.templateId).toBe(made.id)
        expect(res.body.warnings).toEqual([])
      })
    })

    describe('an inherited default that goes stale (TMPL-26)', () => {
      // Bob sets a design ada shared with him as his own account default;
      // ada later unshares him. Neither a fresh project nor a fresh lecture
      // may inherit a design Bob can no longer even open — they fall back to
      // the deployment default exactly as they would for one since deleted.
      it("falls back once Bob's account default is unshared from him", async () => {
        const made = await own()
        await act(ada, 'template.share', {
          templateId: made.id,
          email: 'bob@example.com',
          role: 'viewer',
        })
        // Bob sets it as his account default while he can still read it.
        expect(
          (await act(bob, 'user.setTemplate', { templateId: made.id })).status,
        ).toBe(200)

        const bobId = (await UserModel.findOne({ email: 'bob@example.com' }))!
          .id
        await act(ada, 'template.unshare', {
          templateId: made.id,
          userId: bobId,
          role: 'viewer',
        })

        // A fresh project inherits the account default (TMPL-24) — stale
        // now, so it falls back rather than pointing at a design Bob can no
        // longer even open.
        const project = await act(bob, 'project.create', { title: 'Bob U' })
        expect(project.body.templateId).toBe(defaultTemplateId())

        // A fresh lecture inherits its project's default; also independently
        // stale if the project itself was pointed at the design before Bob
        // lost access to it. Written directly, the way an existing project
        // that predates the unshare would already hold it.
        await ProjectModel.updateOne(
          { _id: project.body.id },
          { templateId: made.id },
        )
        const deck = await act(bob, 'deck.create', {
          projectId: project.body.id,
          title: 'Waves',
        })
        expect(deck.body.templateId).toBe(defaultTemplateId())

        expect(
          (await act(bob, 'template.get', { slug: made.permalinkSlug })).status,
        ).toBe(403)
      })
    })
  })
})

describe('migrating a template’s stored visibility (TMPL-26)', () => {
  const adaId = async () =>
    (await UserModel.findOne({ email: 'ada@example.com' }))!.id

  it('folds private and unlisted down to restricted, and leaves public alone', async () => {
    const ownerId = await adaId()
    const fixture = (visibility: TemplateDb['visibility']) =>
      TemplateModel.create({
        ownerId,
        name: `Fixture ${visibility}`,
        theme: {},
        layouts: listBuiltinTemplates()[0]!.layouts,
        visibility,
      })
    const priv = await fixture('private')
    const unlisted = await fixture('unlisted')
    const pub = await fixture('public')
    const { backfillTemplateVisibility } =
      await import('../../src/jobs/migrate-template-visibility')
    const migrated = await backfillTemplateVisibility()
    expect(migrated).toBe(2)

    expect((await TemplateModel.findById(priv.id))!.visibility).toBe(
      'restricted',
    )
    expect((await TemplateModel.findById(unlisted.id))!.visibility).toBe(
      'restricted',
    )
    expect((await TemplateModel.findById(pub.id))!.visibility).toBe('public')

    // Idempotent: a second run finds nothing left to change.
    expect(await backfillTemplateVisibility()).toBe(0)
  })

  it('reads private/unlisted as restricted even before the backfill runs', async () => {
    const doc = await TemplateModel.create({
      ownerId: await adaId(),
      name: 'Not yet migrated',
      permalinkSlug: 'not-yet-migrated',
      theme: {},
      layouts: listBuiltinTemplates()[0]!.layouts,
      visibility: 'unlisted',
    })
    const res = await act(ada, 'template.get', { slug: doc.permalinkSlug! })
    expect(res.body.visibility).toBe('restricted')
  })
})
