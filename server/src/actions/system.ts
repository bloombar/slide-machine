/**
 * System actions. `system.echo` is a demo action that exercises the full
 * dispatch pipeline end-to-end until real actions (slide.*, deck.*,
 * concept.*) land with their features.
 */
import { z } from 'zod'
import { defineAction } from './define'
import { registerAction } from './dispatch'

export const systemEcho = defineAction({
  name: 'system.echo',
  input: z.object({ message: z.string().min(1) }),
  execute: async (ctx, input) => ({
    message: input.message,
    requestId: ctx.requestId,
  }),
})

registerAction(systemEcho)
