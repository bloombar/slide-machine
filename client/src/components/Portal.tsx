/**
 * Renders its children into document.body via a portal, so a full-screen
 * overlay escapes every ancestor stacking context and layers purely by its
 * own z-index. Without this, a dialog mounted inside an element that creates
 * a stacking context (e.g. the image slot's `z-10` group) is trapped at that
 * element's level and paints beneath page chrome no matter how high its own
 * z-index — the search dialog appearing under the deck toolbar was exactly
 * this. See the z-index tiers in docs/DECISIONS.md.
 */
import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export default function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
