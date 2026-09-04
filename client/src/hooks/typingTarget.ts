/**
 * True when a keyboard event targets a text field — an input, a textarea,
 * or a contenteditable element — so a global key shortcut can skip it and
 * let the keystroke reach the field instead. Shared by every hook that
 * listens for single-letter shortcuts on `window` (arrow-key navigation,
 * bracket-key layout cycling, full-screen toggling): each used to declare
 * its own private copy of this exact check.
 */
export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable)
