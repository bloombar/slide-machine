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

const renderModal = (over: Partial<Deck> = {}) => {
  const onReformatted = vi.fn()
  render(
    <MemoryRouter>
      <DeckSettingsModal
        deck={{ ...baseDeck, ...over }}
        projectGenerationFreedom={2}
        isOwner
        onClose={vi.fn()}
        onTemplateChange={vi.fn()}
        onDeckChange={vi.fn()}
        onDeleted={vi.fn()}
        onReformatted={onReformatted}
      />
    </MemoryRouter>,
  )
  return { onReformatted }
}

afterEach(cleanup)

describe('DeckSettingsModal — Refine tab', () => {
  it('starts with every option checked and gates the button when all are cleared', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine' }))

    // All three options default to checked, so the button is enabled and the
    // "Refine all slides" slider is already revealed.
    const refine = screen.getByRole('button', { name: 'Refine' })
    expect(refine).toBeEnabled()
    expect(
      screen.getByRole('checkbox', { name: /Identify multiple speakers/ }),
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /Refine all slides/ }),
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /Refine the spoken transcript/ }),
    ).toBeChecked()
    expect(
      screen.getByLabelText('How much to refine slides'),
    ).toBeInTheDocument()

    // Clearing every option disables the button and hides the slider.
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Identify multiple speakers/ }),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /Refine all slides/ }))
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Refine the spoken transcript/ }),
    )
    expect(refine).toBeDisabled()
    expect(screen.queryByLabelText('How much to refine slides')).toBeNull()
  })

  it('saves a moved slider to the lecture (debounced), inheriting otherwise', async () => {
    let savedBody: unknown = null
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setRefineLevels': init => {
        savedBody = JSON.parse(String(init?.body))
        return { status: 200, body: { ...baseDeck, refineSlidesLevel: 4 } }
      },
    })
    renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine' }))

    // "Refine all slides" is checked by default, so its slider is visible;
    // it starts at the config default (2) until moved.
    const slider = screen.getByLabelText('How much to refine slides')
    expect(slider).toHaveValue('2')

    fireEvent.change(slider, { target: { value: '4' } })
    await vi.waitFor(
      () => expect(savedBody).toEqual({ deckId: 'd1', slidesLevel: 4 }),
      { timeout: 2000 },
    )
  })

  it('starts the slider at the lecture-saved level when set', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ refineSlidesLevel: 5 })
    fireEvent.click(screen.getByRole('tab', { name: 'Refine' }))
    expect(screen.getByLabelText('How much to refine slides')).toHaveValue('5')
  })

  it('disables the whole form when the lecture has no slides', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ slideOrder: [] })
    fireEvent.click(screen.getByRole('tab', { name: 'Refine' }))

    expect(
      screen.getByRole('checkbox', { name: /Refine all slides/ }),
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
    fireEvent.click(screen.getByRole('tab', { name: 'Refine' }))
    expect(
      screen.getByRole('checkbox', { name: /Identify multiple speakers/ }),
    ).toBeDisabled()
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
          summary: { reframed: 1, slidesRefined: 2, transcriptsUpdated: 2 },
        },
      }),
      '/api/actions/deck.refine': () => ({
        status: 200,
        body: { jobId: 'job-1' },
      }),
    })
    const { onReformatted } = renderModal()
    fireEvent.click(screen.getByRole('tab', { name: 'Refine' }))
    // All options are checked by default; just submit.
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))

    // The status poll waits ~2 s before its first check, so allow for it.
    const status = await screen.findByRole('status', {}, { timeout: 4000 })
    expect(status.textContent).toMatch(
      /Done — reframed 1 student slide, refined 2 slides, updated 2 narrations\./,
    )
    expect(onReformatted).toHaveBeenCalledOnce()
  })
})
