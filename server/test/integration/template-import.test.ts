/**
 * Deriving a template from a Google Slides presentation (TMPL-8), against a
 * real MongoDB with the Google side mock-backed.
 *
 * The consolidation itself is covered by src/import/*.test.ts. This is the
 * action around it: who may call it, what it saves, and — the property that
 * matters most — that what comes out is a template the editor can open and the
 * renderer can draw, not a shape that merely typechecks.
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

// Hermetic: a developer's local EXPORT_MODE=live must not leak in — this
// suite exercises mock mode, which imports a sample deck rather than Google's.
vi.mock('../../src/config/env', async importActual => {
  const actual = await importActual<typeof import('../../src/config/env')>()
  return { ...actual, env: { ...actual.env, EXPORT_MODE: 'mock' } }
})

const { env } = await import('../../src/config/env')
const { connectMongo, disconnectMongo } = await import('../../src/db/mongoose')
const { createApp } = await import('../../src/app')
const { UserModel } = await import('../../src/models/user')
const { TemplateModel } = await import('../../src/models/template')
const { RefreshTokenModel } = await import('../../src/models/refresh-token')
const { layoutSchema } = await import('../../src/templates/builtin')

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
    TemplateModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
})

describe('template.importFromSlides (TMPL-8)', () => {
  it('refuses until a Google account is connected', async () => {
    const res = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    expect(res.status).toBe(403)
  })

  it('refuses a caller who is not signed in', async () => {
    const res = await request(server)
      .post('/api/actions/template.importFromSlides')
      .send({ presentationId: 'deck-1' })
    expect(res.status).toBe(401)
  })

  it('saves a design derived from the presentation', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    expect(res.status).toBe(200)
    expect(res.body.template.name).toBeTruthy()
    expect(res.body.template.layouts.length).toBeGreaterThan(0)

    const stored = await TemplateModel.findById(res.body.template.id)
    expect(stored).not.toBeNull()
    expect(stored!.layouts.length).toBe(res.body.template.layouts.length)
  })

  it('produces layouts the template schema accepts', async () => {
    // A template the editor cannot open would be worse than no import
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    for (const layout of res.body.template.layouts) {
      expect(layoutSchema.safeParse(layout).success).toBe(true)
    }
  })

  it('draws its layouts from their boxes, since an imported design has no tree', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    // `positioned` is what tells the renderer to draw the boxes where the
    // presentation had them rather than flow them
    expect(res.body.template.renderMode).toBe('positioned')
    for (const layout of res.body.template.layouts) {
      // The whiteboard is a blank slate with no boxes to place (TMPL-7)
      if (layout.slots.length) {
        expect(Object.keys(layout.elementPositions).length).toBe(
          layout.slots.length,
        )
      }
    }
  })

  it('offers the blank slate every template owes (TMPL-7)', async () => {
    // No presentation has one to import, so it is synthesized
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    const types = res.body.template.layouts.map((l: { type: string }) => l.type)
    expect(types).toContain('whiteboard')
  })

  it('gives back the few designs the deck is built from when asked to tidy', async () => {
    // Consolidation asserted through the action (TMPL-8). The mock deck is
    // deliberately messy — a handful of real designs rebuilt by hand with
    // jitter on every copy — so a template of one layout per slide would be
    // the near-duplicates the spec calls worse than useless.
    //
    // Asked for EXPLICITLY, because merging is the opt-in: which slides are
    // "the same design" is a judgement, and the app does not make it unless
    // the author ticks the box (`KEEP_EVERY_SLIDE_BY_DEFAULT`).
    await act(ada, 'quiz.connectGoogle')
    const { body } = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
      keepEverySlide: false,
    })
    expect(body.report.layoutsCreated).toBeLessThan(body.report.slidesRead)
    // Every design, plus the blank slate every template owes (TMPL-7)
    expect(body.template.layouts).toHaveLength(body.report.layoutsCreated + 1)
  })

  it('gives back every slide as its own layout by default', async () => {
    // The DEFAULT, asserted through the action rather than only in the unit
    // tests: the flag is deliberately not passed, so this fails if the
    // action's own schema ever stops defaulting to keeping every slide —
    // which is exactly how the two halves came to disagree before
    // (`KEEP_EVERY_SLIDE_BY_DEFAULT`).
    await act(ada, 'quiz.connectGoogle')
    const { body } = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    expect(body.report.layoutsCreated).toBe(body.report.slidesRead)
    expect(body.report.approximated).toBe(0)
    expect(body.template.layouts).toHaveLength(body.report.slidesRead + 1)
  })

  it('reports the slides it could only approximate', async () => {
    // Consolidation is lossy and this report is the only visibility into it
    await act(ada, 'quiz.connectGoogle')
    const { body } = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    expect(body.report).toMatchObject({
      slidesRead: expect.any(Number),
      layoutsCreated: expect.any(Number),
      approximated: expect.any(Number),
    })
    // ABSENT, and asserted as absent rather than as a number.
    //
    // This import fetches nothing — it is given nowhere to put a picture — so
    // there is no count to report, and reporting zero would be the same
    // answer a wholly successful fetch gives. That indistinguishability was
    // the defect; a test that accepted `any(Number)` here is evidence of it,
    // since it was written when the field could not say "not attempted".
    expect(body.report.assetsFailed).toBeUndefined()
  })

  it('arrives private, since an import is a guess the author reviews', async () => {
    await act(ada, 'quiz.connectGoogle')
    const { body } = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    expect(body.template.visibility).toBe('private')
  })

  it('is reachable at a permalink of its own', async () => {
    await act(ada, 'quiz.connectGoogle')
    const { body } = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    const res = await act(ada, 'template.get', {
      slug: body.template.permalinkSlug,
    })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(body.template.id)
  })

  it('takes a name from the caller when they gave one', async () => {
    await act(ada, 'quiz.connectGoogle')
    const { body } = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
      name: 'Physics 101',
    })
    expect(body.template.name).toBe('Physics 101')
  })

  it('shows up in the caller’s library and nobody else’s', async () => {
    await act(ada, 'quiz.connectGoogle')
    const { body } = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
      name: 'Ada’s Import',
    })
    const mine = await act(ada, 'template.list')
    expect(mine.body.map((t: { id: string }) => t.id)).toContain(
      body.template.id,
    )

    const bob = await registerUser('bob@example.com')
    const theirs = await act(bob, 'template.list')
    expect(theirs.body.map((t: { id: string }) => t.id)).not.toContain(
      body.template.id,
    )
  })

  it('rejects a presentation id that is not one', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'template.importFromSlides', {
      presentationId: '',
    })
    expect(res.status).toBe(400)
  })

  it('can be run twice without the two colliding', async () => {
    await act(ada, 'quiz.connectGoogle')
    const first = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    const second = await act(ada, 'template.importFromSlides', {
      presentationId: 'deck-1',
    })
    expect(second.status).toBe(200)
    expect(second.body.template.id).not.toBe(first.body.template.id)
    expect(second.body.template.permalinkSlug).not.toBe(
      first.body.template.permalinkSlug,
    )
  })
})
