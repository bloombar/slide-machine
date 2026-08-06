/**
 * Integration tests for template versions and opt-in updates (TMPL-11).
 *
 * The property that matters most is the negative one: editing a template must
 * NOT reach into lectures already built on it. Everything else here — the
 * notice, the warning's contents, the apply — is the machinery for taking that
 * edit deliberately once the owner decides to.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import type { Layout, LayoutNode, Template } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { TemplateModel } from '../../src/models/template'
import { TemplateVersionModel } from '../../src/models/template-version'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { listBuiltinTemplates } from '../../src/templates/builtin'
import { backfillTemplateVersions } from '../../src/jobs/pin-template-versions'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  await UserModel.updateOne({ email }, { emailVerified: true })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

const builtinId = (): string => listBuiltinTemplates()[0]!.id

let ada: string
let projectId: string
let deckId: string
let templateId: string
let template: Template

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), TemplateVersionModel.init()])
})
afterAll(async () => {
  await disconnectMongo()
})

/** Saves the template with `mutate` applied to its layouts. */
const editTemplate = async (mutate: (layouts: Layout[]) => Layout[]) => {
  const res = await act(ada, 'template.update', {
    templateId,
    name: template.name,
    renderMode: template.renderMode,
    theme: template.theme,
    layouts: mutate(structuredClone(template.layouts)),
  })
  // The body is in the message so a schema rejection says what it rejected.
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as Template
}

/** The content layout every fixture slide sits on. */
const contentLayout = (layouts: Layout[]): Layout =>
  layouts.find(l => l.type === 'content')!

/**
 * A layout's tree names the slots it draws, and the schema refuses a tree
 * showing a slot the layout no longer declares. So the fixture edits both —
 * which is what the template editor does too.
 */
const walkTree = (
  node: LayoutNode | undefined,
  visit: (node: LayoutNode) => void,
): void => {
  if (!node) return
  visit(node)
  for (const child of node.children ?? []) walkTree(child, visit)
}

/** Drops a box from a layout, tree included. */
const dropSlot = (layout: Layout, name: string): void => {
  layout.slots = layout.slots.filter(s => s.name !== name)
  const prune = (node: LayoutNode): void => {
    node.children = (node.children ?? []).filter(child => child.slot !== name)
    node.children.forEach(prune)
  }
  if (layout.tree) prune(layout.tree)
  delete layout.elementPositions?.[name]
}

/** Renames a box in a layout, tree included. */
const renameSlot = (layout: Layout, from: string, to: string): void => {
  layout.slots = layout.slots.map(s =>
    s.name === from ? { ...s, name: to } : s,
  )
  walkTree(layout.tree, node => {
    if (node.slot === from) node.slot = to
  })
  const positions = layout.elementPositions
  if (positions?.[from]) {
    positions[to] = positions[from]!
    delete positions[from]
  }
}

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    TemplateModel.deleteMany({}),
    TemplateVersionModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')

  // A template is created by duplicating one, which is the only way to get an
  // editable copy (built-ins are read-only).
  const dup = await act(ada, 'template.duplicate', { templateId: builtinId() })
  template = dup.body as Template
  templateId = template.id

  const project = await act(ada, 'project.create', { title: 'Physics' })
  projectId = project.body.id as string
  // deck.create takes its template from the project, so the lecture is moved
  // onto the authored one deliberately — which also pins it.
  const deck = await act(ada, 'deck.create', { projectId, title: 'Waves' })
  deckId = deck.body.id as string
  const switched = await act(ada, 'deck.switchTemplate', { deckId, templateId })
  expect(switched.status).toBe(200)
  await SlideModel.create({
    deckId,
    index: 0,
    layoutType: 'content',
    slots: {
      title: { kind: 'text', value: 'Standing waves' },
      body: { kind: 'text', value: 'A wave that stays in place.' },
    },
  })
})

describe('pinning', () => {
  it('pins a lecture to its template at creation', async () => {
    const deck = await DeckModel.findById(deckId)
    expect(deck!.templateVersionId).toBeTruthy()
    expect(await TemplateVersionModel.countDocuments({ templateId })).toBe(1)
  })

  it('shares one version between lectures on the same template', async () => {
    const other = await act(ada, 'deck.create', { projectId, title: 'Optics' })
    await act(ada, 'deck.switchTemplate', {
      deckId: other.body.id,
      templateId,
    })
    expect(await TemplateVersionModel.countDocuments({ templateId })).toBe(1)
  })

  it('does not change a lecture when its template is edited', async () => {
    await editTemplate(layouts => {
      renameSlot(contentLayout(layouts), 'title', 'heading')
      return layouts
    })
    // The whole point: the lecture is still drawn with what it pinned.
    const deck = await DeckModel.findById(deckId)
    const version = await TemplateVersionModel.findById(deck!.templateVersionId)
    const layout = version!.layouts.find(l => l.type === 'content')!
    expect(layout.slots.map(s => s.name)).toContain('title')
    expect(layout.slots.map(s => s.name)).not.toContain('heading')
  })

  it('pins the new template when the lecture switches to one', async () => {
    const before = (await DeckModel.findById(deckId))!.templateVersionId
    await act(ada, 'deck.switchTemplate', { deckId, templateId: builtinId() })
    const after = (await DeckModel.findById(deckId))!.templateVersionId
    expect(after).toBeTruthy()
    expect(after).not.toBe(before)
  })

  it('backfills a lecture written before versions existed', async () => {
    await DeckModel.updateOne(
      { _id: deckId },
      { $unset: { templateVersionId: 1 } },
    )
    expect(await backfillTemplateVersions()).toBe(1)
    expect((await DeckModel.findById(deckId))!.templateVersionId).toBeTruthy()
    // Idempotent: a second pass finds nothing left to do.
    expect(await backfillTemplateVersions()).toBe(0)
  })
})

describe('what the viewer is served', () => {
  it('renders a lecture with the structure it pinned, not the latest', async () => {
    // The regression this exists for: the viewer draws from
    // DeckViewResponse.template, so resolving that live would restructure
    // lectures the moment their template was edited — exactly what pinning
    // is meant to prevent, and invisible to every other test.
    await editTemplate(layouts => {
      renameSlot(contentLayout(layouts), 'body', 'prose')
      return layouts
    })
    const res = await act(ada, 'deck.get', { deckId })
    expect(res.status).toBe(200)
    const layout = (res.body.template.layouts as Layout[]).find(
      l => l.type === 'content',
    )!
    expect(layout.slots.map(s => s.name)).toContain('body')
    expect(layout.slots.map(s => s.name)).not.toContain('prose')
  })

  it('serves the latest structure once the update is applied', async () => {
    await editTemplate(layouts => {
      renameSlot(contentLayout(layouts), 'body', 'prose')
      return layouts
    })
    await act(ada, 'deck.applyTemplateUpdate', { deckId })
    const res = await act(ada, 'deck.get', { deckId })
    const layout = (res.body.template.layouts as Layout[]).find(
      l => l.type === 'content',
    )!
    expect(layout.slots.map(s => s.name)).toContain('prose')
  })
})

describe('the update notice', () => {
  it('reports nothing while the template is untouched', async () => {
    const res = await act(ada, 'deck.templateUpdateStatus', { deckId })
    expect(res.body.available).toBe(false)
    expect(res.body.affectedSlides).toBe(0)
  })

  it('reports an update with nothing to adjust for a cosmetic edit', async () => {
    await act(ada, 'template.update', {
      templateId,
      name: template.name,
      renderMode: template.renderMode,
      theme: { ...template.theme, background: '#101010' },
      layouts: template.layouts,
    })
    const res = await act(ada, 'deck.templateUpdateStatus', { deckId })
    expect(res.body.available).toBe(true)
    expect(res.body.impact).toEqual([])
    expect(res.body.affectedSlides).toBe(0)
  })

  it('names the boxes whose content would need re-placing', async () => {
    await editTemplate(layouts => {
      dropSlot(contentLayout(layouts), 'body')
      return layouts
    })
    const res = await act(ada, 'deck.templateUpdateStatus', { deckId })
    expect(res.body.available).toBe(true)
    expect(res.body.affectedSlides).toBe(1)
    const impact = res.body.impact.find(
      (i: { layoutType: string }) => i.layoutType === 'content',
    )
    // The author-facing label, not the raw slot name.
    expect(impact.unplaced).toHaveLength(1)
    expect(impact.slideCount).toBe(1)
  })

  it('stays quiet about a removed box no slide fills', async () => {
    await SlideModel.updateOne(
      { deckId },
      { $set: { slots: { title: { kind: 'text', value: 'Standing waves' } } } },
    )
    await editTemplate(layouts => {
      dropSlot(contentLayout(layouts), 'body')
      return layouts
    })
    const res = await act(ada, 'deck.templateUpdateStatus', { deckId })
    expect(res.body.available).toBe(true)
    expect(res.body.affectedSlides).toBe(0)
  })
})

describe('applying the update', () => {
  it('carries content onto a renamed box', async () => {
    await editTemplate(layouts => {
      renameSlot(contentLayout(layouts), 'body', 'prose')
      return layouts
    })
    const res = await act(ada, 'deck.applyTemplateUpdate', { deckId })
    expect(res.status).toBe(200)

    const slide = await SlideModel.findOne({ deckId })
    expect(slide!.slots!.prose).toEqual({
      kind: 'text',
      value: 'A wave that stays in place.',
    })
  })

  it('keeps unplaced content on the slide rather than deleting it', async () => {
    // The promise the confirmation dialog makes.
    await editTemplate(layouts => {
      dropSlot(contentLayout(layouts), 'body')
      return layouts
    })
    await act(ada, 'deck.applyTemplateUpdate', { deckId })

    const slide = await SlideModel.findOne({ deckId })
    expect(slide!.slots!.body).toEqual({
      kind: 'text',
      value: 'A wave that stays in place.',
    })
  })

  it('repins the lecture so the notice clears', async () => {
    await editTemplate(layouts => {
      contentLayout(layouts).label = 'Body copy'
      return layouts
    })
    const before = (await DeckModel.findById(deckId))!.templateVersionId
    await act(ada, 'deck.applyTemplateUpdate', { deckId })
    const after = (await DeckModel.findById(deckId))!.templateVersionId
    expect(after).not.toBe(before)

    const res = await act(ada, 'deck.templateUpdateStatus', { deckId })
    expect(res.body.available).toBe(false)
  })

  it('refuses when there is no update to apply', async () => {
    const res = await act(ada, 'deck.applyTemplateUpdate', { deckId })
    expect(res.status).toBe(400)
  })

  it('leaves a slide alone when its layout was removed', async () => {
    await editTemplate(layouts => layouts.filter(l => l.type !== 'content'))
    const status = await act(ada, 'deck.templateUpdateStatus', { deckId })
    expect(
      status.body.impact.find(
        (i: { layoutType: string }) => i.layoutType === 'content',
      ).layoutRemoved,
    ).toBe(true)

    await act(ada, 'deck.applyTemplateUpdate', { deckId })
    const slide = await SlideModel.findOne({ deckId })
    // Content and layout name both survive: the system does not pick a
    // replacement layout on the user's behalf.
    expect(slide!.layoutType).toBe('content')
    expect(slide!.slots!.title).toEqual({
      kind: 'text',
      value: 'Standing waves',
    })
  })

  it('refuses a lecture the caller cannot edit', async () => {
    const bob = await registerUser('bob@example.com')
    await editTemplate(layouts => {
      contentLayout(layouts).label = 'Body copy'
      return layouts
    })
    const res = await act(bob, 'deck.applyTemplateUpdate', { deckId })
    expect(res.status).toBe(403)
  })
})
