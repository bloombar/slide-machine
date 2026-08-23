/**
 * Every template this app ships is audited, so a design with a defect in it
 * cannot be committed (TMPL-8/TMPL-9).
 *
 * The rules are in `audit.ts` and each one earned its place by catching
 * something real while importing a Google Slides deck. What makes them worth
 * running here is that none of them are about imports: a hand-written template
 * can just as easily put two boxes of words on top of each other, or set a
 * caption in a colour that cannot be read against the page behind it.
 *
 * This is a gate on the DATA, and it is worth being clear about what that
 * does not cover: a template whose every colour was misread from its source
 * will pass. Only looking at it renders that judgement.
 *
 * ## If this is red for a template you do not recognise
 *
 * Every file in `server/config/templates/` ships, so every file in it is
 * audited — which is the point, and why this reads the loaded set rather than
 * a list of ids it expects. A design derived from someone's deck and dropped
 * in there for review is therefore audited like any other, and a derived
 * design usually has something wrong with it. That is the check working.
 *
 * Remove the temporary file before merging; do not exempt its id. An id
 * allow-list would let a genuinely bad built-in be added without this
 * noticing, so long as nobody put it on the list, which turns a gate into a
 * checklist.
 */
import { describe, it, expect } from 'vitest'
import { listBuiltinTemplates } from './builtin'
import { auditTemplate, type AuditFinding } from './audit'

/** A finding as a line someone can act on, rather than an object dump. */
const readable = (finding: AuditFinding): string =>
  `[${finding.rule}] ${[finding.layout, finding.box].filter(Boolean).join('.')} ${finding.message}`

describe('every built-in design', () => {
  const templates = listBuiltinTemplates()

  it('is a set worth auditing at all', () => {
    // Guards the loop below: if the built-ins ever stopped loading, every
    // assertion in it would pass by having nothing to check.
    expect(templates.length).toBeGreaterThan(0)
    for (const template of templates)
      expect(
        template.layouts.length,
        `${template.id} has no layouts`,
      ).toBeGreaterThan(0)
  })

  for (const template of templates)
    it(`${template.id} has nothing wrong with it`, () => {
      const { faults } = auditTemplate(template)
      expect(
        faults.map(readable),
        `${template.id} has faults in its own data:\n${faults
          .map(readable)
          .join(
            '\n',
          )}\n\nIf this is a design imported for review rather than ` +
          `one this app ships, remove it from server/config/templates/ before ` +
          `merging rather than exempting it here.`,
      ).toEqual([])
    })
})
