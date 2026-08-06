/**
 * Unit tests for the template-update notice (TMPL-11).
 *
 * What matters here is that the offer is honest. It stays out of the way when
 * there is nothing to take, it distinguishes a cosmetic update from one that
 * would leave content unplaced, it names the boxes rather than issuing a
 * generic warning, and it promises — in the words the user actually reads —
 * that nothing is deleted. And it never applies anything without a
 * confirmation.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { TemplateUpdateStatus } from '@slide-machine/shared'
import { mockFetchRoutes } from '../../test/fetch-mock'
import TemplateUpdateNotice from './TemplateUpdateNotice'

const clean: TemplateUpdateStatus = {
  available: true,
  impact: [],
  affectedSlides: 0,
}

const lossy: TemplateUpdateStatus = {
  available: true,
  affectedSlides: 2,
  impact: [
    {
      layoutType: 'content',
      slideCount: 3,
      unplaced: ['Sources'],
      layoutRemoved: false,
    },
  ],
}

/** Routes the status call to `status`, and records applies. */
const routes = (status: TemplateUpdateStatus) => {
  const applied: string[] = []
  const mock = mockFetchRoutes({
    '/api/actions/deck.templateUpdateStatus': () => ({
      status: 200,
      body: status,
    }),
    '/api/actions/deck.applyTemplateUpdate': () => {
      applied.push('applied')
      return { status: 200, body: { id: 'd1', templateId: 't1' } }
    },
  })
  return { applied, ...mock }
}

const mount = (onApplied = vi.fn()) => {
  render(<TemplateUpdateNotice deckId="d1" onApplied={onApplied} />)
  return onApplied
}

describe('TemplateUpdateNotice', () => {
  it('shows nothing when the template has not moved on', async () => {
    routes({ available: false, impact: [], affectedSlides: 0 })
    mount()
    await waitFor(() =>
      expect(
        screen.queryByText('This design has been updated'),
      ).not.toBeInTheDocument(),
    )
  })

  it('stays silent when the status cannot be read', async () => {
    mockFetchRoutes({
      '/api/actions/deck.templateUpdateStatus': () => ({ status: 500 }),
    })
    mount()
    // A lecture that renders fine should not sprout an error banner because a
    // secondary lookup failed.
    await waitFor(() =>
      expect(
        screen.queryByText('This design has been updated'),
      ).not.toBeInTheDocument(),
    )
  })

  it('says there is nothing to adjust for a cosmetic update', async () => {
    routes(clean)
    mount()
    expect(
      await screen.findByText('This design has been updated'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'The changes are visual only — nothing on your slides needs adjusting.',
      ),
    ).toBeInTheDocument()
  })

  it('counts the slides whose content may need adjusting', async () => {
    routes(lossy)
    mount()
    expect(
      await screen.findByText('Content on 2 slides may need adjusting.'),
    ).toBeInTheDocument()
  })

  it('does not apply anything until the dialog is confirmed', async () => {
    const { applied } = routes(lossy)
    mount()
    fireEvent.click(
      await screen.findByRole('button', { name: /Update this lecture/ }),
    )
    // The dialog is open, and nothing has been sent yet.
    expect(
      screen.getByText("Update this lecture's design?"),
    ).toBeInTheDocument()
    expect(applied).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(applied).toHaveLength(0)
  })

  it('names the boxes that would have nowhere to go', async () => {
    routes(lossy)
    mount()
    fireEvent.click(
      await screen.findByRole('button', { name: /Update this lecture/ }),
    )
    expect(
      screen.getByText(
        'On 2 slides, these boxes have no match in the new design:',
      ),
    ).toBeInTheDocument()
    // The author-facing label, straight from the server.
    expect(screen.getByText('Sources')).toBeInTheDocument()
  })

  it('promises that nothing is deleted', async () => {
    routes(lossy)
    mount()
    fireEvent.click(
      await screen.findByRole('button', { name: /Update this lecture/ }),
    )
    expect(
      screen.getByText(/Nothing is deleted\./, { exact: false }),
    ).toBeInTheDocument()
  })

  it('warns about slides on a layout the update removes', async () => {
    routes({
      available: true,
      affectedSlides: 4,
      impact: [
        {
          layoutType: 'quote',
          slideCount: 4,
          unplaced: [],
          layoutRemoved: true,
        },
      ],
    })
    mount()
    fireEvent.click(
      await screen.findByRole('button', { name: /Update this lecture/ }),
    )
    expect(
      screen.getByText(
        '4 slides use layouts the new design no longer has, and will be left as they are.',
      ),
    ).toBeInTheDocument()
  })

  it('applies on confirm, then takes the notice away', async () => {
    const { applied } = routes(lossy)
    const onApplied = mount()
    fireEvent.click(
      await screen.findByRole('button', { name: /Update this lecture/ }),
    )
    // The dialog's confirm, not the banner's button behind it.
    const confirm = screen
      .getAllByRole('button', { name: /Update this lecture/ })
      .at(-1)!
    fireEvent.click(confirm)

    await waitFor(() => expect(applied).toHaveLength(1))
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
    )
    await waitFor(() =>
      expect(
        screen.queryByText('This design has been updated'),
      ).not.toBeInTheDocument(),
    )
  })
})
