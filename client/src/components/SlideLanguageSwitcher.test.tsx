/**
 * Unit tests for the deck viewer's slide-content language picker (SHARE-2):
 * it names the deck's own language as "Original", never offers that language
 * twice, and reports the current choice in its accessible name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { changeLocale } from '../i18n'
import SlideLanguageSwitcher from './SlideLanguageSwitcher'

// The trigger names itself "Slide language: <current choice>"
const TRIGGER = { name: /Slide language/ }

beforeEach(() => {
  localStorage.clear()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await changeLocale('en')
})

const open = () => {
  fireEvent.click(screen.getByRole('button', TRIGGER))
  return screen.getByRole('menu')
}

describe('SlideLanguageSwitcher', () => {
  it("shows the deck's own language as the original", () => {
    render(
      <SlideLanguageSwitcher source="en" value={null} onChange={() => {}} />,
    )
    expect(
      screen.getByRole('button', { name: /Original \(English\)/ }),
    ).toBeInTheDocument()
  })

  it("names the deck's own language, not the reader's", () => {
    render(
      <SlideLanguageSwitcher source="ru" value={null} onChange={() => {}} />,
    )
    expect(
      screen.getByRole('button', { name: /Original \(Русский\)/ }),
    ).toBeInTheDocument()
  })

  it("offers every other locale but not the deck's own", () => {
    render(
      <SlideLanguageSwitcher source="fr" value={null} onChange={() => {}} />,
    )
    const menu = open()
    const items = within(menu).getAllByRole('menuitemradio')
    const labels = items.map(i => i.textContent)
    // Original plus the four locales that are not the deck's own
    expect(items).toHaveLength(5)
    expect(labels.filter(l => l?.includes('Français'))).toHaveLength(1)
    expect(labels.some(l => l?.includes('Español'))).toBe(true)
    expect(labels.some(l => l?.includes('中文'))).toBe(true)
  })

  it('reports the chosen language and marks it checked', () => {
    render(<SlideLanguageSwitcher source="en" value="es" onChange={() => {}} />)
    expect(
      screen.getByRole('button', { name: /Slide language: Español/ }),
    ).toBeInTheDocument()
    const checked = within(open())
      .getAllByRole('menuitemradio')
      .filter(i => i.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0]?.textContent).toContain('Español')
  })

  it('reports a choice and closes the menu', () => {
    const onChange = vi.fn()
    render(
      <SlideLanguageSwitcher source="en" value={null} onChange={onChange} />,
    )
    fireEvent.click(within(open()).getByRole('menuitemradio', { name: /中文/ }))
    expect(onChange).toHaveBeenCalledWith('zh')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('reports null when the reader goes back to the original', () => {
    const onChange = vi.fn()
    render(<SlideLanguageSwitcher source="en" value="fr" onChange={onChange} />)
    fireEvent.click(
      within(open()).getByRole('menuitemradio', { name: /Original/ }),
    )
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('closes on Escape', () => {
    render(
      <SlideLanguageSwitcher source="en" value={null} onChange={() => {}} />,
    )
    open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
