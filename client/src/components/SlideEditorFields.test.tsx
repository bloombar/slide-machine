/**
 * Unit tests for debounced auto-save: one API call after a burst of
 * typing, retry-on-next-change after failure, no call when clean.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Slide } from '@slide-machine/shared'
import SlideEditorFields from './SlideEditorFields'
import { setAccessToken } from '../auth/token'
import { mockFetchRoutes } from '../test/fetch-mock'

const slide: Slide = {
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'content',
  title: 'Original',
  body: 'Body',
}

beforeEach(() => {
  setAccessToken('tok')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SlideEditorFields', () => {
  it('auto-saves once after a typing burst (debounced)', async () => {
    let calls = 0
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/slide.editContent': () => {
        calls++
        return { status: 200, body: { ...slide, title: 'New title' } }
      },
    })
    const onSaved = vi.fn()

    render(
      <SlideEditorFields slide={slide} onSaved={onSaved} debounceMs={30} />,
    )
    const title = screen.getByLabelText('Slide title')
    fireEvent.change(title, { target: { value: 'N' } })
    fireEvent.change(title, { target: { value: 'Ne' } })
    fireEvent.change(title, { target: { value: 'New title' } })

    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
    expect(calls).toBe(1)
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New title' }),
    )
    const lastBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(lastBody).toMatchObject({ slideId: 's1', title: 'New title' })
  })

  it('splits bullet lines into an array', async () => {
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/slide.editContent': () => ({ status: 200, body: slide }),
    })
    render(
      <SlideEditorFields slide={slide} onSaved={vi.fn()} debounceMs={10} />,
    )

    fireEvent.change(screen.getByLabelText('Slide bullets'), {
      target: { value: 'one\ntwo\n\nthree' },
    })

    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.bullets).toEqual(['one', 'two', 'three'])
  })

  it('reports failure quietly and retries on the next change', async () => {
    let calls = 0
    mockFetchRoutes({
      '/api/actions/slide.editContent': () =>
        ++calls === 1 ? { status: 500 } : { status: 200, body: slide },
    })
    render(
      <SlideEditorFields slide={slide} onSaved={vi.fn()} debounceMs={10} />,
    )

    fireEvent.change(screen.getByLabelText('Slide title'), {
      target: { value: 'X' },
    })
    await waitFor(() =>
      expect(screen.getByText(/save failed/i)).toBeInTheDocument(),
    )

    fireEvent.change(screen.getByLabelText('Slide title'), {
      target: { value: 'XY' },
    })
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
    expect(calls).toBe(2)
  })

  it('does not call the API when nothing changed', async () => {
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/slide.editContent': () => ({ status: 200, body: slide }),
    })
    render(
      <SlideEditorFields slide={slide} onSaved={vi.fn()} debounceMs={10} />,
    )

    await new Promise(r => setTimeout(r, 50))
    expect(fetchMock.mock.calls.length).toBe(0)
  })
})
