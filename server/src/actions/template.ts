/**
 * Template actions (TMPL-1, minimal). Only the built-ins for now;
 * user-authored templates (TMPL-4) arrive in a later slice.
 *   - template.list   — the available style templates.
 *   - template.export — a template serialized to YAML for download (EXP-2).
 */
import { z } from 'zod'
import type { ExportDownload, Template } from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionValidationError } from './dispatch'
import { getBuiltinTemplate, listBuiltinTemplates } from '../templates/builtin'
import { templateToYaml } from '../lib/template-yaml'

export const templateList = defineAction<Record<string, never>, Template[]>({
  name: 'template.list',
  input: z.object({}),
  execute: async () => listBuiltinTemplates(),
})

/**
 * Exports a style template to a YAML file (EXP-2), returned inline for the
 * browser to download — the template's identity, theme, and layouts.
 */
export const templateExport = defineAction<
  { templateId: string },
  ExportDownload
>({
  name: 'template.export',
  input: z.object({ templateId: z.string().min(1) }),
  execute: async (_ctx, input) => {
    const template = getBuiltinTemplate(input.templateId)
    if (!template) {
      throw new ActionValidationError('template.export', ['unknown template'])
    }
    const slug =
      template.id.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'template'
    return {
      fileName: `${slug}.template.yaml`,
      mimeType: 'application/x-yaml',
      contentBase64: Buffer.from(templateToYaml(template), 'utf8').toString(
        'base64',
      ),
    }
  },
})

registerAction(templateList)
registerAction(templateExport)
