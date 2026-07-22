/**
 * Unit tests for logAdminAction: persists the full entry shape and never
 * throws when the write fails. The model is mocked; the real DB path is
 * covered by the admin-logs integration tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logAdminAction } from './log'
import { AdminActionLogModel } from '../models/admin-action-log'

vi.mock('../models/admin-action-log', () => ({
  AdminActionLogModel: { create: vi.fn() },
}))

const create = vi.mocked(AdminActionLogModel.create)

beforeEach(() => {
  create.mockReset()
})

describe('logAdminAction', () => {
  it('persists the full entry shape', async () => {
    create.mockResolvedValue({} as never)
    await logAdminAction({
      actorId: 'a1',
      actorEmail: 'admin@example.com',
      action: 'user.delete',
      targetType: 'user',
      targetId: 'u1',
      details: { reason: 'spam' },
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({
      actorId: 'a1',
      actorEmail: 'admin@example.com',
      action: 'user.delete',
      targetType: 'user',
      targetId: 'u1',
      details: { reason: 'spam' },
    })
  })

  it('resolves and reports to the console when the write fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    create.mockRejectedValue(new Error('mongo down'))
    await expect(
      logAdminAction({
        actorId: 'a1',
        actorEmail: 'admin@example.com',
        action: 'user.ban',
      }),
    ).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith(
      'audit log write failed',
      expect.any(Error),
    )
    consoleError.mockRestore()
  })
})
