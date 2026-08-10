/**
 * Unit tests for the usage call to action (BILL-4/BILL-5). The sentence itself
 * is translation; what is worth pinning is which words become links, and where
 * they go — an invitation to get in touch with no way to do it is the defect
 * this component exists to prevent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { PlanTier } from '@slide-machine/shared'
import * as runtimeConfig from '../runtime-config'
import UsageCallToAction from './UsageCallToAction'

const renderCta = (
  tier: PlanTier,
  { linkToPlan = false, onFollow }: Parameters<typeof UsageCallToAction>[0] = {
    tier,
  },
) =>
  render(
    <MemoryRouter>
      <UsageCallToAction
        tier={tier}
        linkToPlan={linkToPlan}
        onFollow={onFollow}
      />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.spyOn(runtimeConfig, 'getFeedbackEnabled').mockReturnValue(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('UsageCallToAction', () => {
  it('sends a Max account to the feedback form, on "Something else"', async () => {
    // No larger plan exists, so the only useful action is talking to us — and
    // an account asking for more room than Max is neither reporting a bug nor
    // requesting a feature.
    renderCta('max')

    expect(
      await screen.findByRole('link', { name: 'get in touch' }),
    ).toHaveAttribute('href', '/feedback?kind=other')
  })

  it.each(['free', 'fresh', 'pro'] as const)(
    'offers %s an upgrade rather than a conversation',
    async tier => {
      renderCta(tier, { tier, linkToPlan: true })

      expect(
        await screen.findByRole('link', { name: 'Upgrading' }),
      ).toHaveAttribute('href', '/app/settings?tab=plan')
      expect(screen.queryByRole('link', { name: 'get in touch' })).toBeNull()
    },
  )

  it('states the plan wording without a link where none was asked for', async () => {
    renderCta('free')

    expect(await screen.findByText(/raises every limit/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('drops the contact link on a server with no feedback form', async () => {
    // Pointing at a page that can only say "there is nowhere to send this" is
    // worse than leaving the words alone — the shell menu hides its own entry
    // for the same reason.
    vi.spyOn(runtimeConfig, 'getFeedbackEnabled').mockReturnValue(false)

    renderCta('max')

    expect(await screen.findByText(/largest plan/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('never leaves the markup slots in the text', async () => {
    renderCta('max')

    await screen.findByText(/largest plan/)
    expect(document.body.textContent).not.toContain('contactLink')
    expect(document.body.textContent).not.toContain('<')
  })

  it('tells the caller when a link was followed', async () => {
    // The footer badge closes its popover on the way out.
    const onFollow = vi.fn()
    renderCta('max', { tier: 'max', onFollow })
    ;(await screen.findByRole('link', { name: 'get in touch' })).click()

    expect(onFollow).toHaveBeenCalled()
  })
})
