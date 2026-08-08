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
import { templateExport } from './template'
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
