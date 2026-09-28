/**
 * Unit tests for the VoteControl (SOC-1/TMPL-27): the two side-by-side arrows
 * each show their own count (▲ up-votes, ▼ down-votes), the active arrow
 * reads as pressed, voting is optimistic with revert on failure, and the
 * target it dispatches to follows `target.kind` rather than being hardwired
 * to a lecture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import VoteControl from './VoteControl'
import { dispatchAction } from '../api/actions'

vi.mock('../api/actions', () => ({ dispatchAction: vi.fn() }))
const mockDispatch = vi.mocked(dispatchAction)

beforeEach(() => {
  mockDispatch.mockReset()
})

const up = () => screen.getByRole('button', { name: 'Upvote Thing' })
const down = () => screen.getByRole('button', { name: 'Downvote Thing' })

const deckTarget = { kind: 'deck' as const, id: 'd1' }
const templateTarget = { kind: 'template' as const, id: 't1' }

describe('VoteControl', () => {
  it('casts an up-vote, incrementing the up count and marking it active', async () => {
    mockDispatch.mockResolvedValue({ up: 1, down: 0, voteScore: 1, myVote: 1 })
    render(
      <VoteControl
        target={deckTarget}
        name="Thing"
        up={0}
        down={0}
        myVote={0}
      />,
    )
    fireEvent.click(up())
    // Optimistic: up count shows 1 immediately
    expect(up()).toHaveTextContent('1')
    await waitFor(() => expect(up()).toHaveAttribute('aria-pressed', 'true'))
    expect(mockDispatch).toHaveBeenCalledWith('deck.vote', {
      deckId: 'd1',
      value: 1,
    })
  })

  it('dispatches template.vote for a template target', async () => {
    mockDispatch.mockResolvedValue({ up: 1, down: 0, voteScore: 1, myVote: 1 })
    render(
      <VoteControl
        target={templateTarget}
        name="Thing"
        up={0}
        down={0}
        myVote={0}
      />,
    )
    fireEvent.click(up())
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith('template.vote', {
        templateId: 't1',
        value: 1,
      }),
    )
  })

  it('clears the vote when the active arrow is clicked again', async () => {
    mockDispatch.mockResolvedValue({ up: 0, down: 0, voteScore: 0, myVote: 0 })
    render(
      <VoteControl
        target={deckTarget}
        name="Thing"
        up={1}
        down={0}
        myVote={1}
      />,
    )
    fireEvent.click(up())
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenLastCalledWith('deck.vote', {
        deckId: 'd1',
        value: 0,
      }),
    )
    expect(up()).toHaveAttribute('aria-pressed', 'false')
    expect(up()).toHaveTextContent('0')
  })

  it('switches from up to down in one click', async () => {
    mockDispatch.mockResolvedValue({
      up: 0,
      down: 1,
      voteScore: -1,
      myVote: -1,
    })
    render(
      <VoteControl
        target={deckTarget}
        name="Thing"
        up={1}
        down={0}
        myVote={1}
      />,
    )
    fireEvent.click(down())
    await waitFor(() => expect(down()).toHaveAttribute('aria-pressed', 'true'))
    expect(up()).toHaveAttribute('aria-pressed', 'false')
    expect(down()).toHaveTextContent('1')
    expect(mockDispatch).toHaveBeenCalledWith('deck.vote', {
      deckId: 'd1',
      value: -1,
    })
  })

  it('reverts the optimistic update when the vote fails', async () => {
    mockDispatch.mockRejectedValueOnce(new Error('boom'))
    render(
      <VoteControl
        target={deckTarget}
        name="Thing"
        up={5}
        down={0}
        myVote={0}
      />,
    )
    fireEvent.click(up())
    await waitFor(() => expect(up()).toHaveAttribute('aria-pressed', 'false'))
    expect(up()).toHaveTextContent('5')
  })

  it('shows the down-vote count as a negative number', () => {
    render(
      <VoteControl
        target={deckTarget}
        name="Thing"
        up={5}
        down={2}
        myVote={0}
      />,
    )
    // Up stays positive, down reads negative: ▲ 5  ▼ -2
    expect(up()).toHaveTextContent('5')
    expect(down()).toHaveTextContent('-2')
  })

  it('renders zero down-votes as 0, not -0', () => {
    render(
      <VoteControl
        target={deckTarget}
        name="Thing"
        up={0}
        down={0}
        myVote={0}
      />,
    )
    expect(down()).toHaveTextContent('0')
    expect(down()).not.toHaveTextContent('-0')
  })

  it('calls onChange with the settled result once a vote resolves', async () => {
    const onChange = vi.fn()
    mockDispatch.mockResolvedValue({ up: 1, down: 0, voteScore: 1, myVote: 1 })
    render(
      <VoteControl
        target={templateTarget}
        name="Thing"
        up={0}
        down={0}
        myVote={0}
        onChange={onChange}
      />,
    )
    fireEvent.click(up())
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        up: 1,
        down: 0,
        voteScore: 1,
        myVote: 1,
      }),
    )
  })

  // TMPL-27 round 2: a caller re-rendering with new counts (a library
  // reload after a duplicate, a delete, or another vote settling elsewhere)
  // should show them, not whatever this control mounted with — the same
  // component instance is not remounted just because its props changed.
  it('adopts fresh up/down/myVote props when nothing is pending', () => {
    const { rerender } = render(
      <VoteControl
        target={deckTarget}
        name="Thing"
        up={0}
        down={0}
        myVote={0}
      />,
    )
    expect(up()).toHaveTextContent('0')

    rerender(
      <VoteControl
        target={deckTarget}
        name="Thing"
        up={5}
        down={2}
        myVote={1}
      />,
    )
    expect(up()).toHaveTextContent('5')
    expect(down()).toHaveTextContent('-2')
    expect(up()).toHaveAttribute('aria-pressed', 'true')
  })

  // The other half of round 2's fix: adopting props must not undo a vote's
  // own optimistic update the instant its response clears `pending` — the
  // response settles the count, and would otherwise be clobbered a tick
  // later by props the caller has not refreshed yet.
  it('does not let a settling vote’s own result get overwritten by stale props', async () => {
    mockDispatch.mockResolvedValue({ up: 1, down: 0, voteScore: 1, myVote: 1 })
    render(
      <VoteControl
        target={deckTarget}
        name="Thing"
        up={0}
        down={0}
        myVote={0}
      />,
    )
    fireEvent.click(up())
    await waitFor(() => expect(up()).toHaveAttribute('aria-pressed', 'true'))
    // The vote's own response, not the stale `up={0}` prop this render
    // started with.
    expect(up()).toHaveTextContent('1')
  })

  it('does not let a click bubble to an ancestor (a card is not selected by voting)', () => {
    const onCardClick = vi.fn()
    render(
      <div onClick={onCardClick}>
        <VoteControl
          target={templateTarget}
          name="Thing"
          up={0}
          down={0}
          myVote={0}
          size="compact"
        />
      </div>,
    )
    fireEvent.click(up())
    expect(onCardClick).not.toHaveBeenCalled()
  })
})
