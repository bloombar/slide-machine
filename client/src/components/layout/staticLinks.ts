/**
 * The static pages — About, feedback, and the two legal documents — as one
 * list, shared by the hamburger menu and the site footer so both ways in
 * name the same pages in the same order.
 *
 * English labels, not translation keys, for the reason
 * client/src/content/document.ts gives: the pages themselves are English-only
 * documents, and a translated way in would promise something the page does
 * not deliver.
 */

export interface StaticLink {
  /** In-app path. */
  to: string
  /** What the link says. */
  label: string
  /** True for links that are pointless on a server that cannot send mail. */
  needsMail?: boolean
}

/**
 * The two fenced groups the menu reads as: what we are and how to reach us,
 * then the two documents. The footer flattens them into one row.
 */
export const STATIC_GROUPS: StaticLink[][] = [
  [
    { to: '/about', label: 'About us' },
    { to: '/feedback', label: 'Send feedback', needsMail: true },
  ],
  [
    { to: '/privacy', label: 'Privacy policy' },
    { to: '/terms', label: 'Terms & conditions' },
  ],
]
