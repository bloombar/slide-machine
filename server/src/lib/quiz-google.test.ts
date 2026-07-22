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
  clientForRefreshToken: (t: string) => ({ token: t }),
}))

import { listDriveFoldersLive, publishQuizLive } from './quiz-google'

const def: QuizDefinition = {
  title: 'Photosynthesis',
  questions: [
    {
      question: 'Where?',
      choices: ['Chloroplasts', 'Nucleus'],
      correctIndex: 0,
    },
  ],
}

beforeEach(() => createForm.mockReset())

describe('quiz-google (live)', () => {
  it('offers My Drive as the only destination (drive.file limit)', async () => {
    expect(await listDriveFoldersLive()).toEqual([
      { id: 'root', name: 'My Drive' },
    ])
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
    expect(options.auth).toEqual({ token: 'refresh-tok' })
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
})
