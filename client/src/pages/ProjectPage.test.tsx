/**
 * Unit tests for the project page: seed notes load and auto-save
 * through project.update (PROJ-1).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import ProjectPage from './ProjectPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const project = {
  id: 'p1',
  ownerId: 'u1',
  title: 'Physics',
  seedContext: 'Existing notes',
  createdAt: '2026-07-01T00:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProjectPage lecture creation', () => {
  it('starts an untitled lecture when the title is left empty', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/project.get': () => ({ status: 200, body: project }),
      '/api/actions/deck.list': () => ({ status: 200, body: [] }),
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.create': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            id: 'd1',
            title: '',
            permalinkSlug: 'untitled-abc123',
            slideOrder: [],
          },
        }
      },
    })
    render(
      <MemoryRouter initialEntries={['/app/projects/p1']}>
        <Routes>
          <Route path="/app/projects/:projectId" element={<ProjectPage />} />
          <Route path="/d/:slug" element={<div>VIEWER</div>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(
      await vi.waitFor(() =>
        screen.getByRole('button', { name: 'Start lecture' }),
      ),
    )

    await vi.waitFor(() =>
      expect(sent).toEqual({
        projectId: 'p1',
        title: '',
        templateId: 'classic',
      }),
    )
    expect(await screen.findByText('VIEWER')).toBeInTheDocument()
  })
})

describe('ProjectPage seed notes', () => {
  it('loads existing notes and auto-saves edits via project.update', async () => {
    vi.useFakeTimers()
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/project.get': () => ({ status: 200, body: project }),
      '/api/actions/deck.list': () => ({ status: 200, body: [] }),
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.update': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { ...project, seedContext: 'Existing notes, updated' },
        }
      },
    })
    render(
      <MemoryRouter initialEntries={['/app/projects/p1']}>
        <Routes>
          <Route path="/app/projects/:projectId" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const box = await vi.waitFor(() =>
      screen.getByRole('textbox', { name: 'Project seed notes' }),
    )
    expect(box).toHaveValue('Existing notes')

    fireEvent.change(box, {
      target: { value: 'Existing notes, updated' },
    })
    vi.advanceTimersByTime(800)

    await vi.waitFor(() =>
      expect(sent).toEqual({
        projectId: 'p1',
        seedContext: 'Existing notes, updated',
      }),
    )
    vi.useRealTimers()
  })
})
