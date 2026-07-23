/**
 * Unit tests for the Quiz tab (QUIZ-1..7): the connect → generate → folder
 * picker → shareable URL flow, the copy-to-clipboard button, creating a new
 * Drive folder, deleting a quiz, and the generation options — question count,
 * points, per-type counts (with the mismatch warning), email, transcript, and
 * AI instructions. The Google actions are stubbed at the fetch layer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import QuizPanel from './QuizPanel'
import { mockFetchRoutes } from '../test/fetch-mock'

const FORM_URL = 'https://docs.google.com/forms/d/e/mock-abc123/viewform'

afterEach(() => vi.unstubAllGlobals())

describe('QuizPanel', () => {
  it('prompts to connect Google, then offers to generate once connected', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: false } }),
      'quiz.connectGoogle': () => ({
        status: 200,
        body: { status: 'connected' },
      }),
    })
    render(<QuizPanel deckId="d1" />)

    const connect = await screen.findByRole('button', {
      name: 'Connect Google',
    })
    fireEvent.click(connect)

    // After connecting (mock mode), the generate button appears
    expect(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    ).toBeInTheDocument()
  })

  it('redirects to Google consent in live mode, returning to the Quiz tab', async () => {
    const consent = 'https://accounts.google.com/o/oauth2/v2/auth?x=1'
    const loc = { href: 'http://localhost:5173/d/x' }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: loc,
    })
    let connectBody: { returnTo?: string } = {}
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: false } }),
      'quiz.connectGoogle': init => {
        connectBody = JSON.parse(String(init?.body))
        return { status: 200, body: { status: 'redirect', url: consent } }
      },
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect Google' }),
    )
    await waitFor(() => expect(loc.href).toBe(consent))
    // The return URL asks the app to reopen the Quiz tab after connecting.
    expect(connectBody.returnTo).toContain('settings=quiz')
  })

  it('offers a Reconnect link when already connected (to grant new scopes)', async () => {
    const consent = 'https://accounts.google.com/o/oauth2/v2/auth?y=1'
    const loc = { href: 'http://localhost:5173/d/x' }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: loc,
    })
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.connectGoogle': () => ({
        status: 200,
        body: { status: 'redirect', url: consent },
      }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reconnect Google account' }),
    )
    await waitFor(() => expect(loc.href).toBe(consent))
  })

  it('shows an existing quiz URL and copies it to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    mockFetchRoutes({
      'quiz.status': () => ({
        status: 200,
        body: {
          googleConnected: true,
          quiz: {
            formUrl: FORM_URL,
            driveFolderName: 'Quizzes',
            publishedAt: '2026-07-20T00:00:00.000Z',
          },
        },
      }),
    })
    render(<QuizPanel deckId="d1" />)

    expect(await screen.findByText(FORM_URL)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy quiz link' }))
    expect(writeText).toHaveBeenCalledWith(FORM_URL)
    // The button flips to a copied state, then reverts after the timeout
    expect(
      await screen.findByRole('button', { name: 'Link copied' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole(
        'button',
        { name: 'Copy quiz link' },
        { timeout: 2500 },
      ),
    ).toBeInTheDocument()
  })

  it('generates a quiz, saving to My Drive by default', async () => {
    let published: unknown
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: { folders: [{ id: 'folder-quizzes', name: 'Quizzes' }] },
      }),
      'quiz.publish': init => {
        published = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            formUrl: FORM_URL,
            driveFolderName: 'My Drive',
            publishedAt: '2026-07-20T00:00:00.000Z',
          },
        }
      },
    })
    render(<QuizPanel deckId="d1" />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )

    // The finder opens at My Drive and lists its sub-folders
    const dialog = await screen.findByRole('dialog', {
      name: 'Choose a Drive folder',
    })
    expect(dialog).toBeInTheDocument()
    await screen.findByRole('button', { name: 'Quizzes' })
    // Save into the current folder (My Drive root)
    fireEvent.click(screen.getByRole('button', { name: 'Generate & save' }))

    await waitFor(() =>
      expect(published).toMatchObject({
        deckId: 'd1',
        driveFolderId: 'root',
        driveFolderName: 'My Drive',
      }),
    )
    expect(await screen.findByText(FORM_URL)).toBeInTheDocument()
  })

  it('navigates into a sub-folder and saves the quiz there', async () => {
    let published: unknown
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': init => {
        const { parentId } = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            folders:
              parentId === 'root'
                ? [{ id: 'folder-quizzes', name: 'Quizzes' }]
                : [],
          },
        }
      },
      'quiz.publish': init => {
        published = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { formUrl: FORM_URL, publishedAt: '2026-07-20T00:00:00.000Z' },
        }
      },
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    // Open the folder, then save inside it
    fireEvent.click(await screen.findByRole('button', { name: 'Quizzes' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate & save' }),
    )
    await waitFor(() =>
      expect(published).toMatchObject({
        driveFolderId: 'folder-quizzes',
        driveFolderName: 'Quizzes',
      }),
    )
  })

  it('shows an empty folder but still lets you save into it', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    await screen.findByRole('dialog', { name: 'Choose a Drive folder' })
    expect(await screen.findByText(/this folder is empty/i)).toBeInTheDocument()
    // Save is never disabled: you can always save to the current folder
    expect(
      screen.getByRole('button', { name: 'Generate & save' }),
    ).toBeEnabled()
  })

  it('shows Drive files for context alongside folders', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: {
          folders: [{ id: 'folder-quizzes', name: 'Quizzes' }],
          files: [{ id: 'file-1', name: 'Syllabus.pdf' }],
        },
      }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    // The folder is a navigable button; the file is plain context (not a button)
    expect(
      await screen.findByRole('button', { name: 'Quizzes' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Syllabus.pdf')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Syllabus.pdf' }),
    ).not.toBeInTheDocument()
  })

  it('surfaces an error when the status fails to load', async () => {
    mockFetchRoutes({ 'quiz.status': () => ({ status: 500, body: {} }) })
    render(<QuizPanel deckId="d1" />)
    expect(
      await screen.findByText(/could not load the quiz status/i),
    ).toBeInTheDocument()
  })

  it('surfaces an error when connecting Google fails', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: false } }),
      'quiz.connectGoogle': () => ({ status: 500, body: {} }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect Google' }),
    )
    expect(
      await screen.findByText(/could not connect your google account/i),
    ).toBeInTheDocument()
  })

  it('surfaces an error when the Drive folders fail to load', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 500, body: {} }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    expect(
      await screen.findByText(/could not load your drive folders/i),
    ).toBeInTheDocument()
  })

  it('surfaces an error when publishing fails', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: { folders: [{ id: 'root', name: 'My Drive' }] },
      }),
      'quiz.publish': () => ({ status: 500, body: {} }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate & save' }),
    )
    expect(
      await screen.findByText(/could not generate the quiz/i),
    ).toBeInTheDocument()
  })

  it('closes the folder picker on cancel', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: { folders: [{ id: 'root', name: 'My Drive' }] },
      }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    await screen.findByRole('dialog', { name: 'Choose a Drive folder' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Choose a Drive folder' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('creates a new Drive folder in the picker and publishes to it', async () => {
    let published: unknown
    mockFetchRoutes({
      'quiz.status': () => ({
        status: 200,
        body: { googleConnected: true, hasTranscript: false },
      }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: { folders: [{ id: 'root', name: 'My Drive' }] },
      }),
      'quiz.createFolder': init => {
        const { name } = JSON.parse(String(init?.body))
        return { status: 200, body: { id: 'folder-new', name } }
      },
      'quiz.publish': init => {
        published = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { formUrl: FORM_URL, publishedAt: '2026-07-20T00:00:00.000Z' },
        }
      },
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    // Open the new-folder input, name it, create it
    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('New folder name'), {
      target: { value: 'Week 5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    // Creating steps into the new folder (shown in the breadcrumb); save there
    await screen.findByRole('button', { name: 'Week 5' })
    fireEvent.click(screen.getByRole('button', { name: 'Generate & save' }))
    await waitFor(() =>
      expect(published).toMatchObject({
        driveFolderId: 'folder-new',
        driveFolderName: 'Week 5',
      }),
    )
  })

  it('navigates back up via the breadcrumb', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': init => {
        const { parentId } = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            folders:
              parentId === 'root'
                ? [{ id: 'folder-quizzes', name: 'Quizzes' }]
                : [{ id: 'folder-inner', name: 'Inner' }],
          },
        }
      },
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    // Into Quizzes → its child "Inner" shows
    fireEvent.click(await screen.findByRole('button', { name: 'Quizzes' }))
    await screen.findByRole('button', { name: 'Inner' })
    // Click the "My Drive" crumb to go back up; the root list returns
    fireEvent.click(screen.getByRole('button', { name: 'My Drive' }))
    expect(
      await screen.findByRole('button', { name: 'Quizzes' }),
    ).toBeInTheDocument()
  })

  it('cancels creating a new folder', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('New folder name'), {
      target: { value: 'Scratch' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel new folder' }))
    expect(screen.queryByLabelText('New folder name')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'New folder' }),
    ).toBeInTheDocument()
  })

  it('creates a folder with the Enter key, and shows an error if it fails', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
      'quiz.createFolder': () => ({ status: 500, body: {} }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }))
    const input = screen.getByLabelText('New folder name')
    fireEvent.change(input, { target: { value: 'Week 9' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(
      await screen.findByText(/could not create the folder/i),
    ).toBeInTheDocument()
  })

  it('offers to include the transcript and sends it when checked', async () => {
    let published: unknown
    mockFetchRoutes({
      'quiz.status': () => ({
        status: 200,
        body: { googleConnected: true, hasTranscript: true },
      }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: { folders: [{ id: 'root', name: 'My Drive' }] },
      }),
      'quiz.publish': init => {
        published = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { formUrl: FORM_URL, publishedAt: '2026-07-20T00:00:00.000Z' },
        }
      },
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    // The transcript option lives under Advanced settings
    fireEvent.click(
      await screen.findByRole('button', { name: 'Advanced settings' }),
    )
    const checkbox = await screen.findByRole('checkbox', {
      name: /include the spoken transcript/i,
    })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Generate & save' }))
    await waitFor(() =>
      expect(published).toMatchObject({ includeTranscript: true }),
    )
  })

  it('hides the transcript option when the lecture has no transcript', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({
        status: 200,
        body: { googleConnected: true, hasTranscript: false },
      }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: { folders: [{ id: 'root', name: 'My Drive' }] },
      }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    await screen.findByRole('dialog', { name: 'Choose a Drive folder' })
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    expect(
      screen.queryByRole('checkbox', {
        name: /include the spoken transcript/i,
      }),
    ).not.toBeInTheDocument()
  })

  it('sets question count, points, types, and instructions from the options (QUIZ-7)', async () => {
    let published: {
      questionCount?: number
      totalPoints?: number
      requireEmail?: boolean
      typeCounts?: Record<string, number>
      customInstructions?: string
    } = {}
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
      'quiz.publish': init => {
        published = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { formUrl: FORM_URL, publishedAt: '2026-07-20T00:00:00.000Z' },
        }
      },
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    fireEvent.change(await screen.findByLabelText('Number of questions'), {
      target: { value: '4' },
    })
    fireEvent.change(screen.getByLabelText('Total points'), {
      target: { value: '8' },
    })
    // Advanced: per-type counts + email + instructions
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    fireEvent.click(screen.getByLabelText(/require a verified/i))
    fireEvent.change(screen.getByLabelText('Single-choice (MCQ)'), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText('Short answer'), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText('AI instructions (optional)'), {
      target: { value: 'focus on the water cycle' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate & save' }))
    await waitFor(() =>
      expect(published).toMatchObject({
        questionCount: 4,
        totalPoints: 8,
        requireEmail: false,
        typeCounts: { single_choice: 1, short_text: 3 },
        customInstructions: 'focus on the water cycle',
      }),
    )
  })

  it('warns when the per-type counts do not match the question count', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    // Default count is 5; set the types to sum to 2
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    fireEvent.change(screen.getByLabelText('Single-choice (MCQ)'), {
      target: { value: '2' },
    })
    expect(await screen.findByText(/add up to 2, not 5/i)).toBeInTheDocument()
  })

  it('deletes an existing quiz and returns to the generate state', async () => {
    let deleted = false
    mockFetchRoutes({
      'quiz.status': () => ({
        status: 200,
        body: {
          googleConnected: true,
          quiz: { formUrl: FORM_URL, publishedAt: '2026-07-20T00:00:00.000Z' },
          hasTranscript: false,
        },
      }),
      'quiz.delete': () => {
        deleted = true
        return { status: 200, body: { deleted: true } }
      },
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(await screen.findByRole('button', { name: /delete quiz/i }))
    await waitFor(() => expect(deleted).toBe(true))
    expect(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    ).toBeInTheDocument()
  })

  it('surfaces an error when deleting the quiz fails', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({
        status: 200,
        body: {
          googleConnected: true,
          quiz: { formUrl: FORM_URL, publishedAt: '2026-07-20T00:00:00.000Z' },
          hasTranscript: false,
        },
      }),
      'quiz.delete': () => ({ status: 500, body: {} }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(await screen.findByRole('button', { name: /delete quiz/i }))
    expect(
      await screen.findByText(/could not delete the quiz/i),
    ).toBeInTheDocument()
  })

  it('does not crash when the clipboard write fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    mockFetchRoutes({
      'quiz.status': () => ({
        status: 200,
        body: {
          googleConnected: true,
          quiz: { formUrl: FORM_URL, publishedAt: '2026-07-20T00:00:00.000Z' },
        },
      }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy quiz link' }),
    )
    // Still shows the un-copied label (no crash, no false success)
    expect(
      await screen.findByRole('button', { name: 'Copy quiz link' }),
    ).toBeInTheDocument()
  })
})
