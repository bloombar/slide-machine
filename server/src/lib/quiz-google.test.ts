/**
 * Unit tests for the live Google publishing service: creating the real Form
 * via the (mocked) Quiz Generator library with an authorized client, and
 * trashing it again. Nothing here browses Drive — the app holds only
 * `drive.file`, so the destination folder arrives from Google's Picker.
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
  // Shared with the import path since a dead connection must report itself
  // the same way on both — one helper, so it cannot drift.
  accessTokenFor: async (t: string) => `access-${t}`,
}))

import { publishQuizLive, deleteQuizLive } from './quiz-google'

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
