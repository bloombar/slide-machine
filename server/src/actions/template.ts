/**
 * Template actions (TMPL-1, minimal). Only the built-ins for now;
 * user-authored templates (TMPL-4) arrive in a later slice.
 */
import { z } from 'zod'
import type { Template } from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction } from './dispatch'
import { listBuiltinTemplates } from '../templates/builtin'

export const templateList = defineAction<Record<string, never>, Template[]>({
  name: 'template.list',
  input: z.object({}),
  execute: async () => listBuiltinTemplates(),
})

registerAction(templateList)
