/**
 * Unit tests for the live Google publishing service: folder options under the
 * drive.file limitation, and creating the real Form via the (mocked) Quiz
 * Generator library with an authorized client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { QuizDefinition } from '@slide-machine/shared'

const { createForm } = vi.hoisted(() => ({ createForm: vi.fn() }))
vi.mock('google-forms-quiz-tool', () => ({
  createGoogleFormFromQuiz: createForm,
}))
vi.mock('../auth/google-connect', () => ({
  clientForRefreshToken: (t: string) => ({
    token: t,
    getAccessToken: async () => ({ token: `access-${t}` }),
  }),
}))

import {
  listDriveFoldersLive,
  createDriveFolderLive,
  publishQuizLive,
  deleteQuizLive,
} from './quiz-google'

const def: QuizDefinition = {
  title: 'Photosynthesis',
  questions: [
    {
      type: 'single_choice',
      question: 'Where?',
      choices: ['Chloroplasts', 'Nucleus'],
      correctIndex: 0,
    },
  ],
}

beforeEach(() => createForm.mockReset())

describe('quiz-google (live)', () => {
  it('lists the sub-folders inside the given parent (folders only)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        files: [
          { id: 'f1', name: 'Quizzes' },
          { id: 'f2', name: 'Exit Tickets' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const folders = await listDriveFoldersLive('refresh-tok', 'parent-1')
      expect(folders).toEqual([
        { id: 'f1', name: 'Quizzes' },
        { id: 'f2', name: 'Exit Tickets' },
      ])
      // The query scopes to that parent and to folders, with an access token.
      const [url, init] = fetchMock.mock.calls[0]!
      const q = decodeURIComponent(String(url)).replace(/\+/g, ' ')
      expect(String(url)).toContain('/drive/v3/files')
      expect(q).toContain("'parent-1' in parents")
      expect(q).toContain('folder')
      expect(init.headers.Authorization).toBe('Bearer access-refresh-tok')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('defaults to My Drive root and returns empty when there are none', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    try {
      expect(await listDriveFoldersLive('t')).toEqual([])
      const q = decodeURIComponent(String(fetchMock.mock.calls[0]![0])).replace(
        /\+/g,
        ' ',
      )
      expect(q).toContain("'root' in parents")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('throws when the Drive folder list request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    )
    try {
      await expect(listDriveFoldersLive('t')).rejects.toThrow(
        /folder list failed \(500\)/,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('creates a Drive folder in root and returns its id and name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'new-folder', name: 'Week 5' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const folder = await createDriveFolderLive('refresh-tok', 'Week 5')
      expect(folder).toEqual({ id: 'new-folder', name: 'Week 5' })
      const [url, init] = fetchMock.mock.calls[0]!
      expect(String(url)).toContain('/drive/v3/files')
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer access-refresh-tok')
      const body = JSON.parse(String(init.body))
      expect(body.name).toBe('Week 5')
      expect(body.mimeType).toBe('application/vnd.google-apps.folder')
      // Root is the implicit parent, so none is pinned.
      expect(body.parents).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('pins the parent when creating a folder inside a sub-folder', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'nested', name: 'Week 5' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await createDriveFolderLive('t', 'Week 5', 'parent-1')
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      expect(body.parents).toEqual(['parent-1'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('throws when the Drive folder create fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    )
    try {
      await expect(createDriveFolderLive('t', 'x')).rejects.toThrow(
        /folder create failed \(403\)/,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('creates the form and returns its shareable URL', async () => {
    createForm.mockResolvedValue({
      formId: 'F1',
      responderUri: 'https://docs.google.com/forms/d/F1/viewform',
    })
    const res = await publishQuizLive(def, 'refresh-tok', 'root')
    expect(res).toEqual({
      formId: 'F1',
      formUrl: 'https://docs.google.com/forms/d/F1/viewform',
    })
    // The generated quiz is passed in the library's shape; 'root' → no move
    const [quiz, options] = createForm.mock.calls[0]!
    expect(quiz).toMatchObject({ version: 1, title: 'Photosynthesis' })
    expect(options.folderId).toBeUndefined()
    expect(options.auth).toMatchObject({ token: 'refresh-tok' })
  })

  it('passes a non-root folder id through to the library', async () => {
    createForm.mockResolvedValue({ formId: 'F2', responderUri: 'u' })
    await publishQuizLive(def, 't', 'folder-123')
    expect(createForm.mock.calls[0]![1].folderId).toBe('folder-123')
  })

  it('throws when Google returns no form URL', async () => {
    createForm.mockResolvedValue({ formId: 'F3' })
    await expect(publishQuizLive(def, 't', 'root')).rejects.toThrow(
      /no form URL/,
    )
  })

  it('trashes the form in Drive with an access token (delete)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await deleteQuizLive('F1', 'refresh-tok')
      const [url, init] = fetchMock.mock.calls[0]!
      expect(String(url)).toContain('/drive/v3/files/F1')
      expect(init.method).toBe('PATCH')
      expect(init.headers.Authorization).toBe('Bearer access-refresh-tok')
      expect(JSON.parse(String(init.body))).toEqual({ trashed: true })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('throws when Drive rejects the trash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    )
    try {
      await expect(deleteQuizLive('F1', 't')).rejects.toThrow(
        /Drive trash failed \(403\)/,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
