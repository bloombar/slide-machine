/**
 * Unit tests for what template.export produces (EXP-2): a built-in template
 * serialized to downloadable YAML.
 *
 * Who may export is no longer this test's business — the action declares
 * `templateReadable` and the dispatcher enforces it before `execute` runs, so
 * the rule is pinned once against the policy (test/integration) rather than
 * re-tested per action that borrows it. What is left here is the part that
 * needs no database: the serialization.
 */
import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
import type { Template } from '@slide-machine/shared'
import { templateExport, templateDescriptorStatus } from './template'
import { listBuiltinTemplates } from '../templates/builtin'
import type { ActionContext } from './context'
import type { TemplateAccess } from './access'

const ctx: ActionContext = {
  userId: '507f1f77bcf86cd799439011',
  requestId: 'test-request',
}

/** What the policy would have resolved for a built-in: no stored document. */
const accessTo = (id: string): TemplateAccess => ({
  userId: ctx.userId!,
  template: listBuiltinTemplates().find(t => t.id === id)!,
  doc: null,
})

/**
 * A synthetic over-budget template. No shipped design exceeds the
 * recommended budget any more (`descriptor-budget.test.ts`), so the
 * over-budget case is exercised here by a fixture rather than by a built-in
 * — that is stated plainly rather than implied by a passing suite.
 */
const overBudgetAccess = (): TemplateAccess => {
  const description = 'x'.repeat(5200)
  const template: Template = {
    id: 'over-budget-fixture',
    permalinkSlug: 'over-budget-fixture',
    ownerId: ctx.userId!,
    name: 'Over-budget fixture',
    theme: {},
    layouts: [
      {
        type: 'content',
        label: 'Content',
        purpose: 'A fixture layout whose instruction alone exceeds the budget',
        slots: [{ name: 'title', kind: 'text', label: 'Title', description }],
        elementPositions: {},
      },
    ],
    visibility: 'private',
    voteScore: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  return { userId: ctx.userId!, template, doc: null }
}

describe('template.export', () => {
  it('exports a built-in template as downloadable YAML', async () => {
    const id = listBuiltinTemplates()[0]!.id
    const res = await templateExport.execute(
      ctx,
      { templateId: id },
      accessTo(id),
    )
    expect(res.fileName).toMatch(/\.template\.yaml$/)
    expect(res.mimeType).toBe('application/x-yaml')
    const parsed = YAML.parse(
      Buffer.from(res.contentBase64, 'base64').toString('utf8'),
    )
    expect(parsed.kind).toBe('template')
    expect(parsed.id).toBe(id)
  })

  it('names the file after the design, slugified', async () => {
    const template = listBuiltinTemplates()[0]!
    const res = await templateExport.execute(
      ctx,
      { templateId: template.id },
      accessTo(template.id),
    )
    expect(res.fileName).toBe(
      `${template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.template.yaml`,
    )
  })
})

/**
 * template.descriptorStatus (TMPL-25): the same length the prompt actually
 * costs, so the Design tab and the template editor can tell an author their
 * instructions have grown past the recommended budget.
 */
describe('template.descriptorStatus', () => {
  it('reports over-budget for a template whose menu exceeds the recommended max', async () => {
    // No shipped design measures over the 5000-char default any more — nyu-bold
    // did, at 5104, until its instruction wording was trimmed to fit
    // (docs/DECISIONS.md). The over-budget case is exercised here by a
    // fixture instead.
    const access = overBudgetAccess()
    const res = await templateDescriptorStatus.execute(
      ctx,
      { templateId: access.template.id },
      access,
    )
    expect(res.overBudget).toBe(true)
    expect(res.length).toBeGreaterThan(res.max)
  })

  it('reports under-budget for a template whose menu is within it', async () => {
    const id = 'classic'
    const res = await templateDescriptorStatus.execute(
      ctx,
      { templateId: id },
      accessTo(id),
    )
    expect(res.overBudget).toBe(false)
    expect(res.length).toBeLessThanOrEqual(res.max)
  })
})
