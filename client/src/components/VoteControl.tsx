/**
 * Reddit-style vote widget for a lecture (SOC-1). Two arrows side by side, each
 * with its own count — ▲ up-votes and ▼ down-votes — kept neutral (black/white)
 * so it reads as a quiet side option. The arrow matching the caller's own vote
 * fills solid. Clicking casts or changes a vote; clicking the active arrow
 * clears it. Updates are optimistic and revert on failure.
 *
 * Voting is offered in the lecture viewer only. Browsable lists show a
 * read-only `RatingBadge` instead, so a list never presents a control that
 * needs a lecture's context to be honest.
 */
import { useState } from 'react'
import { ArrowBigUp, ArrowBigDown } from 'lucide-react'
import type { MyVote, VoteResult } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'

export default function VoteControl({
  deckId,
  up: initialUp,
  down: initialDown,
  myVote: initialVote,
  className = '',
}: {
  deckId: string
  up: number
  down: number
  myVote: MyVote
  className?: string
}) {
  const [up, setUp] = useState(initialUp)
  const [down, setDown] = useState(initialDown)
  const [myVote, setMyVote] = useState<MyVote>(initialVote)
  const [pending, setPending] = useState(false)

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
      const res = await dispatchAction<VoteResult>('deck.vote', {
        deckId,
        value: next,
      })
      setUp(res.up)
      setDown(res.down)
      setMyVote(res.myVote)
    } catch {
      setUp(prev.up)
      setDown(prev.down)
      setMyVote(prev.vote)
    } finally {
      setPending(false)
    }
  }

  const arrow = (dir: 1 | -1) => {
    const Icon = dir === 1 ? ArrowBigUp : ArrowBigDown
    const active = myVote === dir
    const count = dir === 1 ? up : down
    // Down-votes read as negative (1 down → -1, 2 → -2); -0 renders as "0".
    const shown = dir === 1 ? count : -count
    const label = dir === 1 ? 'Upvote' : 'Downvote'
    const solid = active ? 'fill-current text-slate-900' : ''
    return (
      <button
        key={dir}
        type="button"
        onClick={() => void cast(dir)}
        disabled={pending}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className="flex items-center gap-1 rounded-full px-2.5 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
      >
        <Icon className={`h-5 w-5 ${solid}`} aria-hidden />
        <span className="min-w-[1rem] text-center text-sm font-semibold tabular-nums">
          {shown}
        </span>
      </button>
    )
  }

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white ${className}`}
    >
      {arrow(1)}
      {arrow(-1)}
    </div>
  )
}
