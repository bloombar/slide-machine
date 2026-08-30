/**
 * Unit tests for the Quiz tab (QUIZ-1..7): the connect → generate → folder
 * picker → shareable URL flow, the copy-to-clipboard button, creating a new
 * Drive folder, deleting a quiz, and the generation options — question count
 * (kept in sync with the per-type counts), points, email, transcript, and AI
 * instructions. The Google actions are stubbed at the fetch layer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { QuizQuestion } from '@slide-machine/shared'
import QuizPanel from './QuizPanel'
import { mockFetchRoutes } from '../test/fetch-mock'

const FORM_URL = 'https://docs.google.com/forms/d/e/mock-abc123/viewform'

// The generate step returns questions for the review preview (QUIZ-2), where
// the instructor confirms/edits points before publishing.
const GENERATE_OK = () => ({
  status: 200,
  body: { questions: [{ type: 'single_choice', question: 'Q1', points: 5 }] },
})

/** Clicks "Publish quiz" in the review preview (opens after "Generate & save"). */
const publishFromPreview = async () =>
  fireEvent.click(await screen.findByRole('button', { name: 'Publish quiz' }))

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
      'quiz.generate': GENERATE_OK,
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
    await publishFromPreview()

    await waitFor(() =>
      expect(published).toMatchObject({
        deckId: 'd1',
        driveFolderId: 'root',
        driveFolderName: 'My Drive',
      }),
    )
    expect(await screen.findByText(FORM_URL)).toBeInTheDocument()
  })

  it('keeps the entered options when the review is cancelled (QUIZ-2)', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
      'quiz.generate': GENERATE_OK,
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )

    // Enter a distinctive point total, then generate to reach the review step.
    const points = await screen.findByLabelText('Total points')
    fireEvent.change(points, { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate & save' }))

    // The review step opens…
    await screen.findByRole('button', { name: 'Publish quiz' })
    // …cancel it: the picker returns with the point total still filled in,
    // rather than resetting to the defaults.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByLabelText('Total points')).toHaveValue(42)
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
      'quiz.generate': GENERATE_OK,
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
    await publishFromPreview()
    await waitFor(() =>
      expect(published).toMatchObject({
        driveFolderId: 'folder-quizzes',
        driveFolderName: 'Quizzes',
      }),
    )
  })

  /**
   * Reaches the review step with a given set of generated questions, and
   * captures what publish actually sent.
   *
   * The captured body is the point: the Form is built from exactly this array
   * (`quiz.publish` publishes it as given), so an edit that does not appear
   * here never reaches a student, however well the input rendered.
   */
  const reviewing = async (questions: unknown[]) => {
    const sent: { questions?: QuizQuestion[] } = {}
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
      'quiz.generate': () => ({ status: 200, body: { questions } }),
      'quiz.publish': init => {
        Object.assign(sent, JSON.parse(String(init?.body)))
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
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate & save' }),
    )
    await screen.findByLabelText('Text of question 1')
    return sent
  }

  const MCQ = {
    type: 'single_choice',
    question: 'What number does Python indexing begin at?',
    points: 20,
    choices: ['0', '1', '-1'],
    correctIndex: 0,
  }

  it('publishes a reworded question, not the generated one (QUIZ-2)', async () => {
    const sent = await reviewing([MCQ])
    fireEvent.change(screen.getByLabelText('Text of question 1'), {
      target: { value: 'What index does the first element of a list have?' },
    })
    await publishFromPreview()
    await waitFor(() =>
      expect(sent.questions?.[0]?.question).toBe(
        'What index does the first element of a list have?',
      ),
    )
  })

  it('publishes an edited choice (QUIZ-2)', async () => {
    const sent = await reviewing([MCQ])
    fireEvent.change(screen.getByLabelText('Choice 2 for question 1'), {
      target: { value: 'one' },
    })
    await publishFromPreview()
    // Only that choice changed; the others are carried through as generated
    await waitFor(() =>
      expect(sent.questions?.[0]?.choices).toEqual(['0', 'one', '-1']),
    )
  })

  it('moves the correct answer to the choice the instructor marks (QUIZ-2)', async () => {
    const sent = await reviewing([MCQ])
    // Generated with choice 1 correct; the instructor says it is choice 3
    fireEvent.click(
      screen.getByLabelText('Mark choice 3 correct for question 1'),
    )
    await publishFromPreview()
    await waitFor(() => expect(sent.questions?.[0]?.correctIndex).toBe(2))
  })

  it('toggles several correct answers for a multiple-answer question (QUIZ-2)', async () => {
    const sent = await reviewing([
      {
        type: 'multiple_choice',
        question: 'Which are sequence types?',
        points: 20,
        choices: ['list', 'tuple', 'int'],
        correctIndexes: [0],
      },
    ])
    fireEvent.click(
      screen.getByLabelText('Mark choice 2 correct for question 1'),
    )
    await publishFromPreview()
    // Kept in choice order, not click order, so the Form reads as the list does
    await waitFor(() =>
      expect(sent.questions?.[0]?.correctIndexes).toEqual([0, 1]),
    )
  })

  it('unmarks a correct answer that was marked (QUIZ-2)', async () => {
    const sent = await reviewing([
      {
        type: 'multiple_choice',
        question: 'Which are sequence types?',
        points: 20,
        choices: ['list', 'tuple', 'int'],
        correctIndexes: [0, 2],
      },
    ])
    fireEvent.click(
      screen.getByLabelText('Mark choice 3 correct for question 1'),
    )
    await publishFromPreview()
    await waitFor(() =>
      expect(sent.questions?.[0]?.correctIndexes).toEqual([0]),
    )
  })

  it('edits an accepted answer of a short-answer question (QUIZ-2)', async () => {
    const sent = await reviewing([
      {
        type: 'short_text',
        question: 'Name the method that appends to a list.',
        points: 20,
        correctAnswers: ['apend'],
      },
    ])
    fireEvent.change(
      screen.getByLabelText('Accepted answer 1 for question 1'),
      {
        target: { value: 'append' },
      },
    )
    await publishFromPreview()
    await waitFor(() =>
      expect(sent.questions?.[0]?.correctAnswers).toEqual(['append']),
    )
  })

  it('offers no accepted-answer box where the AI wrote none (QUIZ-2)', async () => {
    // A question with no accepted answer is manually graded; inventing one is
    // a decision about the quiz, not a correction to it
    await reviewing([
      { type: 'short_text', question: 'Explain why.', points: 20 },
    ])
    expect(screen.queryByText('Accepted answers')).not.toBeInTheDocument()
  })

  it('refuses to publish a question emptied of its text (QUIZ-2)', async () => {
    // The server rejects an empty stem, which would otherwise surface as a
    // failed publish after the folder was already chosen
    await reviewing([MCQ])
    fireEvent.change(screen.getByLabelText('Text of question 1'), {
      target: { value: '   ' },
    })
    expect(screen.getByRole('button', { name: 'Publish quiz' })).toBeDisabled()
    expect(
      screen.getByText('Fill in every question and choice first.'),
    ).toBeInTheDocument()
  })

  it('refuses to publish a choice emptied of its text (QUIZ-2)', async () => {
    await reviewing([MCQ])
    fireEvent.change(screen.getByLabelText('Choice 2 for question 1'), {
      target: { value: '' },
    })
    expect(screen.getByRole('button', { name: 'Publish quiz' })).toBeDisabled()
  })

  it('publishes again once the blank is filled back in (QUIZ-2)', async () => {
    // The guard must lift, or a typo would strand the instructor in the dialog
    const sent = await reviewing([MCQ])
    const stem = screen.getByLabelText('Text of question 1')
    fireEvent.change(stem, { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Publish quiz' })).toBeDisabled()
    fireEvent.change(stem, { target: { value: 'Where does indexing start?' } })
    expect(
      screen.getByRole('button', { name: 'Publish quiz' }),
    ).not.toBeDisabled()
    await publishFromPreview()
    await waitFor(() =>
      expect(sent.questions?.[0]?.question).toBe('Where does indexing start?'),
    )
  })

  it('leaves an untouched question exactly as generated (QUIZ-2)', async () => {
    const sent = await reviewing([
      MCQ,
      {
        type: 'single_choice',
        question: 'Which method appends?',
        points: 20,
        choices: ['append', 'push'],
        correctIndex: 0,
      },
    ])
    fireEvent.change(screen.getByLabelText('Text of question 1'), {
      target: { value: 'Edited' },
    })
    await publishFromPreview()
    await waitFor(() =>
      expect(sent.questions?.[1]).toEqual({
        type: 'single_choice',
        question: 'Which method appends?',
        points: 20,
        choices: ['append', 'push'],
        correctIndex: 0,
      }),
    )
  })

  it('lets the instructor override per-question points before publishing (QUIZ-2)', async () => {
    let published: { questions?: Array<{ points?: number }> } = {}
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
      'quiz.generate': () => ({
        status: 200,
        body: {
          questions: [
            { type: 'single_choice', question: 'Q1', points: 5 },
            { type: 'short_text', question: 'Q2', points: 5 },
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
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate & save' }),
    )
    // The review step shows the generated questions with editable points.
    const q1Points = await screen.findByLabelText('Points for question 1')
    fireEvent.change(q1Points, { target: { value: '20' } })
    await publishFromPreview()
    await waitFor(() => expect(published.questions?.[0]?.points).toBe(20))
    // The untouched question keeps its generated points.
    expect(published.questions?.[1]?.points).toBe(5)
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
    expect(await screen.findByText(/no sub-folders here/i)).toBeInTheDocument()
    // Save is never disabled: you can always save to the current folder
    expect(
      screen.getByRole('button', { name: 'Generate & save' }),
    ).toBeEnabled()
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
      'quiz.generate': GENERATE_OK,
      'quiz.publish': () => ({ status: 500, body: {} }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate & save' }),
    )
    await publishFromPreview()
    expect(
      await screen.findByText(/could not publish the quiz/i),
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
      'quiz.generate': GENERATE_OK,
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
    await publishFromPreview()
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
      'quiz.generate': GENERATE_OK,
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
      name: /include spoken transcript/i,
    })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Generate & save' }))
    await publishFromPreview()
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
        name: /include spoken transcript/i,
      }),
    ).not.toBeInTheDocument()
  })

  it('sets question count, points, types, and instructions from the options (QUIZ-7)', async () => {
    let published: {
      questionCount?: number
      totalPoints?: number
      emailCollection?: string
      typeCounts?: Record<string, number>
      customInstructions?: string
    } = {}
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
      'quiz.generate': GENERATE_OK,
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
    fireEvent.change(screen.getByLabelText('Collect respondent email'), {
      target: { value: 'none' },
    })
    fireEvent.change(screen.getByLabelText('Single-choice (MCQ)'), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText('Short answer'), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText(/additional instructions/i), {
      target: { value: 'focus on the water cycle' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate & save' }))
    await publishFromPreview()
    await waitFor(() =>
      expect(published).toMatchObject({
        questionCount: 4,
        totalPoints: 8,
        emailCollection: 'none',
        typeCounts: { single_choice: 1, short_text: 3 },
        customInstructions: 'focus on the water cycle',
      }),
    )
  })

  it('keeps the question count in sync with the per-type counts', async () => {
    let published: {
      questionCount?: number
      typeCounts?: Record<string, number>
    } = {}
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
      'quiz.generate': GENERATE_OK,
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
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    // Default is 5 single-choice; add 3 short-answer → total becomes 8
    fireEvent.change(screen.getByLabelText('Short answer'), {
      target: { value: '3' },
    })
    // The "Number of questions" field reflects the new sum
    expect(screen.getByLabelText('Number of questions')).toHaveValue(8)
    fireEvent.click(screen.getByRole('button', { name: 'Generate & save' }))
    await publishFromPreview()
    await waitFor(() =>
      expect(published).toMatchObject({
        questionCount: 8,
        typeCounts: { single_choice: 5, short_text: 3 },
      }),
    )
  })

  it('lets the number-of-questions field be cleared and retyped', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 200, body: { folders: [] } }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    const count = screen.getByLabelText('Number of questions')
    expect(count).toHaveValue(5)
    // Clearing stays empty — it must NOT snap back to 1 while typing
    fireEvent.change(count, { target: { value: '' } })
    expect(count).toHaveValue(null)
    // Typing a fresh value works
    fireEvent.change(count, { target: { value: '7' } })
    expect(count).toHaveValue(7)
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

  it('offers to reconnect when the Drive folders fail to load', async () => {
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: true } }),
      'quiz.driveFolders': () => ({ status: 500, body: {} }),
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate quiz' }),
    )
    // The picker surfaces the failure with a reconnect path, not a dead end.
    expect(
      await screen.findByText(/may not have granted Drive access/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reconnect Google' }),
    ).toBeInTheDocument()
  })

  it('explains when a connect returned without Drive access (drive_denied)', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/d/x', search: '?connect=drive_denied' },
    })
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: false } }),
    })
    render(<QuizPanel deckId="d1" />)
    expect(
      await screen.findByText(/Drive access wasn.t allowed/i),
    ).toBeInTheDocument()
  })

  it('does not carry the drive_denied flag into the reconnect return URL', async () => {
    // Reconnecting from a drive_denied URL must return to a CLEAN url, so a
    // successful reconnect doesn't land back on the banner.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'http://localhost/d/x?connect=drive_denied',
        search: '?connect=drive_denied',
      },
    })
    let returnTo = ''
    mockFetchRoutes({
      'quiz.status': () => ({ status: 200, body: { googleConnected: false } }),
      'quiz.connectGoogle': init => {
        returnTo = JSON.parse(String(init?.body)).returnTo
        return { status: 200, body: { status: 'redirect', url: 'https://g/x' } }
      },
    })
    render(<QuizPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect Google' }),
    )
    await waitFor(() => expect(returnTo).toContain('settings=quiz'))
    expect(returnTo).not.toContain('connect=drive_denied')
  })
})
