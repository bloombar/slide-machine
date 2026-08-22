/**
 * Unit tests for the badge switch: which logo candidate a URL selects, how
 * the choice is remembered, and what it does to the favicon.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  resolveBadgeChoice,
  badgeUrlFor,
  getBadgeUrl,
  initBadge,
} from './badge'

/** Puts the page on a URL and gives it the icon links index.html ships. */
const visit = (search: string): HTMLLinkElement[] => {
  window.history.replaceState({}, '', `/${search}`)
  document.head.innerHTML = ''
  const ico = document.createElement('link')
  ico.rel = 'icon'
  ico.href = '/favicon.ico'
  ico.setAttribute('sizes', '32x32')
  const svg = document.createElement('link')
  svg.rel = 'icon'
  svg.type = 'image/svg+xml'
  svg.href = '/icon.svg'
  document.head.append(ico, svg)
  return [ico, svg]
}

describe('resolveBadgeChoice', () => {
  it('takes the choice the query parameter names', () => {
    expect(resolveBadgeChoice('?badge=classic', null)).toBe('classic')
    expect(resolveBadgeChoice('?badge=a', 'classic')).toBe('a')
  })

  it('falls back to the remembered choice when no parameter is given', () => {
    // Without this the badge would snap back to the shipping mark on every
    // link click, which makes the other one impossible to look at for long.
    expect(resolveBadgeChoice('', 'classic')).toBe('classic')
    expect(resolveBadgeChoice('?deck=7', 'classic')).toBe('classic')
  })

  it('falls back to the shipping mark when nothing names a real choice', () => {
    expect(resolveBadgeChoice('', null)).toBe('a')
    expect(resolveBadgeChoice('?badge=purple', null)).toBe('a')
    expect(resolveBadgeChoice('', 'purple')).toBe('a')
    expect(resolveBadgeChoice('?badge=purple', 'classic')).toBe('classic')
  })
})

describe('badgeUrlFor', () => {
  it('gives each choice its own asset', () => {
    const urls = [badgeUrlFor('a'), badgeUrlFor('classic')]
    expect(new Set(urls).size).toBe(2)
    // Vite inlines assets this small, so the URLs are data: URIs rather
    // than file paths — what matters is that both candidates are the SVGs.
    expect(badgeUrlFor('classic')).toContain('svg')
    expect(badgeUrlFor('a')).toContain('svg')
  })
})

describe('initBadge', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    visit('')
    initBadge()
  })

  it('remembers the choice a URL asks for', () => {
    visit('?badge=classic')
    expect(initBadge()).toBe('classic')
    expect(window.localStorage.getItem('slideMachine.badge')).toBe('classic')

    visit('')
    expect(initBadge()).toBe('classic')
    expect(getBadgeUrl()).toBe(badgeUrlFor('classic'))
  })

  it('points every icon link at the old mark while it is being looked at', () => {
    const icons = visit('?badge=classic')
    initBadge()
    // Both links move: a browser that reads SVG prefers /icon.svg, so
    // rewriting only the .ico would leave the tab showing the other mark.
    for (const icon of icons) {
      expect(icon.href).toBe(badgeUrlFor('classic'))
      expect(icon.type).toBe('image/svg+xml')
      expect(icon.hasAttribute('sizes')).toBe(false)
    }
  })

  it('leaves the shipped favicon alone for the shipping mark', () => {
    // index.html's icons are cut from this mark already; rewriting the link
    // would swap a three-size .ico for a single SVG for no reason.
    const icons = visit('?badge=a')
    initBadge()
    expect(icons.map(icon => icon.getAttribute('href'))).toEqual([
      '/favicon.ico',
      '/icon.svg',
    ])
    expect(getBadgeUrl()).toBe(badgeUrlFor('a'))
  })

  it('survives storage it cannot read or write', () => {
    // Private browsing throws on both; a logo experiment must not take the
    // page down with it.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    visit('?badge=classic')
    expect(initBadge()).toBe('classic')
  })
})
