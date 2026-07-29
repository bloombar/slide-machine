/**
 * Unit tests for the template.export action (EXP-2): a built-in template
 * exports to downloadable YAML, and an unknown id is rejected.
 */
import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
import { templateExport } from './template'
import { listBuiltinTemplates } from '../templates/builtin'
import type { ActionContext } from './context'

const ctx = {} as ActionContext

describe('template.export', () => {
  it('exports a built-in template as downloadable YAML', async () => {
    const id = listBuiltinTemplates()[0]!.id
    const res = await templateExport.execute(ctx, { templateId: id })
    expect(res.fileName).toMatch(/\.template\.yaml$/)
    expect(res.mimeType).toBe('application/x-yaml')
    const parsed = YAML.parse(
      Buffer.from(res.contentBase64, 'base64').toString('utf8'),
    )
    expect(parsed.kind).toBe('template')
    expect(parsed.id).toBe(id)
  })

  it('rejects an unknown template', async () => {
    await expect(
      templateExport.execute(ctx, { templateId: 'does-not-exist' }),
    ).rejects.toThrow()
  })
})
