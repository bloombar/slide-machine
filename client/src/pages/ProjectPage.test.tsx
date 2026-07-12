/**
 * Unit tests for the project page: lectures listed up front, the +
 * starting an untitled lecture immediately, and the settings modal
 * (seed notes auto-save + project deletion with confirmation).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import ProjectPage from './ProjectPage'
import { AuthProvider } from '../auth/AuthContext'
import { mockFetchRoutes } from '../test/fetch-mock'

const project = {
  id: 'p1',
  ownerId: 'u1',
  title: 'Physics',
  seedContext: 'Existing notes',
  visibility: 'public',
  createdAt: '2026-07-01T00:00:00.000Z',
}

const baseRoutes = {
  '/api/auth/refresh': () => ({
    status: 200,
    body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
  }),
  '/api/actions/project.get': () => ({ status: 200, body: project }),
  '/api/actions/deck.list': () => ({
    status: 200,
    body: [
      {
        id: 'd1',
        projectId: 'p1',
        title: 'Waves',
        permalinkSlug: 'waves-abc123',
        slideOrder: ['s1'],
        updatedAt: new Date().toISOString(),
      },
    ],
  }),
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/app/projects/p1']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/projects/:projectId" element={<ProjectPage />} />
          <Route path="/d/:slug" element={<div>VIEWER</div>} />
          <Route path="/app" element={<div>HOME</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProjectPage', () => {
  it('lists lectures up front with their metadata', async () => {
    mockFetchRoutes(baseRoutes)
    renderPage()
    expect(
      await screen.findByRole('heading', { name: 'Lectures' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Waves/ })).toHaveAttribute(
      'href',
      '/d/waves-abc123',
    )
  })

  it('renames the project title in place', async () => {
    vi.useFakeTimers()
    let sent: unknown
    mockFetchRoutes({
      ...baseRoutes,
      '/api/actions/project.update': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: { ...project, title: 'Physics II' } }
      },
    })
    renderPage()

    fireEvent.click(
      await vi.waitFor(() => screen.getByTitle('Click to edit Project title')),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Project title' }), {
      target: { value: 'Physics II' },
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Project title' }), {
      key: 'Enter',
    })
    vi.advanceTimersByTime(800)

    await vi.waitFor(() =>
      expect(sent).toEqual({ projectId: 'p1', title: 'Physics II' }),
    )
    vi.useRealTimers()
  })

  it('starts an untitled lecture from the + beside Lectures', async () => {
    let sent: unknown
    mockFetchRoutes({
      ...baseRoutes,
      '/api/actions/deck.create': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { id: 'd2', title: '', permalinkSlug: 'untitled-abc123' },
        }
      },
    })
    renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Start a new lecture' }),
    )

    await vi.waitFor(() =>
      expect(sent).toEqual({ projectId: 'p1', templateId: 'classic' }),
    )
    expect(await screen.findByText('VIEWER')).toBeInTheDocument()
  })

  it('auto-saves seed notes from the settings modal', async () => {
    vi.useFakeTimers()
    let sent: unknown
    mockFetchRoutes({
      ...baseRoutes,
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.update': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { ...project, seedContext: 'Existing notes, updated' },
        }
      },
    })
    renderPage()

    fireEvent.click(
      await vi.waitFor(() =>
        screen.getByRole('button', { name: 'Project settings' }),
      ),
    )
    const box = await vi.waitFor(() =>
      screen.getByRole('textbox', { name: 'Project seed notes' }),
    )
    expect(box).toHaveValue('Existing notes')

    fireEvent.change(box, { target: { value: 'Existing notes, updated' } })
    vi.advanceTimersByTime(800)

    await vi.waitFor(() =>
      expect(sent).toEqual({
        projectId: 'p1',
        seedContext: 'Existing notes, updated',
      }),
    )
    vi.useRealTimers()
  })

  it('deletes the project from the Danger zone after confirmation', async () => {
    let deleted = false
    mockFetchRoutes({
      ...baseRoutes,
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.delete': () => {
        deleted = true
        return { status: 200, body: { deleted: true } }
      },
    })
    renderPage()

    fireEvent.click(
      await vi.waitFor(() =>
        screen.getByRole('button', { name: 'Project settings' }),
      ),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete project' }),
    )

    // Cancel first: nothing happens
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(deleted).toBe(false)

    // Confirm: the project goes and the page leaves for home
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('HOME')).toBeInTheDocument()
    expect(deleted).toBe(true)
  })
})
