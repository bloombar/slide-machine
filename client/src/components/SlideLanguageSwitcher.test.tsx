/**
 * Unit tests for the deck viewer's slide-content language picker (SHARE-2):
 * it denotes each language by its flag, marks the deck's own language with a
 * dot, never offers that language twice, and reports the current choice in
 * its accessible name.
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

/** A row's label, which is its accessible name — the flag has no text. */
const labels = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitemradio')
    .map(i => i.getAttribute('aria-label'))

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

  it("offers every locale once, the deck's own leading", () => {
    render(
      <SlideLanguageSwitcher source="fr" value={null} onChange={() => {}} />,
    )
    const menu = open()
    const names = labels(menu)
    // The original plus the four locales that are not the deck's own
    expect(names).toHaveLength(5)
    expect(names[0]).toBe('Original (Français)')
    expect(names.filter(l => l?.includes('Français'))).toHaveLength(1)
    expect(names).toContain('Español')
    expect(names).toContain('中文')
  })

  it('denotes languages by flag rather than by name', () => {
    render(
      <SlideLanguageSwitcher source="fr" value={null} onChange={() => {}} />,
    )
    const menu = open()
    const rows = within(menu).getAllByRole('menuitemradio')
    // No language names take up room in the menu; every row is a flag
    expect(rows.every(row => row.textContent === '')).toBe(true)
    expect(
      rows.map(row =>
        row.querySelector('svg[data-locale]')?.getAttribute('data-locale'),
      ),
    ).toEqual(['fr', 'en', 'es', 'ru', 'zh'])
  })

  it('flies the flag of the language on screen', () => {
    const { rerender } = render(
      <SlideLanguageSwitcher source="ru" value={null} onChange={() => {}} />,
    )
    const flag = () =>
      screen
        .getByRole('button', TRIGGER)
        .querySelector('svg[data-locale]')
        ?.getAttribute('data-locale')
    // The deck's own language while the original is showing...
    expect(flag()).toBe('ru')
    // ...and the translation's once one is chosen
    rerender(
      <SlideLanguageSwitcher source="ru" value="zh" onChange={() => {}} />,
    )
    expect(flag()).toBe('zh')
  })

  it("marks the deck's own language with a dot, and only that one", () => {
    render(<SlideLanguageSwitcher source="es" value="en" onChange={() => {}} />)
    const menu = open()
    const dots = within(menu).getAllByTestId('default-language-dot')
    expect(dots).toHaveLength(1)
    const row = dots[0]?.closest('[role="menuitemradio"]')
    expect(row?.getAttribute('aria-label')).toBe('Original (Español)')
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
    expect(checked[0]?.getAttribute('aria-label')).toBe('Español')
  })

  it("checks the deck's own language while the original is showing", () => {
    render(
      <SlideLanguageSwitcher source="en" value={null} onChange={() => {}} />,
    )
    const checked = within(open())
      .getAllByRole('menuitemradio')
      .filter(i => i.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0]?.getAttribute('aria-label')).toBe('Original (English)')
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

  it('spins while a translation is being fetched, keeping the flag', () => {
    const { container, rerender } = render(
      <SlideLanguageSwitcher source="en" value="fr" onChange={() => {}} />,
    )
    expect(container.querySelector('.animate-spin')).toBeNull()
    rerender(
      <SlideLanguageSwitcher source="en" value="fr" onChange={() => {}} busy />,
    )
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(
      screen.getByRole('button', TRIGGER).querySelector('svg[data-locale]'),
    ).not.toBeNull()
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
