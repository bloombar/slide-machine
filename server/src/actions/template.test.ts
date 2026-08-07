/**
 * Unit tests for the template.export action (EXP-2): a built-in template
 * exports to downloadable YAML for any signed-in caller, and both an unknown
 * id and an anonymous caller are refused.
 *
 * Who may export a *stored* template is the same question as who may view it,
 * and answering it needs the database — that case lives in the integration
 * suite (template-export.test.ts).
 */
import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
import { templateExport } from './template'
import { ActionForbiddenError } from './dispatch'
import { listBuiltinTemplates } from '../templates/builtin'
import type { ActionContext } from './context'

const ctx: ActionContext = {
  userId: '507f1f77bcf86cd799439011',
  requestId: 'test-request',
}

describe('template.export', () => {
  it('exports a built-in template as downloadable YAML', async () => {
    const id = listBuiltinTemplates()[0]!.id
    const res = await templateExport.execute(ctx, { templateId: id }, undefined)
    expect(res.fileName).toMatch(/\.template\.yaml$/)
    expect(res.mimeType).toBe('application/x-yaml')
    const parsed = YAML.parse(
      Buffer.from(res.contentBase64, 'base64').toString('utf8'),
    )
    expect(parsed.kind).toBe('template')
    expect(parsed.id).toBe(id)
  })

  // Refused, not reported as invalid input: an unknown id and a design the
  // caller may not see answer identically, so neither can be told from the
  // other by probing.
  it('refuses an unknown template', async () => {
    await expect(
      templateExport.execute(ctx, { templateId: 'does-not-exist' }, undefined),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })

  it('refuses an anonymous caller', async () => {
    const id = listBuiltinTemplates()[0]!.id
    await expect(
      templateExport.execute(
        { requestId: 'test-request' },
        { templateId: id },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ActionForbiddenError)
  })
})
