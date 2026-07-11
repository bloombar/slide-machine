/**
 * Integration tests for the core models: unique indexes, TTL index
 * existence, and DTO mapper roundtrips against a real MongoDB.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { UserModel, toUserDto } from '../../src/models/user'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { ProjectModel, toProjectDto } from '../../src/models/project'
import { DeckModel, toDeckDto } from '../../src/models/deck'
import { SlideModel, toSlideDto } from '../../src/models/slide'

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  // Ensure unique indexes exist before tests that rely on them
  await Promise.all([
    UserModel.init(),
    RefreshTokenModel.init(),
    ProjectModel.init(),
    DeckModel.init(),
    SlideModel.init(),
  ])
})

afterAll(async () => {
  await disconnectMongo()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
  ])
})

describe('User model', () => {
  it('lowercases email, applies defaults, and maps to a SafeUser DTO', async () => {
    const doc = await UserModel.create({
      email: 'Ada@Example.COM',
      displayName: 'Ada',
      passwordHash: 'hash',
    })
    expect(doc.email).toBe('ada@example.com')

    const dto = toUserDto(doc)
    expect(dto).toMatchObject({
      email: 'ada@example.com',
      displayName: 'Ada',
      emailVerified: false,
      locale: 'en',
      planTier: 'free',
    })
    expect(dto).not.toHaveProperty('passwordHash')
    expect(new Date(dto.createdAt).getTime()).toBeGreaterThan(0)
  })

  it('enforces unique email, case-insensitively via lowercasing', async () => {
    await UserModel.create({ email: 'a@b.com', displayName: 'One' })
    await expect(
      UserModel.create({ email: 'A@B.com', displayName: 'Two' }),
    ).rejects.toMatchObject({ code: 11000 })
  })

  it('does not select passwordHash by default', async () => {
    await UserModel.create({
      email: 'a@b.com',
      displayName: 'A',
      passwordHash: 'h',
    })
    const plain = await UserModel.findOne({ email: 'a@b.com' })
    expect(plain?.passwordHash).toBeUndefined()
    const withHash = await UserModel.findOne({ email: 'a@b.com' }).select(
      '+passwordHash',
    )
    expect(withHash?.passwordHash).toBe('h')
  })
})

describe('RefreshToken model', () => {
  it('has a TTL index on expiresAt and a unique tokenHash index', async () => {
    const indexes = await RefreshTokenModel.collection.indexes()
    const ttl = indexes.find(i => i.key.expiresAt === 1)
    expect(ttl?.expireAfterSeconds).toBe(0)
    const hash = indexes.find(i => i.key.tokenHash === 1)
    expect(hash?.unique).toBe(true)
  })
})

describe('Deck and Slide models', () => {
  it('roundtrips through DTO mappers matching shared-type shapes', async () => {
    const ownerId = new Types.ObjectId()
    const project = await ProjectModel.create({ ownerId, title: 'Bio 101' })
    const deck = await DeckModel.create({
      projectId: project._id,
      ownerId,
      title: 'Lecture 1',
      templateId: 'classic',
      permalinkSlug: 'lecture-1-abc',
    })
    const slide = await SlideModel.create({
      deckId: deck._id,
      index: 0,
      layoutType: 'title',
      title: 'Photosynthesis',
    })

    expect(toProjectDto(project)).toMatchObject({
      title: 'Bio 101',
      ownerId: ownerId.toString(),
    })
    expect(toDeckDto(deck)).toMatchObject({
      title: 'Lecture 1',
      visibility: 'public',
      viewers: [],
      editors: [],
      voteScore: 0,
      slideOrder: [],
      projectId: project._id.toString(),
    })
    expect(toSlideDto(slide)).toMatchObject({
      deckId: deck._id.toString(),
      index: 0,
      layoutType: 'title',
      title: 'Photosynthesis',
    })
  })

  it('enforces unique permalink slugs', async () => {
    const base = {
      projectId: new Types.ObjectId(),
      ownerId: new Types.ObjectId(),
      title: 'D',
      templateId: 't',
    }
    await DeckModel.create({ ...base, permalinkSlug: 'same-slug' })
    await expect(
      DeckModel.create({ ...base, permalinkSlug: 'same-slug' }),
    ).rejects.toMatchObject({ code: 11000 })
  })
})
