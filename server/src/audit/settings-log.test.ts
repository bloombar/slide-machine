/**
 * Unit tests for the settings change logger: logSettingsChange persists
 * the full entry shape and never throws, and recordSettingsChange turns
 * two snapshots into one entry — skipping the write, and the actor
 * lookup, when nothing changed. The models are mocked; the real DB path
 * is covered by the settings-log integration tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logSettingsChange, recordSettingsChange } from './settings-log'
import { SettingsChangeLogModel } from '../models/settings-change-log'
import { UserModel } from '../models/user'

vi.mock('../models/settings-change-log', () => ({
  SettingsChangeLogModel: { create: vi.fn() },
}))
vi.mock('../models/user', () => ({
  UserModel: { findById: vi.fn() },
}))

const create = vi.mocked(SettingsChangeLogModel.create)
const findById = vi.mocked(UserModel.findById)

/** The shared identity fields every recordSettingsChange call carries. */
const target = {
  actorId: 'a1',
  actorRole: 'owner',
  entityType: 'project',
  entityId: 'p1',
  entityName: 'Physics',
  ownerId: 'u1',
} as const

beforeEach(() => {
  create.mockReset()
  create.mockResolvedValue({} as never)
  findById.mockReset()
  findById.mockReturnValue(
    Promise.resolve({ email: 'ada@example.com' }) as never,
  )
})

describe('logSettingsChange', () => {
  it('persists the full entry shape', async () => {
    await logSettingsChange({
      actorId: 'a1',
      actorEmail: 'ada@example.com',
      actorRole: 'admin',
      entityType: 'user',
      entityId: 'u1',
      entityName: 'ada@example.com',
      ownerId: 'u1',
      changes: { locale: { from: 'en', to: 'fr' } },
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({
      actorId: 'a1',
      actorEmail: 'ada@example.com',
      actorRole: 'admin',
      entityType: 'user',
      entityId: 'u1',
      entityName: 'ada@example.com',
      ownerId: 'u1',
      changes: { locale: { from: 'en', to: 'fr' } },
    })
  })

  it('resolves and reports to the console when the write fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    create.mockRejectedValue(new Error('mongo down'))
    await expect(
      logSettingsChange({
        actorId: 'a1',
        actorEmail: 'ada@example.com',
        actorRole: 'owner',
        entityType: 'deck',
        entityId: 'd1',
        ownerId: 'u1',
        changes: { title: { from: 'A', to: 'B' } },
      }),
    ).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith(
      'settings log write failed',
      expect.any(Error),
    )
    consoleError.mockRestore()
  })
})

describe('recordSettingsChange', () => {
  it('records only the fields that changed', async () => {
    await recordSettingsChange({
      ...target,
      before: { language: 'en', ttsVoice: 'alloy' },
      after: { language: 'fr', ttsVoice: 'alloy' },
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'p1',
        entityName: 'Physics',
        ownerId: 'u1',
        changes: { language: { from: 'en', to: 'fr' } },
      }),
    )
  })

  it('writes nothing, and looks nothing up, when the edit changed nothing', async () => {
    await recordSettingsChange({
      ...target,
      before: { language: 'en' },
      after: { language: 'en' },
    })
    expect(create).not.toHaveBeenCalled()
    expect(findById).not.toHaveBeenCalled()
  })

  it("snapshots the actor's email, looking it up only when needed", async () => {
    await recordSettingsChange({
      ...target,
      before: { language: 'en' },
      after: { language: 'fr' },
    })
    expect(findById).toHaveBeenCalledWith('a1')
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ actorEmail: 'ada@example.com' }),
    )
  })

  it('trusts a caller that already knows the email, sparing the lookup', async () => {
    await recordSettingsChange({
      ...target,
      actorEmail: 'admin@example.com',
      before: { language: 'en' },
      after: { language: 'fr' },
    })
    expect(findById).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ actorEmail: 'admin@example.com' }),
    )
  })

  it('still records the change when the actor account has gone', async () => {
    findById.mockReturnValue(Promise.resolve(null) as never)
    await recordSettingsChange({
      ...target,
      before: { language: 'en' },
      after: { language: 'fr' },
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ actorEmail: '' }),
    )
  })

  it('normalizes a cleared setting to null rather than dropping it', async () => {
    await recordSettingsChange({
      ...target,
      before: { language: 'fr' },
      after: { language: undefined },
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { language: { from: 'fr', to: null } },
      }),
    )
  })
})
