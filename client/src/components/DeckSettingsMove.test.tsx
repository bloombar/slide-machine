/**
 * Tests for the lecture settings "Project" control (PROJ-3): the owner is
 * offered the projects they own, picking one dispatches deck.move, and
 * everyone else is offered nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Deck, Project } from '@slide-machine/shared'
import { mockFetchRoutes } from '../test/fetch-mock'
import DeckSettingsModal from './DeckSettingsModal'

const baseDeck: Deck = {
  id: 'd1',
  projectId: 'p1',
  ownerId: 'u1',
  title: 'Lecture',
  templateId: 'classic',
  visibility: 'public',
  accessInherited: true,
  permalinkSlug: 'lecture-1',
  slideOrder: ['s1'],
  voteScore: 0,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  hasRecordings: false,
}

const project = (id: string, title: string): Project => ({
  id,
  ownerId: 'u1',
  title,
  visibility: 'public',
  templateId: 'classic',
  effectiveGenerationFreedom: 2,
  viewers: [],
  editors: [],
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
})

const renderModal = (
  props: { isOwner?: boolean; projectTitle?: string } = {},
) => {
  const onDeckChange = vi.fn()
  const onMoved = vi.fn()
  render(
    <MemoryRouter>
      <DeckSettingsModal
        deck={baseDeck}
        projectGenerationFreedom={2}
        isOwner={props.isOwner ?? true}
        projectTitle={props.projectTitle}
        onClose={vi.fn()}
        onTemplateChange={vi.fn()}
        onDeckChange={onDeckChange}
        onDeleted={vi.fn()}
        onMoved={onMoved}
        onReformatted={vi.fn()}
      />
    </MemoryRouter>,
  )
  return { onDeckChange, onMoved }
}

afterEach(cleanup)

describe('DeckSettingsModal — Project (PROJ-3)', () => {
  it('offers the owner their projects, on the one the lecture is in', async () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.list': () => ({
        status: 200,
        body: [project('p1', 'Physics'), project('p2', 'Chemistry')],
      }),
    })
    renderModal()

    const select = (await screen.findByRole('combobox', {
      name: 'Project',
    })) as HTMLSelectElement
    expect(select.value).toBe('p1')
    expect([...select.options].map(o => [o.value, o.textContent])).toEqual([
      ['p1', 'Physics'],
      ['p2', 'Chemistry'],
    ])
  })

  it('moves the lecture to the project picked, and reports back', async () => {
    const moved = { ...baseDeck, projectId: 'p2' }
    const bodies: unknown[] = []
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.list': () => ({
        status: 200,
        body: [project('p1', 'Physics'), project('p2', 'Chemistry')],
      }),
      '/api/actions/deck.move': init => {
        bodies.push(JSON.parse(String(init?.body)))
        return { status: 200, body: moved }
      },
    })
    const { onDeckChange, onMoved } = renderModal()

    const select = await screen.findByRole('combobox', { name: 'Project' })
    fireEvent.change(select, { target: { value: 'p2' } })

    await waitFor(() => expect(onDeckChange).toHaveBeenCalledWith(moved))
    expect(bodies).toEqual([{ deckId: 'd1', projectId: 'p2' }])
    // The viewer reloads: everything the lecture inherits has changed.
    expect(onMoved).toHaveBeenCalled()
  })

  it('keeps the lecture’s own project on the list when the owner does not own it', async () => {
    // A project handed to someone else keeps its lectures with their
    // owners, so the lecture sits somewhere its owner cannot move it back to.
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.list': () => ({
        status: 200,
        body: [project('p2', 'Chemistry')],
      }),
    })
    renderModal({ projectTitle: 'Physics' })

    const select = (await screen.findByRole('combobox', {
      name: 'Project',
    })) as HTMLSelectElement
    expect(select.value).toBe('p1')
    expect([...select.options].map(o => o.textContent)).toEqual([
      'Physics',
      'Chemistry',
    ])
  })

  it('offers nothing when there is nowhere else to move to', async () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.list': () => ({
        status: 200,
        body: [project('p1', 'Physics')],
      }),
    })
    renderModal()

    await screen.findByRole('textbox', { name: 'Lecture title' })
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull()
  })

  it('does not offer the move to an editor who does not own the lecture', async () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      // project.list is not mocked: an editor must not even ask for it
    })
    renderModal({ isOwner: false })

    await screen.findByRole('textbox', { name: 'Lecture title' })
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull()
  })
})
