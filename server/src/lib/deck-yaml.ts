/**
 * Serializes a slide deck into a standards-based, human-readable YAML document
 * (SPEC EXP-2). The format captures the deck's structure, content, and image
 * attribution so a downstream copy stays license-compliant (EXP-1) and the file
 * is import-compatible for a faithful round-trip (EXP-3).
 *
 * Output is produced with the `yaml` library (never hand-built) so it is always
 * valid. Only fields that are present are written — a missing value is simply
 * absent rather than emitted as an empty key.
 */
import YAML from 'yaml'
import type {
  ExportedDeckSettings,
  ImageAttribution,
  Layout,
  SlotValue,
  Stroke,
} from '@slide-machine/shared'
import type { ExportTheme } from './deck-theme'

/** Format marker written at the top of every export, so an importer can
 * recognize the shape and its version (EXP-3). */
export const DECK_YAML_VERSION = 1

/** One slide's exportable content — a de-serialized view of the stored slide.
 * `drawings` (freehand whiteboard marks) are carried for the visual formats
 * (PDF, Google Slides); the YAML serializer deliberately omits them (see
 * deckToYaml). */
export interface ExportSlide {
  layoutType: string
  /** The slide's content by slot name, so a layout the author arranged can be
   * drawn from its own boxes rather than a hardcoded arrangement. */
  slots?: Record<string, SlotValue>
  title?: string
  body?: string
  bullets?: string[]
  imageRef?: string
  /** Provenance of the image (seeded / stock / generated). Carried so a
   * re-import keeps AI-sourced credit read-only, matching the original (IMG-5). */
  imageSource?: string
  caption?: string
  attribution?: ImageAttribution
  /** What the instructor said over this slide (EDIT-6). Carried so a Google
   * Slides export can put it in the speaker notes, which is what notes mean
   * to a presenter, and bring it back as narration (EXP-8). */
  narration?: string
  drawings?: Stroke[]
}

/** The deck-level fields captured in the export. `theme` (the template's
 * resolved colors) drives the PDF/Slides look and is emitted as inline styling.
 * `settings` makes the file import-compatible (EXP-3): the General-tab lecture
 * settings travel with the deck so a re-import restores them. Seed notes and
 * seed material are not carried (they can hold private/copyrighted content). */
export interface ExportDeck {
  title: string
  templateId: string
  /** The template's layouts, for the renderers to read an arrangement from.
   * Not serialized into the YAML — the file carries content, not design. */
  layouts?: Layout[]
  visibility?: string
  theme?: ExportTheme
  settings?: ExportedDeckSettings
  slides: ExportSlide[]
}

/** Drops undefined/empty values so only present fields are serialized. */
const compact = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out as Partial<T>
}

/** Maps a slide's image (reference, caption, and TASL attribution) into the
 * export shape, or undefined when the slide carries no image. */
const imageBlock = (
  slide: ExportSlide,
): Record<string, unknown> | undefined => {
  const attribution = slide.attribution
    ? compact({ ...slide.attribution })
    : undefined
  const block = compact({
    ref: slide.imageRef,
    source: slide.imageSource,
    caption: slide.caption,
    attribution:
      attribution && Object.keys(attribution).length ? attribution : undefined,
  })
  return Object.keys(block).length ? block : undefined
}

/** Maps the General-tab settings into the export shape, or undefined when none
 * are set (so no empty `settings:` key is emitted). */
const settingsBlock = (
  settings: ExportDeck['settings'],
): Record<string, unknown> | undefined => {
  if (!settings) return undefined
  const block = compact({ ...settings })
  return Object.keys(block).length ? block : undefined
}

/**
 * Renders the deck to a YAML string. Slides are written in display order with
 * their layout, text content, and image (including attribution). The lecture
 * settings are written when present (EXP-3).
 */
export const deckToYaml = (deck: ExportDeck): string => {
  const settings = settingsBlock(deck.settings)
  const doc = {
    version: DECK_YAML_VERSION,
    kind: 'deck',
    title: deck.title,
    // The template it was built from, plus its resolved styling inline so the
    // file captures the look even without that template (EXP-2 "styling").
    templateId: deck.templateId,
    ...(deck.theme ? { styling: { ...deck.theme } } : {}),
    ...(deck.visibility ? { visibility: deck.visibility } : {}),
    ...(settings ? { settings } : {}),
    slides: deck.slides.map(slide =>
      compact({
        layout: slide.layoutType,
        title: slide.title,
        body: slide.body,
        bullets: slide.bullets,
        image: imageBlock(slide),
      }),
    ),
  }
  return YAML.stringify(doc)
}
