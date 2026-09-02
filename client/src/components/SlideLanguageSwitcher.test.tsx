/**
 * Unit tests for the deck viewer's slide-content language picker (SHARE-2):
 * its trigger is an icon alone, its menu names every language once, a check
 * marks the one being read, and the trigger reports that choice in its
 * accessible name.
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

/** Every row's label, in menu order. */
const labels = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitemradio')
    .map(i => i.textContent)

/** The rows showing a checkmark. Every row holds one — it keeps the menu a
 * steady width — but only the current choice's is visible. */
const checkedRows = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitemradio')
    .filter(row => {
      const check = row.querySelector('svg')
      return check !== null && !check.classList.contains('invisible')
    })

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

  it('names every language, and nothing else stands in for one', () => {
    render(
      <SlideLanguageSwitcher source="fr" value={null} onChange={() => {}} />,
    )
    const rows = within(open()).getAllByRole('menuitemradio')
    expect(rows.map(row => row.textContent)).toEqual([
      'Original (Français)',
      'English',
      'Español',
      'Русский',
      '中文',
    ])
  })

  it('keeps the trigger to its icon, whatever language is on screen', () => {
    const { rerender } = render(
      <SlideLanguageSwitcher source="ru" value={null} onChange={() => {}} />,
    )
    // The nav has no room for a language name, so the trigger carries none
    const trigger = () => screen.getByRole('button', TRIGGER)
    expect(trigger().textContent).toBe('')
    rerender(
      <SlideLanguageSwitcher source="ru" value="zh" onChange={() => {}} />,
    )
    expect(trigger().textContent).toBe('')
  })

  it('reports the chosen language and checks its row', () => {
    render(<SlideLanguageSwitcher source="en" value="es" onChange={() => {}} />)
    expect(
      screen.getByRole('button', { name: /Slide language: Español/ }),
    ).toBeInTheDocument()
    const menu = open()
    const checked = within(menu)
      .getAllByRole('menuitemradio')
      .filter(i => i.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0]?.textContent).toBe('Español')
    // And the check is the one a reader can actually see
    expect(checkedRows(menu).map(row => row.textContent)).toEqual(['Español'])
  })

  it("checks the deck's own language while the original is showing", () => {
    render(
      <SlideLanguageSwitcher source="en" value={null} onChange={() => {}} />,
    )
    const menu = open()
    const checked = within(menu)
      .getAllByRole('menuitemradio')
      .filter(i => i.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0]?.textContent).toBe('Original (English)')
    expect(checkedRows(menu).map(row => row.textContent)).toEqual([
      'Original (English)',
    ])
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

  it('spins while a translation is being fetched', () => {
    const { container, rerender } = render(
      <SlideLanguageSwitcher source="en" value="fr" onChange={() => {}} />,
    )
    expect(container.querySelector('.animate-spin')).toBeNull()
    rerender(
      <SlideLanguageSwitcher source="en" value="fr" onChange={() => {}} busy />,
    )
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    // The spinner takes the chevron's place, so the icon stays put
    expect(
      screen.getByRole('button', TRIGGER).querySelectorAll('svg'),
    ).toHaveLength(2)
  })

  it('closes on Escape', () => {
    render(
      <SlideLanguageSwitcher source="en" value={null} onChange={() => {}} />,
    )
    open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  // Translated viewing needs an account (AUTH-8): a signed-out visitor's
  // click raises the sign-in gate instead of opening the language menu.
  it('raises the gate instead of opening the menu while locked', () => {
    const onChange = vi.fn()
    const onLockedClick = vi.fn()
    render(
      <SlideLanguageSwitcher
        source="en"
        value={null}
        onChange={onChange}
        locked
        onLockedClick={onLockedClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', TRIGGER))
    expect(onLockedClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opens the menu as usual once unlocked', () => {
    const onLockedClick = vi.fn()
    render(
      <SlideLanguageSwitcher
        source="en"
        value={null}
        onChange={() => {}}
        locked={false}
        onLockedClick={onLockedClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', TRIGGER))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(onLockedClick).not.toHaveBeenCalled()
  })
})
