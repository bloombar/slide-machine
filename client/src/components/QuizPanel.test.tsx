/**
 * Unit tests for the Quiz tab (QUIZ-1..4): the connect → generate → folder
 * picker → shareable URL flow, and the copy-to-clipboard button. The Google
 * actions are stubbed at the fetch layer.
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

  it('redirects to Google consent in live mode', async () => {
    const consent = 'https://accounts.google.com/o/oauth2/v2/auth?x=1'
    const loc = { href: 'http://localhost:5173/d/x' }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: loc,
    })
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: false } }),
      'quiz.connectGoogle': () => ({
        status: 200,
        body: { status: 'redirect', url: consent },
      }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect Google' }),
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

  it('generates a quiz through the Drive folder picker', async () => {
    let published: unknown
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: {
          folders: [
            { id: 'root', name: 'My Drive' },
            { id: 'folder-quizzes', name: 'Quizzes' },
          ],
        },
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

    // The folder picker opens and lists folders; the first is preselected
    const dialog = await screen.findByRole('dialog', {
      name: 'Choose a Drive folder',
    })
    expect(dialog).toBeInTheDocument()
    await screen.findByText('Quizzes')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Publishing sends the chosen folder and the URL is then shown
    await waitFor(() =>
      expect(published).toMatchObject({
        deckId: 'd1',
        driveFolderId: 'root',
        driveFolderName: 'My Drive',
      }),
    )
    expect(await screen.findByText(FORM_URL)).toBeInTheDocument()
  })

  it('lets the user choose a different destination folder', async () => {
    let published: unknown
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: {
          folders: [
            { id: 'root', name: 'My Drive' },
            { id: 'folder-quizzes', name: 'Quizzes' },
          ],
        },
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
    // Switch off the preselected first folder to the second
    fireEvent.click(await screen.findByRole('radio', { name: 'Quizzes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() =>
      expect(published).toMatchObject({ driveFolderId: 'folder-quizzes' }),
    )
  })

  it('disables Continue when the account has no Drive folders', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    await screen.findByRole('dialog', { name: 'Choose a Drive folder' })
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
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
    await screen.findByText('My Drive')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
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

  it('reopens the picker to regenerate an existing quiz', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({
        status: 200,
        body: {
          googleConnected: true,
          quiz: { formUrl: FORM_URL, publishedAt: '2026-07-20T00:00:00.000Z' },
        },
      }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: { folders: [{ id: 'root', name: 'My Drive' }] },
      }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    expect(
      await screen.findByRole('dialog', { name: 'Choose a Drive folder' }),
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
