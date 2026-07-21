/**
 * Unit tests for requireAdmin: 401 without an authenticated user, 403 for
 * unknown or non-allowlisted accounts, pass-through for admins. The user
 * lookup is mocked; the real DB path is covered by the admin integration
 * tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import { requireAdmin } from './admin'
import { UserModel } from '../models/user'
import { HttpError } from './error'

vi.mock('../models/user', () => ({
  UserModel: { findById: vi.fn() },
}))

const findById = vi.mocked(UserModel.findById)

const run = (userId?: string) => {
  const req = { userId } as Request
  const next = vi.fn() as NextFunction
  return { req, next, done: requireAdmin(req, {} as Response, next) }
}

beforeEach(() => {
  findById.mockReset()
  vi.stubEnv('ADMIN_EMAILS', 'admin@example.com')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('requireAdmin', () => {
  it('throws 401 when no userId is attached (requireAuth missing)', async () => {
    const { next, done } = run(undefined)
    await expect(done).rejects.toMatchObject({ status: 401 })
    expect(next).not.toHaveBeenCalled()
    expect(findById).not.toHaveBeenCalled()
  })

  it('throws 403 when the account no longer exists', async () => {
    findById.mockResolvedValue(null as never)
    const { next, done } = run('u1')
    await expect(done).rejects.toMatchObject({ status: 403 })
    expect(next).not.toHaveBeenCalled()
  })

  it('throws 403 for a signed-in non-admin', async () => {
    findById.mockResolvedValue({ email: 'user@example.com' } as never)
    const { next, done } = run('u1')
    const err = await done.then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 403, code: 'forbidden' })
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next for an allowlisted admin', async () => {
    findById.mockResolvedValue({ email: 'Admin@Example.com' } as never)
    const { next, done } = run('u1')
    await done
    expect(findById).toHaveBeenCalledWith('u1')
    expect(next).toHaveBeenCalledOnce()
  })
})
