/**
 * Telling a model what happened to what it just wrote (MCP layout truth).
 *
 * add_slide, add_slides and edit_slides write the four conventional fields
 * straight through slide.editContent, which applies title/body/bullets/
 * caption unconditionally — unlike an author-named slot, it never checks a
 * conventional field against the layout the slide is actually on
 * (server/src/actions/slide.ts). Three things then go wrong silently:
 *
 *   - a field written to a box the layout does not declare is stored and
 *     never drawn (the layout has no box to draw it in);
 *   - text, a bullet list, or an individual bullet longer than its box's
 *     budget is not refused — it shrinks to a floor and then scrolls on
 *     screen, and runs off the page in PDF/PPTX export;
 *   - a slide already on the `whiteboard` layout has NO text boxes at all
 *     (it is a manual drawing canvas), so every field written to it is
 *     undrawn — and it is the one layout `layoutDescriptors` deliberately
 *     excludes, which would otherwise make this the one case the check is
 *     structurally guaranteed to miss.
 *
 * None of this is refused: reporting is the job of this module, not
 * enforcement, so a caller deliberately writing long text is never blocked.
 *
 * An empty issue list must mean ONE thing — checked, and it fits — never
 * "could not check". A slide on `whiteboard` gets an explicit undrawn entry
 * per field (it never needs the template: whiteboard's absence of boxes is
 * true by construction, not by lookup). A slide whose layoutType is not
 * found in a template that WAS read (a custom layout since renamed or
 * removed) gets an explicit "could not check" entry instead of silence — a
 * measurement that never happened must not read as a passing one. Only when
 * the template itself could not be read at all (deck.get failed) does this
 * stay silent, matching the rest of this surface's established rule that a
 * failed best-effort read costs only what it would have supplied
 * (tools/links.ts's fetchDeckView) rather than the call itself.
 */
import type { LayoutDescriptor } from '@slide-machine/shared'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'

/** The four conventional fields a write tool can address — the same ones
 * `slotsOf` (server/src/lib/slide-slots.ts) maps 1:1 onto slot names. These
 * are also the only boxes add_slide/add_slides/edit_slides can ever fill,
 * regardless of what else a layout declares (list_templates' detail view
 * marks the rest "app only" for the same reason). */
export const WRITABLE_FIELDS = ['title', 'body', 'bullets', 'caption'] as const

export interface WrittenContent {
  title?: string
  body?: string
  bullets?: string[]
  caption?: string
}

export type FitIssueKind = 'undrawn' | 'over-budget' | 'unchecked'

/** One box (or one bullet, or one slide) that did not fit — or could not be
 * checked — in a form a model can act on directly as well as read as prose. */
export interface FitIssue {
  slideId: string
  field: string
  issue: FitIssueKind
  message: string
  used?: number
  allowed?: number
}

const chars = (text: string): number => text.trim().length

/** A value actually worth checking — clearing a field back to empty is not
 * writing it, so it must never be reported as undrawn (it was never drawn
 * because there is nothing there, not because the box is missing). */
const isWritten = (value: string | undefined): value is string =>
  value !== undefined && value !== ''

const OVER_BUDGET_CONSEQUENCE =
  'Over-budget text shrinks to a floor and then scrolls on screen, or runs off the page in export.'

/** A field written to a box the layout has no slot for — stored, but the
 * layout has nothing to draw it with. Names only the boxes this surface can
 * actually address (WRITABLE_FIELDS): a model told "figure, label, caption"
 * on big-number would try writing figure and label next and get nowhere,
 * since neither is reachable from add_slide/add_slides/edit_slides at all. */
const undrawn = (
  slideId: string,
  field: string,
  layout: LayoutDescriptor,
): FitIssue => {
  const boxNames = layout.slots.map(s => s.name)
  const writable = boxNames.filter(n =>
    (WRITABLE_FIELDS as readonly string[]).includes(n),
  )
  const other = boxNames.filter(
    n => !(WRITABLE_FIELDS as readonly string[]).includes(n),
  )
  const reachable = writable.length
    ? `The boxes this tool can write on the "${layout.type}" layout are: ${writable.join(', ')}.`
    : `This tool cannot write any box on the "${layout.type}" layout.`
  const rest = other.length
    ? ` Its other box${other.length === 1 ? '' : 'es'} (${other.join(', ')}) must be filled in the app.`
    : ''
  return {
    slideId,
    field,
    issue: 'undrawn',
    message:
      `"${field}" will not be drawn: the "${layout.type}" layout has no ` +
      `such box. ${reachable}${rest} Content written here is stored but ` +
      'never shown.',
  }
}

/** A field written to a slide on `whiteboard` — a manual drawing canvas
 * with no text boxes at all, so nothing written to it is ever drawn.
 * Reported without needing the deck's template: whiteboard having no boxes
 * is true by construction (server/src/templates/builtin.ts), not by lookup,
 * which is exactly why it must not depend on `layoutDescriptors` — that
 * function excludes whiteboard on purpose (GEN-6), which is what made this
 * the one case the old, template-lookup-only check always missed. */
const whiteboardUndrawn = (slideId: string, field: string): FitIssue => ({
  slideId,
  field,
  issue: 'undrawn',
  message:
    `"${field}" will not be drawn: this slide is on the "whiteboard" ` +
    'layout, a manual drawing canvas with no text boxes at all. Content ' +
    'written here is stored but never shown.',
})

/** The layout a slide claims to be on is not in the template that was
 * actually read — a custom layout since renamed, removed, or from a
 * different template than the one the slide now carries. Nothing here has
 * been checked, and the model must be told that rather than reading silence
 * as "it fit". */
const unchecked = (slideId: string, layoutType: string): FitIssue => ({
  slideId,
  field: '*',
  issue: 'unchecked',
  message:
    `Fit check could not run for this slide: the "${layoutType}" layout ` +
    "was not found in this lecture's current template, so nothing written " +
    'here has been checked against its budgets.',
})

/** The conventional text fields actually written this call — empty means
 * cleared, not written, so it is never reported (see `isWritten`). */
const writtenTextFields = (
  content: WrittenContent,
): ('title' | 'body' | 'caption')[] =>
  (['title', 'body', 'caption'] as const).filter(f => isWritten(content[f]))

/** The bullet list actually written this call, or undefined for "not
 * written" — an empty array clears the bullets, which is not a write. */
const writtenBullets = (content: WrittenContent): string[] | undefined =>
  content.bullets?.length ? content.bullets : undefined

/**
 * One slide's fit problems: fields not on its layout, fields or bullets
 * past their box's budget, or (whiteboard, or a layout gone missing from
 * the template) fields that could not be drawn or checked at all.
 *
 * `descriptors` is `layoutDescriptors(template)` for the deck this slide
 * belongs to, or `undefined` when the template itself could not be read —
 * a distinct case from "read fine, but this layoutType isn't in it" (an
 * empty match against a defined array), which is reported rather than
 * silenced. Returns `[]` only when the write was actually checked and
 * everything fit, or when the template could not be read at all (silent,
 * like the rest of this surface's best-effort reads).
 */
export const fitIssues = (
  slideId: string,
  content: WrittenContent,
  layoutType: string,
  descriptors: LayoutDescriptor[] | undefined,
): FitIssue[] => {
  const textFields = writtenTextFields(content)
  const bullets = writtenBullets(content)
  if (!textFields.length && !bullets) return []

  if (layoutType === WHITEBOARD_LAYOUT_TYPE) {
    const issues = textFields.map(f => whiteboardUndrawn(slideId, f))
    if (bullets) issues.push(whiteboardUndrawn(slideId, 'bullets'))
    return issues
  }

  // The template could not be read at all (deck.get failed) — silent, the
  // same best-effort rule the rest of this surface follows.
  if (!descriptors) return []

  const layout = descriptors.find(d => d.type === layoutType)
  if (!layout) return [unchecked(slideId, layoutType)]

  const issues: FitIssue[] = []
  for (const field of textFields) {
    const value = content[field]!
    const slot = layout.slots.find(s => s.name === field)
    if (!slot) {
      issues.push(undrawn(slideId, field, layout))
      continue
    }
    const used = chars(value)
    if (slot.maxChars && used > slot.maxChars) {
      issues.push({
        slideId,
        field,
        issue: 'over-budget',
        used,
        allowed: slot.maxChars,
        message: `"${field}" is over budget: ${used} used, ${slot.maxChars} allowed. ${OVER_BUDGET_CONSEQUENCE}`,
      })
    }
  }

  if (bullets) {
    const slot = layout.slots.find(s => s.name === 'bullets')
    if (!slot) {
      issues.push(undrawn(slideId, 'bullets', layout))
    } else {
      if (slot.maxItems && bullets.length > slot.maxItems) {
        issues.push({
          slideId,
          field: 'bullets',
          issue: 'over-budget',
          used: bullets.length,
          allowed: slot.maxItems,
          message: `"bullets" has ${bullets.length} used, ${slot.maxItems} allowed. Extra bullets shrink to a floor and then scroll on screen, or run off the page in export.`,
        })
      }
      bullets.forEach((bullet, i) => {
        const used = chars(bullet)
        if (slot.maxChars && used > slot.maxChars) {
          issues.push({
            slideId,
            field: `bullets[${i}]`,
            issue: 'over-budget',
            used,
            allowed: slot.maxChars,
            message: `bullet ${i + 1} is over budget: ${used} used, ${slot.maxChars} allowed. ${OVER_BUDGET_CONSEQUENCE}`,
          })
        }
      })
    }
  }

  return issues
}

/** The tail appended to a tool's result text — undefined when there is
 * nothing to report, so a clean write's text is unchanged. */
export const fitReportText = (issues: FitIssue[]): string | undefined =>
  issues.length
    ? `\n\nFit check:\n${issues.map(i => `- ${i.slideId}: ${i.message}`).join('\n')}`
    : undefined
