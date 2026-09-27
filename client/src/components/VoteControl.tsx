/**
 * Reddit-style vote widget, shared by a lecture (SOC-1) and a design
 * template (TMPL-27). Two arrows side by side, each with its own count — ▲
 * up-votes and ▼ down-votes — kept neutral (black/white) so it reads as a
 * quiet side option. The arrow matching the caller's own vote fills solid.
 * Clicking casts or changes a vote; clicking the active arrow clears it.
 * Updates are optimistic and revert on failure.
 *
 * `target` says what is being voted on — `deck.vote` or `template.vote` —
 * so one component serves the lecture viewer and every place a template is
 * shown (its own page, and a library card). Browsable lists show a
 * read-only `VoteCount` instead, so a list never presents a control that
 * needs the item's own context to be honest.
 *
 * `size="compact"` matches this to the small icon row a template library
 * card already draws (duplicate/edit/delete): same icon size, no outer
 * pill — the count beside each arrow still shows, just at that row's own
 * smaller text size.
 */
import { useEffect, useState } from 'react'
import { ArrowBigUp, ArrowBigDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MyVote, VoteResult } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'

/** What is being voted on, and the action it dispatches to. */
export type VoteTarget =
  { kind: 'deck'; id: string } | { kind: 'template'; id: string }

export default function VoteControl({
  target,
  name,
  up: initialUp,
  down: initialDown,
  myVote: initialVote,
  onChange,
  size = 'default',
  className = '',
}: {
  target: VoteTarget
  /** The lecture's or design's own name, so the aria label says what is
   * being voted on ("Upvote {name}") rather than a bare "Upvote". */
  name: string
  up: number
  down: number
  myVote: MyVote
  /** Told about every settled vote (TMPL-27), so a caller holding the same
   * counts elsewhere — a library card's list state — can keep them in sync
   * without this control needing to know where they live. */
  onChange?: (result: VoteResult) => void
  /** 'compact' matches a template card's own icon row (TMPL-27); 'default'
   * is the bordered pill a lecture's viewer and a design's own page use. */
  size?: 'default' | 'compact'
  className?: string
}) {
  const { t } = useTranslation()
  const [up, setUp] = useState(initialUp)
  const [down, setDown] = useState(initialDown)
  const [myVote, setMyVote] = useState<MyVote>(initialVote)
  const [pending, setPending] = useState(false)

  // Adopt fresh counts from the caller once nothing is in flight (TMPL-27
  // round 2): a re-render with new props — a library reload after a
  // duplicate, a delete, or an import — should show the counts that reload
  // brought back, not whatever this control set on mount and never
  // revisited. `pending` is read, not listed as a dependency: including it
  // would re-run this the instant a vote's own response clears `pending`,
  // reapplying props that have not caught up with that response yet and
  // undoing what `cast` just wrote.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (pending) return
    setUp(initialUp)
    setDown(initialDown)
    setMyVote(initialVote)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUp, initialDown, initialVote])
  /* eslint-enable react-hooks/set-state-in-effect */

  const action = target.kind === 'deck' ? 'deck.vote' : 'template.vote'
  const idField = target.kind === 'deck' ? 'deckId' : 'templateId'

  /** Toggle the given direction: clicking the active arrow clears the vote. */
  const cast = async (dir: 1 | -1) => {
    if (pending) return
    const next: MyVote = myVote === dir ? 0 : dir
    const prev = { vote: myVote, up, down }
    // Optimistic: shift the affected counts immediately, revert on failure.
    let nextUp = up
    let nextDown = down
    if (prev.vote === 1) nextUp -= 1
    if (prev.vote === -1) nextDown -= 1
    if (next === 1) nextUp += 1
    if (next === -1) nextDown += 1
    setUp(nextUp)
    setDown(nextDown)
    setMyVote(next)
    setPending(true)
    try {
      const res = await dispatchAction<VoteResult>(action, {
        [idField]: target.id,
        value: next,
      })
      setUp(res.up)
      setDown(res.down)
      setMyVote(res.myVote)
      onChange?.(res)
    } catch {
      setUp(prev.up)
      setDown(prev.down)
      setMyVote(prev.vote)
    } finally {
      setPending(false)
    }
  }

  const compact = size === 'compact'

  const arrow = (dir: 1 | -1) => {
    const Icon = dir === 1 ? ArrowBigUp : ArrowBigDown
    const active = myVote === dir
    const count = dir === 1 ? up : down
    // Down-votes read as negative (1 down → -1, 2 → -2); -0 renders as "0".
    const shown = dir === 1 ? count : -count
    const label = t(dir === 1 ? 'vote.upNamed' : 'vote.downNamed', { name })
    const solid = active ? 'fill-current text-slate-900' : ''
    return (
      <button
        key={dir}
        type="button"
        // Defensive rather than load-bearing today: `TemplateLibrary`'s
        // vote row sits beside the card's selectable radio, not inside it,
        // so nothing currently bubbles up to select the card — unlike the
        // duplicate/edit/delete icons, which need no guard for the same
        // reason. Kept anyway, since a vote is its own act (TMPL-27) and
        // this control is also dropped into places (a page header) that
        // are not a `TemplateLibrary` card at all.
        onClick={e => {
          e.stopPropagation()
          void cast(dir)
        }}
        disabled={pending}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className={
          compact
            ? 'flex items-center gap-0.5 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50'
            : 'flex items-center gap-1 rounded-full px-2.5 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50'
        }
      >
        <Icon
          className={`${compact ? 'h-3.5 w-3.5' : 'h-5 w-5'} ${solid}`}
          aria-hidden
        />
        <span
          className={`min-w-[1rem] text-center font-semibold tabular-nums ${compact ? 'text-[0.65rem]' : 'text-sm'}`}
        >
          {shown}
        </span>
      </button>
    )
  }

  return (
    <div
      className={
        compact
          ? `flex items-center gap-0.5 ${className}`
          : `inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white ${className}`
      }
    >
      {arrow(1)}
      {arrow(-1)}
    </div>
  )
}
