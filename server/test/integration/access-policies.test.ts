/**
 * The access policy vocabulary (SPEC TECH-14), against a real MongoDB.
 *
 * These are the repo's first direct assertions on ActionForbiddenError — the
 * rules they cover were previously only ever exercised through an HTTP status
 * on some action that happened to use them. Testing the constructors directly
 * means the *rule* is pinned once, rather than re-tested per action that
 * borrows it, and that the invariants below hold for every future caller:
 *
 *   - a missing resource and a forbidden one refuse identically, so an id
 *     cannot be probed to learn whether the thing behind it exists;
 *   - editor and viewer are genuinely different — the gap the existing suite
 *     is thinnest on, and the one a mis-transcribed policy would fall into;
 *   - an anonymous caller is refused with one canonical message.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { ActionForbiddenError } from '../../src/actions/dispatch'
import {
  deckEditor,
  deckViewer,
  deckOwner,
  projectOwner,
  projectMember,
  slideEditor,
  self,
  signedIn,
  open,
  custom,
} from '../../src/actions/access'
import type { ActionContext } from '../../src/actions/context'

const ctxFor = (userId?: string): ActionContext => ({
  userId,
  requestId: 'access-policy-test',
})

/** A well-formed id that addresses nothing. */
const ABSENT = '507f1f77bcf86cd799439011'

let ada: string
let bob: string
let cleo: string
let projectId: string
let deckId: string
let slideId: string

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
    RefreshTokenModel.deleteMany({}),
  ])
  const users = await UserModel.create([
    { email: 'ada@example.com', displayName: 'Ada', emailVerified: true },
    { email: 'bob@example.com', displayName: 'Bob', emailVerified: true },
    { email: 'cleo@example.com', displayName: 'Cleo', emailVerified: true },
  ])
  ada = users[0]!._id.toString()
  bob = users[1]!._id.toString()
  cleo = users[2]!._id.toString()

  // Ada owns a restricted project; cleo may view her lecture, bob is a
  // stranger. Editors are granted on the lecture itself so the two levels
  // are genuinely distinguishable.
  const project = await ProjectModel.create({
    ownerId: ada,
    title: 'Bio',
    visibility: 'restricted',
    viewers: [],
    editors: [],
  })
  projectId = project._id.toString()

  const deck = await DeckModel.create({
    ownerId: ada,
    projectId: project._id,
    title: 'Photosynthesis',
    templateId: 'classic',
    permalinkSlug: 'photosynthesis-abcd1234',
    slideOrder: [],
    accessOverride: { visibility: 'restricted', viewers: [cleo], editors: [] },
  })
  deckId = deck._id.toString()

  const slide = await SlideModel.create({
    deckId: deck._id,
    index: 0,
    layoutType: 'title-body',
    slots: {},
  })
  slideId = slide._id.toString()
})

const pickDeck = (i: { deckId: string }) => i.deckId

describe('deckEditor', () => {
  const policy = deckEditor(pickDeck)

  it('admits the owner and hands back the lecture and its ACL', async () => {
    const access = await policy.authorize(ctxFor(ada), { deckId })
    expect(access.userId).toBe(ada)
    expect(access.deck._id.toString()).toBe(deckId)
    expect(access.acl.ownerId).toBe(ada)
  })

  it('admits someone the lecture was shared with for editing', async () => {
    await DeckModel.updateOne(
      { _id: deckId },
      { 'accessOverride.editors': [bob] },
    )
    await expect(
      policy.authorize(ctxFor(bob), { deckId }),
    ).resolves.toMatchObject({ userId: bob })
  })

  // The distinction a mis-transcribed policy would erase.
  it('refuses a viewer', async () => {
    await expect(
      policy.authorize(ctxFor(cleo), { deckId }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })

  it('refuses a stranger', async () => {
    await expect(
      policy.authorize(ctxFor(bob), { deckId }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })

  it('refuses an anonymous caller with the one canonical message', async () => {
    await expect(policy.authorize(ctxFor(), { deckId })).rejects.toThrow(
      'Sign in to continue',
    )
  })

  // The no-existence-leak invariant, asserted on the rule rather than on
  // whichever action happens to use it.
  it('answers a missing lecture exactly as it answers a forbidden one', async () => {
    const missing = await policy
      .authorize(ctxFor(bob), { deckId: ABSENT })
      .catch((e: Error) => e)
    const forbidden = await policy
      .authorize(ctxFor(bob), { deckId })
      .catch((e: Error) => e)
    expect((missing as Error).constructor).toBe(
      (forbidden as Error).constructor,
    )
    expect((missing as Error).message).toBe((forbidden as Error).message)
  })

  it('refuses a malformed id the same way, without throwing a cast error', async () => {
    await expect(
      policy.authorize(ctxFor(ada), { deckId: 'not-an-id' }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })
})

describe('deckViewer', () => {
  const policy = deckViewer(pickDeck)

  it('admits a listed viewer, where deckEditor would not', async () => {
    await expect(
      policy.authorize(ctxFor(cleo), { deckId }),
    ).resolves.toMatchObject({ userId: cleo })
  })

  it('refuses a stranger while the lecture is restricted', async () => {
    await expect(
      policy.authorize(ctxFor(bob), { deckId }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })

  it('admits anyone once the lecture is public', async () => {
    await DeckModel.updateOne(
      { _id: deckId },
      { 'accessOverride.visibility': 'public' },
    )
    await expect(
      policy.authorize(ctxFor(bob), { deckId }),
    ).resolves.toMatchObject({ userId: bob })
  })
})

describe('deckOwner', () => {
  const policy = deckOwner(pickDeck)

  it('admits the owner', async () => {
    await expect(
      policy.authorize(ctxFor(ada), { deckId }),
    ).resolves.toMatchObject({ userId: ada })
  })

  // Stricter than deckEditor on purpose: deleting a lecture or handing it on
  // is not something an editor may do.
  it('refuses an editor', async () => {
    await DeckModel.updateOne(
      { _id: deckId },
      { 'accessOverride.editors': [bob] },
    )
    await expect(
      policy.authorize(ctxFor(bob), { deckId }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })
})

describe('deck ACL inheritance', () => {
  it('follows the project when the lecture has no override of its own', async () => {
    await DeckModel.updateOne(
      { _id: deckId },
      { $unset: { accessOverride: 1 } },
    )
    await ProjectModel.updateOne({ _id: projectId }, { editors: [bob] })
    const access = await deckEditor(pickDeck).authorize(ctxFor(bob), { deckId })
    expect(access.acl.inherited).toBe(true)
  })

  it('stops following it once the lecture has one', async () => {
    await ProjectModel.updateOne({ _id: projectId }, { editors: [bob] })
    await expect(
      deckEditor(pickDeck).authorize(ctxFor(bob), { deckId }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })
})

describe('slideEditor', () => {
  const policy = slideEditor((i: { slideId: string }) => i.slideId)

  it('admits an editor of the slide’s lecture, and returns both', async () => {
    const access = await policy.authorize(ctxFor(ada), { slideId })
    expect(access.slide._id.toString()).toBe(slideId)
    expect(access.deck._id.toString()).toBe(deckId)
  })

  it('refuses a viewer of that lecture', async () => {
    await expect(
      policy.authorize(ctxFor(cleo), { slideId }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })

  it('refuses a missing slide the same way as a forbidden one', async () => {
    await expect(
      policy.authorize(ctxFor(ada), { slideId: ABSENT }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })

  // A slide whose lecture is gone is unreachable, not a crash.
  it('refuses when the lecture behind the slide is missing', async () => {
    await DeckModel.deleteOne({ _id: deckId })
    await expect(
      policy.authorize(ctxFor(ada), { slideId }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })
})

describe('project policies', () => {
  const pick = (i: { projectId: string }) => i.projectId

  it('projectOwner admits the owner and refuses an editor', async () => {
    await expect(
      projectOwner(pick).authorize(ctxFor(ada), { projectId }),
    ).resolves.toMatchObject({ userId: ada })
    await ProjectModel.updateOne({ _id: projectId }, { editors: [bob] })
    await expect(
      projectOwner(pick).authorize(ctxFor(bob), { projectId }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })

  // isAclMember ignores public deliberately: "public" says the CONTENT is
  // readable, not that the project's management data is open to strangers.
  it('projectMember refuses a stranger even when the project is public', async () => {
    await ProjectModel.updateOne({ _id: projectId }, { visibility: 'public' })
    await expect(
      projectMember(pick).authorize(ctxFor(bob), { projectId }),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })

  it('projectMember admits a listed viewer', async () => {
    await ProjectModel.updateOne({ _id: projectId }, { viewers: [cleo] })
    await expect(
      projectMember(pick).authorize(ctxFor(cleo), { projectId }),
    ).resolves.toMatchObject({ userId: cleo })
  })
})

describe('policies that name no resource', () => {
  it('self loads the acting account', async () => {
    const access = await self().authorize(ctxFor(ada), {})
    expect(access.user._id.toString()).toBe(ada)
  })

  it('self refuses when the account is gone but the token is not', async () => {
    await UserModel.deleteOne({ _id: ada })
    await expect(self().authorize(ctxFor(ada), {})).rejects.toBeInstanceOf(
      ActionForbiddenError,
    )
  })

  it('signedIn admits any account and refuses none', async () => {
    await expect(signedIn().authorize(ctxFor(bob), {})).resolves.toEqual({
      userId: bob,
    })
    await expect(signedIn().authorize(ctxFor(), {})).rejects.toBeInstanceOf(
      ActionForbiddenError,
    )
  })

  it('open admits an anonymous caller', async () => {
    await expect(open().authorize(ctxFor(), {})).resolves.toBeUndefined()
  })

  // Escaping the vocabulary is not escaping the need to be signed in.
  it('custom carries its reason and still requires a caller', async () => {
    const policy = custom('the Mongo filter is the authorization')
    expect(policy.descriptor.custom?.reason).toContain('filter')
    await expect(policy.authorize(ctxFor(ada), {})).resolves.toEqual({
      userId: ada,
    })
    await expect(policy.authorize(ctxFor(), {})).rejects.toBeInstanceOf(
      ActionForbiddenError,
    )
  })
})
