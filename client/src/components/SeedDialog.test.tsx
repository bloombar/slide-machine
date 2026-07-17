/**
 * Unit tests for the seeding dialog: it carries the seed-notes editor and
 * the material uploader, shows the right actions per mode, and closes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Deck } from '@slide-machine/shared'
import SeedDialog from './SeedDialog'
import { mockFetchRoutes } from '../test/fetch-mock'

const deck = (over: Partial<Deck> = {}): Deck =>
  ({
    id: 'd1',
    projectId: 'p1',
    title: 'Lecture',
    seedContext: '',
    ...over,
  }) as Deck

afterEach(() => vi.unstubAllGlobals())

const renderDialog = (
  props: Partial<Parameters<typeof SeedDialog>[0]> = {},
) => {
  mockFetchRoutes({
    '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
  })
  return render(
    <SeedDialog
      deck={deck()}
      mode="prelecture"
      onClose={props.onClose ?? (() => {})}
      onDeckChange={props.onDeckChange ?? (() => {})}
    />,
  )
}

describe('SeedDialog', () => {
  it('shows both the seed-notes editor and the material uploader', async () => {
    renderDialog()
    expect(
      screen.getByRole('textbox', { name: 'Lecture seed notes' }),
    ).toBeInTheDocument()
    expect(await screen.findByText(/drag and drop/i)).toBeInTheDocument()
  })

  it('offers Skip and Start lecture before a lecture begins', () => {
    renderDialog({ onClose: () => {} })
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Start lecture' }),
    ).toBeInTheDocument()
  })

  it('both Skip and Start lecture close the dialog', () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start lecture' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows a single Done action in manual mode', () => {
    mockFetchRoutes({
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
    })
    const onClose = vi.fn()
    render(
      <SeedDialog
        deck={deck()}
        mode="manual"
        onClose={onClose}
        onDeckChange={() => {}}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Skip' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on the backdrop and on Escape', () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves the dialog open on other keys', () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    fireEvent.keyDown(window, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prefills the seed-notes editor from existing deck notes', () => {
    mockFetchRoutes({
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
    })
    render(
      <SeedDialog
        deck={deck({ seedContext: 'existing notes' })}
        mode="prelecture"
        onClose={() => {}}
        onDeckChange={() => {}}
      />,
    )
    expect(
      screen.getByRole('textbox', { name: 'Lecture seed notes' }),
    ).toHaveValue('existing notes')
  })

  it('saves seed notes through the deck action and reports the change back', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setSeedNotes': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: deck({ seedContext: 'atoms' }) }
      },
    })
    const onDeckChange = vi.fn()
    render(
      <SeedDialog
        deck={deck()}
        mode="prelecture"
        onClose={() => {}}
        onDeckChange={onDeckChange}
      />,
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Lecture seed notes' }),
      { target: { value: 'atoms' } },
    )
    // The notes editor debounces then saves via deck.setSeedNotes
    await vi.waitFor(() =>
      expect(sent).toEqual({ deckId: 'd1', seedContext: 'atoms' }),
    )
    await vi.waitFor(() => expect(onDeckChange).toHaveBeenCalled())
  })
})
