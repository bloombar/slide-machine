/**
 * Telling a model what happened to what it just wrote (MCP layout truth).
 *
 * add_slide, add_slides and edit_slides write the four conventional fields
 * straight through slide.editContent, which applies title/body/bullets/
 * caption unconditionally — unlike an author-named slot, it never checks a
 * conventional field against the layout the slide is actually on
 * (server/src/actions/slide.ts). Two things then go wrong silently:
 *
 *   - a field written to a box the layout does not declare is stored and
 *     never drawn (the layout has no box to draw it in);
 *   - text, a bullet list, or an individual bullet longer than its box's
 *     budget is not refused — it shrinks to a floor and then scrolls on
 *     screen, and runs off the page in PDF/PPTX export.
 *
 * Neither is refused here either: reporting is the job of this module, not
 * enforcement, so a caller deliberately writing long text is never blocked.
 * `fitIssues` returns nothing for a slide whose write fits, so a clean write
 * never grows the tool's result by a single line.
 */
import type { LayoutDescriptor } from '@slide-machine/shared'

/** The four conventional fields a write tool can address — the same ones
 * `slotsOf` (server/src/lib/slide-slots.ts) maps 1:1 onto slot names. */
export interface WrittenContent {
  title?: string
  body?: string
  bullets?: string[]
  caption?: string
}

export type FitIssueKind = 'undrawn' | 'over-budget'

/** One box (or one bullet) that did not fit, in a form a model can act on
 * directly as well as read as prose. */
export interface FitIssue {
  slideId: string
  field: string
  issue: FitIssueKind
  message: string
  used?: number
  allowed?: number
}

const chars = (text: string): number => text.trim().length

const OVER_BUDGET_CONSEQUENCE =
  'Over-budget text shrinks to a floor and then scrolls on screen, or runs off the page in export.'

/** A field written to a box the layout has no slot for — stored, but the
 * layout has nothing to draw it with. */
const undrawn = (
  slideId: string,
  field: string,
  layout: LayoutDescriptor,
): FitIssue => {
  const boxNames = layout.slots.map(s => s.name).join(', ') || 'none'
  return {
    slideId,
    field,
    issue: 'undrawn',
    message:
      `"${field}" will not be drawn: the "${layout.type}" layout has no ` +
      `such box. Its boxes are: ${boxNames}. Content written here is ` +
      'stored but never shown.',
  }
}

/** One slide's fit problems: fields not on its layout, and fields or
 * bullets past their box's budget. Empty when everything fits, or when the
 * layout is unknown (deck.get failed, or the slide's layout was not found
 * in its template) — nothing to check against in that case. */
export const fitIssues = (
  slideId: string,
  content: WrittenContent,
  layout: LayoutDescriptor | undefined,
): FitIssue[] => {
  if (!layout) return []
  const issues: FitIssue[] = []

  for (const field of ['title', 'body', 'caption'] as const) {
    const value = content[field]
    if (value === undefined) continue
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

  if (content.bullets !== undefined) {
    const slot = layout.slots.find(s => s.name === 'bullets')
    if (!slot) {
      issues.push(undrawn(slideId, 'bullets', layout))
    } else {
      if (slot.maxItems && content.bullets.length > slot.maxItems) {
        issues.push({
          slideId,
          field: 'bullets',
          issue: 'over-budget',
          used: content.bullets.length,
          allowed: slot.maxItems,
          message: `"bullets" has ${content.bullets.length} used, ${slot.maxItems} allowed. Extra bullets shrink to a floor and then scroll on screen, or run off the page in export.`,
        })
      }
      content.bullets.forEach((bullet, i) => {
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
