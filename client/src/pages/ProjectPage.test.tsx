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
  templateId: 'classic',
  effectiveGenerationFreedom: 3,
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
      await screen.findByRole('button', {
        name: 'Start a new lecture in Physics',
      }),
    )

    await vi.waitFor(() => expect(sent).toEqual({ projectId: 'p1' }))
    expect(await screen.findByText('VIEWER')).toBeInTheDocument()
  })

  /** Selects a YAML file in the (hidden) import input. */
  const importFile = (content: string) => {
    const file = new File([content], 'deck.yaml', {
      type: 'application/x-yaml',
    })
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('imports a lecture from a file and lists it with a notice', async () => {
    let sent: unknown
    mockFetchRoutes({
      ...baseRoutes,
      '/api/actions/deck.import': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            deck: {
              id: 'd9',
              projectId: 'p1',
              title: 'Imported Deck',
              permalinkSlug: 'imported-deck-xyz',
              slideOrder: [],
              updatedAt: new Date().toISOString(),
            },
            warnings: [],
          },
        }
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Lectures' })

    importFile('version: 1\nkind: deck\ntitle: Imported Deck\n')

    await vi.waitFor(() =>
      expect(sent).toEqual({
        projectId: 'p1',
        content: 'version: 1\nkind: deck\ntitle: Imported Deck\n',
      }),
    )
    expect(
      await screen.findByText('Imported "Imported Deck".'),
    ).toBeInTheDocument()
    // The imported lecture is added to the list.
    expect(
      screen.getByRole('link', { name: /Imported Deck/ }),
    ).toBeInTheDocument()
  })

  it('surfaces import warnings in the notice', async () => {
    mockFetchRoutes({
      ...baseRoutes,
      '/api/actions/deck.import': () => ({
        status: 200,
        body: {
          deck: {
            id: 'd9',
            projectId: 'p1',
            title: 'X',
            permalinkSlug: 'x-1',
            slideOrder: [],
            updatedAt: new Date().toISOString(),
          },
          warnings: [
            'Unknown template "foo" — using the default template instead.',
          ],
        },
      }),
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Lectures' })
    importFile('version: 1\nkind: deck\ntitle: X\n')
    expect(await screen.findByText(/Unknown template/)).toBeInTheDocument()
  })

  it('shows the validation problems when an import is rejected', async () => {
    mockFetchRoutes({
      ...baseRoutes,
      '/api/actions/deck.import': () => ({
        status: 400,
        body: {
          error: {
            code: 'invalid_input',
            message: 'Invalid input',
            details: ['slides: Required', 'title: Required'],
          },
        },
      }),
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Lectures' })
    importFile('kind: deck\n')
    expect(
      await screen.findByText(/slides: Required title: Required/),
    ).toBeInTheDocument()
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

  it('sets the project default template from the Design tab', async () => {
    let sent: unknown
    mockFetchRoutes({
      ...baseRoutes,
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
      '/api/actions/template.list': () => ({
        status: 200,
        body: [
          {
            id: 'classic',
            name: 'Classic',
            theme: {},
            layouts: [],
            visibility: 'public',
            voteScore: 0,
            ownerId: 'system',
            createdAt: '',
          },
          {
            id: 'midnight',
            name: 'Midnight',
            theme: {},
            layouts: [],
            visibility: 'public',
            voteScore: 0,
            ownerId: 'system',
            createdAt: '',
          },
        ],
      }),
      '/api/actions/project.switchTemplate': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: { ...project, templateId: 'midnight' } }
      },
    })
    renderPage()

    fireEvent.click(
      await vi.waitFor(() =>
        screen.getByRole('button', { name: 'Project settings' }),
      ),
    )
    fireEvent.click(await screen.findByRole('tab', { name: 'Design' }))
    fireEvent.click(await screen.findByRole('radio', { name: /midnight/i }))

    await vi.waitFor(() =>
      expect(sent).toEqual({ projectId: 'p1', templateId: 'midnight' }),
    )
  })

  it('opens settings when deep-linked from a lecture', async () => {
    mockFetchRoutes({
      ...baseRoutes,
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
    })
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/app/projects/p1', state: { openSettings: true } },
        ]}
      >
        <AuthProvider>
          <Routes>
            <Route path="/app/projects/:projectId" element={<ProjectPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(
      await screen.findByRole('dialog', { name: 'Project settings' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/apply across all lectures/i)).toBeInTheDocument()
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
