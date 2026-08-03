/**
 * Unit tests for the VoteControl (SOC-1): the two side-by-side arrows each show
 * their own count (▲ up-votes, ▼ down-votes), the active arrow reads as
 * pressed, and voting is optimistic with revert on failure.
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

const up = () => screen.getByRole('button', { name: 'Upvote' })
const down = () => screen.getByRole('button', { name: 'Downvote' })

describe('VoteControl', () => {
  it('casts an up-vote, incrementing the up count and marking it active', async () => {
    mockDispatch.mockResolvedValue({ up: 1, down: 0, voteScore: 1, myVote: 1 })
    render(<VoteControl deckId="d1" up={0} down={0} myVote={0} />)
    fireEvent.click(up())
    // Optimistic: up count shows 1 immediately
    expect(up()).toHaveTextContent('1')
    await waitFor(() => expect(up()).toHaveAttribute('aria-pressed', 'true'))
    expect(mockDispatch).toHaveBeenCalledWith('deck.vote', {
      deckId: 'd1',
      value: 1,
    })
  })

  it('clears the vote when the active arrow is clicked again', async () => {
    mockDispatch.mockResolvedValue({ up: 0, down: 0, voteScore: 0, myVote: 0 })
    render(<VoteControl deckId="d1" up={1} down={0} myVote={1} />)
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
    render(<VoteControl deckId="d1" up={1} down={0} myVote={1} />)
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
    render(<VoteControl deckId="d1" up={5} down={0} myVote={0} />)
    fireEvent.click(up())
    await waitFor(() => expect(up()).toHaveAttribute('aria-pressed', 'false'))
    expect(up()).toHaveTextContent('5')
  })

  it('shows the down-vote count as a negative number', () => {
    render(<VoteControl deckId="d1" up={5} down={2} myVote={0} />)
    // Up stays positive, down reads negative: ▲ 5  ▼ -2
    expect(up()).toHaveTextContent('5')
    expect(down()).toHaveTextContent('-2')
  })

  it('renders zero down-votes as 0, not -0', () => {
    render(<VoteControl deckId="d2" up={0} down={0} myVote={0} />)
    expect(down()).toHaveTextContent('0')
    expect(down()).not.toHaveTextContent('-0')
  })
})
