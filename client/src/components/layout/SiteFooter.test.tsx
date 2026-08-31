/**
 * Unit tests for the site footer: the static-page links are present without
 * any interaction, which is what makes the privacy policy reachable in one
 * click from a signed-out homepage, and the feedback link drops out on a
 * server that cannot send mail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import * as runtimeConfig from '../../runtime-config'
import SiteFooter from './SiteFooter'

const renderFooter = () =>
  render(
    <MemoryRouter>
      <SiteFooter />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.spyOn(runtimeConfig, 'getFeedbackEnabled').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('SiteFooter', () => {
  it('links the static pages with no drawer to open', () => {
    renderFooter()
    expect(
      screen.getByRole('link', { name: 'Privacy policy' }),
    ).toHaveAttribute('href', '/privacy')
    expect(
      screen.getByRole('link', { name: 'Terms & conditions' }),
    ).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'About us' })).toHaveAttribute(
      'href',
      '/about',
    )
    expect(screen.getByRole('link', { name: 'Send feedback' })).toHaveAttribute(
      'href',
      '/feedback',
    )
  })

  it('drops the feedback link when the server cannot send mail', () => {
    vi.spyOn(runtimeConfig, 'getFeedbackEnabled').mockReturnValue(false)
    renderFooter()
    expect(screen.queryByRole('link', { name: 'Send feedback' })).toBeNull()
    // The documents are unaffected — only the mail-dependent link goes
    expect(
      screen.getByRole('link', { name: 'Privacy policy' }),
    ).toBeInTheDocument()
  })
})
