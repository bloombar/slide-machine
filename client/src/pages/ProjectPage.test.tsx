/**
 * Unit tests for the project page: lectures listed up front, the +
 * starting an untitled lecture immediately, the settings modal (seed
 * notes auto-save + project deletion with confirmation), and an admin
 * editing another user's project settings there (ADMIN-5).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import ProjectPage from './ProjectPage'
import { AuthProvider } from '../auth/AuthContext'
import { resetAdminStatus } from '../hooks/useIsAdmin'
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

/** Opens the project's settings through its kebab — the same menu the home
 * screen shows beside each project, rather than a settings button of its own.
 * Named exactly: every lecture row carries a kebab of its own. */
const openProjectSettings = async () => {
  fireEvent.click(
    await vi.waitFor(() =>
      screen.getByRole('button', { name: `Options for ${project.title}` }),
    ),
  )
  // The menu opens synchronously on click, so read it directly — a polling
  // query would stall in the specs that install fake timers.
  fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
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
  // The admin check caches its answer per account for the session
  resetAdminStatus()
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

  it('names the owner under the title, linking to their profile', async () => {
    mockFetchRoutes({
      ...baseRoutes,
      '/api/actions/project.get': () => ({
        status: 200,
        body: { ...project, owner: { id: 'u1', displayName: 'ada@nyu.edu' } },
      }),
    })
    renderPage()

    // An email-shaped display name reads as its handle, as in the greeting
    const byline = await screen.findByRole('link', { name: 'ada' })
    expect(byline).toHaveAttribute('href', '/u/u1')
  })

  it('leaves the byline out when the owner is unknown', async () => {
    mockFetchRoutes(baseRoutes)
    renderPage()
    await screen.findByRole('heading', { name: 'Lectures' })

    expect(screen.queryByRole('link', { name: /^u1$/ })).toBeNull()
  })

  it('the Lectures "+" offers New lecture and one import, but no New project', async () => {
    mockFetchRoutes(baseRoutes)
    renderPage()
    await screen.findByRole('heading', { name: 'Lectures' })

    fireEvent.click(screen.getByRole('button', { name: 'Create new' }))
    // One import entry whatever the material is: a file this app exported
    // (EXP-3) and a deck the instructor teaches from (EXP-5) are the same
    // errand, and the panel asks which rather than the menu.
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual([
      'New lecture',
      'Import a lecture',
    ])
  })

  it('the "+" opens a panel offering both sources', async () => {
    mockFetchRoutes(baseRoutes)
    renderPage()
    await screen.findByRole('heading', { name: 'Lectures' })

    fireEvent.click(screen.getByRole('button', { name: 'Create new' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import a lecture' }))

    expect(
      await screen.findByRole('button', { name: /choose a presentation/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/import a lecture file/i)).toBeInTheDocument()
  })

  it('the project kebab no longer carries Import — the "+" does', async () => {
    mockFetchRoutes(baseRoutes)
    renderPage()
    await screen.findByRole('heading', { name: 'Lectures' })

    fireEvent.click(
      screen.getByRole('button', { name: `Options for ${project.title}` }),
    )
    const menu = screen.getByRole('menu', {
      name: `Options for ${project.title}`,
    })
    expect(menu.textContent).not.toMatch(/Import/)
  })

  it('starts a lecture from the "+" menu', async () => {
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
    await screen.findByRole('heading', { name: 'Lectures' })

    fireEvent.click(screen.getByRole('button', { name: 'Create new' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New lecture' }))

    await vi.waitFor(() => expect(sent).toEqual({ projectId: 'p1' }))
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
  /** Drops a file on the hidden import input. Awaits it: the input lives in
   * the new-lecture zone, which only editors see, so it appears once the
   * viewer's rights resolve rather than with the first paint. */
  /** Imports a file the way the screen does: one entry, then the source. */
  const importFile = async (content: string) => {
    const file = new File([content], 'deck.yaml', {
      type: 'application/x-yaml',
    })
    // The "+" no longer picks a file; it opens the panel that asks where the
    // lecture is coming from.
    if (!document.querySelector('input[type="file"]')) {
      fireEvent.click(screen.getByRole('button', { name: 'Create new' }))
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'Import a lecture' }),
      )
    }
    const input = await vi.waitFor(() => {
      const el = document.querySelector('input[type="file"]')
      if (!el) throw new Error('import input not rendered yet')
      return el as HTMLInputElement
    })
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

    await importFile('version: 1\nkind: deck\ntitle: Imported Deck\n')

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
    await importFile('version: 1\nkind: deck\ntitle: X\n')
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
    await importFile('kind: deck\n')
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

    await openProjectSettings()
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

    await openProjectSettings()
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

    await openProjectSettings()
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

describe('ProjectPage admin settings (ADMIN-5)', () => {
  // Signed in as an admin who owns nothing here: the project is Ada's.
  const adminRoutes = (isAdmin = true) => ({
    ...baseRoutes,
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: { id: 'admin1', displayName: 'Root' }, accessToken: 't' },
    }),
    '/api/admin/status': () =>
      isAdmin ? { status: 200, body: { isAdmin: true } } : { status: 403 },
    '/api/actions/template.list': () => ({ status: 200, body: [] }),
  })

  const openSettings = async () => {
    await openProjectSettings()
  }

  it('asks before opening another user’s settings, then shows the banner', async () => {
    mockFetchRoutes(adminRoutes())
    renderPage()
    await openSettings()

    const dialog = await screen.findByRole('alertdialog', {
      name: "Edit this project's settings?",
    })
    expect(dialog).toHaveTextContent(/recorded in the audit log/i)
    // Nothing is editable until the admin acknowledges it
    expect(
      screen.queryByRole('dialog', { name: 'Project settings' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
    const settings = await screen.findByRole('dialog', {
      name: 'Project settings',
    })
    expect(settings).toHaveTextContent(
      /editing another user's project as an admin/i,
    )
    // Uploading into someone else's project is not a settings edit
    expect(screen.queryByText('Seed material')).not.toBeInTheDocument()
    // Deleting it belongs to the owner (and to the admin console)
    expect(
      screen.queryByRole('button', { name: 'Delete project' }),
    ).not.toBeInTheDocument()
  })

  it('leaves the settings shut when the admin declines', async () => {
    mockFetchRoutes(adminRoutes())
    renderPage()
    await openSettings()

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(
      screen.queryByRole('dialog', { name: 'Project settings' }),
    ).not.toBeInTheDocument()
  })

  it('never asks the owner, and shows no admin banner', async () => {
    mockFetchRoutes({
      ...baseRoutes,
      '/api/admin/status': () => ({ status: 200, body: { isAdmin: true } }),
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
    })
    renderPage()
    await openSettings()

    const settings = await screen.findByRole('dialog', {
      name: 'Project settings',
    })
    expect(settings).not.toHaveTextContent(/as an admin/i)
    expect(screen.getByText('Seed material')).toBeVisible()
  })
})

/**
 * A public project is browsable read-only by anyone (SOC-2 discovery), so a
 * signed-in stranger reaches this page. They must see the lectures and nothing
 * that implies they can change the project.
 */
describe('ProjectPage read-only visitor (SOC-2)', () => {
  // Signed in as someone who neither owns the project nor is an admin.
  const strangerRoutes = {
    ...baseRoutes,
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: { id: 'u9', displayName: 'Byron' }, accessToken: 't' },
    }),
    '/api/admin/status': () => ({ status: 403 }),
  }

  it('shows the lectures but offers no owner controls', async () => {
    mockFetchRoutes(strangerRoutes)
    renderPage()
    // The project's content is readable
    expect(
      await screen.findByRole('heading', { name: 'Lectures' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Waves/ })).toBeInTheDocument()
    // …but nothing that edits it
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Project settings' }),
      ).toBeNull(),
    )
    expect(screen.queryByRole('button', { name: /new lecture/i })).toBeNull()
  })
})
