/**
 * Which of a template's layouts a reader can step through (TMPL-4/TMPL-28):
 * every layout but the reserved whiteboard, which cannot be given boxes and
 * would page a card or the editor's rail to a blank slate.
 *
 * Shared so the client library card (`TemplateLibrary.tsx`) and the server's
 * `layoutCount` card metadata (TMPL-28) agree on the same count without
 * restating the rule in two places.
 */
import { WHITEBOARD_LAYOUT_TYPE } from '../types/template'
import type { Layout } from '../types/template'

export const steppableLayouts = (layouts: Layout[] | undefined): Layout[] =>
  (layouts ?? []).filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)
