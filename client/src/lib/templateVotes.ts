/**
 * Patches one template's vote tally within a list, by id (TMPL-27 round 3).
 *
 * A `TemplateLibrary` card's `VoteControl` only knows the template it drew a
 * card for; it cannot itself reach into whichever list its caller owns. Every
 * caller that keeps its own `templates` state — `AccountSettingsPage`,
 * `DeckSettingsModal`, `ProjectSettingsModal` — wires `TemplateLibrary`'s
 * `onVote` to this, in its own `setTemplates`, so a cast vote survives
 * whatever unmounts and remounts the Design tab that drew it (switching
 * tabs, closing and reopening a settings modal) rather than reverting to
 * whatever `template.list` last returned.
 */
import type { Template, VoteResult } from '@slide-machine/shared'

export const patchTemplateVote = (
  templates: Template[],
  templateId: string,
  result: VoteResult,
): Template[] =>
  templates.map(t =>
    t.id === templateId
      ? {
          ...t,
          votes: { up: result.up, down: result.down, myVote: result.myVote },
        }
      : t,
  )
