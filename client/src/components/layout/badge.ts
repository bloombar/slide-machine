/**
 * Which badge the shells and the favicon draw.
 *
 * The app ships option A — the solid bubble with the slide knocked out in
 * white — as `badge-a.svg`, and index.html's icons are cut from the same
 * mark. The mark it replaced is still one query parameter away, so the two
 * can be held up against each other in the running app: put
 * `?badge=classic` on any URL, `?badge=a` to come back. The choice is
 * remembered for the browser afterwards, so it survives navigation.
 *
 * Temporary: when the old mark is no longer worth keeping around, this
 * module goes away and the shells import badge-a.svg directly.
 */
import optionAUrl from '../../assets/badge-a.svg'
import classicUrl from '../../assets/badge-classic.svg'

export const BADGE_CHOICES = ['a', 'classic'] as const

export type BadgeChoice = (typeof BADGE_CHOICES)[number]

/** What the app ships when nothing asks for anything else. */
const DEFAULT_CHOICE: BadgeChoice = 'a'

/** Where the remembered choice lives. */
const STORAGE_KEY = 'slideMachine.badge'

const URLS: Record<BadgeChoice, string> = {
  a: optionAUrl,
  classic: classicUrl,
}

const isChoice = (value: string | null): value is BadgeChoice =>
  value !== null && (BADGE_CHOICES as readonly string[]).includes(value)

/**
 * The parameter wins when it names a real choice; otherwise whatever was
 * remembered; otherwise the shipping mark.
 */
export const resolveBadgeChoice = (
  search: string,
  stored: string | null,
): BadgeChoice => {
  const asked = new URLSearchParams(search).get('badge')
  if (isChoice(asked)) return asked
  return isChoice(stored) ? stored : DEFAULT_CHOICE
}

/** The asset for a choice. */
export const badgeUrlFor = (choice: BadgeChoice): string => URLS[choice]

/** The remembered choice, or null when storage is unreadable. */
const readStored = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

let current: BadgeChoice = DEFAULT_CHOICE

/** The badge the shells should draw, settled by initBadge(). */
export const getBadgeUrl = (): string => URLS[current]

/**
 * Settles the choice before the first paint, remembers it, and — when the
 * old mark is the one being looked at — points the favicon at it too, so
 * the 16px reading can be judged in a real tab. Storage can throw (private
 * browsing), which is never worth failing a page load over, so every
 * access is guarded.
 */
export const initBadge = (): BadgeChoice => {
  current = resolveBadgeChoice(window.location.search, readStored())

  try {
    window.localStorage.setItem(STORAGE_KEY, current)
  } catch {
    // Not being able to remember the choice only costs a query parameter.
  }

  // The icons index.html ships are already cut from the shipping mark.
  // Every icon link has to move, not just the first: the page offers an
  // .ico and an .svg, and a browser that reads SVG would keep showing the
  // one this preview is meant to replace.
  if (current !== DEFAULT_CHOICE) {
    const icons = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')
    icons.forEach(icon => {
      icon.href = URLS[current]
      icon.type = 'image/svg+xml'
      icon.removeAttribute('sizes')
    })
  }

  return current
}
