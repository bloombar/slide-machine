/**
 * Tests for the Lecture settings "Refine" tab (GEN-4): the submit gates on a
 * selection and reveals a slider per option; running dispatches deck.refine,
 * polls deck.refineStatus, reports a summary, and asks the viewer to reload.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Deck } from '@slide-machine/shared'
import { mockFetchRoutes } from '../test/fetch-mock'
import DeckSettingsModal from './DeckSettingsModal'

const baseDeck: Deck = {
  id: 'd1',
  projectId: 'p1',
  ownerId: 'u1',
  title: 'Lecture',
  templateId: 'classic',
  visibility: 'public',
  accessInherited: true,
  permalinkSlug: 'lecture-1',
  slideOrder: ['s1', 's2'],
  voteScore: 0,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  hasRecordings: true,
}

const renderModal = (
  over: Partial<Deck> = {},
  opts: { slidesHaveDrawings?: boolean; viewerIsAdmin?: boolean } = {},
) => {
  const onReformatted = vi.fn()
  const onDeckChange = vi.fn()
  render(
    <MemoryRouter>
      <DeckSettingsModal
        deck={{ ...baseDeck, ...over }}
        projectGenerationFreedom={2}
        isOwner
        viewerIsAdmin={opts.viewerIsAdmin}
        slidesHaveDrawings={opts.slidesHaveDrawings}
        onClose={vi.fn()}
        onTemplateChange={vi.fn()}
        onDeckChange={onDeckChange}
        onDeleted={vi.fn()}
        onReformatted={onReformatted}
      />
    </MemoryRouter>,
  )
  return { onReformatted, onDeckChange }
}

afterEach(cleanup)

describe('DeckSettingsModal — Refine tab', () => {
  it('opens on the same defaults as the per-slide dialog', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))

    // The three slide aspects start on; the narration and speaker ID start
    // off — exactly like "Refine this slide with AI". Speaker ID is opted
    // into because it re-reads the whole recording at the same per-minute
    // rate as capturing it.
    expect(screen.getByRole('button', { name: 'Refine' })).toBeEnabled()
    expect(
      screen.getByRole('checkbox', { name: /Identify multiple speakers/ }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /Refine slide text/ }),
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /Refine slide layout/ }),
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /Refine slide imagery/ }),
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /Refine the spoken transcript/ }),
    ).not.toBeChecked()
    // Breaking slides up starts off for the same reason: it changes how many
    // slides the lecture has.
    expect(
      screen.getByRole('checkbox', { name: /Break up crowded slides/ }),
    ).not.toBeChecked()
  })

  it('gates the button when every option is cleared', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setRefineSettings': () => ({
        status: 200,
        body: baseDeck,
      }),
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    const refine = screen.getByRole('button', { name: 'Refine' })

    // Speaker ID is already off by default, so only the content passes need
    // clearing to leave nothing selected.
    for (const name of [
      /Refine slide text/,
      /Refine slide layout/,
      /Refine slide imagery/,
    ])
      fireEvent.click(screen.getByRole('checkbox', { name }))
    expect(refine).toBeDisabled()
  })

  it('sends the chosen aspects and one strength for the whole lecture', async () => {
    let refineBody: { refineSlides?: unknown; refineTranscript?: unknown } = {}
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setRefineSettings': () => ({
        status: 200,
        body: baseDeck,
      }),
      '/api/actions/deck.refine': init => {
        refineBody = JSON.parse(String(init?.body))
        return { status: 200, body: { jobId: 'j1' } }
      },
      '/api/actions/deck.refineStatus': () => ({
        status: 200,
        body: {
          status: 'done',
          summary: {
            reframed: 0,
            slidesRefined: 1,
            slidesSplit: 0,
            transcriptsUpdated: 1,
          },
        },
      }),
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))

    fireEvent.click(
      screen.getByRole('checkbox', { name: /Refine slide imagery/ }),
    )
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Refine the spoken transcript/ }),
    )
    fireEvent.change(screen.getByLabelText('How much to refine this lecture'), {
      target: { value: '5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))

    await vi.waitFor(() =>
      // One slider drives both passes; the aspects ride along with the slides one.
      expect(refineBody).toMatchObject({
        refineSlides: {
          level: 5,
          parts: { text: true, layout: true, imagery: false },
        },
        refineTranscript: { level: 5 },
      }),
    )
  })

  it('saves a moved slider to both stored levels (debounced)', async () => {
    let savedBody: unknown = null
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setRefineSettings': init => {
        savedBody = JSON.parse(String(init?.body))
        return { status: 200, body: { ...baseDeck, refineSlidesLevel: 4 } }
      },
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))

    // The single slider starts at the config default (2) until moved.
    const slider = screen.getByLabelText('How much to refine this lecture')
    expect(slider).toHaveValue('2')

    fireEvent.change(slider, { target: { value: '4' } })
    // It governs both passes, so both stored levels follow it — keeping the
    // per-slide dialog and transcript editor in step.
    await vi.waitFor(
      () =>
        expect(savedBody).toEqual({
          deckId: 'd1',
          slidesLevel: 4,
          transcriptLevel: 4,
        }),
      { timeout: 2000 },
    )
  })

  it('persists a toggled option to the lecture immediately', async () => {
    let savedBody: unknown = null
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setRefineSettings': init => {
        savedBody = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { ...baseDeck, refineSlidesEnabled: false },
        }
      },
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    // The lecture stores the slide pass as one flag: clearing every aspect
    // saves slidesEnabled:false right away.
    for (const name of [
      /Refine slide text/,
      /Refine slide layout/,
      /Refine slide imagery/,
    ])
      fireEvent.click(screen.getByRole('checkbox', { name }))
    await vi.waitFor(
      () => expect(savedBody).toEqual({ deckId: 'd1', slidesEnabled: false }),
      { timeout: 2000 },
    )
  })

  it('starts toggles from the lecture-saved settings', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ refineSlidesEnabled: false, refineTranscriptEnabled: true })
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    // A lecture with the slide pass saved off opens with no aspect selected.
    expect(
      screen.getByRole('checkbox', { name: /Refine slide text/ }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /Refine slide imagery/ }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /Refine the spoken transcript/ }),
    ).toBeChecked()
  })

  it('starts the slider at the lecture-saved level when set', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ refineSlidesLevel: 5 })
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    expect(
      screen.getByLabelText('How much to refine this lecture'),
    ).toHaveValue('5')
  })

  it('disables the whole form when the lecture has no slides', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ slideOrder: [] })
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))

    expect(
      screen.getByRole('checkbox', { name: /Refine slide text/ }),
    ).toBeDisabled()
    expect(
      screen.getByRole('checkbox', { name: /Refine the spoken transcript/ }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refine' })).toBeDisabled()
    expect(screen.getByText(/nothing to refine/)).toBeInTheDocument()
  })

  it('disables speaker identification without retained audio', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ hasRecordings: false })
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    expect(
      screen.getByRole('checkbox', { name: /Identify multiple speakers/ }),
    ).toBeDisabled()
  })

  // Diarization is billed across the whole recording however few slides need
  // it, so the lecture-wide tab points at the per-slide action instead.
  it('advises running speaker identification per slide, not lecture-wide', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    expect(
      screen.getByText(/Usually better one slide at a time/),
    ).toBeInTheDocument()
  })

  it('omits the per-slide advice when there is no audio to identify', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ hasRecordings: false })
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    expect(screen.queryByText(/Usually better one slide at a time/)).toBeNull()
  })

  it('enables speaker ID when recordings appear, still unchecked, without a remount', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    const modal = (deck: Deck) => (
      <MemoryRouter>
        <DeckSettingsModal
          deck={deck}
          projectGenerationFreedom={2}
          isOwner
          onClose={vi.fn()}
          onTemplateChange={vi.fn()}
          onDeckChange={vi.fn()}
          onDeleted={vi.fn()}
          onReformatted={vi.fn()}
        />
      </MemoryRouter>
    )
    // Open with no audio yet: the toggle is disabled, unchecked, and explained.
    const { rerender } = render(modal({ ...baseDeck, hasRecordings: false }))
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    const box = () =>
      screen.getByRole('checkbox', { name: /Identify multiple speakers/ })
    expect(box()).toBeDisabled()
    expect(box()).not.toBeChecked()
    expect(
      screen.getByText(/No lecture audio was recorded/),
    ).toBeInTheDocument()

    // The lecture's audio finishes flushing and the deck now reports recordings
    // (the viewer's poll updates the prop) — no reload, same mounted modal.
    // The toggle becomes available but stays off: audio arriving is not the
    // user asking to pay for a diarization pass over it.
    rerender(modal({ ...baseDeck, hasRecordings: true }))
    expect(box()).toBeEnabled()
    expect(box()).not.toBeChecked()
    expect(screen.queryByText(/No lecture audio was recorded/)).toBeNull()
  })

  it('leaves speaker ID off when the lecture saved it off, even once audio lands', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    const modal = (deck: Deck) => (
      <MemoryRouter>
        <DeckSettingsModal
          deck={deck}
          projectGenerationFreedom={2}
          isOwner
          onClose={vi.fn()}
          onTemplateChange={vi.fn()}
          onDeckChange={vi.fn()}
          onDeleted={vi.fn()}
          onReformatted={vi.fn()}
        />
      </MemoryRouter>
    )
    const deckOff = { ...baseDeck, refineIdentifySpeakers: false }
    const { rerender } = render(modal({ ...deckOff, hasRecordings: false }))
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    rerender(modal({ ...deckOff, hasRecordings: true }))
    const box = screen.getByRole('checkbox', {
      name: /Identify multiple speakers/,
    })
    expect(box).toBeEnabled()
    expect(box).not.toBeChecked() // respects the saved-off choice
  })

  it('runs the selected passes and reports a summary', async () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      // refineStatus first: its URL contains "deck.refine" as a substring, so
      // the substring-matching mock must check the longer key before it.
      '/api/actions/deck.refineStatus': () => ({
        status: 200,
        body: {
          status: 'done',
          summary: {
            reframed: 1,
            slidesRefined: 2,
            slidesSplit: 0,
            transcriptsUpdated: 2,
          },
        },
      }),
      '/api/actions/deck.refine': () => ({
        status: 200,
        body: { jobId: 'job-1' },
      }),
    })
    const { onReformatted } = renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    // All options are checked by default; just submit.
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))

    // The status poll waits ~2 s before its first check, so allow for it. The
    // progress line is a status region too, so this waits for the summary's
    // own words rather than for whichever region appears first.
    await screen.findByText(
      /Done — reframed 1 student slide, refined 2 slides, updated 2 narrations\./,
      {},
      { timeout: 4000 },
    )
    expect(onReformatted).toHaveBeenCalledOnce()
  })

  /**
   * Breaking slides up, lecture-wide (GEN-4).
   *
   * A batch pass has nowhere to ask, which is exactly why the permission is a
   * checkbox taken before the run. The box therefore has to do two things:
   * persist to the lecture like the other Refine settings, and reach the job
   * that acts on it. A box that renders but sends nothing is a setting that
   * silently does not exist.
   */
  it('saves the split setting on the lecture, and asks the job for it', async () => {
    let saved: { splitEnabled?: boolean } = {}
    let refineBody: { refineSlides?: { allowSplit?: boolean } } = {}
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setRefineSettings': init => {
        saved = JSON.parse(String(init?.body))
        return { status: 200, body: { ...baseDeck, refineSplitEnabled: true } }
      },
      '/api/actions/deck.refineStatus': () => ({
        status: 200,
        body: {
          status: 'done',
          summary: {
            reframed: 0,
            slidesRefined: 1,
            slidesSplit: 1,
            transcriptsUpdated: 0,
          },
        },
      }),
      '/api/actions/deck.refine': init => {
        refineBody = JSON.parse(String(init?.body))
        return { status: 200, body: { jobId: 'job-1' } }
      },
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Break up crowded slides/ }),
    )
    expect(saved.splitEnabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    await vi.waitFor(() =>
      expect(refineBody.refineSlides?.allowSplit).toBe(true),
    )
    // And the run says how many slides it actually divided.
    await screen.findByText(/broke up 1 slide/, {}, { timeout: 4000 })
  })

  it('opens ticked when the lecture saved it on', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ refineSplitEnabled: true })
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    expect(
      screen.getByRole('checkbox', { name: /Break up crowded slides/ }),
    ).toBeChecked()
  })

  it('asks for no split while the box is unticked', async () => {
    let refineBody: { refineSlides?: { allowSplit?: boolean } } = {}
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.refineStatus': () => ({
        status: 200,
        body: {
          status: 'done',
          summary: {
            reframed: 0,
            slidesRefined: 1,
            slidesSplit: 0,
            transcriptsUpdated: 0,
          },
        },
      }),
      '/api/actions/deck.refine': init => {
        refineBody = JSON.parse(String(init?.body))
        return { status: 200, body: { jobId: 'job-1' } }
      },
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    await vi.waitFor(() =>
      expect(refineBody.refineSlides?.allowSplit).toBe(false),
    )
  })

  /**
   * Naming the slide being refined.
   *
   * "Working in the background" is true of a run that is progressing and of
   * one that has hung, which is why a long pass needs to say where it is.
   * The generic line stays as the fallback for the gap before the first
   * status poll lands.
   */
  it('names the slide being refined as the job reports it', async () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.refineStatus': () => ({
        status: 200,
        body: {
          status: 'running',
          progress: {
            phase: 'slides',
            done: 2,
            total: 9,
            index: 3,
            title: 'Carbon fixation',
          },
        },
      }),
      '/api/actions/deck.refine': () => ({
        status: 200,
        body: { jobId: 'job-1' },
      }),
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    // Before the first poll there is nothing specific to say.
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    expect(screen.getByText(/Working in the background/)).toBeVisible()

    await screen.findByText(
      'Refining slide 3 of 9: Carbon fixation',
      {},
      { timeout: 4000 },
    )
  })

  it('confirms before refining when slides carry whiteboard marks', async () => {
    let refineCalled = false
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.refineStatus': () => ({
        status: 200,
        body: {
          status: 'done',
          summary: {
            reframed: 0,
            slidesRefined: 1,
            slidesSplit: 0,
            transcriptsUpdated: 0,
          },
        },
      }),
      '/api/actions/deck.refine': () => {
        refineCalled = true
        return { status: 200, body: { jobId: 'job-1' } }
      },
    })
    renderModal({}, { slidesHaveDrawings: true })
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    // Slide pass is on by default; with marks present, Refine prompts first.
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    expect(
      screen.getByRole('alertdialog', { name: /refine marked-up slides/i }),
    ).toBeInTheDocument()
    expect(refineCalled).toBe(false)
    // Confirming proceeds to the refine job.
    fireEvent.click(screen.getByRole('button', { name: 'Refine anyway' }))
    await vi.waitFor(() => expect(refineCalled).toBe(true), { timeout: 2000 })
  })

  it('does not prompt when the slide pass is off, even with marks', async () => {
    let refineCalled = false
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setRefineSettings': () => ({
        status: 200,
        body: { ...baseDeck, refineSlidesEnabled: false },
      }),
      '/api/actions/deck.refineStatus': () => ({
        status: 200,
        body: {
          status: 'done',
          summary: {
            reframed: 0,
            slidesRefined: 0,
            slidesSplit: 0,
            transcriptsUpdated: 1,
          },
        },
      }),
      '/api/actions/deck.refine': () => {
        refineCalled = true
        return { status: 200, body: { jobId: 'job-2' } }
      },
    })
    renderModal({}, { slidesHaveDrawings: true })
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    // Clear every slide aspect — only the transcript pass remains, which does
    // not touch slide content, so no confirmation is needed.
    for (const name of [
      /Refine slide text/,
      /Refine slide layout/,
      /Refine slide imagery/,
    ])
      fireEvent.click(screen.getByRole('checkbox', { name }))
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Refine the spoken transcript/ }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await vi.waitFor(() => expect(refineCalled).toBe(true), { timeout: 2000 })
  })
})

describe('DeckSettingsModal — lecture title', () => {
  it('shows the current title and saves an edit via deck.rename', async () => {
    const renamed = { ...baseDeck, title: 'Photosynthesis Deep Dive' }
    mockFetchRoutes({
      '/api/actions/deck.rename': () => ({ status: 200, body: renamed }),
    })
    const { onDeckChange } = renderModal()

    const input = screen.getByRole('textbox', { name: 'Lecture title' })
    expect(input).toHaveValue('Lecture')
    fireEvent.change(input, {
      target: { value: 'Photosynthesis Deep Dive' },
    })
    fireEvent.blur(input)
    await waitFor(() => expect(onDeckChange).toHaveBeenCalledWith(renamed))
  })

  it('saves on Enter as well as blur', async () => {
    const renamed = { ...baseDeck, title: 'Renamed' }
    mockFetchRoutes({
      '/api/actions/deck.rename': () => ({ status: 200, body: renamed }),
    })
    const { onDeckChange } = renderModal()
    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Lecture title',
    })
    input.focus()
    fireEvent.change(input, { target: { value: 'Renamed' } })
    // Enter blurs the field, which triggers the save
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onDeckChange).toHaveBeenCalledWith(renamed))
  })

  it('does not save when the title is unchanged', () => {
    mockFetchRoutes({
      '/api/actions/deck.rename': () => ({ status: 500, body: {} }),
    })
    const { onDeckChange } = renderModal()
    fireEvent.blur(screen.getByRole('textbox', { name: 'Lecture title' }))
    expect(onDeckChange).not.toHaveBeenCalled()
  })

  it('quietly ignores a rename failure', async () => {
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/deck.rename': () => ({ status: 500, body: {} }),
    })
    const { onDeckChange } = renderModal()
    const input = screen.getByRole('textbox', { name: 'Lecture title' })
    fireEvent.change(input, { target: { value: 'Doomed rename' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('deck.rename'),
        expect.anything(),
      ),
    )
    expect(onDeckChange).not.toHaveBeenCalled()
  })
})

describe('DeckSettingsModal — study label (EVAL-3)', () => {
  it('hides the field from non-admin viewers, owner included', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ studyLabel: 'B1-SWE-treatment' })
    expect(screen.queryByRole('textbox', { name: 'Study label' })).toBeNull()
  })

  it('shows an admin the saved label', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ studyLabel: 'B1-SWE-treatment' }, { viewerIsAdmin: true })
    expect(screen.getByRole('textbox', { name: 'Study label' })).toHaveValue(
      'B1-SWE-treatment',
    )
  })

  it('saves the trimmed label on blur and reports the fresh deck', async () => {
    let sent: { deckId?: string; studyLabel?: string } = {}
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setStudyLabel': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { ...baseDeck, studyLabel: sent.studyLabel },
        }
      },
    })
    const { onDeckChange } = renderModal({}, { viewerIsAdmin: true })
    const input = screen.getByRole('textbox', { name: 'Study label' })
    fireEvent.change(input, { target: { value: '  B2-Agile-control  ' } })
    fireEvent.blur(input)
    await waitFor(() => expect(onDeckChange).toHaveBeenCalled())
    expect(sent).toEqual({ deckId: 'd1', studyLabel: 'B2-Agile-control' })
  })

  it('does not save an unchanged label', () => {
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ studyLabel: 'B1-SWE-treatment' }, { viewerIsAdmin: true })
    const input = screen.getByRole('textbox', { name: 'Study label' })
    fireEvent.blur(input)
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('deck.setStudyLabel'),
      expect.anything(),
    )
  })
})
