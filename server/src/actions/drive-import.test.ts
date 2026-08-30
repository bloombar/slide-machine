/**
 * Unit tests for the mock Drive the fallback picker browses (EXP-3/EXP-4).
 *
 * The listing itself is fabricated, so what is worth pinning is the boundary:
 * live, this must refuse rather than answer. A live deployment that reached it
 * has a client which failed to open Google's Picker, and a fabricated tree
 * would offer files and folders that do not exist — a failure that looks
 * exactly like success until someone imports one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { isLive, googleLive } = vi.hoisted(() => ({
  isLive: vi.fn(),
  googleLive: vi.fn(),
}))
vi.mock('../lib/export-mode', () => ({ isLive, googleLive }))

import { driveImportables } from './drive-import'
import { quizDriveFolders } from './quiz'
import type { ActionContext } from './context'

const ctx: ActionContext = {
  userId: '507f1f77bcf86cd799439011',
  requestId: 'test-request',
}
const access = {
  userId: ctx.userId!,
  googleUser: { googleQuizRefreshToken: 'stored' },
} as never

beforeEach(() => {
  isLive.mockReset()
  googleLive.mockReset()
})

describe('drive.importables', () => {
  it('lists the mock tree when there is no Google to ask', async () => {
    googleLive.mockReturnValue(false)
    const root = await driveImportables.execute(ctx, {}, access)
    expect(root.folders.map(f => f.name)).toEqual(['Courses'])
    expect(root.files.map(f => f.name)).toEqual(['Rainwater Harvesting'])

    const inner = await driveImportables.execute(
      ctx,
      { parentId: 'folder-courses' },
      access,
    )
    expect(inner.files.map(f => f.name)).toContain('Seminar slides.pptx')
  })

  it('is empty for a folder the mock tree does not know', async () => {
    googleLive.mockReturnValue(false)
    expect(
      await driveImportables.execute(ctx, { parentId: 'nowhere' }, access),
    ).toEqual({ folders: [], files: [] })
  })

  it('refuses live, where the Picker is the browser', async () => {
    googleLive.mockReturnValue(true)
    await expect(driveImportables.execute(ctx, {}, access)).rejects.toThrow(
      /Google Picker/i,
    )
  })
})

describe('quiz.driveFolders', () => {
  it('lists the mock folder tree when there is no Google to ask', async () => {
    googleLive.mockReturnValue(false)
    const { folders } = await quizDriveFolders.execute(ctx, {}, access)
    expect(folders.map(f => f.name)).toContain('Quizzes')
  })

  it('refuses live, where the Picker is the browser', async () => {
    googleLive.mockReturnValue(true)
    await expect(quizDriveFolders.execute(ctx, {}, access)).rejects.toThrow(
      /Google Picker/i,
    )
  })
})
